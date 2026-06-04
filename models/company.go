package models

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	log "github.com/gophish/gophish/logger"
)

// Company represents an organization that campaigns can be associated with.
// It is a lightweight grouping construct: each campaign optionally references
// a single company via Campaign.CompanyId. NameHe and CustomerId are sourced
// from Hudu (via the n8n hudu-companies webhook): NameHe is the Hebrew display
// name used in generated reports, CustomerId is the Hudu customer id.
type Company struct {
	Id           int64     `json:"id"`
	UserId       int64     `json:"-"`
	Name         string    `json:"name"`
	NameHe       string    `json:"name_he"`
	CustomerId   string    `json:"customer_id"`
	ModifiedDate time.Time `json:"modified_date"`
}

// TableName specifies the database table name for Gorm to use.
func (c Company) TableName() string {
	return "companies"
}

// CompanySummaries is a struct representing the overview of Companies.
type CompanySummaries struct {
	Total     int64     `json:"total"`
	Companies []Company `json:"companies"`
}

// ErrCompanyNameNotSpecified is thrown when a company name is not specified.
var ErrCompanyNameNotSpecified = errors.New("Company name not specified")

// Validate performs validation on a company given by the user.
func (c *Company) Validate() error {
	if c.Name == "" {
		return ErrCompanyNameNotSpecified
	}
	return nil
}

// GetCompanies returns the companies owned by the given user. Administrators
// receive the companies owned by every user.
func GetCompanies(uid int64) ([]Company, error) {
	cs := []Company{}
	query := db.Model(&Company{})
	if !userIsAdmin(uid) {
		query = query.Where("user_id=?", uid)
	}
	err := query.Order("name asc").Find(&cs).Error
	if err != nil {
		log.Error(err)
		return cs, err
	}
	return cs, nil
}

// GetCompany returns the company, if it exists, specified by the given id and
// user_id. Administrators may retrieve a company owned by any user.
func GetCompany(id int64, uid int64) (Company, error) {
	c := Company{}
	query := db.Where("id=?", id)
	if !userIsAdmin(uid) {
		query = query.Where("user_id=?", uid)
	}
	err := query.Find(&c).Error
	if err != nil {
		log.Error(err)
		return c, err
	}
	return c, nil
}

// GetCompanyByName returns the company, if it exists, specified by the given
// name and user_id.
func GetCompanyByName(n string, uid int64) (Company, error) {
	c := Company{}
	err := db.Where("user_id=? and name=?", uid, n).Find(&c).Error
	if err != nil {
		return c, err
	}
	return c, nil
}

// PostCompany creates a new company in the database.
func PostCompany(c *Company) error {
	if err := c.Validate(); err != nil {
		return err
	}
	err := db.Save(c).Error
	if err != nil {
		log.Error(err)
	}
	return err
}

// PutCompany updates the given company if found in the database.
func PutCompany(c *Company) error {
	if err := c.Validate(); err != nil {
		return err
	}
	err := db.Where("id=?", c.Id).Save(c).Error
	if err != nil {
		log.Error(err)
	}
	return err
}

// HuduCompany is a single company as returned by the n8n hudu-companies
// webhook. "nickname" carries the Hebrew name and "id_number" the customer id.
type HuduCompany struct {
	Id         int64  `json:"id"`
	Name       string `json:"name"`
	NameHe     string `json:"nickname"`
	CustomerId string `json:"id_number"`
	Archived   bool   `json:"archived"`
}

// huduCompaniesEnvelope matches the webhook's response shape:
// [{"companies": [...]}]
type huduCompaniesEnvelope struct {
	Companies []HuduCompany `json:"companies"`
}

// Default Hudu companies webhook endpoint, used when no override is present in
// config.json (hudu_companies_url). The shared secret is NOT defaulted - it
// must be provided via config (hudu_companies_secret) so it never lives in
// source control.
const defaultHuduCompaniesURL = "https://n8n.yazamco.pro/webhook/hudu-companies"

// ErrHuduNotConfigured is returned when the hudu-companies webhook secret is
// missing from config.json.
var ErrHuduNotConfigured = errors.New("hudu companies webhook not configured: set hudu_companies_secret in config.json")

// GetHuduCompanies fetches the company list from the n8n hudu-companies
// webhook server-side (so the shared secret never reaches the browser) and
// returns the non-archived companies.
func GetHuduCompanies() ([]HuduCompany, error) {
	if conf == nil || conf.HuduCompaniesSecret == "" {
		log.Error(ErrHuduNotConfigured)
		return nil, ErrHuduNotConfigured
	}
	url := defaultHuduCompaniesURL
	secret := conf.HuduCompaniesSecret
	if conf.HuduCompaniesURL != "" {
		url = conf.HuduCompaniesURL
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-techform-secret", secret)
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Errorf("error fetching hudu companies: %v", err)
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Errorf("hudu companies webhook returned status %d", resp.StatusCode)
		return nil, errors.New("Hudu companies webhook returned an error")
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	// The webhook responds with [{"companies": [...]}]; tolerate a bare
	// {"companies": [...]} object too.
	raw := []HuduCompany{}
	envelopes := []huduCompaniesEnvelope{}
	if err := json.Unmarshal(body, &envelopes); err == nil {
		for _, e := range envelopes {
			raw = append(raw, e.Companies...)
		}
	} else {
		envelope := huduCompaniesEnvelope{}
		if err := json.Unmarshal(body, &envelope); err != nil {
			log.Errorf("error parsing hudu companies response: %v", err)
			return nil, err
		}
		raw = envelope.Companies
	}
	cs := []HuduCompany{}
	for _, c := range raw {
		if c.Archived {
			continue
		}
		cs = append(cs, c)
	}
	return cs, nil
}

// DeleteCompany deletes the specified company. Any campaigns previously
// associated with the company have their company_id reset to 0 so they are
// simply left unassigned rather than deleted.
func DeleteCompany(id int64, uid int64) error {
	err := db.Model(&Campaign{}).Where("company_id=?", id).Update("company_id", 0).Error
	if err != nil {
		log.Error(err)
		return err
	}
	err = db.Where("id=?", id).Delete(&Company{}).Error
	if err != nil {
		log.Error(err)
	}
	return err
}
