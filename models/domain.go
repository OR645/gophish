package models

import (
	"errors"
	"fmt"
	"strings"
	"time"

	log "github.com/gophish/gophish/logger"
	"github.com/gophish/gophish/webhook"
)

// Domain represents a sending / landing domain that has already been purchased
// and is managed through the Domains page. A domain optionally belongs to a
// Company (via CompanyId); when it does, the campaign wizard uses it to
// auto-fill the listener URL and pick a matching sending profile.
//
// gophish does not perform DNS / Microsoft 365 provisioning itself. When a
// domain is created, a webhook is dispatched to n8n (if configured) carrying
// the desired record set, and n8n performs the actual Cloudflare + Microsoft
// Graph work plus any additional steps.
type Domain struct {
	Id           int64     `json:"id"`
	UserId       int64     `json:"-"`
	CompanyId    int64     `json:"company_id"`
	Name         string    `json:"name"`
	IP           string    `json:"ip"`
	Registrar    string    `json:"registrar"`
	AutoARecord  bool      `json:"auto_a_record"`
	Configure365 bool      `json:"configure_365"`
	Status       string    `json:"status"`      // pending | verified | failed
	M365Status   string    `json:"m365_status"` // not_connected | connected
	ModifiedDate time.Time `json:"modified_date"`
	// Records is not persisted; it is populated on create so the UI can show
	// the desired record set that was sent to n8n.
	Records []DNSRecord `json:"records,omitempty" gorm:"-"`
}

// TableName specifies the database table name for Gorm to use.
func (d Domain) TableName() string {
	return "domains"
}

// DNSRecord describes a single DNS record in the desired record set for a
// domain. It is used for display and as part of the n8n webhook payload.
type DNSRecord struct {
	Type     string `json:"type"`
	Host     string `json:"host"`
	Value    string `json:"value"`
	TTL      string `json:"ttl"`
	Priority int    `json:"priority,omitempty"`
	Label    string `json:"label,omitempty"`
}

// DomainWebhookPayload is the body POSTed to the configured n8n webhook when a
// domain is created.
type DomainWebhookPayload struct {
	Event        string      `json:"event"`
	Domain       string      `json:"domain"`
	IP           string      `json:"ip"`
	Registrar    string      `json:"registrar"`
	CompanyId    int64       `json:"company_id"`
	CompanyName  string      `json:"company_name"`
	AutoARecord  bool        `json:"auto_a_record"`
	Configure365 bool        `json:"configure_365"`
	Records      []DNSRecord `json:"records"`
}

// ErrDomainNameNotSpecified is thrown when a domain name is not specified.
var ErrDomainNameNotSpecified = errors.New("Domain name not specified")

// Validate performs validation on a domain given by the user.
func (d *Domain) Validate() error {
	if d.Name == "" {
		return ErrDomainNameNotSpecified
	}
	return nil
}

// GetDomains returns the domains owned by the given user. Administrators
// receive the domains owned by every user.
func GetDomains(uid int64) ([]Domain, error) {
	ds := []Domain{}
	query := db.Model(&Domain{})
	if !userIsAdmin(uid) {
		query = query.Where("user_id=?", uid)
	}
	err := query.Order("name asc").Find(&ds).Error
	if err != nil {
		log.Error(err)
		return ds, err
	}
	return ds, nil
}

// GetDomainsByCompany returns the domains associated with the given company
// that are visible to the user.
func GetDomainsByCompany(companyId int64, uid int64) ([]Domain, error) {
	ds := []Domain{}
	query := db.Model(&Domain{}).Where("company_id=?", companyId)
	if !userIsAdmin(uid) {
		query = query.Where("user_id=?", uid)
	}
	err := query.Order("name asc").Find(&ds).Error
	if err != nil {
		log.Error(err)
		return ds, err
	}
	return ds, nil
}

// GetDomain returns the domain, if it exists, specified by the given id and
// user_id. Administrators may retrieve a domain owned by any user.
func GetDomain(id int64, uid int64) (Domain, error) {
	d := Domain{}
	query := db.Where("id=?", id)
	if !userIsAdmin(uid) {
		query = query.Where("user_id=?", uid)
	}
	err := query.Find(&d).Error
	if err != nil {
		log.Error(err)
		return d, err
	}
	return d, nil
}

// GetDomainByName returns the domain, if it exists, specified by the given
// name and user_id.
func GetDomainByName(n string, uid int64) (Domain, error) {
	d := Domain{}
	err := db.Where("user_id=? and name=?", uid, n).Find(&d).Error
	if err != nil {
		return d, err
	}
	return d, nil
}

// PostDomain creates a new domain in the database.
func PostDomain(d *Domain) error {
	if err := d.Validate(); err != nil {
		return err
	}
	err := db.Save(d).Error
	if err != nil {
		log.Error(err)
	}
	return err
}

// PutDomain updates the given domain if found in the database.
func PutDomain(d *Domain) error {
	if err := d.Validate(); err != nil {
		return err
	}
	err := db.Where("id=?", d.Id).Save(d).Error
	if err != nil {
		log.Error(err)
	}
	return err
}

// DeleteDomain deletes the specified domain.
func DeleteDomain(id int64, uid int64) error {
	err := db.Where("id=?", id).Delete(&Domain{}).Error
	if err != nil {
		log.Error(err)
	}
	return err
}

// BuildDesiredRecords returns the DNS records that should be provisioned for
// the domain: the root A record (when auto A record is enabled) plus the
// Microsoft 365 mail record set (when 365 configuration is enabled). This
// mirrors the record set shown in the UI mockup and is included in the n8n
// webhook payload.
func BuildDesiredRecords(d Domain) []DNSRecord {
	records := []DNSRecord{}
	if d.AutoARecord {
		ip := d.IP
		if ip == "" {
			ip = "0.0.0.0"
		}
		records = append(records, DNSRecord{
			Type: "A", Host: "@", Value: ip, TTL: "3600",
			Label: "Origin A record",
		})
	}
	if d.Configure365 {
		records = append(records, m365Records(d.Name)...)
	}
	return records
}

// m365Records returns the Microsoft 365 mail record set for a domain. The
// tenant-specific selector hosts are left as placeholders for n8n to resolve
// against the real tenant when it provisions the records.
func m365Records(name string) []DNSRecord {
	slug := strings.ReplaceAll(name, ".", "-")
	return []DNSRecord{
		{Type: "MX", Host: "@", Value: fmt.Sprintf("%s.mail.protection.outlook.com", slug), TTL: "3600", Priority: 0, Label: "Mail routing"},
		{Type: "TXT", Host: "@", Value: "v=spf1 include:spf.protection.outlook.com -all", TTL: "3600", Label: "Sender policy (SPF)"},
		{Type: "CNAME", Host: "autodiscover", Value: "autodiscover.outlook.com", TTL: "3600", Label: "Autodiscover"},
		{Type: "CNAME", Host: "selector1._domainkey", Value: fmt.Sprintf("selector1-%s._domainkey.<tenant>.onmicrosoft.com", slug), TTL: "3600", Label: "DKIM key 1"},
		{Type: "CNAME", Host: "selector2._domainkey", Value: fmt.Sprintf("selector2-%s._domainkey.<tenant>.onmicrosoft.com", slug), TTL: "3600", Label: "DKIM key 2"},
		{Type: "TXT", Host: "_dmarc", Value: fmt.Sprintf("v=DMARC1; p=quarantine; rua=mailto:dmarc@%s", name), TTL: "3600", Label: "DMARC policy"},
	}
}

// notifyN8n dispatches a domain.created event to the configured n8n webhook.
// It is a no-op when no webhook URL is configured. The send happens in a
// goroutine so it never blocks the API response; the webhook package signs the
// payload with the configured secret (X-Gophish-Signature).
func notifyN8n(d Domain, records []DNSRecord) {
	if conf == nil || conf.N8nWebhookURL == "" {
		return
	}
	companyName := ""
	if d.CompanyId != 0 {
		if c, err := GetCompany(d.CompanyId, d.UserId); err == nil {
			companyName = c.Name
		}
	}
	payload := DomainWebhookPayload{
		Event:        "domain.created",
		Domain:       d.Name,
		IP:           d.IP,
		Registrar:    d.Registrar,
		CompanyId:    d.CompanyId,
		CompanyName:  companyName,
		AutoARecord:  d.AutoARecord,
		Configure365: d.Configure365,
		Records:      records,
	}
	endpoint := webhook.EndPoint{
		URL:    conf.N8nWebhookURL,
		Secret: conf.N8nWebhookSecret,
	}
	go func() {
		if err := webhook.Send(endpoint, payload); err != nil {
			log.Errorf("error sending domain webhook to n8n: %v", err)
		}
	}()
}

// NotifyDomainCreated builds the desired record set for a freshly-created
// domain, dispatches the n8n webhook, and returns the records so the caller can
// surface them to the UI.
func NotifyDomainCreated(d Domain) []DNSRecord {
	records := BuildDesiredRecords(d)
	notifyN8n(d, records)
	return records
}
