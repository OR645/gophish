// companies.js powers the Companies management page: listing, creating,
// editing and deleting companies that campaigns can be associated with.

let companies = [];
// companyCampaignCounts maps a company id -> number of campaigns associated
// with it (derived client-side from the campaign summaries).
let companyCampaignCounts = {};

const dismiss = () => {
    $("#name").val("");
    $("#modal\\.flashes").empty();
};

const saveCompany = (id) => {
    let company = {
        name: $("#name").val()
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
    if (id !== -1 && id !== "-1") {
        $("#companyModalLabel").text("Edit Company");
        api.companyId.get(id)
            .success(function (company) {
                $("#name").val(company.name);
            })
            .error(function () {
                errorFlash("Error fetching company");
            });
    } else {
        $("#companyModalLabel").text("New Company");
    }
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
});
