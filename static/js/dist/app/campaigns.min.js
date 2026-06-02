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
    return '<tr>' +
        '<td class="strong"><a href="/campaigns/' + campaign.id + '" style="color:inherit;text-decoration:none;">' + escapeHtml(campaign.name) + '</a>' +
        '<div class="mono" style="font-size:10.5px;color:var(--ink-faint);font-weight:400;">CMP-' + campaign.id + '</div></td>' +
        '<td data-order="' + escapeHtml(campaign.status) + '">' + campaignStatusPill(campaign.status, quickStats) + '</td>' +
        '<td class="num" data-order="' + epoch + '">' + date + '</td>' +
        '<td class="num strong" data-order="' + (s.sent || 0) + '">' + (s.sent || 0) + '</td>' +
        '<td>' + campaignMiniFunnel(f) + '</td>' +
        '<td class="num strong" data-order="' + rate + '">' + rate + '%</td>' +
        '<td class="no-sort"><div style="display:flex;gap:6px;justify-content:flex-end;">' +
        '<a class="icon-btn" style="width:30px;height:30px;" href="/campaigns/' + campaign.id + '" data-toggle="tooltip" data-placement="top" title="View Results"><i class="fa fa-bar-chart"></i></a>' +
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
    $("#url").val("");
    $("#profile").val("").change();
    $("#users").val("").change();
    $("#modal").modal('hide');
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

function setupOptions() {
    api.groups.summary()
        .success(function (summaries) {
            groups = summaries.groups
            if (groups.length == 0) {
                modalError("No groups found!")
                return false;
            } else {
                var group_s2 = $.map(groups, function (obj) {
                    obj.text = obj.name
                    obj.title = obj.num_targets + " targets"
                    return obj
                });
                console.log(group_s2)
                $("#users.form-control").select2({
                    placeholder: "Select Groups",
                    data: group_s2,
                });
            }
        });
    api.templates.get()
        .success(function (templates) {
            if (templates.length == 0) {
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
                if (templates.length === 1) {
                    template_select.val(template_s2[0].id)
                    template_select.trigger('change.select2')
                }
            }
        });
    api.pages.get()
        .success(function (pages) {
            if (pages.length == 0) {
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
                if (pages.length === 1) {
                    page_select.val(page_s2[0].id)
                    page_select.trigger('change.select2')
                }
            }
        });
    api.SMTP.get()
        .success(function (profiles) {
            if (profiles.length == 0) {
                modalError("No profiles found!")
                return false
            } else {
                var profile_s2 = $.map(profiles, function (obj) {
                    obj.text = obj.name
                    return obj
                });
                var profile_select = $("#profile.form-control")
                profile_select.select2({
                    placeholder: "Select a Sending Profile",
                    data: profile_s2,
                }).select2("val", profile_s2[0]);
                if (profiles.length === 1) {
                    profile_select.val(profile_s2[0].id)
                    profile_select.trigger('change.select2')
                }
            }
        });
}

function edit(campaign) {
    setupOptions();
}

function copy(idx) {
    setupOptions();
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
            $("#url").val(campaign.url)
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
                    order: [[2, "desc"]]
                }
                activeCampaignsTable = $("#campaignTable").DataTable(dtOpts)
                archivedCampaignsTable = $("#campaignTableArchive").DataTable(dtOpts)
                if (!archivedRows.length) { $("#emptyMessageArchive").show() }
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
