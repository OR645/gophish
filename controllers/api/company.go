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

// Companies returns a list of companies if requested via GET.
// If requested via POST, Companies creates a new company and returns a reference to it.
func (as *Server) Companies(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == "GET":
		cs, err := models.GetCompanies(ctx.Get(r, "user_id").(int64))
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "No companies found"}, http.StatusNotFound)
			return
		}
		JSONResponse(w, cs, http.StatusOK)
	//POST: Create a new company and return it as JSON
	case r.Method == "POST":
		c := models.Company{}
		// Put the request into a company
		err := json.NewDecoder(r.Body).Decode(&c)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Invalid JSON structure"}, http.StatusBadRequest)
			return
		}
		_, err = models.GetCompanyByName(c.Name, ctx.Get(r, "user_id").(int64))
		if err != gorm.ErrRecordNotFound {
			JSONResponse(w, models.Response{Success: false, Message: "Company name already in use"}, http.StatusConflict)
			return
		}
		c.ModifiedDate = time.Now().UTC()
		c.UserId = ctx.Get(r, "user_id").(int64)
		err = models.PostCompany(&c)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
			return
		}
		JSONResponse(w, c, http.StatusCreated)
	}
}

// Company returns details about the requested company.
// If the company is not valid, Company returns null.
func (as *Server) Company(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, _ := strconv.ParseInt(vars["id"], 0, 64)
	c, err := models.GetCompany(id, ctx.Get(r, "user_id").(int64))
	if err != nil {
		JSONResponse(w, models.Response{Success: false, Message: "Company not found"}, http.StatusNotFound)
		return
	}
	switch {
	case r.Method == "GET":
		JSONResponse(w, c, http.StatusOK)
	case r.Method == "DELETE":
		err = models.DeleteCompany(id, ctx.Get(r, "user_id").(int64))
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: "Error deleting company"}, http.StatusInternalServerError)
			return
		}
		JSONResponse(w, models.Response{Success: true, Message: "Company deleted successfully!"}, http.StatusOK)
	case r.Method == "PUT":
		c = models.Company{}
		err = json.NewDecoder(r.Body).Decode(&c)
		if err != nil {
			log.Errorf("error decoding company: %v", err)
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusInternalServerError)
			return
		}
		if c.Id != id {
			JSONResponse(w, models.Response{Success: false, Message: "Error: /:id and company_id mismatch"}, http.StatusInternalServerError)
			return
		}
		c.ModifiedDate = time.Now().UTC()
		c.UserId = ctx.Get(r, "user_id").(int64)
		err = models.PutCompany(&c)
		if err != nil {
			JSONResponse(w, models.Response{Success: false, Message: err.Error()}, http.StatusBadRequest)
			return
		}
		JSONResponse(w, c, http.StatusOK)
	}
}
