// labels is a map of campaign statuses to
// CSS classes
var labels = {
    "In progress": "label-primary",
    "Queued": "label-info",
    "Completed": "label-success",
    "Emails Sent": "label-success",
    "Error": "label-danger"
}

var campaigns = []
var campaign = {}

// smtpProfiles caches the sending profiles loaded for the wizard so the
// company -> domain auto-wiring can select a profile whose From address matches
// the company's domain. campaignDomains caches the domains for the same reason.
var smtpProfiles = []
var campaignDomains = []

// applyCompanyDomain wires a selected company's domain into the wizard: it
// auto-fills the listener URL (https://<domain>) and selects an existing
// sending profile whose From address ends in @<domain>. If no profile matches,
// a hint is shown in the sending-profile step. Selecting a company is a
// deliberate action, so this intentionally overrides the URL / profile.
function applyCompanyDomain(companyId) {
    var hint = $("#domainProfileHint")
    if (!companyId) {
        hint.hide()
        return
    }
    var domain = campaignDomains.find(function (d) {
        return String(d.company_id) === String(companyId)
    })
    if (!domain || !domain.name) {
        hint.hide()
        return
    }
    // Auto-fill the listener URL from the domain.
    setURLValue("https://" + domain.name)
    saveURL("https://" + domain.name)
    // Auto-select a sending profile whose From address matches the domain.
    var suffix = "@" + domain.name.toLowerCase()
    var match = smtpProfiles.find(function (p) {
        return p.from_address && p.from_address.toLowerCase().indexOf(suffix) !== -1
    })
    if (match) {
        $("#profile").val(String(match.id)).trigger("change.select2").trigger("change")
        hint.hide()
    } else {
        hint.html('<i class="fa fa-info-circle"></i>&nbsp;No sending profile uses <b>' + escapeHtml(domain.name) +
            '</b>. Create one with a From address like <span class="soc-mono">phish@' + escapeHtml(domain.name) + '</span>.').show()
    }
}

// ---- Saved URLs (picker) --------------------------------------------------
// A list of phishing-listener URLs is persisted in the browser's localStorage
// so the same URLs can be reused across several parallel campaigns without
// retyping. (Stored client-side because this build ships frontend-only.)
var SAVED_URLS_KEY = "gophish.savedURLs"

function getSavedURLs() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_URLS_KEY)) || []
    } catch (e) {
        return []
    }
}

function saveURL(url) {
    url = $.trim(url || "")
    if (url === "") {
        return
    }
    var urls = getSavedURLs()
    if (urls.indexOf(url) === -1) {
        urls.push(url)
        localStorage.setItem(SAVED_URLS_KEY, JSON.stringify(urls))
    }
}

function removeSavedURL(url) {
    var urls = getSavedURLs().filter(function (u) {
        return u !== url
    })
    localStorage.setItem(SAVED_URLS_KEY, JSON.stringify(urls))
}

// Initialize the #url select2 as a tag input sourced from the saved URLs.
// Picking an entry selects it; typing a new value creates (and on launch saves)
// a new entry.
function setupURLSelect() {
    var $url = $("#url")
    var data = getSavedURLs().map(function (u) {
        return { id: u, text: u }
    })
    if ($url.hasClass("select2-hidden-accessible")) {
        $url.select2("destroy")
        $url.empty().append("<option></option>")
    }
    $url.select2({
        placeholder: "http://192.168.1.1",
        tags: true,
        data: data,
        createTag: function (params) {
            var term = $.trim(params.term)
            if (term === "") {
                return null
            }
            return { id: term, text: term }
        }
    })
}

// Set the #url select to a specific value, adding it as an option first if it
// isn't already known (used when copying an existing campaign).
function setURLValue(url) {
    var $url = $("#url")
    if (url) {
        var exists = false
        $url.find("option").each(function () {
            if (this.value === url) {
                exists = true
            }
        })
        if (!exists) {
            $url.append(new Option(url, url, true, true))
        }
    }
    $url.val(url || null).trigger("change")
}

function renderSavedURLList() {
    var urls = getSavedURLs()
    if (!urls.length) {
        return '<div style="color:#888;padding:8px 0;">No saved URLs yet. Type a URL when creating a campaign and it will be saved here.</div>'
    }
    return '<ul style="list-style:none;padding:0;margin:0;">' + urls.map(function (u) {
        return '<li style="display:flex;align-items:center;justify-content:space-between;padding:6px 4px;border-bottom:1px solid #eee;">' +
            '<span style="word-break:break-all;margin-right:8px;">' + escapeHtml(u) + '</span>' +
            '<button type="button" class="btn btn-sm btn-danger remove-url-btn" data-url="' + escapeHtml(u) + '" title="Remove">' +
            '<i class="fa fa-trash-o"></i></button>' +
            '</li>'
    }).join("") + '</ul>'
}

// Open a small dialog listing the saved URLs with the ability to delete them.
function manageURLs() {
    Swal.fire({
        title: "Saved URLs",
        html: '<div class="url-list-wrap" style="text-align:left;">' + renderSavedURLList() + '</div>',
        showConfirmButton: false,
        showCloseButton: true
    })
    $(document).off("click.removeurl").on("click.removeurl", ".remove-url-btn", function () {
        removeSavedURL($(this).attr("data-url"))
        $(".url-list-wrap").html(renderSavedURLList())
        setupURLSelect()
    })
}

// ---- SOC-redesign list helpers --------------------------------------------
// Status -> pill style (matches the prototype StatusPill).
function campaignStatusPill(status, quickStats) {
    var cls = status === "Completed" ? "pill-done" : status === "Error" ? "pill-submitted" : "pill-active"
    return '<span class="pill ' + cls + '" data-toggle="tooltip" data-placement="right" data-html="true" title="' +
        quickStats + '"><span class="dot"></span>' + escapeHtml(status) + '</span>'
}

// Inline mini funnel bar [sent, opened, clicked, submitted, reported].
function campaignMiniFunnel(f) {
    var total = f.reduce(function (a, b) { return a + b }, 0) || 1
    var colors = ["var(--c-sent)", "var(--c-opened)", "var(--c-clicked)", "var(--c-submitted)", "var(--c-reported)"]
    return '<div class="minifunnel" title="' + f.join(" / ") + '">' + f.map(function (v, i) {
        return '<span style="width:' + (v / total * 100) + '%;background:' + colors[i] + '"></span>'
    }).join("") + '</div>'
}

// Populate the #companyFilter dropdown with the distinct companies present in
// the campaign list, and wire it to filter both DataTables by the company
// column (index 1).
function buildCompanyFilter(cs) {
    var companies = []
    $.each(cs, function (i, c) {
        if (c.company && companies.indexOf(c.company) === -1) {
            companies.push(c.company)
        }
    })
    companies.sort()
    var $filter = $("#companyFilter")
    $filter.find("option").not("[value='']").remove()
    $.each(companies, function (i, name) {
        $filter.append(new Option(name, name))
    })
    $filter.off("change.companyfilter").on("change.companyfilter", function () {
        var val = $(this).val()
        var search = val ? "^" + $.fn.dataTable.util.escapeRegex(val) + "$" : ""
        if (typeof activeCampaignsTable !== "undefined") {
            activeCampaignsTable.column(1).search(search, true, false).draw()
        }
        if (typeof archivedCampaignsTable !== "undefined") {
            archivedCampaignsTable.column(1).search(search, true, false).draw()
        }
    })
}

// Build a full <tr> for the campaign list (DOM-sourced DataTable; data-order
// attributes drive correct sorting on each column).
function campaignRowHtml(campaign, idx) {
    var s = campaign.stats || {}
    var rate = s.sent ? Math.round((s.clicked / s.sent) * 1000) / 10 : 0
    var f = [s.sent || 0, s.opened || 0, s.clicked || 0, s.submitted_data || 0, s.email_reported || 0]
    var epoch = new Date(campaign.created_date).getTime() || 0
    var date = moment(campaign.created_date).format('MMM Do YYYY, h:mm a')
    var launchDate, quickStats
    if (moment(campaign.launch_date).isAfter(moment())) {
        launchDate = "Scheduled to start: " + moment(campaign.launch_date).format('MMMM Do YYYY, h:mm:ss a')
        quickStats = launchDate + "<br><br>Number of recipients: " + s.total
    } else {
        launchDate = "Launch Date: " + moment(campaign.launch_date).format('MMMM Do YYYY, h:mm:ss a')
        quickStats = launchDate + "<br><br>Number of recipients: " + s.total + "<br><br>Emails opened: " + s.opened +
            "<br><br>Emails clicked: " + s.clicked + "<br><br>Submitted Credentials: " + s.submitted_data +
            "<br><br>Errors : " + s.error + "<br><br>Reported : " + s.email_reported
    }
    var company = campaign.company || ""
    var companyCell = company
        ? '<span class="pill pill-active" style="background:rgba(120,140,170,.14);">' + escapeHtml(company) + '</span>'
        : '<span style="color:var(--ink-faint);">—</span>'
    return '<tr>' +
        '<td class="strong"><a href="/campaigns/' + campaign.id + '" style="color:inherit;text-decoration:none;">' + escapeHtml(campaign.name) + '</a>' +
        '<div class="mono" style="font-size:10.5px;color:var(--ink-faint);font-weight:400;">CMP-' + campaign.id + '</div></td>' +
        '<td data-order="' + escapeHtml(company) + '">' + companyCell + '</td>' +
        '<td data-order="' + escapeHtml(campaign.status) + '">' + campaignStatusPill(campaign.status, quickStats) + '</td>' +
        '<td class="num" data-order="' + epoch + '">' + date + '</td>' +
        '<td class="num strong" data-order="' + (s.sent || 0) + '">' + (s.sent || 0) + '</td>' +
        '<td>' + campaignMiniFunnel(f) + '</td>' +
        '<td class="num strong" data-order="' + rate + '">' + rate + '%</td>' +
        '<td class="no-sort"><div style="display:flex;gap:6px;justify-content:flex-end;">' +
        '<a class="icon-btn" style="width:30px;height:30px;" href="/campaigns/' + campaign.id + '" data-toggle="tooltip" data-placement="top" title="View Results"><i class="fa fa-bar-chart"></i></a>' +
        '<button class="icon-btn" style="width:30px;height:30px;" data-toggle="tooltip" data-placement="top" title="Generate Report" onclick="reportCampaign(' + idx + ')"><i class="fa fa-file-text-o"></i></button>' +
        '<span data-toggle="modal" data-backdrop="static" data-target="#modal"><button class="icon-btn" style="width:30px;height:30px;" data-toggle="tooltip" data-placement="top" title="Copy Campaign" onclick="copy(' + idx + ')"><i class="fa fa-copy"></i></button></span>' +
        '<button class="icon-btn" style="width:30px;height:30px;color:var(--c-submitted);" data-toggle="tooltip" data-placement="top" title="Delete Campaign" onclick="deleteCampaign(' + idx + ')"><i class="fa fa-trash-o"></i></button>' +
        '</div></td>' +
        '</tr>'
}

// KPI row above the table (real aggregates).
function renderCampaignKpis(cs) {
    var running = 0, sent = 0, clicked = 0
    $.each(cs, function (i, c) {
        var s = c.stats || {}
        sent += s.sent || 0
        clicked += s.clicked || 0
        if (c.status && c.status !== "Completed") running++
    })
    var rate = sent ? Math.round((clicked / sent) * 1000) / 10 : 0
    var kpis = [
        { label: "Total Campaigns", icon: "fa-bullseye", value: cs.length },
        { label: "Running Now", icon: "fa-bolt", value: running, accent: true },
        { label: "Avg Click Rate", icon: "fa-mouse-pointer", value: rate, suffix: "%" }
    ]
    document.getElementById("campaignKpis").innerHTML = kpis.map(function (k) {
        return '<div class="kpi"><div class="label"><span class="ic"><i class="fa ' + k.icon + '"></i></span>' + k.label + '</div>' +
            '<div class="value"' + (k.accent ? ' style="color:var(--accent)"' : '') + '>' + k.value + (k.suffix ? '<small>' + k.suffix + '</small>' : '') + '</div></div>'
    }).join("")
}

// Launch attempts to POST to /campaigns/
function launch() {
    Swal.fire({
        title: "Are you sure?",
        text: "This will schedule the campaign to be launched.",
        type: "question",
        animation: false,
        showCancelButton: true,
        confirmButtonText: "Launch",
        confirmButtonColor: "#428bca",
        reverseButtons: true,
        allowOutsideClick: false,
        showLoaderOnConfirm: true,
        preConfirm: function () {
            return new Promise(function (resolve, reject) {
                groups = []
                $("#users").select2("data").forEach(function (group) {
                    groups.push({
                        name: group.text
                    });
                })
                // Validate our fields
                var send_by_date = $("#send_by_date").val()
                if (send_by_date != "") {
                    send_by_date = moment(send_by_date, "MMMM Do YYYY, h:mm a").utc().format()
                }
                campaign = {
                    name: $("#name").val(),
                    template: {
                        name: $("#template").select2("data")[0].text
                    },
                    url: $("#url").val(),
                    page: {
                        name: $("#page").select2("data")[0].text
                    },
                    smtp: {
                        name: $("#profile").select2("data")[0].text
                    },
                    launch_date: moment($("#launch_date").val(), "MMMM Do YYYY, h:mm a").utc().format(),
                    send_by_date: send_by_date || null,
                    groups: groups,
                    company_id: parseInt($("#company").val(), 10) || 0,
                }
                // Remember this URL so it can be reused for parallel campaigns
                saveURL(campaign.url)
                // Submit the campaign
                api.campaigns.post(campaign)
                    .success(function (data) {
                        resolve()
                        campaign = data
                    })
                    .error(function (data) {
                        $("#modal\\.flashes").empty().append("<div style=\"text-align:center\" class=\"alert alert-danger\">\
            <i class=\"fa fa-exclamation-circle\"></i> " + data.responseJSON.message + "</div>")
                        Swal.close()
                    })
            })
        }
    }).then(function (result) {
        if (result.value){
            Swal.fire(
                'Campaign Scheduled!',
                'This campaign has been scheduled for launch!',
                'success'
            );
        }
        $('button:contains("OK")').on('click', function () {
            window.location = "/campaigns/" + campaign.id.toString()
        })
    })
}

// Attempts to send a test email by POSTing to /campaigns/
function sendTestEmail() {
    var test_email_request = {
        template: {
            name: $("#template").select2("data")[0].text
        },
        first_name: $("input[name=to_first_name]").val(),
        last_name: $("input[name=to_last_name]").val(),
        email: $("input[name=to_email]").val(),
        position: $("input[name=to_position]").val(),
        url: $("#url").val(),
        page: {
            name: $("#page").select2("data")[0].text
        },
        smtp: {
            name: $("#profile").select2("data")[0].text
        }
    }
    saveURL(test_email_request.url)
    btnHtml = $("#sendTestModalSubmit").html()
    $("#sendTestModalSubmit").html('<i class="fa fa-spinner fa-spin"></i> Sending')
    // Send the test email
    api.send_test_email(test_email_request)
        .success(function (data) {
            $("#sendTestEmailModal\\.flashes").empty().append("<div style=\"text-align:center\" class=\"alert alert-success\">\
            <i class=\"fa fa-check-circle\"></i> Email Sent!</div>")
            $("#sendTestModalSubmit").html(btnHtml)
        })
        .error(function (data) {
            $("#sendTestEmailModal\\.flashes").empty().append("<div style=\"text-align:center\" class=\"alert alert-danger\">\
            <i class=\"fa fa-exclamation-circle\"></i> " + data.responseJSON.message + "</div>")
            $("#sendTestModalSubmit").html(btnHtml)
        })
}

function dismiss() {
    $("#modal\\.flashes").empty();
    $("#name").val("");
    $("#template").val("").change();
    $("#page").val("").change();
    $("#url").val(null).trigger("change");
    $("#profile").val("").change();
    $("#users").val("").change();
    $("#company").val(null).trigger("change");
    $("#modal").modal('hide');
}

// reportCampaign generates the Yazamco phishing report for a campaign in the
// list. Delegates to openCampaignReport() (report.js), which fetches the full
// campaign data and prompts for the company name.
function reportCampaign(idx) {
    openCampaignReport(campaigns[idx].id)
}

function deleteCampaign(idx) {
    Swal.fire({
        title: "Are you sure?",
        text: "This will delete the campaign. This can't be undone!",
        type: "warning",
        animation: false,
        showCancelButton: true,
        confirmButtonText: "Delete " + campaigns[idx].name,
        confirmButtonColor: "#428bca",
        reverseButtons: true,
        allowOutsideClick: false,
        preConfirm: function () {
            return new Promise(function (resolve, reject) {
                api.campaignId.delete(campaigns[idx].id)
                    .success(function (msg) {
                        resolve()
                    })
                    .error(function (data) {
                        reject(data.responseJSON.message)
                    })
            })
        }
    }).then(function (result) {
        if (result.value){
            Swal.fire(
                'Campaign Deleted!',
                'This campaign has been deleted!',
                'success'
            );
        }
        $('button:contains("OK")').on('click', function () {
            location.reload()
        })
    })
}

// loadCompanies populates the #company select2 in the campaign modal. If
// selectedId is provided, that company is preselected (used when copying a
// campaign or just after creating a new company inline).
function loadCompanies(selectedId) {
    api.companies.get()
        .success(function (companies) {
            var company_s2 = $.map(companies, function (obj) {
                obj.text = obj.name
                return obj
            })
            var $company = $("#company")
            if ($company.hasClass("select2-hidden-accessible")) {
                $company.select2("destroy")
            }
            $company.empty().append("<option></option>")
            $company.select2({
                placeholder: "No company",
                allowClear: true,
                data: company_s2
            })
            if (selectedId) {
                $company.val(selectedId.toString()).trigger("change.select2")
            }
        })
}

function setupOptions() {
    setupURLSelect()
    loadCompanies()
    // Cache domains so selecting a company can auto-wire its domain into the
    // listener URL and matching sending profile.
    api.domains.get()
        .success(function (ds) { campaignDomains = ds || [] })
        .error(function () { campaignDomains = [] })
    api.groups.summary()
        .success(function (summaries) {
            groups = summaries.groups
            if (groups.length == 0) {
                wizRenderGroups([])
                modalError("No groups found!")
                return false;
            } else {
                var group_s2 = $.map(groups, function (obj) {
                    obj.text = obj.name
                    obj.title = obj.num_targets + " targets"
                    return obj
                });
                $("#users.form-control").select2({
                    placeholder: "Select Groups",
                    data: group_s2,
                });
                wizRenderGroups(group_s2)
            }
        });
    api.templates.get()
        .success(function (templates) {
            if (templates.length == 0) {
                wizRenderSingle("#templateChoices", [], "#template")
                modalError("No templates found!")
                return false
            } else {
                var template_s2 = $.map(templates, function (obj) {
                    obj.text = obj.name
                    return obj
                });
                var template_select = $("#template.form-control")
                template_select.select2({
                    placeholder: "Select a Template",
                    data: template_s2,
                });
                wizRenderSingle("#templateChoices", template_s2, "#template", function (t) { return t.subject || "" })
                if (templates.length === 1) {
                    template_select.val(template_s2[0].id)
                    template_select.trigger('change.select2')
                }
            }
        });
    api.pages.get()
        .success(function (pages) {
            if (pages.length == 0) {
                wizRenderSingle("#pageChoices", [], "#page")
                modalError("No pages found!")
                return false
            } else {
                var page_s2 = $.map(pages, function (obj) {
                    obj.text = obj.name
                    return obj
                });
                var page_select = $("#page.form-control")
                page_select.select2({
                    placeholder: "Select a Landing Page",
                    data: page_s2,
                });
                wizRenderSingle("#pageChoices", page_s2, "#page",
                    function (p) { return p.redirect_url || "" },
                    function (p) { return p.capture_credentials ? '<span class="tag" style="color:var(--c-submitted);">captures creds</span>' : '<span class="tag">clicks only</span>' })
                if (pages.length === 1) {
                    page_select.val(page_s2[0].id)
                    page_select.trigger('change.select2')
                }
            }
        });
    api.SMTP.get()
        .success(function (profiles) {
            if (profiles.length == 0) {
                wizRenderSingle("#profileChoices", [], "#profile")
                modalError("No profiles found!")
                return false
            } else {
                smtpProfiles = profiles
                var profile_s2 = $.map(profiles, function (obj) {
                    obj.text = obj.name
                    return obj
                });
                var profile_select = $("#profile.form-control")
                profile_select.select2({
                    placeholder: "Select a Sending Profile",
                    data: profile_s2,
                }).select2("val", profile_s2[0]);
                wizRenderSingle("#profileChoices", profile_s2, "#profile",
                    function (p) { return p.from_address || p.host || "" },
                    function (p) { return p.ignore_cert_errors ? '<span class="pill pill-clicked"><span class="dot"></span>Check certs</span>' : '<span class="pill pill-reported"><span class="dot"></span>TLS</span>' })
                if (profiles.length === 1) {
                    profile_select.val(profile_s2[0].id)
                    profile_select.trigger('change.select2')
                }
            }
        });
}

/* ============================================================
   SOC cx campaign wizard
   Drives the hidden #template/#page/#profile/#users select2 data
   layer via a stepper + choice cards + a live preview aside, so
   launch()/copy()/sendTestEmail()/dismiss() keep working unchanged.
   ============================================================ */
var WIZ_LABELS = ["Details", "Email", "Page", "Profile", "Targets", "Schedule", "Review"]
var WIZ_DESC = [
    "Name your simulation and pick a company.",
    "Pick the phishing email targets will receive.",
    "Choose the landing page and listener URL.",
    "Select the SMTP profile used to deliver mail.",
    "Choose which groups to include.",
    "Set the launch time and delivery window.",
    "Confirm everything, then launch."
]
var wizStep = 0

function wizBuildStepper() {
    var html = ""
    for (var i = 0; i < WIZ_LABELS.length; i++) {
        var cls = i === wizStep ? "active" : (i < wizStep ? "done" : "")
        html += '<div class="st ' + cls + '" data-step="' + i + '"><span class="b">' +
            (i < wizStep ? '<i class="fa fa-check"></i>' : (i + 1)) + '</span><span class="lbl">' + WIZ_LABELS[i] + '</span></div>'
        if (i < WIZ_LABELS.length - 1) html += '<div class="ln ' + (i < wizStep ? "filled" : "") + '"><i></i></div>'
    }
    $("#campaignStepper").html(html)
}

function showStep(i) {
    wizStep = Math.max(0, Math.min(WIZ_LABELS.length - 1, i))
    $("#modal .step-pane").attr("hidden", true)
    $('#modal .step-pane[data-step="' + wizStep + '"]').removeAttr("hidden")
    wizBuildStepper()
    $("#wizStepDesc").text(WIZ_DESC[wizStep])
    $("#wizCounter").text("step " + (wizStep + 1) + " / " + WIZ_LABELS.length)
    $("#wizBack").text(wizStep === 0 ? "Cancel" : "Back")
    var last = wizStep === WIZ_LABELS.length - 1
    $("#wizNext").toggle(!last)
    $("#launchButton").toggle(last)
    if (last) { wizRenderReview() }
    wizUpdatePreview()
    $("#modal .cx-main").scrollTop(0)
}
function wizNext() { if (wizStep < WIZ_LABELS.length - 1) { showStep(wizStep + 1) } }
function wizBack() { if (wizStep === 0) { $("#modal").modal("hide") } else { showStep(wizStep - 1) } }

function wizSelText(sel) {
    try { var d = $(sel).select2("data"); return (d && d[0]) ? d[0].text : "" } catch (e) { return "" }
}
function wizRecipients() {
    var n = 0
    $("#groupChoices .choice.sel").each(function () { n += parseInt($(this).attr("data-targets") || "0", 10) || 0 })
    return n
}
function wizRow(icon, label, val, accent) {
    return '<div class="sr"' + (accent ? ' style="background:var(--accent-soft);"' : '') + '>' +
        '<div class="si"' + (accent ? ' style="background:var(--accent);color:#fff;"' : '') + '><i class="fa fa-' + icon + '"></i></div>' +
        '<div style="min-width:0;"><div class="sl">' + label + '</div>' +
        '<div class="sv" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(String(val)) + '</div></div></div>'
}
function wizUpdatePreview() {
    if (!$("#previewSummary").length) { return }
    var recips = wizRecipients()
    $("#previewSummary").html(
        wizRow("bullseye", "Simulation", $("#name").val() || "Untitled", true) +
        wizRow("envelope-o", "Template", wizSelText("#template") || "—") +
        wizRow("file-o", "Page", wizSelText("#page") || "—") +
        wizRow("paper-plane-o", "Profile", wizSelText("#profile") || "—") +
        wizRow("users", "Recipients", recips.toLocaleString())
    )
    var funnel = [
        ["Sent", recips, "var(--c-sent)"],
        ["Opened", Math.round(recips * 0.64), "var(--c-opened)"],
        ["Clicked", Math.round(recips * 0.30), "var(--c-clicked)"],
        ["Submitted", Math.round(recips * 0.12), "var(--c-submitted)"]
    ]
    var max = recips || 1
    $("#previewFunnel").html(funnel.map(function (f) {
        return '<div class="pf"><span class="pl">' + f[0] + '</span><span class="pt"><i style="width:' +
            Math.max(4, (f[1] / max) * 100) + '%;background:' + f[2] + '"></i></span><span class="pv">' + f[1].toLocaleString() + '</span></div>'
    }).join(""))
    var ng = $("#groupChoices .choice.sel").length
    $("#recipientsNote").text(recips.toLocaleString() + " recipients across " + ng + " group" + (ng === 1 ? "" : "s"))
}
function wizRenderReview() {
    var ng = $("#groupChoices .choice.sel").length
    $("#reviewSummary").html(
        wizRow("bullseye", "Campaign", $("#name").val() || "Untitled") +
        wizRow("envelope-o", "Email template", wizSelText("#template") || "—") +
        wizRow("file-o", "Landing page", wizSelText("#page") || "—") +
        wizRow("link", "Listener URL", $("#url").val() || "—") +
        wizRow("paper-plane-o", "Sending profile", wizSelText("#profile") || "—") +
        wizRow("users", "Recipients", wizRecipients().toLocaleString() + " across " + ng + " group" + (ng === 1 ? "" : "s")) +
        wizRow("calendar", "Launch", $("#launch_date").val() || "—")
    )
}

// choice card rendering --------------------------------------------------
function wizChoiceHtml(id, title, sub, right) {
    return '<div class="choice" data-id="' + id + '">' +
        '<span class="ck"><i class="fa fa-check"></i></span>' +
        '<div style="flex:1;min-width:0;"><b style="font-size:13.5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(title) + '</b>' +
        (sub ? '<span class="mono" style="font-size:11px;color:var(--ink-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">' + escapeHtml(sub) + '</span>' : '') +
        '</div>' + (right || '') + '</div>'
}
function wizRenderSingle(containerId, items, selId, subFn, rightFn) {
    var $c = $(containerId)
    if (!items || !items.length) { $c.html('<div class="minilist-empty">None available — create one first.</div>'); return }
    $c.html(items.map(function (it) {
        return wizChoiceHtml(it.id, it.name || it.text, subFn ? subFn(it) : "", rightFn ? rightFn(it) : "")
    }).join(""))
    wizSyncSingle(containerId, selId)
}
function wizSyncSingle(containerId, selId) {
    var v = String($(selId).val() || "")
    $(containerId + " .choice").removeClass("sel").each(function () {
        if (String($(this).data("id")) === v) { $(this).addClass("sel") }
    })
}
function wizRenderGroups(items) {
    var $c = $("#groupChoices")
    if (!items || !items.length) { $c.html('<div class="minilist-empty">No groups yet — create one first.</div>'); return }
    $c.html(items.map(function (g) {
        var n = g.num_targets || 0
        return '<div class="choice" data-id="' + g.id + '" data-targets="' + n + '">' +
            '<span class="ck"><i class="fa fa-check"></i></span>' +
            '<div style="flex:1;min-width:0;"><b style="font-size:13.5px;display:block;">' + escapeHtml(g.name) + '</b>' +
            '<span class="mono" style="font-size:11px;color:var(--ink-dim);">' + n + ' targets</span></div>' +
            '<span class="num" style="font-weight:600;font-size:13px;color:var(--ink-dim);">' + n + '</span></div>'
    }).join(""))
    wizSyncGroups()
}
function wizSyncGroups() {
    var vals = ($("#users").val() || []).map(String)
    $("#groupChoices .choice").removeClass("sel").each(function () {
        if (vals.indexOf(String($(this).data("id"))) >= 0) { $(this).addClass("sel") }
    })
}

function edit(campaign) {
    setupOptions();
    showStep(0);
}

function copy(idx) {
    setupOptions();
    showStep(0);
    // Set our initial values
    api.campaignId.get(campaigns[idx].id)
        .success(function (campaign) {
            $("#name").val("Copy of " + campaign.name)
            if (!campaign.template.id) {
                $("#template").val("").change();
                $("#template").select2({
                    placeholder: campaign.template.name
                });
            } else {
                $("#template").val(campaign.template.id.toString());
                $("#template").trigger("change.select2")
            }
            if (!campaign.page.id) {
                $("#page").val("").change();
                $("#page").select2({
                    placeholder: campaign.page.name
                });
            } else {
                $("#page").val(campaign.page.id.toString());
                $("#page").trigger("change.select2")
            }
            if (!campaign.smtp.id) {
                $("#profile").val("").change();
                $("#profile").select2({
                    placeholder: campaign.smtp.name
                });
            } else {
                $("#profile").val(campaign.smtp.id.toString());
                $("#profile").trigger("change.select2")
            }
            setURLValue(campaign.url)
            if (campaign.company_id) {
                loadCompanies(campaign.company_id)
            }
        })
        .error(function (data) {
            $("#modal\\.flashes").empty().append("<div style=\"text-align:center\" class=\"alert alert-danger\">\
            <i class=\"fa fa-exclamation-circle\"></i> " + data.responseJSON.message + "</div>")
        })
}

$(document).ready(function () {
    $("#launch_date").datetimepicker({
        "widgetPositioning": {
            "vertical": "bottom"
        },
        "showTodayButton": true,
        "defaultDate": moment(),
        "format": "MMMM Do YYYY, h:mm a"
    })
    $("#send_by_date").datetimepicker({
        "widgetPositioning": {
            "vertical": "bottom"
        },
        "showTodayButton": true,
        "useCurrent": false,
        "format": "MMMM Do YYYY, h:mm a"
    })
    // Setup multiple modals
    // Code based on http://miles-by-motorcycle.com/static/bootstrap-modal/index.html
    $('.modal').on('hidden.bs.modal', function (event) {
        $(this).removeClass('fv-modal-stack');
        $('body').data('fv_open_modals', $('body').data('fv_open_modals') - 1);
    });
    $('.modal').on('shown.bs.modal', function (event) {
        // Keep track of the number of open modals
        if (typeof ($('body').data('fv_open_modals')) == 'undefined') {
            $('body').data('fv_open_modals', 0);
        }
        // if the z-index of this modal has been set, ignore.
        if ($(this).hasClass('fv-modal-stack')) {
            return;
        }
        $(this).addClass('fv-modal-stack');
        // Increment the number of open modals
        $('body').data('fv_open_modals', $('body').data('fv_open_modals') + 1);
        // Setup the appropriate z-index
        $(this).css('z-index', 1040 + (10 * $('body').data('fv_open_modals')));
        $('.modal-backdrop').not('.fv-modal-stack').css('z-index', 1039 + (10 * $('body').data('fv_open_modals')));
        $('.modal-backdrop').not('fv-modal-stack').addClass('fv-modal-stack');
    });
    // Scrollbar fix - https://stackoverflow.com/questions/19305821/multiple-modals-overlay
    $(document).on('hidden.bs.modal', '.modal', function () {
        $('.modal:visible').length && $(document.body).addClass('modal-open');
    });
    $('#modal').on('hidden.bs.modal', function (event) {
        dismiss()
    });
    $("#manageUrlsBtn").on("click", manageURLs);
    // cx wizard: stepper + choice cards drive the hidden select2 data layer
    $("#campaignStepper").on("click", ".st", function () { showStep(parseInt($(this).attr("data-step"), 10)) })
    $("#templateChoices").on("click", ".choice", function () { $("#template").val(String($(this).data("id"))).trigger("change.select2").trigger("change") })
    $("#pageChoices").on("click", ".choice", function () { $("#page").val(String($(this).data("id"))).trigger("change.select2").trigger("change") })
    $("#profileChoices").on("click", ".choice", function () { $("#profile").val(String($(this).data("id"))).trigger("change.select2").trigger("change") })
    $("#groupChoices").on("click", ".choice", function () {
        $(this).toggleClass("sel")
        var ids = []
        $("#groupChoices .choice.sel").each(function () { ids.push(String($(this).data("id"))) })
        $("#users").val(ids).trigger("change.select2").trigger("change")
    })
    $("#template").on("change", function () { wizSyncSingle("#templateChoices", "#template"); wizUpdatePreview() })
    $("#page").on("change", function () { wizSyncSingle("#pageChoices", "#page"); wizUpdatePreview() })
    $("#profile").on("change", function () { wizSyncSingle("#profileChoices", "#profile"); wizUpdatePreview() })
    $("#users").on("change", function () { wizSyncGroups(); wizUpdatePreview() })
    // Selecting a company auto-wires its domain into the listener URL and a
    // matching sending profile. (select2 preselects fire change.select2 only,
    // so copying an existing campaign won't trigger this.)
    $("#company").on("change", function () { applyCompanyDomain($(this).val()); wizUpdatePreview() })
    $("#name").on("input", wizUpdatePreview)
    showStep(0)
    // Add a new company inline from the campaign modal.
    $("#addCompanyBtn").on("click", function () {
        Swal.fire({
            title: "New Company",
            input: "text",
            inputPlaceholder: "Company name",
            showCancelButton: true,
            confirmButtonText: "Add",
            confirmButtonColor: "#428bca",
            reverseButtons: true,
            allowOutsideClick: false,
            showLoaderOnConfirm: true,
            preConfirm: function (name) {
                name = $.trim(name || "")
                if (name === "") {
                    Swal.showValidationMessage("Please enter a company name")
                    return false
                }
                return new Promise(function (resolve) {
                    api.companies.post({ name: name })
                        .success(function (data) {
                            resolve(data)
                        })
                        .error(function (data) {
                            Swal.showValidationMessage(data.responseJSON.message)
                            resolve(false)
                        })
                })
            }
        }).then(function (result) {
            if (result.value) {
                loadCompanies(result.value.id)
            }
        })
    });
    api.campaigns.summary()
        .success(function (data) {
            campaigns = data.campaigns
            $("#loading").hide()
            if (campaigns.length > 0) {
                renderCampaignKpis(campaigns)
                var activeRows = [], archivedRows = []
                $.each(campaigns, function (i, campaign) {
                    var html = campaignRowHtml(campaign, i)
                    if (campaign.status == 'Completed') {
                        archivedRows.push(html)
                    } else {
                        activeRows.push(html)
                    }
                })
                // Source the DataTables from the DOM so per-cell data-order
                // attributes drive correct numeric / date sorting.
                $("#campaignTable tbody").html(activeRows.join(""))
                $("#campaignTableArchive tbody").html(archivedRows.join(""))
                $("#campaignTable").show()
                $("#campaignTableArchive").show()
                var dtOpts = {
                    columnDefs: [{ orderable: false, targets: "no-sort" }],
                    order: [[3, "desc"]]
                }
                activeCampaignsTable = $("#campaignTable").DataTable(dtOpts)
                archivedCampaignsTable = $("#campaignTableArchive").DataTable(dtOpts)
                if (!archivedRows.length) { $("#emptyMessageArchive").show() }
                buildCompanyFilter(campaigns)
                $('[data-toggle="tooltip"]').tooltip()
            } else {
                $("#emptyMessage").show()
            }
        })
        .error(function () {
            $("#loading").hide()
            errorFlash("Error fetching campaigns")
        })
    // Select2 Defaults
    $.fn.select2.defaults.set("width", "100%");
    $.fn.select2.defaults.set("dropdownParent", $("#modal_body"));
    $.fn.select2.defaults.set("theme", "bootstrap");
    $.fn.select2.defaults.set("sorter", function (data) {
        return data.sort(function (a, b) {
            if (a.text.toLowerCase() > b.text.toLowerCase()) {
                return 1;
            }
            if (a.text.toLowerCase() < b.text.toLowerCase()) {
                return -1;
            }
            return 0;
        });
    })
})
