package models

import (
	"errors"
	"time"

	log "github.com/gophish/gophish/logger"
)

// Company represents an organization that campaigns can be associated with.
// It is a lightweight grouping construct: each campaign optionally references
// a single company via Campaign.CompanyId.
type Company struct {
	Id           int64     `json:"id"`
	UserId       int64     `json:"-"`
	Name         string    `json:"name"`
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
