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

// wizData caches the option lists loaded for the wizard. The listener URL and
// the sending profiles are both derived from the Domains tab: the URL list is
// exactly the managed domains, and only profiles whose From address belongs to
// a managed domain are eligible.
var wizData = {
    templates: [],
    pages: [],
    profiles: [],
    groups: [],
    domains: []
}

// wizState tracks the user's current selections. Card clicks mutate this
// state and the render/sync helpers reflect it back into the DOM, so there is
// no hidden select2 layer to fall out of sync.
var wizState = {
    templates: [], // template ids (multi — rotated randomly between recipients)
    page: null,    // page id
    profile: null, // sending profile id
    groups: [],    // group ids
    url: ""        // listener URL (always https://<managed domain>)
}

function wizResetState() {
    wizState.templates = []
    wizState.page = null
    wizState.profile = null
    wizState.groups = []
    wizState.url = ""
}

// wizFind returns the cached item with the given id (ids come back from the
// API as numbers; jQuery's .data() also yields numbers, so === is safe).
function wizFind(list, id) {
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
            return list[i]
        }
    }
    return null
}

function wizSelectedTemplates() {
    return wizState.templates.map(function (id) {
        return wizFind(wizData.templates, id)
    }).filter(Boolean)
}

function wizSelectedGroups() {
    return wizState.groups.map(function (id) {
        return wizFind(wizData.groups, id)
    }).filter(Boolean)
}

// ---- Listener URL (sourced from the Domains tab only) ----------------------
// The URL select offers exactly the managed domains as https://<domain> — no
// free-text entry, so a campaign can never point at a domain that wasn't
// provisioned through the Domains tab.
function setupURLSelect() {
    var $url = $("#url")
    if ($url.hasClass("select2-hidden-accessible")) {
        $url.select2("destroy")
    }
    $url.empty().append("<option></option>")
    var data = wizData.domains.filter(function (d) { return d.name }).map(function (d) {
        return { id: "https://" + d.name, text: "https://" + d.name }
    })
    $url.select2({
        placeholder: data.length ? "Select a domain" : "No domains available",
        allowClear: true,
        data: data
    })
    if (!data.length) {
        $("#urlNote").html('No domains found — add one in the <a href="/domains">Domains</a> tab first.')
    } else {
        $("#urlNote").text("")
    }
    if (wizState.url) {
        setURLValue(wizState.url)
    }
}

// Set the #url select to a specific value, adding it as an option first if it
// isn't already known (used when copying an existing campaign whose domain may
// have since been removed).
function setURLValue(url) {
    wizState.url = url || ""
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
    $url.val(url || null).trigger("change.select2")
    wizUpdatePreview()
}

// ---- Domain-driven auto-wiring ---------------------------------------------
// applyCompanyDomain wires a selected company's domain into the wizard: it
// auto-fills the listener URL (https://<domain>) and selects an eligible
// sending profile whose From address ends in @<domain>. If no profile matches,
// a hint is shown in the sending-profile section. Selecting a company is a
// deliberate action, so this intentionally overrides the URL / profile.
function applyCompanyDomain(companyId) {
    var hint = $("#domainProfileHint")
    if (!companyId) {
        hint.hide()
        return
    }
    var domain = wizData.domains.find(function (d) {
        return String(d.company_id) === String(companyId)
    })
    if (!domain || !domain.name) {
        hint.hide()
        return
    }
    // Auto-fill the listener URL from the domain.
    setURLValue("https://" + domain.name)
    // Auto-select a sending profile whose From address matches the domain.
    var suffix = "@" + domain.name.toLowerCase()
    var match = wizData.profiles.find(function (p) {
        return p.from_address && p.from_address.toLowerCase().indexOf(suffix) !== -1
    })
    if (match) {
        wizState.profile = match.id
        wizSyncAll()
        wizUpdatePreview()
        hint.hide()
    } else {
        hint.html('<i class="fa fa-info-circle"></i>&nbsp;No sending profile uses <b>' + escapeHtml(domain.name) +
            '</b>. Create one with a From address like <span class="soc-mono">admin@' + escapeHtml(domain.name) + '</span>.').show()
    }
}

// profileMatchesDomains reports whether a sending profile's From address
// belongs to one of the managed domains. Only such profiles are offered in the
// wizard — mailboxes that don't exist on a managed domain can't be used.
function profileMatchesDomains(p) {
    var from = (p.from_address || "").toLowerCase()
    return wizData.domains.some(function (d) {
        return d.name && from.indexOf("@" + d.name.toLowerCase()) !== -1
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

// wizValidate checks that every required selection has been made before
// launch. On failure it shows the message and jumps to the offending step.
function wizValidate() {
    var fail = function (msg, step) {
        showStep(step)
        modalError(msg)
        return false
    }
    if ($.trim($("#name").val()) === "") {
        return fail("Please give the campaign a name.", 0)
    }
    if (!wizState.templates.length) {
        return fail("Select at least one email template.", 0)
    }
    if (!wizState.page) {
        return fail("Select a landing page.", 1)
    }
    if (!wizState.url) {
        return fail("Select a listener URL (domain).", 1)
    }
    if (!wizState.profile) {
        return fail("Select a sending profile.", 1)
    }
    if (!wizState.groups.length) {
        return fail("Select at least one target group.", 1)
    }
    return true
}

// Launch attempts to POST to /campaigns/
function launch() {
    if (!wizValidate()) {
        return
    }
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
                var templates = wizSelectedTemplates().map(function (t) {
                    return { name: t.name }
                })
                var groups = wizSelectedGroups().map(function (g) {
                    return { name: g.name }
                })
                var page = wizFind(wizData.pages, wizState.page)
                var profile = wizFind(wizData.profiles, wizState.profile)
                // Validate our fields
                var send_by_date = $("#send_by_date").val()
                if (send_by_date != "") {
                    send_by_date = moment(send_by_date, "MMMM Do YYYY, h:mm a").utc().format()
                }
                campaign = {
                    name: $("#name").val(),
                    // template stays the first selection for compatibility;
                    // templates carries the full rotation pool.
                    template: templates[0],
                    templates: templates,
                    url: wizState.url,
                    page: {
                        name: page ? page.name : ""
                    },
                    smtp: {
                        name: profile ? profile.name : ""
                    },
                    launch_date: moment($("#launch_date").val(), "MMMM Do YYYY, h:mm a").utc().format(),
                    send_by_date: send_by_date || null,
                    groups: groups,
                    company_id: parseInt($("#company").val(), 10) || 0,
                }
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
    var templates = wizSelectedTemplates()
    var page = wizFind(wizData.pages, wizState.page)
    var profile = wizFind(wizData.profiles, wizState.profile)
    if (!templates.length || !page || !profile || !wizState.url) {
        $("#sendTestEmailModal\\.flashes").empty().append("<div style=\"text-align:center\" class=\"alert alert-danger\">\
            <i class=\"fa fa-exclamation-circle\"></i> Select a template, landing page, URL and sending profile first.</div>")
        return
    }
    var test_email_request = {
        template: {
            name: templates[0].name
        },
        first_name: $("input[name=to_first_name]").val(),
        last_name: $("input[name=to_last_name]").val(),
        email: $("input[name=to_email]").val(),
        position: $("input[name=to_position]").val(),
        url: wizState.url,
        page: {
            name: page.name
        },
        smtp: {
            name: profile.name
        }
    }
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
    wizResetState()
    $("#url").val(null).trigger("change.select2");
    $("#company").val(null).trigger("change");
    $("#domainProfileHint").hide()
    wizSyncAll()
    wizUpdatePreview()
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

// loadProfiles fetches the sending profiles and keeps only those whose From
// address belongs to a managed domain. Must run after the domains have loaded.
function loadProfiles() {
    api.SMTP.get()
        .success(function (profiles) {
            profiles = profiles || []
            wizData.profiles = profiles.filter(profileMatchesDomains)
            wizRenderProfiles()
            if (profiles.length === 0) {
                modalError("No sending profiles found!")
            } else if (wizData.profiles.length === 1 && !wizState.profile) {
                wizState.profile = wizData.profiles[0].id
                wizSyncAll()
                wizUpdatePreview()
            }
        })
        .error(function () {
            wizData.profiles = []
            wizRenderProfiles()
        })
}

function setupOptions() {
    loadCompanies()
    // The Domains tab drives both the listener URL options and which sending
    // profiles are eligible, so profiles are loaded after the domains arrive.
    api.domains.get()
        .success(function (ds) {
            wizData.domains = ds || []
            setupURLSelect()
            loadProfiles()
            // With a single managed domain there is nothing to choose — use it.
            if (wizData.domains.length === 1 && !wizState.url && wizData.domains[0].name) {
                setURLValue("https://" + wizData.domains[0].name)
            }
        })
        .error(function () {
            wizData.domains = []
            setupURLSelect()
            loadProfiles()
        })
    api.groups.summary()
        .success(function (summaries) {
            wizData.groups = summaries.groups || []
            wizRenderGroups()
            if (wizData.groups.length == 0) {
                modalError("No groups found!")
            }
        });
    api.templates.get()
        .success(function (templates) {
            wizData.templates = templates || []
            wizRenderTemplates()
            if (wizData.templates.length == 0) {
                modalError("No templates found!")
            } else if (wizData.templates.length === 1 && !wizState.templates.length) {
                wizState.templates = [wizData.templates[0].id]
                wizSyncAll()
                wizUpdatePreview()
            }
        });
    api.pages.get()
        .success(function (pages) {
            wizData.pages = pages || []
            wizRenderPages()
            if (wizData.pages.length == 0) {
                modalError("No pages found!")
            } else if (wizData.pages.length === 1 && !wizState.page) {
                wizState.page = wizData.pages[0].id
                wizSyncAll()
                wizUpdatePreview()
            }
        });
}

/* ============================================================
   SOC cx campaign wizard
   A compact 3-step flow: Campaign (name/company/templates),
   Delivery (page/URL/profile/targets) and Review & Launch.
   Card clicks mutate wizState; sync helpers mark the cards.
   ============================================================ */
var WIZ_LABELS = ["Campaign", "Delivery", "Review"]
var WIZ_DESC = [
    "Name the simulation, pick a company and choose the email templates.",
    "Choose the landing page, listener domain, sender and targets.",
    "Set the schedule, confirm everything, then launch."
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

function wizRecipients() {
    var n = 0
    wizSelectedGroups().forEach(function (g) { n += g.num_targets || 0 })
    return n
}
function wizRow(icon, label, val, accent) {
    return '<div class="sr"' + (accent ? ' style="background:var(--accent-soft);"' : '') + '>' +
        '<div class="si"' + (accent ? ' style="background:var(--accent);color:#fff;"' : '') + '><i class="fa fa-' + icon + '"></i></div>' +
        '<div style="min-width:0;"><div class="sl">' + label + '</div>' +
        '<div class="sv" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(String(val)) + '</div></div></div>'
}
function wizTemplatesLabel() {
    var ts = wizSelectedTemplates()
    if (!ts.length) { return "—" }
    if (ts.length === 1) { return ts[0].name }
    return ts.length + " templates (random rotation)"
}
function wizSingleName(list, id) {
    var it = id !== null ? wizFind(list, id) : null
    return it ? it.name : "—"
}
function wizUpdatePreview() {
    if (!$("#previewSummary").length) { return }
    var recips = wizRecipients()
    $("#previewSummary").html(
        wizRow("bullseye", "Simulation", $("#name").val() || "Untitled", true) +
        wizRow("envelope-o", "Template" + (wizState.templates.length > 1 ? "s" : ""), wizTemplatesLabel()) +
        wizRow("file-o", "Page", wizSingleName(wizData.pages, wizState.page)) +
        wizRow("link", "URL", wizState.url || "—") +
        wizRow("paper-plane-o", "Profile", wizSingleName(wizData.profiles, wizState.profile)) +
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
    var ng = wizState.groups.length
    $("#recipientsNote").text(recips.toLocaleString() + " recipients across " + ng + " group" + (ng === 1 ? "" : "s"))
    var nt = wizState.templates.length
    $("#templatesNote").text(nt > 1 ? nt + " templates selected — each recipient will receive one of them at random" : "")
}
function wizRenderReview() {
    var ng = wizState.groups.length
    $("#reviewSummary").html(
        wizRow("bullseye", "Campaign", $("#name").val() || "Untitled") +
        wizRow("envelope-o", "Email template" + (wizState.templates.length > 1 ? "s" : ""),
            wizSelectedTemplates().map(function (t) { return t.name }).join(", ") || "—") +
        wizRow("file-o", "Landing page", wizSingleName(wizData.pages, wizState.page)) +
        wizRow("link", "Listener URL", wizState.url || "—") +
        wizRow("paper-plane-o", "Sending profile", wizSingleName(wizData.profiles, wizState.profile)) +
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
function wizRenderTemplates() {
    var $c = $("#templateChoices")
    if (!wizData.templates.length) { $c.html('<div class="minilist-empty">None available — create one first.</div>'); return }
    $c.html(wizData.templates.map(function (t) {
        return wizChoiceHtml(t.id, t.name, t.subject || "")
    }).join(""))
    wizSyncAll()
}
function wizRenderPages() {
    var $c = $("#pageChoices")
    if (!wizData.pages.length) { $c.html('<div class="minilist-empty">None available — create one first.</div>'); return }
    $c.html(wizData.pages.map(function (p) {
        return wizChoiceHtml(p.id, p.name, p.redirect_url || "",
            p.capture_credentials ? '<span class="tag" style="color:var(--c-submitted);">captures creds</span>' : '<span class="tag">clicks only</span>')
    }).join(""))
    wizSyncAll()
}
function wizRenderProfiles() {
    var $c = $("#profileChoices")
    if (!wizData.profiles.length) {
        $c.html('<div class="minilist-empty">No sending profiles match your domains. Add a domain in the ' +
            '<a href="/domains">Domains</a> tab, then create a sending profile whose From address uses it ' +
            '(e.g. admin@your-domain).</div>')
        return
    }
    $c.html(wizData.profiles.map(function (p) {
        return wizChoiceHtml(p.id, p.name, p.from_address || p.host || "",
            p.ignore_cert_errors ? '<span class="pill pill-clicked"><span class="dot"></span>Check certs</span>' : '<span class="pill pill-reported"><span class="dot"></span>TLS</span>')
    }).join(""))
    wizSyncAll()
}
function wizRenderGroups() {
    var $c = $("#groupChoices")
    if (!wizData.groups.length) { $c.html('<div class="minilist-empty">No groups yet — create one first.</div>'); return }
    $c.html(wizData.groups.map(function (g) {
        var n = g.num_targets || 0
        return '<div class="choice" data-id="' + g.id + '" data-targets="' + n + '">' +
            '<span class="ck"><i class="fa fa-check"></i></span>' +
            '<div style="flex:1;min-width:0;"><b style="font-size:13.5px;display:block;">' + escapeHtml(g.name) + '</b>' +
            '<span class="mono" style="font-size:11px;color:var(--ink-dim);">' + n + ' targets</span></div>' +
            '<span class="num" style="font-weight:600;font-size:13px;color:var(--ink-dim);">' + n + '</span></div>'
    }).join(""))
    wizSyncAll()
}
// wizSyncAll marks the cards in every list according to wizState.
function wizSyncAll() {
    var mark = function (containerId, selected) {
        $(containerId + " .choice").each(function () {
            var id = $(this).data("id")
            $(this).toggleClass("sel", selected.indexOf(id) >= 0)
        })
    }
    mark("#templateChoices", wizState.templates)
    mark("#pageChoices", wizState.page !== null ? [wizState.page] : [])
    mark("#profileChoices", wizState.profile !== null ? [wizState.profile] : [])
    mark("#groupChoices", wizState.groups)
}

function edit(campaign) {
    wizResetState()
    setupOptions();
    showStep(0);
}

function copy(idx) {
    wizResetState()
    setupOptions();
    showStep(0);
    // Set our initial values
    api.campaignId.get(campaigns[idx].id)
        .success(function (campaign) {
            $("#name").val("Copy of " + campaign.name)
            // Restore the template rotation pool when present, otherwise the
            // single template.
            var pool = (campaign.templates && campaign.templates.length) ? campaign.templates : [campaign.template]
            wizState.templates = pool.map(function (t) { return t.id }).filter(Boolean)
            if (campaign.page && campaign.page.id) {
                wizState.page = campaign.page.id
            }
            if (campaign.smtp && campaign.smtp.id) {
                wizState.profile = campaign.smtp.id
            }
            setURLValue(campaign.url)
            if (campaign.company_id) {
                loadCompanies(campaign.company_id)
            }
            wizSyncAll()
            wizUpdatePreview()
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
    // cx wizard: stepper + choice cards drive wizState
    $("#campaignStepper").on("click", ".st", function () { showStep(parseInt($(this).attr("data-step"), 10)) })
    $("#templateChoices").on("click", ".choice", function () {
        var id = $(this).data("id")
        var i = wizState.templates.indexOf(id)
        if (i >= 0) { wizState.templates.splice(i, 1) } else { wizState.templates.push(id) }
        wizSyncAll(); wizUpdatePreview()
    })
    $("#pageChoices").on("click", ".choice", function () {
        wizState.page = $(this).data("id")
        wizSyncAll(); wizUpdatePreview()
    })
    $("#profileChoices").on("click", ".choice", function () {
        wizState.profile = $(this).data("id")
        wizSyncAll(); wizUpdatePreview()
    })
    $("#groupChoices").on("click", ".choice", function () {
        var id = $(this).data("id")
        var i = wizState.groups.indexOf(id)
        if (i >= 0) { wizState.groups.splice(i, 1) } else { wizState.groups.push(id) }
        wizSyncAll(); wizUpdatePreview()
    })
    $("#url").on("change", function () {
        wizState.url = $(this).val() || ""
        wizUpdatePreview()
    })
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
