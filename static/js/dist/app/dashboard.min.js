/*
    dashboard.js — SOC-redesign dashboard.

    Renders the prototype dashboard (KPI row, phishing funnel, live activity
    feed, engagement-over-time line chart, risk-by-campaign bars and a recent
    campaigns table) entirely from real data:
      - GET /api/campaigns/summary  → aggregate stats + per-campaign rows
      - GET /api/campaigns/:id/results (timeline) for the most recent campaigns
        → the live activity feed.

    Charts are inline SVG that reference CSS custom properties (--c-*,
    --grid-line, ...) so they re-theme automatically on dark/light toggle with
    no reload. No Highcharts dependency on this page.
*/

var campaigns = []

// ---- funnel stage definitions (key matches campaign.stats fields) ----------
var FUNNEL_DEF = [
    { key: "sent", label: "Email Sent", color: "var(--c-sent)" },
    { key: "opened", label: "Email Opened", color: "var(--c-opened)" },
    { key: "clicked", label: "Clicked Link", color: "var(--c-clicked)" },
    { key: "submitted_data", label: "Submitted Data", color: "var(--c-submitted)" },
    { key: "email_reported", label: "Reported", color: "var(--c-reported)" }
]

// ---- timeline event → feed styling -----------------------------------------
var EVENT_META = {
    "Email Sent": { c: "var(--c-sent)", verb: "was sent the email" },
    "Email Opened": { c: "var(--c-opened)", verb: "opened the email" },
    "Clicked Link": { c: "var(--c-clicked)", verb: "clicked the link" },
    "Submitted Data": { c: "var(--c-submitted)", verb: "submitted credentials" },
    "Email Reported": { c: "var(--c-reported)", verb: "reported the email" },
    "Campaign Created": { c: "var(--accent)", verb: null }
}

function byDateAsc(a, b) { return new Date(a.created_date) - new Date(b.created_date) }
function byDateDesc(a, b) { return new Date(b.created_date) - new Date(a.created_date) }

// ============================================================================
// SVG chart helpers (ports of the prototype charts.jsx components)
// ============================================================================
function sparklineSVG(data, color) {
    var w = 64, h = 26
    if (!data || data.length < 2) return ""
    var max = Math.max.apply(null, data), min = Math.min.apply(null, data)
    var rng = (max - min) || 1
    var pts = data.map(function (v, i) {
        return [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 3) - 1.5]
    })
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1) }).join(" ")
    var area = d + " L " + w + " " + h + " L 0 " + h + " Z"
    var gid = "sg" + Math.random().toString(36).slice(2, 7)
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + color + '" stop-opacity="0.28"/>' +
        '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
        '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
}

function lineChartSVG(series, labels) {
    var w = 760, h = 230, padL = 38, padR = 14, padT = 14, padB = 26
    var iw = w - padL - padR, ih = h - padT - padB
    var all = []
    series.forEach(function (s) { all = all.concat(s.data) })
    var max = Math.ceil((Math.max.apply(null, all) || 0) / 100) * 100 || 100
    var n = series[0].data.length
    var xx = function (i) { return padL + (i / (n - 1)) * iw }
    var yy = function (v) { return padT + ih - (v / max) * ih }
    var svg = '<svg width="100%" viewBox="0 0 ' + w + ' ' + h + '" style="display:block">'
        ;[0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
            var y = padT + ih * (1 - g)
            svg += '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + y + '" y2="' + y + '" stroke="var(--grid-line)" stroke-width="1"/>'
            svg += '<text x="' + (padL - 8) + '" y="' + (y + 3.5) + '" text-anchor="end" font-family="var(--mono-font)" font-size="9.5" fill="var(--ink-faint)">' + Math.round(max * g) + '</text>'
        })
    if (labels) labels.forEach(function (lb, i) {
        svg += '<text x="' + xx(i) + '" y="' + (h - 7) + '" text-anchor="middle" font-family="var(--mono-font)" font-size="9.5" fill="var(--ink-faint)">' + lb + '</text>'
    })
    series.forEach(function (s, si) {
        var pts = s.data.map(function (v, i) { return [xx(i), yy(v)] })
        var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1) }).join(" ")
        var gid = "lg" + si + Math.random().toString(36).slice(2, 6)
        if (s.fill) {
            svg += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0" stop-color="' + s.color + '" stop-opacity="0.22"/>' +
                '<stop offset="1" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>'
            svg += '<path d="' + d + ' L ' + xx(n - 1) + ' ' + (padT + ih) + ' L ' + xx(0) + ' ' + (padT + ih) + ' Z" fill="url(#' + gid + ')"/>'
        }
        svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        pts.forEach(function (p) {
            svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.4" fill="var(--panel)" stroke="' + s.color + '" stroke-width="1.6"/>'
        })
    })
    svg += '</svg>'
    return svg
}

// ============================================================================
// Renderers
// ============================================================================
function computeTotals(cs) {
    var t = { total: 0, sent: 0, opened: 0, clicked: 0, submitted_data: 0, email_reported: 0, error: 0, running: 0, count: cs.length }
    $.each(cs, function (i, c) {
        var s = c.stats || {}
        t.total += s.total || 0
        t.sent += s.sent || 0
        t.opened += s.opened || 0
        t.clicked += s.clicked || 0
        t.submitted_data += s.submitted_data || 0
        t.email_reported += s.email_reported || 0
        t.error += s.error || 0
        if (c.status && c.status !== "Completed") t.running++
    })
    return t
}

function renderKPIs(totals, sortedAsc) {
    var clickRate = totals.sent ? Math.round((totals.clicked / totals.sent) * 1000) / 10 : 0
    var reportRate = totals.sent ? Math.round((totals.email_reported / totals.sent) * 1000) / 10 : 0
    var last = sortedAsc.slice(-10)
    var recSpark = last.map(function (c) { return (c.stats || {}).total || 0 })
    var clkSpark = last.map(function (c) { var s = c.stats || {}; return s.sent ? (s.clicked / s.sent) * 100 : 0 })
    var repSpark = last.map(function (c) { var s = c.stats || {}; return s.sent ? (s.email_reported / s.sent) * 100 : 0 })
    var kpis = [
        { label: "Active Campaigns", icon: "fa-bolt", value: totals.running, accent: true, sub: totals.count + " total", spark: recSpark, sparkColor: "var(--accent)" },
        { label: "Recipients", icon: "fa-users", value: totals.total.toLocaleString(), sub: totals.sent.toLocaleString() + " emails sent", spark: recSpark, sparkColor: "var(--accent)" },
        { label: "Click Rate", icon: "fa-mouse-pointer", value: clickRate, suffix: "%", sub: totals.clicked.toLocaleString() + " clicks", spark: clkSpark, sparkColor: "var(--c-clicked)" },
        { label: "Report Rate", icon: "fa-bullhorn", value: reportRate, suffix: "%", sub: totals.email_reported.toLocaleString() + " reported", spark: repSpark, sparkColor: "var(--c-reported)" }
    ]
    document.getElementById("kpiGrid").innerHTML = kpis.map(function (k) {
        return '<div class="kpi"><div class="label"><span class="ic"><i class="fa ' + k.icon + '"></i></span>' + k.label + '</div>' +
            '<div class="value"' + (k.accent ? ' style="color:var(--accent)"' : '') + '>' + k.value + (k.suffix ? '<small>' + k.suffix + '</small>' : '') + '</div>' +
            (k.sub ? '<div class="delta"><span style="color:var(--ink-faint)">' + k.sub + '</span></div>' : '') +
            '<div class="spark">' + sparklineSVG(k.spark, k.sparkColor) + '</div></div>'
    }).join("")
}

function renderFunnel(totals) {
    var base = totals.sent || totals.total || 1
    var html = ""
    FUNNEL_DEF.forEach(function (f, i) {
        var v = totals[f.key] || 0
        var pct = (v / base) * 100
        var ofPrev = 100
        if (i) {
            var prevVal = totals[FUNNEL_DEF[i - 1].key] || 0
            ofPrev = prevVal ? (v / prevVal) * 100 : 0
        }
        html += '<div class="funnel-row">' +
            '<div class="fl"><span class="sw" style="background:' + f.color + '"></span>' + f.label + '</div>' +
            '<div class="funnel-track"><div class="funnel-fill" style="width:' + Math.max(pct, 7) + '%;background:' + f.color + '">' + Math.round(pct) + '%</div></div>' +
            '<div class="fv"><b class="num">' + v.toLocaleString() + '</b> <span class="num">' + (i ? Math.round(ofPrev) + '%' : '—') + '</span></div>' +
            '</div>'
    })
    document.getElementById("funnel").innerHTML = html
    document.getElementById("funnelLegend").innerHTML = FUNNEL_DEF.map(function (f) {
        return '<div class="li"><span class="sw" style="background:' + f.color + '"></span>' + f.label + '</div>'
    }).join("")
}

function renderEngagement(cs) {
    var sorted = cs.slice().sort(byDateAsc).slice(-12)
    var el = document.getElementById("engagementChart")
    if (sorted.length < 2) {
        el.innerHTML = '<div class="mono" style="color:var(--ink-faint);text-align:center;padding:46px 0;font-size:12px;">Not enough campaigns to plot a trend yet.</div>'
        return
    }
    var labels = sorted.map(function (c) { return moment(c.created_date).format("MMM D") })
    el.innerHTML = lineChartSVG([
        { data: sorted.map(function (c) { return (c.stats || {}).opened || 0 }), color: "var(--c-opened)", fill: true },
        { data: sorted.map(function (c) { return (c.stats || {}).clicked || 0 }), color: "var(--c-clicked)" },
        { data: sorted.map(function (c) { return (c.stats || {}).email_reported || 0 }), color: "var(--c-reported)" }
    ], labels)
}

function renderRisk(cs) {
    // All campaigns, highest risk first — the panel body scrolls (.panel-scroll)
    // so the list doesn't stretch the Engagement Over Time panel next to it.
    var rows = cs.map(function (c) {
        var s = c.stats || {}
        var rate = s.total ? Math.round((s.submitted_data / s.total) * 100) : 0
        return { name: c.name, n: s.total || 0, rate: rate }
    }).sort(function (a, b) { return b.rate - a.rate })
    document.getElementById("riskList").innerHTML = rows.map(function (d) {
        var col = d.rate >= 30 ? "var(--c-submitted)" : d.rate >= 20 ? "var(--c-clicked)" : "var(--accent)"
        var txt = d.rate >= 30 ? "var(--c-submitted)" : d.rate >= 20 ? "var(--c-clicked)" : "var(--ink-mid)"
        return '<div><div class="between" style="margin-bottom:6px;">' +
            '<span style="font-size:12.5px;font-weight:500;">' + escapeHtml(d.name) + ' <span class="mono" style="color:var(--ink-faint);font-size:11px;">· ' + d.n + '</span></span>' +
            '<span class="num" style="font-size:12.5px;font-weight:600;color:' + txt + '">' + d.rate + '%</span></div>' +
            '<div style="height:7px;background:var(--panel-2);border-radius:4px;overflow:hidden;"><div style="width:' + Math.min(d.rate * 2, 100) + '%;height:100%;border-radius:4px;background:' + col + '"></div></div></div>'
    }).join("")
}

function statusPill(status) {
    var cls = status === "Completed" ? "pill-done" : "pill-active"
    return '<span class="pill ' + cls + '"><span class="dot"></span>' + escapeHtml(status) + '</span>'
}

function miniFunnel(f) {
    var total = f.reduce(function (a, b) { return a + b }, 0) || 1
    var colors = ["var(--c-sent)", "var(--c-opened)", "var(--c-clicked)", "var(--c-submitted)", "var(--c-reported)"]
    return '<div class="minifunnel" title="' + f.join(" / ") + '">' + f.map(function (v, i) {
        return '<span style="width:' + (v / total * 100) + '%;background:' + colors[i] + '"></span>'
    }).join("") + '</div>'
}

function renderRecent(cs) {
    var rows = cs.slice().sort(byDateDesc).slice(0, 5)
    var tb = document.querySelector("#recentTable tbody")
    tb.innerHTML = rows.map(function (c) {
        var s = c.stats || {}
        var rate = s.sent ? Math.round((s.clicked / s.sent) * 1000) / 10 : 0
        var f = [s.sent || 0, s.opened || 0, s.clicked || 0, s.submitted_data || 0, s.email_reported || 0]
        return '<tr style="cursor:pointer" onclick="location.href=\'/campaigns/' + c.id + '\'">' +
            '<td class="strong">' + escapeHtml(c.name) + '<div class="mono" style="font-size:10.5px;color:var(--ink-faint);font-weight:400;">CMP-' + c.id + '</div></td>' +
            '<td>' + statusPill(c.status) + '</td>' +
            '<td class="num">' + moment(c.created_date).format("MMM D, YYYY") + '</td>' +
            '<td class="num strong">' + (s.sent || 0) + '</td>' +
            '<td>' + miniFunnel(f) + '</td>' +
            '<td class="num strong">' + rate + '%</td>' +
            '<td style="text-align:right;"><i class="fa fa-angle-right" style="color:var(--ink-faint)"></i></td>' +
            '</tr>'
    }).join("")
}

// ---- live activity feed ----------------------------------------------------
function renderFeed(events) {
    var el = document.getElementById("liveFeed")
    if (!events.length) {
        el.innerHTML = '<div class="mono" style="color:var(--ink-faint);font-size:12px;padding:14px 0;">No recent activity.</div>'
        return
    }
    events.sort(function (a, b) { return new Date(b.time) - new Date(a.time) })
    // The feed scrolls inside its panel (.panel-scroll, height matched to the
    // Phishing Funnel panel), so we can afford a longer backlog.
    el.innerHTML = events.slice(0, 40).map(function (e) {
        var meta = EVENT_META[e.message] || { c: "var(--ink-faint)", verb: e.message }
        var body
        if (e.email && meta.verb) body = '<b>' + escapeHtml(e.email) + '</b> ' + meta.verb
        else if (e.message === "Campaign Created") body = 'Campaign <b>' + escapeHtml(e.campaign) + '</b> created'
        else body = '<b>' + escapeHtml(e.email || e.campaign) + '</b> ' + escapeHtml(e.message)
        return '<div class="ev"><span class="evdot" style="background:' + meta.c + '"></span>' +
            '<div class="ts">' + moment(e.time).format("HH:mm") + '</div>' +
            '<div class="body">' + body +
            '<div class="mono" style="color:var(--ink-faint);font-size:11px;margin-top:2px;">' + escapeHtml(e.campaign) + '</div></div></div>'
    }).join("")
}

function loadFeed(cs) {
    var recent = cs.slice().sort(byDateDesc).slice(0, 4)
    if (!recent.length) { renderFeed([]); return }
    var pending = recent.length, all = []
    var done = function () { if (--pending === 0) renderFeed(all) }
    recent.forEach(function (c) {
        api.campaignId.results(c.id)
            .success(function (res) {
                $.each((res && res.timeline) || [], function (i, ev) {
                    all.push({ time: ev.time, message: ev.message, email: ev.email, campaign: c.name })
                })
                done()
            })
            .error(function () { done() })
    })
}

// ============================================================================
$(document).ready(function () {
    api.campaigns.summary()
        .success(function (data) {
            $("#loading").hide()
            campaigns = (data && data.campaigns) || []
            if (campaigns.length > 0) {
                $("#dashboard").show()
                var totals = computeTotals(campaigns)
                var sortedAsc = campaigns.slice().sort(byDateAsc)
                renderKPIs(totals, sortedAsc)
                renderFunnel(totals)
                document.getElementById("funnelTargets").textContent = totals.total.toLocaleString() + " targets"
                renderEngagement(campaigns)
                renderRisk(campaigns)
                renderRecent(campaigns)
                loadFeed(campaigns)
            } else {
                $("#emptyMessage").show()
            }
        })
        .error(function () {
            $("#loading").hide()
            errorFlash("Error fetching campaigns")
        })
})
