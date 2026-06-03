package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	ctx "github.com/gophish/gophish/context"
	log "github.com/gophish/gophish/logger"
	"github.com/gophish/gophish/models"
	"github.com/gorilla/mux"
	"github.com/jinzhu/gorm"
)

// Domains returns a list of domains if requested via GET.
// If requested via POST, Domains creates a new domain, dispatches the n8n
// provisioning webhook, and returns a reference to it (including the desired
// DNS record set).
func (as *Server) Domains(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == "GET":
		ds, err := models.GetDomains(ctx.Get(r, "user_id").(int64))
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "No domains found"}, http.StatusNotFound)
			return
		}
		JSONResponse(w, ds, http.StatusOK)
	//POST: Create a new domain and return it as JSON
	case r.Method == "POST":
		d := models.Domain{}
		// Put the request into a domain
		err := json.NewDecoder(r.Body).Decode(&d)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Invalid JSON structure"}, http.StatusBadRequest)
			return
		}
		uid := ctx.Get(r, "user_id").(int64)
		_, err = models.GetDomainByName(d.Name, uid)
		if err != gorm.ErrRecordNotFound {
			JSONResponse(w, models.Response{Success: false, Message: "Domain name already in use"}, http.StatusConflict)
			return
		}
		d.ModifiedDate = time.Now().UTC()
		d.UserId = uid
		if d.Status == "" {
			d.Status = "pending"
		}
		if d.Configure365 {
			d.M365Status = "connected"
		} else {
			d.M365Status = "not_connected"
		}
		err = models.PostDomain(&d)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
			return
		}
		// Build the desired record set and dispatch the n8n webhook. The
		// records are attached to the response so the UI can display them.
		d.Records = models.NotifyDomainCreated(d)
		JSONResponse(w, d, http.StatusCreated)
	}
}

// Domain returns details about the requested domain.
// If the domain is not valid, Domain returns null.
func (as *Server) Domain(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	d, err := models.GetDomain(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: "Domain not found"}, http.StatusNotFound)
		return
	}
	switch {
	case r.Method == "GET":
		JSONResponse(w, d, http.StatusOK)
	case r.Method == "DELETE":
		err = models.DeleteDomain(id, ctx.Get(r, "user_id").(int64))
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Error deleting domain"}, http.StatusInternalServerError)
			return
		}
		JSONResponse(w, models.Response{Success: true, Message: "Domain deleted successfully!"}, http.StatusOK)
	case r.Method == "PUT":
		d = models.Domain{}
		err = json.NewDecoder(r.Body).Decode(&d)
		if err != nil {
			log.Errorf("error decoding domain: %v", err)
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		if d.Id != id {
			JSONResponse(w, models.Response{Success: false, Message: "Error: /:id and domain_id mismatch"}, http.StatusInternalServerError)
			return
		}
		d.ModifiedDate = time.Now().UTC()
		d.UserId = ctx.Get(r, "user_id").(int64)
		if d.Configure365 {
			d.M365Status = "connected"
		} else {
			d.M365Status = "not_connected"
		}
		err = models.PutDomain(&d)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
			return
		}
		JSONResponse(w, d, http.StatusOK)
	}
}
