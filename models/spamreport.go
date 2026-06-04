package models

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	log "github.com/gophish/gophish/logger"
)

// ErrSpamReportNotConfigured is returned when the spam-report webhook secret is
// missing from config.json.
var ErrSpamReportNotConfigured = errors.New("spam report webhook not configured: set spam_report_secret in config.json")

// defaultSpamReportURL is the n8n spam-report webhook used when no override is
// present in config.json (spam_report_url).
const defaultSpamReportURL = "https://n8n.yazamco.pro/webhook/gophish-check-spam-report-365"

// SpamReportRecipient is the per-recipient payload sent to the spam-report
// webhook.
type SpamReportRecipient struct {
	// Id is the recipient's gophish result id (RId).
	Id string `json:"id"`
	// Email, FirstName, LastName and Position identify the recipient.
	Email     string `json:"email"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Position  string `json:"position"`
	// Status is the recipient's current campaign status (e.g. "Email Sent",
	// "Clicked Link", ...).
	Status string `json:"status"`
	// Reported indicates whether the recipient reported the phishing email.
	Reported bool `json:"reported"`
	// EmailSubject is the rendered subject (title) of the email this recipient
	// received - dynamic per recipient when the campaign rotates templates.
	EmailSubject string `json:"email_subject"`
	// TemplateId is the email template assigned to this recipient (0 for
	// single-template campaigns).
	TemplateId int64 `json:"template_id"`
	// SendDate is when the email was (or is scheduled to be) sent.
	SendDate time.Time `json:"send_date"`
}

// SpamReportCompany is the company (organization) the campaign is associated
// with, as it appears in gophish.
type SpamReportCompany struct {
	// Id is the company's gophish id.
	Id int64 `json:"id"`
	// Name is the English company name; NameHe is the Hebrew name.
	Name   string `json:"name"`
	NameHe string `json:"name_he"`
	// CustomerId is the Hudu customer id.
	CustomerId string `json:"customer_id"`
}

// SpamReportPayload is the body POSTed to the spam-report webhook.
type SpamReportPayload struct {
	CampaignId    int64                 `json:"campaign_id"`
	CampaignName  string                `json:"campaign_name"`
	Status        string                `json:"status"`
	LaunchDate    time.Time             `json:"launch_date"`
	CompletedDate time.Time             `json:"completed_date"`
	Company       *SpamReportCompany    `json:"company,omitempty"`
	NumRecipients int                   `json:"num_recipients"`
	Recipients    []SpamReportRecipient `json:"recipients"`
}

// buildSpamReportPayload assembles the webhook payload from a campaign and its
// results.
func buildSpamReportPayload(c *Campaign) SpamReportPayload {
	recipients := make([]SpamReportRecipient, 0, len(c.Results))
	for _, r := range c.Results {
		recipients = append(recipients, SpamReportRecipient{
			Id:           r.RId,
			Email:        r.Email,
			FirstName:    r.FirstName,
			LastName:     r.LastName,
			Position:     r.Position,
			Status:       r.Status,
			Reported:     r.Reported,
			EmailSubject: r.EmailSubject,
			TemplateId:   r.TemplateId,
			SendDate:     r.SendDate,
		})
	}
	payload := SpamReportPayload{
		CampaignId:    c.Id,
		CampaignName:  c.Name,
		Status:        c.Status,
		LaunchDate:    c.LaunchDate,
		CompletedDate: c.CompletedDate,
		NumRecipients: len(recipients),
		Recipients:    recipients,
	}
	// Attach the company (organization) the campaign is associated with, if any,
	// so the webhook receives its Hebrew/English name and ids.
	if c.CompanyId != 0 {
		company := Company{}
		err := db.Where("id=?", c.CompanyId).Find(&company).Error
		if err != nil {
			log.Warnf("%s: company %d not found for spam report", err, c.CompanyId)
		} else {
			payload.Company = &SpamReportCompany{
				Id:         company.Id,
				Name:       company.Name,
				NameHe:     company.NameHe,
				CustomerId: company.CustomerId,
			}
		}
	}
	return payload
}

// SendSpamReportWebhook POSTs the campaign's per-recipient results to the n8n
// spam-report webhook. The request is sent in a background goroutine and the
// caller does NOT wait for a response (fire-and-forget), matching the "send
// without waiting" requirement of the results-page button.
func SendSpamReportWebhook(c *Campaign) error {
	// The shared secret must be supplied via config.json (spam_report_secret)
	// so it never lives in source control. Without it we refuse to send.
	if conf == nil || conf.SpamReportSecret == "" {
		log.Error("spam report webhook not configured: set spam_report_secret in config.json")
		return ErrSpamReportNotConfigured
	}
	url := defaultSpamReportURL
	if conf.SpamReportURL != "" {
		url = conf.SpamReportURL
	}
	secret := conf.SpamReportSecret
	payload := buildSpamReportPayload(c)
	go func() {
		body, err := json.Marshal(payload)
		if err != nil {
			log.Errorf("error marshalling spam report payload: %v", err)
			return
		}
		req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
		if err != nil {
			log.Errorf("error building spam report request: %v", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-techform-secret", secret)
		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			log.Errorf("error sending spam report webhook: %v", err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			log.Errorf("spam report webhook returned status %d", resp.StatusCode)
			return
		}
		log.Infof("spam report webhook sent for campaign %d (%d recipients)", c.Id, payload.NumRecipients)
	}()
	return nil
}
