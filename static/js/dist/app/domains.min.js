// domains.js powers the Domains management page: listing, adding, editing and
// deleting sending / landing domains. Adding a domain optionally flags it for
// automatic A-record and Microsoft 365 configuration, which gophish delegates
// to n8n via a webhook (fired server-side on create). A domain can be linked to
// a company so the campaign wizard can auto-wire the listener URL & sending
// profile.

let domains = [];
let companies = [];
// companyMap maps a company id -> company name.
let companyMap = {};
// selectedId is the id of the domain currently shown in the detail pane.
let selectedId = null;
// toggle state for the Add Domain modal
let autoARecord = true;
let connect365 = true;

// REC_COLORS / recBadge build a colored DNS record-type badge, mirroring the
// design mockup.
const REC_COLORS = {
    A: "var(--c-sent)", AAAA: "var(--c-sent)", CNAME: "var(--c-opened)",
    MX: "var(--c-clicked)", TXT: "var(--c-reported)", NS: "var(--ink-dim)"
};
const recBadge = (type) => {
    let c = REC_COLORS[type] || "var(--ink-dim)";
    return '<span class="rec-type" style="color:' + c + ';background:color-mix(in oklch, ' + c + ' 16%, transparent);">' + escapeHtml(type) + '</span>';
};

// m365Records mirrors models.BuildDesiredRecords' 365 set for the modal preview
// only. The authoritative set comes back from the API on create.
const m365Records = (name) => {
    let slug = name.replace(/\./g, "-");
    return [
        { type: "MX", host: "@", value: slug + ".mail.protection.outlook.com", ttl: "3600", priority: 0, label: "Mail routing" },
        { type: "TXT", host: "@", value: "v=spf1 include:spf.protection.outlook.com -all", ttl: "3600", label: "Sender policy (SPF)" },
        { type: "CNAME", host: "autodiscover", value: "autodiscover.outlook.com", ttl: "3600", label: "Autodiscover" },
        { type: "CNAME", host: "selector1._domainkey", value: "selector1-" + slug + "._domainkey.<tenant>.onmicrosoft.com", ttl: "3600", label: "DKIM key 1" },
        { type: "CNAME", host: "selector2._domainkey", value: "selector2-" + slug + "._domainkey.<tenant>.onmicrosoft.com", ttl: "3600", label: "DKIM key 2" },
        { type: "TXT", host: "_dmarc", value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@" + name, ttl: "3600", label: "DMARC policy" }
    ];
};

const statusPill = (status) => {
    if (status === "verified") return '<span class="pill pill-reported"><span class="dot"></span>Verified</span>';
    if (status === "failed") return '<span class="pill pill-submitted"><span class="dot"></span>Failed</span>';
    return '<span class="pill pill-clicked"><span class="dot"></span>Pending</span>';
};
const dotColor = (s) => s === "verified" ? "var(--c-reported)" : s === "failed" ? "var(--c-submitted)" : "var(--c-clicked)";

const dismiss = () => {
    $("#name").val("");
    $("#ip").val("");
    $("#registrar").val("Cloudflare");
    $("#company").val(null).trigger("change");
    autoARecord = true;
    connect365 = true;
    $("#autoASwitch").addClass("on");
    $("#connect365Switch").addClass("on");
    $("#modal\\.flashes").empty();
};

// renderKpis fills the KPI row.
const renderKpis = () => {
    let verified = domains.filter(d => d.status === "verified").length;
    let connected = domains.filter(d => d.m365_status === "connected").length;
    let withA = domains.filter(d => d.auto_a_record).length;
    let kpis = [
        { label: "Domains", value: domains.length, icon: "fa-globe" },
        { label: "Verified", value: verified, icon: "fa-check-circle" },
        { label: "M365 Connected", value: connected, icon: "fa-cloud" },
        { label: "A-records", value: withA, icon: "fa-server" }
    ];
    let html = kpis.map(k =>
        '<div class="kpi"><div class="label"><span class="ic"><i class="fa ' + k.icon + '"></i></span>' + k.label + '</div>' +
        '<div class="value">' + k.value + '</div></div>'
    ).join("");
    $("#domainKpis").html(html);
};

// renderList renders the left-hand domain list.
const renderList = () => {
    $("#domCount").text(domains.length);
    let html = domains.map(d => {
        let sub = (d.registrar || "—");
        let cloud = d.m365_status === "connected"
            ? '<i class="fa fa-cloud" style="color:#2d8fff;flex-shrink:0;" title="Microsoft 365 connected"></i>' : "";
        return '<div class="dom-item ' + (d.id === selectedId ? "sel" : "") + '" data-domain-id="' + d.id + '">' +
            '<span class="di-ic"><i class="fa fa-globe"></i></span>' +
            '<div class="di-n"><b>' + escapeHtml(d.name) + '</b><span>' + escapeHtml(sub) + '</span></div>' +
            cloud +
            '<span class="di-dot" style="background:' + dotColor(d.status) + ';"></span>' +
            '</div>';
    }).join("");
    $("#domItems").html(html);
};

// recordRows builds the DNS records table body from a record set.
const recordRows = (records) => {
    if (!records || !records.length) {
        return '<tr><td colspan="5" style="color:var(--ink-dim);">No records yet. Enable auto A-record or Microsoft 365 when adding the domain.</td></tr>';
    }
    return records.map(r => {
        let prio = (r.priority !== undefined && r.priority !== null && r.type === "MX")
            ? '<span style="color:var(--ink-faint);">[' + r.priority + '] </span>' : "";
        return '<tr>' +
            '<td>' + recBadge(r.type) + '</td>' +
            '<td class="strong soc-mono" style="font-size:12px;">' + escapeHtml(r.host) + '</td>' +
            '<td class="soc-mono" style="font-size:11.5px;color:var(--ink-mid);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + prio + escapeHtml(r.value) + '</td>' +
            '<td class="soc-mono" style="font-size:11.5px;color:var(--ink-dim);">' + escapeHtml(r.ttl || "") + '</td>' +
            '<td><span class="pill pill-reported"><span class="dot"></span>Active</span></td>' +
            '</tr>';
    }).join("");
};

// renderDetail renders the right-hand detail pane for the selected domain.
const renderDetail = () => {
    let d = domains.find(x => x.id === selectedId);
    if (!d) {
        $("#domDetail").html('<div class="panel-body" style="color:var(--ink-dim);">Select a domain to view its DNS records.</div>');
        return;
    }
    // Build the record set for display: prefer the records returned on create,
    // otherwise reconstruct from the toggles.
    let records = d.records;
    if (!records) {
        records = [];
        if (d.auto_a_record) records.push({ type: "A", host: "@", value: d.ip || "0.0.0.0", ttl: "3600", label: "Origin A record" });
        if (d.configure_365) records = records.concat(m365Records(d.name));
    }
    let companyName = d.company_id ? (companyMap[d.company_id] || "—") : "—";

    let m365Card;
    if (d.m365_status === "connected") {
        m365Card = '<div class="intg-card on"><span class="it-tile" style="background:var(--c-reported);"><i class="fa fa-cloud"></i></span>' +
            '<div class="it-body"><b>Connected to Microsoft 365</b><span class="soc-mono">MX, SPF, DKIM &amp; DMARC provisioned</span></div>' +
            '<span class="pill pill-reported"><span class="dot"></span>Mail flow</span></div>';
    } else {
        m365Card = '<div class="intg-card"><span class="it-tile"><i class="fa fa-cloud"></i></span>' +
            '<div class="it-body"><b>Microsoft 365</b><span>Not connected. Edit the domain and enable "Connect to Microsoft 365" to provision mail records.</span></div></div>';
    }

    let html =
        '<div class="dom-head">' +
            '<span class="dh-ic"><i class="fa fa-globe"></i></span>' +
            '<div style="flex:1;min-width:0;"><h3>' + escapeHtml(d.name) + '</h3>' +
            '<div class="dh-sub">' + (d.ip ? "A → " + escapeHtml(d.ip) : "no A record") + ' · ' + escapeHtml(d.registrar || "—") + '</div></div>' +
            statusPill(d.status) +
            '<button type="button" class="btn btn-sm edit_button" data-domain-id="' + d.id + '" data-toggle="modal" data-backdrop="static" data-target="#modal"><i class="fa fa-pencil"></i>&nbsp;Edit</button>' +
            '<button type="button" class="btn btn-sm btn-danger delete_button" data-domain-id="' + d.id + '"><i class="fa fa-trash-o"></i></button>' +
        '</div>' +
        '<div class="dom-meta">' +
            '<div><div class="ml">Registrar</div><div class="mv">' + escapeHtml(d.registrar || "—") + '</div></div>' +
            '<div><div class="ml">Company</div><div class="mv">' + escapeHtml(companyName) + '</div></div>' +
            '<div><div class="ml">Origin IP</div><div class="mv soc-mono" style="font-size:12px;">' + escapeHtml(d.ip || "—") + '</div></div>' +
            '<div><div class="ml">Microsoft 365</div><div class="mv">' + (d.m365_status === "connected" ? "Connected" : "Not connected") + '</div></div>' +
        '</div>' +
        '<div class="intg">' + m365Card + '</div>' +
        '<div class="soc-between" style="padding:2px var(--pad) 10px;">' +
            '<span class="soc-section-title" style="margin:0;"><i class="fa fa-sitemap" style="margin-right:6px;color:var(--ink-dim);"></i>DNS Records · ' + records.length + '</span>' +
        '</div>' +
        '<div class="table-panel"><table class="table">' +
            '<thead><tr><th style="width:70px;">Type</th><th>Host</th><th>Value</th><th style="width:70px;">TTL</th><th style="width:90px;">Status</th></tr></thead>' +
            '<tbody>' + recordRows(records) + '</tbody>' +
        '</table></div>';
    $("#domDetail").html(html);
};

const render = () => {
    $("#loading").hide();
    if (!domains.length) {
        $("#domLayout").hide();
        $("#emptyMessage").show();
        renderKpis();
        return;
    }
    $("#emptyMessage").hide();
    if (selectedId === null || !domains.find(x => x.id === selectedId)) {
        selectedId = domains[0].id;
    }
    renderKpis();
    renderList();
    renderDetail();
    $("#domLayout").show();
    $('[data-toggle="tooltip"]').tooltip();
};

// loadCompanies populates the #company select2 in the Add Domain modal.
const loadCompanies = (selectedCompanyId) => {
    let data = $.map(companies, (c) => { return { id: c.id, text: c.name }; });
    let $company = $("#company");
    if ($company.hasClass("select2-hidden-accessible")) {
        $company.select2("destroy");
    }
    $company.empty().append("<option></option>");
    $company.select2({
        placeholder: "No company",
        allowClear: true,
        dropdownParent: $("#modal"),
        data: data
    });
    if (selectedCompanyId) {
        $company.val(selectedCompanyId.toString()).trigger("change.select2");
    } else {
        $company.val(null).trigger("change.select2");
    }
};

const load = () => {
    $("#domLayout").hide();
    $("#emptyMessage").hide();
    $("#loading").show();
    api.companies.get()
        .success((cs) => {
            companies = cs || [];
            companyMap = {};
            $.each(companies, (i, c) => { companyMap[c.id] = c.name; });
            loadCompanies();
            api.domains.get()
                .success((ds) => {
                    domains = ds || [];
                    render();
                })
                .error(() => {
                    $("#loading").hide();
                    errorFlash("Error fetching domains");
                });
        })
        .error(() => {
            // Companies are optional context; still load domains.
            companies = [];
            companyMap = {};
            loadCompanies();
            api.domains.get()
                .success((ds) => { domains = ds || []; render(); })
                .error(() => { $("#loading").hide(); errorFlash("Error fetching domains"); });
        });
};

// updatePreview refreshes the modal's live preview aside.
const updatePreview = () => {
    let name = $.trim($("#name").val()).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    let ip = $.trim($("#ip").val());
    let recCount = (autoARecord ? 1 : 0) + (connect365 ? 6 : 0);
    let html =
        '<div class="sr" style="background:var(--accent-soft);"><div class="si" style="background:var(--accent);color:#fff;"><i class="fa fa-globe"></i></div>' +
            '<div style="min-width:0;"><div class="sl">Domain</div><div class="sv soc-mono" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (escapeHtml(name) || "—") + '</div></div></div>' +
        '<div class="sr"><div class="si"><i class="fa fa-server"></i></div><div><div class="sl">Root A record</div><div class="sv soc-mono" style="font-size:12.5px;">' + (escapeHtml(ip) || "—") + '</div></div></div>' +
        '<div class="sr"><div class="si"><i class="fa fa-cloud"></i></div><div><div class="sl">Microsoft 365</div><div class="sv">' + (connect365 ? "6 records" : "Not connected") + '</div></div></div>';
    $("#domPreview").html(html);
    $("#domPreviewNote").html('Total <b>' + recCount + '</b> DNS records will be requested. The domain enters <b>Pending</b> and a provisioning request is sent to n8n.');
};

const saveDomain = (id) => {
    let name = $.trim($("#name").val()).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    let domain = {
        name: name,
        ip: $.trim($("#ip").val()),
        registrar: $("#registrar").val(),
        company_id: parseInt($("#company").val(), 10) || 0,
        auto_a_record: autoARecord,
        configure_365: connect365
    };
    if (id != -1) {
        domain.id = parseInt(id);
        api.domainId.put(domain)
            .success(function (data) {
                dismiss();
                selectedId = data.id;
                $("#modal").modal("hide");
                load();
                successFlash('Domain "' + escapeHtml(domain.name) + '" updated successfully!');
            })
            .error(function (data) {
                modalError(data.responseJSON.message);
            });
    } else {
        api.domains.post(domain)
            .success(function (data) {
                dismiss();
                selectedId = data.id;
                $("#modal").modal("hide");
                load();
                let extra = (domain.auto_a_record || domain.configure_365)
                    ? " Provisioning request sent to n8n." : "";
                successFlash('Domain "' + escapeHtml(domain.name) + '" added successfully!' + extra);
            })
            .error(function (data) {
                modalError(data.responseJSON.message);
            });
    }
};

const editDomain = (id) => {
    dismiss();
    $("#modalSubmit").unbind("click").click(() => { saveDomain(id); });
    if (id !== -1 && id !== "-1") {
        $("#domainModalLabel").text("Edit Domain");
        $("#modalSubmit").html('<i class="fa fa-check"></i>&nbsp;Save changes');
        api.domainId.get(id)
            .success(function (d) {
                $("#name").val(d.name);
                $("#ip").val(d.ip || "");
                $("#registrar").val(d.registrar || "Cloudflare");
                autoARecord = !!d.auto_a_record;
                connect365 = !!d.configure_365;
                $("#autoASwitch").toggleClass("on", autoARecord);
                $("#connect365Switch").toggleClass("on", connect365);
                loadCompanies(d.company_id || null);
                updatePreview();
            })
            .error(function () { errorFlash("Error fetching domain"); });
    } else {
        $("#domainModalLabel").text("Add Domain");
        $("#modalSubmit").html('<i class="fa fa-check"></i>&nbsp;Add domain');
        updatePreview();
    }
};

const deleteDomain = (id) => {
    let domain = domains.find(x => x.id == id);
    if (!domain) { return; }
    Swal.fire({
        title: "Are you sure?",
        text: "This will remove the domain '" + escapeHtml(domain.name) + "' from gophish. DNS records already provisioned at your registrar are not removed.",
        type: "warning",
        animation: false,
        showCancelButton: true,
        confirmButtonText: "Delete",
        confirmButtonColor: "#428bca",
        reverseButtons: true,
        allowOutsideClick: false,
        preConfirm: function () {
            return new Promise((resolve, reject) => {
                api.domainId.delete(id)
                    .success((msg) => { resolve(); })
                    .error((data) => { reject(data.responseJSON.message); });
            }).catch(error => { Swal.showValidationMessage(error); });
        }
    }).then(function (result) {
        if (result.value) {
            Swal.fire("Domain Deleted!", "The domain has been deleted!", "success");
        }
        $("button:contains('OK')").on("click", function () { location.reload(); });
    });
};

$(document).ready(function () {
    load();
    $("#modal").on("hide.bs.modal", function () { dismiss(); });
    $("#new_button").on("click", function () { editDomain(-1); });

    // toggle switches
    $("#autoARow").on("click", function () {
        autoARecord = !autoARecord;
        $("#autoASwitch").toggleClass("on", autoARecord);
        updatePreview();
    });
    $("#connect365Row").on("click", function () {
        connect365 = !connect365;
        $("#connect365Switch").toggleClass("on", connect365);
        updatePreview();
    });
    $("#name, #ip").on("input", updatePreview);

    // domain list selection
    $("#domItems").on("click", ".dom-item", function () {
        selectedId = parseInt($(this).attr("data-domain-id"), 10);
        renderList();
        renderDetail();
    });
    // edit / delete from the detail pane
    $("#domDetail").on("click", ".edit_button", function () {
        editDomain($(this).attr("data-domain-id"));
    });
    $("#domDetail").on("click", ".delete_button", function () {
        deleteDomain($(this).attr("data-domain-id"));
    });

    // Add a new company inline from the domain modal.
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
                name = $.trim(name || "");
                if (name === "") {
                    Swal.showValidationMessage("Please enter a company name");
                    return false;
                }
                return new Promise(function (resolve) {
                    api.companies.post({ name: name })
                        .success(function (data) { resolve(data); })
                        .error(function (data) {
                            Swal.showValidationMessage(data.responseJSON.message);
                            resolve(false);
                        });
                });
            }
        }).then(function (result) {
            if (result.value) {
                companies.push(result.value);
                companyMap[result.value.id] = result.value.name;
                loadCompanies(result.value.id);
            }
        });
    });
});
