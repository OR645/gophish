// companies.js powers the Companies management page: listing, creating,
// editing and deleting companies that campaigns can be associated with.

let companies = [];
// companyCampaignCounts maps a company id -> number of campaigns associated
// with it (derived client-side from the campaign summaries).
let companyCampaignCounts = {};

// huduCompanies caches the Hudu company list fetched from the backend proxy
// (/api/companies/hudu) so the picker only hits n8n once per page load.
let huduCompanies = null;
let huduLoading = false;

const dismiss = () => {
    $("#name").val("");
    $("#name_he").val("");
    $("#customer_id").val("");
    $("#hudu_search").val("");
    $("#hudu_results").hide().empty();
    $("#hudu_status").text("");
    $("#modal\\.flashes").empty();
};

const saveCompany = (id) => {
    let company = {
        name: $("#name").val(),
        name_he: $("#name_he").val(),
        customer_id: $("#customer_id").val()
    };
    if (id != -1) {
        company.id = parseInt(id);
        api.companyId.put(company)
            .success(function (data) {
                dismiss();
                load();
                $("#modal").modal("hide");
                successFlash(`Company "${escapeHtml(company.name)}" updated successfully!`);
            })
            .error(function (data) {
                modalError(data.responseJSON.message);
            });
    } else {
        api.companies.post(company)
            .success(function (data) {
                load();
                dismiss();
                $("#modal").modal("hide");
                successFlash(`Company "${escapeHtml(company.name)}" created successfully!`);
            })
            .error(function (data) {
                modalError(data.responseJSON.message);
            });
    }
};

// companyRowHtml builds a full <tr> for the companies table. data-order
// attributes on the cells drive correct numeric / date sorting.
const companyRowHtml = (company) => {
    let modified = moment(company.modified_date).format("MMMM Do YYYY, h:mm:ss a");
    let epoch = new Date(company.modified_date).getTime() || 0;
    let count = companyCampaignCounts[company.id] || 0;
    return '<tr>' +
        '<td class="strong" data-order="' + escapeHtml(company.name) + '">' + escapeHtml(company.name) + '</td>' +
        '<td dir="rtl" style="text-align:left;">' + escapeHtml(company.name_he || "") + '</td>' +
        '<td class="num">' + escapeHtml(company.customer_id || "") + '</td>' +
        '<td class="num" data-order="' + count + '">' + count + '</td>' +
        '<td class="num" data-order="' + epoch + '">' + modified + '</td>' +
        '<td class="no-sort"><div class="pull-right" style="display:flex;gap:6px;justify-content:flex-end;">' +
        '<button class="btn btn-primary edit_button" data-toggle="modal" data-backdrop="static" data-target="#modal" data-company-id="' + company.id + '"><i class="fa fa-pencil"></i></button>' +
        '<button class="btn btn-danger delete_button" data-company-id="' + company.id + '"><i class="fa fa-trash-o"></i></button>' +
        '</div></td>' +
        '</tr>';
};

const renderTable = () => {
    $("#loading").hide();
    if ($.fn.DataTable.isDataTable("#companyTable")) {
        $("#companyTable").DataTable().destroy();
    }
    if (!companies.length) {
        $("#companyTable").hide();
        $("#companyTable tbody").empty();
        $("#emptyMessage").show();
        return;
    }
    $("#emptyMessage").hide();
    let rows = $.map(companies, (company) => companyRowHtml(company));
    $("#companyTable tbody").html(rows.join(""));
    $("#companyTable").show();
    $("#companyTable").DataTable({
        order: [[0, "asc"]],
        columnDefs: [{ orderable: false, targets: "no-sort" }]
    });
    $('[data-toggle="tooltip"]').tooltip();
};

const load = () => {
    $("#companyTable").hide();
    $("#emptyMessage").hide();
    $("#loading").show();
    api.companies.get()
        .success((cs) => {
            companies = cs;
            // Tally campaign counts per company from the campaign summaries,
            // then render regardless of whether that lookup succeeds.
            api.campaigns.summary()
                .success((data) => {
                    companyCampaignCounts = {};
                    $.each((data && data.campaigns) || [], (i, c) => {
                        if (c.company_id) {
                            companyCampaignCounts[c.company_id] = (companyCampaignCounts[c.company_id] || 0) + 1;
                        }
                    });
                    renderTable();
                })
                .error(() => {
                    companyCampaignCounts = {};
                    renderTable();
                });
        })
        .error(() => {
            $("#loading").hide();
            errorFlash("Error fetching companies");
        });
};

const editCompany = (id) => {
    dismiss();
    $("#modalSubmit").unbind("click").click(() => {
        saveCompany(id);
    });
    loadHuduCompanies();
    if (id !== -1 && id !== "-1") {
        $("#companyModalLabel").text("Edit Company");
        api.companyId.get(id)
            .success(function (company) {
                $("#name").val(company.name);
                $("#name_he").val(company.name_he || "");
                $("#customer_id").val(company.customer_id || "");
            })
            .error(function () {
                errorFlash("Error fetching company");
            });
    } else {
        $("#companyModalLabel").text("New Company");
    }
};

// loadHuduCompanies - fetches (and caches) the Hudu company list used by the
// picker at the top of the modal.
const loadHuduCompanies = () => {
    if (huduCompanies !== null || huduLoading) {
        return;
    }
    huduLoading = true;
    $("#hudu_status").text("Loading companies from Hudu…");
    api.companies.hudu()
        .success((cs) => {
            huduLoading = false;
            huduCompanies = cs || [];
            $("#hudu_status").text(huduCompanies.length + " companies available — start typing to search");
            renderHuduResults($("#hudu_search").val());
        })
        .error((data) => {
            huduLoading = false;
            let msg = (data && data.responseJSON && data.responseJSON.message) || "";
            $("#hudu_status").text((msg || "Couldn't load the Hudu company list") + " — you can still fill the fields manually.");
        });
};

// renderHuduResults - filters the cached Hudu list against the query and
// renders the dropdown. An empty query (while the input is focused) shows the
// full list.
const renderHuduResults = (query) => {
    if (huduCompanies === null || !$("#hudu_search").is(":focus")) {
        return;
    }
    let q = (query || "").trim().toLowerCase();
    let matches = huduCompanies.filter((c) =>
        !q ||
        (c.name || "").toLowerCase().indexOf(q) !== -1 ||
        (c.nickname || "").toLowerCase().indexOf(q) !== -1 ||
        (c.id_number || "").toLowerCase().indexOf(q) !== -1
    );
    let $results = $("#hudu_results");
    if (!matches.length) {
        $results.html('<div class="hudu-empty">No matching Hudu companies</div>').show();
        return;
    }
    let rows = matches.map((c, i) =>
        '<div class="hudu-item" data-hudu-index="' + huduCompanies.indexOf(c) + '">' +
        '<span class="hn">' + escapeHtml(c.name || "") + '</span>' +
        '<span class="hh">' + escapeHtml(c.nickname || "") + '</span>' +
        (c.id_number ? '<span class="hc">' + escapeHtml(c.id_number) + '</span>' : '') +
        '</div>'
    );
    $results.html(rows.join("")).show();
};

// pickHuduCompany - fills the form fields from the chosen Hudu company.
const pickHuduCompany = (index) => {
    let c = huduCompanies && huduCompanies[index];
    if (!c) {
        return;
    }
    $("#name").val(c.name || "");
    $("#name_he").val(c.nickname || "");
    $("#customer_id").val(c.id_number || "");
    $("#hudu_search").val(c.name || "");
    $("#hudu_results").hide().empty();
};

const deleteCompany = (id) => {
    var company = companies.find(x => x.id == id);
    if (!company) {
        return;
    }
    Swal.fire({
        title: "Are you sure?",
        text: `This will delete the company '${escapeHtml(company.name)}'. Campaigns linked to it will simply become unassigned.`,
        type: "warning",
        animation: false,
        showCancelButton: true,
        confirmButtonText: "Delete",
        confirmButtonColor: "#428bca",
        reverseButtons: true,
        allowOutsideClick: false,
        preConfirm: function () {
            return new Promise((resolve, reject) => {
                api.companyId.delete(id)
                    .success((msg) => {
                        resolve();
                    })
                    .error((data) => {
                        reject(data.responseJSON.message);
                    });
            }).catch(error => {
                Swal.showValidationMessage(error);
            });
        }
    }).then(function (result) {
        if (result.value) {
            Swal.fire(
                "Company Deleted!",
                "The company has been deleted!",
                "success"
            );
        }
        $("button:contains('OK')").on("click", function () {
            location.reload();
        });
    });
};

$(document).ready(function () {
    load();
    $("#modal").on("hide.bs.modal", function () {
        dismiss();
    });
    $("#new_button").on("click", function () {
        editCompany(-1);
    });
    $("#companyTable").on("click", ".edit_button", function (e) {
        editCompany($(this).attr("data-company-id"));
    });
    $("#companyTable").on("click", ".delete_button", function (e) {
        deleteCompany($(this).attr("data-company-id"));
    });
    // Hudu picker: filter while typing, show the list on focus, pick on
    // mousedown (fires before the input's blur hides the dropdown).
    $("#hudu_search").on("input focus", function () {
        renderHuduResults($(this).val());
    });
    $("#hudu_search").on("blur", function () {
        setTimeout(function () { $("#hudu_results").hide(); }, 150);
    });
    $("#hudu_results").on("mousedown", ".hudu-item", function (e) {
        e.preventDefault();
        pickHuduCompany(parseInt($(this).attr("data-hudu-index"), 10));
    });
});
