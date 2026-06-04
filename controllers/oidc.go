package controllers

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gophish/gophish/auth"
	ctx "github.com/gophish/gophish/context"
	log "github.com/gophish/gophish/logger"
	"github.com/gophish/gophish/models"
	"github.com/gorilla/sessions"
)

// Environment variables used to configure Microsoft 365 (Entra ID) SSO.
// When the OIDC variables are set, SSO becomes the default login method and
// password login is disabled unless GOPHISH_ALLOW_PASSWORD_LOGIN is truthy.
const (
	OIDCClientIDEnv       = "GOPHISH_OIDC_CLIENT_ID"
	OIDCClientSecretEnv   = "GOPHISH_OIDC_CLIENT_SECRET"
	OIDCTenantIDEnv       = "GOPHISH_OIDC_TENANT_ID"
	OIDCRedirectURLEnv    = "GOPHISH_OIDC_REDIRECT_URL"
	AllowPasswordLoginEnv = "GOPHISH_ALLOW_PASSWORD_LOGIN"
)

// oidcSettings holds the Microsoft Entra ID OIDC configuration, loaded from
// the environment when the admin server starts.
type oidcSettings struct {
	ClientID      string
	ClientSecret  string
	TenantID      string
	RedirectURL   string
	AllowPassword bool
}

// loadOIDCSettings reads the SSO configuration from the environment.
func loadOIDCSettings() *oidcSettings {
	s := &oidcSettings{
		ClientID:     os.Getenv(OIDCClientIDEnv),
		ClientSecret: os.Getenv(OIDCClientSecretEnv),
		TenantID:     os.Getenv(OIDCTenantIDEnv),
		RedirectURL:  os.Getenv(OIDCRedirectURLEnv),
	}
	switch strings.ToLower(os.Getenv(AllowPasswordLoginEnv)) {
	case "1", "true", "yes", "on":
		s.AllowPassword = true
	}
	// Multi-tenant endpoints are not supported: they would accept tokens
	// from ANY Entra tenant, allowing cross-tenant impersonation. Require a
	// specific directory (tenant) ID.
	switch strings.ToLower(s.TenantID) {
	case "common", "organizations", "consumers":
		log.Errorf("%s must be a directory (tenant) ID, not %q - SSO disabled", OIDCTenantIDEnv, s.TenantID)
		s.TenantID = ""
	}
	return s
}

// Enabled returns whether SSO is fully configured.
func (s *oidcSettings) Enabled() bool {
	return s.ClientID != "" && s.ClientSecret != "" && s.TenantID != ""
}

// PasswordLoginAllowed returns whether username/password login is permitted.
// If SSO isn't configured at all, password login stays enabled so the
// instance can't be locked out by a missing environment variable.
func (s *oidcSettings) PasswordLoginAllowed() bool {
	if !s.Enabled() {
		return true
	}
	return s.AllowPassword
}

// oidcClaims is the subset of Entra ID v2.0 ID token claims we care about.
// Note: the "email" claim is deliberately NOT used - it is not verified by
// Entra ID and must never be trusted for user lookup. UPN/preferred_username
// domains are verified per-tenant, which is safe because exchangeOIDCCode
// strictly validates the tid claim against the configured tenant.
type oidcClaims struct {
	Issuer            string `json:"iss"`
	Audience          string `json:"aud"`
	Expiry            int64  `json:"exp"`
	Nonce             string `json:"nonce"`
	TenantID          string `json:"tid"`
	PreferredUsername string `json:"preferred_username"`
	UPN               string `json:"upn"`
}

// username returns the best human-readable identifier from the claims.
func (c *oidcClaims) username() string {
	for _, v := range []string{c.PreferredUsername, c.UPN} {
		if v != "" {
			return v
		}
	}
	return "unknown user"
}

// oidcRedirectURL returns the redirect URI registered in Entra ID. It can be
// pinned via GOPHISH_OIDC_REDIRECT_URL; otherwise it is derived from the
// request (scheme is taken from X-Forwarded-Proto when behind a proxy).
func (as *AdminServer) oidcRedirectURL(r *http.Request) string {
	if as.oidc.RedirectURL != "" {
		return as.oidc.RedirectURL
	}
	scheme := "https"
	if r.URL.Scheme != "" {
		scheme = r.URL.Scheme
	} else if r.TLS == nil {
		scheme = "http"
	}
	return fmt.Sprintf("%s://%s/auth/callback", scheme, r.Host)
}

// OIDCLogin starts the authorization code flow (with PKCE) against
// Microsoft Entra ID.
func (as *AdminServer) OIDCLogin(w http.ResponseWriter, r *http.Request) {
	if !as.oidc.Enabled() {
		http.Redirect(w, r, "/login", http.StatusFound)
		return
	}
	session := ctx.Get(r, "session").(*sessions.Session)
	state := auth.GenerateSecureKey(32)
	nonce := auth.GenerateSecureKey(32)
	verifier := auth.GenerateSecureKey(32)
	session.Values["oidc_state"] = state
	session.Values["oidc_nonce"] = nonce
	session.Values["oidc_verifier"] = verifier
	if next := r.URL.Query().Get("next"); next != "" {
		session.Values["oidc_next"] = next
	} else {
		delete(session.Values, "oidc_next")
	}
	err := session.Save(r, w)
	if err != nil {
		log.Error(err)
	}
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	q := url.Values{}
	q.Set("client_id", as.oidc.ClientID)
	q.Set("response_type", "code")
	q.Set("response_mode", "query")
	q.Set("redirect_uri", as.oidcRedirectURL(r))
	q.Set("scope", "openid profile email")
	q.Set("state", state)
	q.Set("nonce", nonce)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	authorizeURL := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/authorize?%s",
		url.PathEscape(as.oidc.TenantID), q.Encode())
	http.Redirect(w, r, authorizeURL, http.StatusFound)
}

// OIDCCallback handles the redirect back from Microsoft Entra ID, exchanges
// the authorization code for an ID token and signs the matching Gophish
// user in.
func (as *AdminServer) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	if !as.oidc.Enabled() {
		http.Redirect(w, r, "/login", http.StatusFound)
		return
	}
	session := ctx.Get(r, "session").(*sessions.Session)
	fail := func(message string, err error) {
		if err != nil {
			log.Error(err)
		}
		Flash(w, r, "danger", message)
		session.Save(r, w)
		http.Redirect(w, r, "/login", http.StatusFound)
	}
	// Pop the values stored when the flow started - they are single use.
	state, _ := session.Values["oidc_state"].(string)
	nonce, _ := session.Values["oidc_nonce"].(string)
	verifier, _ := session.Values["oidc_verifier"].(string)
	next, _ := session.Values["oidc_next"].(string)
	delete(session.Values, "oidc_state")
	delete(session.Values, "oidc_nonce")
	delete(session.Values, "oidc_verifier")
	delete(session.Values, "oidc_next")

	query := r.URL.Query()
	if errCode := query.Get("error"); errCode != "" {
		fail(fmt.Sprintf("SSO sign-in failed: %s", errCode), fmt.Errorf("oidc error: %s - %s", errCode, query.Get("error_description")))
		return
	}
	if state == "" || query.Get("state") != state {
		fail("SSO sign-in failed: invalid state. Please try again.", fmt.Errorf("oidc state mismatch"))
		return
	}
	code := query.Get("code")
	if code == "" {
		fail("SSO sign-in failed: missing authorization code.", fmt.Errorf("oidc callback without code"))
		return
	}
	claims, err := as.exchangeOIDCCode(r, code, verifier)
	if err != nil {
		fail("SSO sign-in failed. Please try again.", err)
		return
	}
	if nonce == "" || claims.Nonce != nonce {
		fail("SSO sign-in failed: invalid nonce. Please try again.", fmt.Errorf("oidc nonce mismatch"))
		return
	}
	u, err := findOIDCUser(claims)
	if err != nil {
		fail(fmt.Sprintf("No Gophish account exists for %s. Ask an administrator to create one.", claims.username()), err)
		return
	}
	if u.AccountLocked {
		fail("Account Locked", nil)
		return
	}
	u.LastLogin = time.Now().UTC()
	err = models.PutUser(&u)
	if err != nil {
		log.Error(err)
	}
	session.Values["id"] = u.Id
	err = session.Save(r, w)
	if err != nil {
		log.Error(err)
	}
	// Mirror the sanitization done in nextOrIndex.
	redirect := "/"
	if nextURL, err := url.Parse(next); err == nil {
		if path := nextURL.EscapedPath(); path != "" {
			redirect = "/" + strings.TrimLeft(path, "/")
		}
	}
	http.Redirect(w, r, redirect, http.StatusFound)
}

// exchangeOIDCCode swaps the authorization code for tokens at the Entra ID
// token endpoint and validates the returned ID token claims.
//
// The ID token is received directly from the token endpoint over TLS using
// the client secret, so per OIDC Core 3.1.3.7 the TLS server validation is
// used in place of JWT signature verification. We still validate the
// issuer, audience, expiry, tenant and nonce claims.
func (as *AdminServer) exchangeOIDCCode(r *http.Request, code, verifier string) (*oidcClaims, error) {
	form := url.Values{}
	form.Set("client_id", as.oidc.ClientID)
	form.Set("client_secret", as.oidc.ClientSecret)
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", as.oidcRedirectURL(r))
	form.Set("code_verifier", verifier)
	tokenURL := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token",
		url.PathEscape(as.oidc.TenantID))
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.PostForm(tokenURL, form)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc token endpoint returned %d: %s", resp.StatusCode, body)
	}
	tokenResponse := struct {
		IDToken string `json:"id_token"`
	}{}
	err = json.Unmarshal(body, &tokenResponse)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(tokenResponse.IDToken, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("oidc: malformed id_token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	claims := &oidcClaims{}
	err = json.Unmarshal(payload, claims)
	if err != nil {
		return nil, err
	}
	if claims.Audience != as.oidc.ClientID {
		return nil, fmt.Errorf("oidc: audience mismatch: %s", claims.Audience)
	}
	if time.Now().Unix() > claims.Expiry {
		return nil, fmt.Errorf("oidc: id_token expired")
	}
	if !strings.HasPrefix(claims.Issuer, "https://login.microsoftonline.com/") {
		return nil, fmt.Errorf("oidc: unexpected issuer: %s", claims.Issuer)
	}
	// The token must come from exactly the configured tenant. This is what
	// makes the UPN/preferred_username claims trustworthy for user lookup -
	// those domains are only verified per-tenant.
	if claims.TenantID == "" || !strings.EqualFold(claims.TenantID, as.oidc.TenantID) {
		return nil, fmt.Errorf("oidc: tenant mismatch: %q", claims.TenantID)
	}
	return claims, nil
}

// findOIDCUser maps the ID token claims onto an existing Gophish user. The
// Gophish username must match the Microsoft 365 sign-in address
// (UPN/preferred_username - never the unverified "email" claim), matched
// case-insensitively. Callers must only pass claims whose tid was validated.
func findOIDCUser(claims *oidcClaims) (models.User, error) {
	seen := map[string]bool{}
	candidates := []string{}
	for _, v := range []string{claims.PreferredUsername, claims.UPN} {
		if v == "" {
			continue
		}
		for _, c := range []string{v, strings.ToLower(v)} {
			if !seen[c] {
				seen[c] = true
				candidates = append(candidates, c)
			}
		}
	}
	var lastErr error = fmt.Errorf("oidc: no usable identity claims in id_token")
	for _, c := range candidates {
		u, err := models.GetUserByUsername(c)
		if err == nil {
			return u, nil
		}
		lastErr = err
	}
	return models.User{}, lastErr
}
