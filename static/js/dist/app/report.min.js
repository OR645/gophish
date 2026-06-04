// report.js
// Client-side port of the New-Report_Phishing PowerShell script.
// Builds the Yazamco "מבדק הממד האנושי - פישינג" HTML report (1:1 with the
// PowerShell output) entirely in the browser from a Gophish campaign object,
// then opens it in a new tab so it can be printed to PDF / saved.
//
// Loaded on the campaigns list page and the campaign results page. Relies on
// the global `api`, `Swal`, `escapeHtml` and `errorFlash` helpers from gophish.js.

// Hebrew genitive month names (matches .NET he-IL 'd MMMM yyyy' which prefixes "ב").
var REPORT_HE_MONTHS = ["בינואר", "בפברואר", "במרץ", "באפריל", "במאי", "ביוני",
    "ביולי", "באוגוסט", "בספטמבר", "באוקטובר", "בנובמבר", "בדצמבר"]

function reportHebrewDate(d) {
    var dt = new Date(d)
    if (isNaN(dt.getTime())) return ""
    return dt.getDate() + " " + REPORT_HE_MONTHS[dt.getMonth()] + " " + dt.getFullYear()
}

// Match PowerShell [math]::Round(x, 1) — whole numbers render without a ".0".
function reportRound1(n) { return Math.round(n * 10) / 10 }

function reportSeverityLevel(clickRate) {
    if (clickRate <= 5) return "מצוינת"
    else if (clickRate <= 15) return "טובה מאוד"
    else if (clickRate <= 25) return "בינונית"
    else if (clickRate <= 30) return "נמוכה"
    else return "נמוכה מאוד"
}

function reportSeverityClass(level) {
    if (level.indexOf("מצוינת") > -1) return "excellent"
    if (level.indexOf("טובה") > -1) return "good"
    if (level.indexOf("בינונית") > -1) return "medium"
    if (level.indexOf("נמוכה") > -1) return "low"
    return "low"
}

function reportFindingSeverity(status) {
    switch (status) {
        case "Submitted Data": return { Class: "critical", Text: "שלח נתונים" }
        case "Clicked Link": return { Class: "high", Text: "לחץ על קישור" }
        case "Email Opened": return { Class: "medium", Text: "פתח מייל" }
        case "Email Sent": return { Class: "low", Text: "נשלח" }
        default: return { Class: "low", Text: status }
    }
}

// Risk ranking used to pick the "highest-risk" recipient and to sort the
// per-employee table (Submitted Data > Clicked Link > Email Opened > Email Sent).
var REPORT_RISK_ORDER = { "Submitted Data": 1, "Clicked Link": 2, "Email Opened": 3, "Email Sent": 4 }

function reportSortByRisk(results) {
    return (results || []).slice().sort(function (a, b) {
        var oa = REPORT_RISK_ORDER[a.status] || 99
        var ob = REPORT_RISK_ORDER[b.status] || 99
        if (oa !== ob) return oa - ob
        return (a.first_name || "").localeCompare(b.first_name || "")
    })
}

// renderGophishTemplate - substitutes the gophish phishing-template tokens
// ({{.URL}}, {{.Tracker}}, {{.FirstName}}, ...) that gophish only fills in at
// send time, so the captured screenshot renders like the real email / page.
function renderGophishTemplate(html, campaign, recipient) {
    if (!html) return html
    recipient = recipient || {}
    var url = campaign.url || "#"
    var repl = {
        "URL": url,
        "BaseURL": url,
        "TrackingURL": url,
        "Tracker": "", // hidden 1x1 tracking pixel - drop it from the preview
        "From": "",
        "RId": recipient.id || "preview",
        "Email": recipient.email || "user@example.com",
        "FirstName": recipient.first_name || "",
        "LastName": recipient.last_name || "",
        "Position": recipient.position || ""
    }
    var out = html
    Object.keys(repl).forEach(function (key) {
        out = out.replace(new RegExp("{{\\s*\\." + key + "\\s*}}", "g"), repl[key])
    })
    // Strip any remaining template actions so they don't show as literal text.
    out = out.replace(/{{\s*\.[^}]*}}/g, "")
    return out
}

// Timeline event -> Hebrew label / icon / color (matches the report palette).
var REPORT_EVENT_INFO = {
    "Campaign Created": { he: "הקמפיין נוצר", icon: "fa-rocket", color: "var(--accent)" },
    "Email Sent": { he: "המייל נשלח", icon: "fa-paper-plane", color: "var(--low)" },
    "Email Opened": { he: "המייל נפתח", icon: "fa-envelope-open", color: "var(--medium)" },
    "Clicked Link": { he: "לחיצה על הקישור", icon: "fa-mouse-pointer", color: "var(--high)" },
    "Submitted Data": { he: "הזנת נתונים", icon: "fa-exclamation-triangle", color: "var(--critical)" },
    "Email Reported": { he: "המייל דווח", icon: "fa-bullhorn", color: "var(--good)" }
}

// Escape a string for use inside a double-quoted HTML attribute (iframe srcdoc).
function reportAttrEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

// fetchImageAsDataURL - loads an image (same-origin) and returns a base64 data
// URI so the generated report is fully self-contained (logo survives save/print).
function fetchImageAsDataURL(url) {
    return fetch(url)
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob() })
        .then(function (blob) {
            return new Promise(function (resolve, reject) {
                var fr = new FileReader()
                fr.onload = function () { resolve(fr.result) }
                fr.onerror = reject
                fr.readAsDataURL(blob)
            })
        })
}

// waitForDocumentReady - resolves once every image AND external stylesheet in
// the document has finished loading (or errored) and web fonts are ready, plus a
// short settle delay so the final layout is stable. Capped so a slow remote
// asset can't hang the capture.
//
// Waiting for <link> stylesheets matters most for landing pages: they are
// usually cloned from a real site and depend on an external CSS file, so
// capturing before it applies produces a blank / unstyled frame.
function waitForDocumentReady(doc) {
    return new Promise(function (resolve) {
        var settled = false
        var settle = function () {
            if (settled) return
            settled = true
            var fontsReady = (doc.fonts && doc.fonts.ready) ? doc.fonts.ready : Promise.resolve()
            fontsReady.catch(function () {}).then(function () {
                // One more tick so reflow from late CSS / fonts / images is painted.
                setTimeout(resolve, 500)
            })
        }
        var imgs = Array.prototype.slice.call(doc.images || [])
        var pendingImgs = imgs.filter(function (im) { return !im.complete })
        // link.sheet is populated only once the stylesheet has loaded & parsed
        // (works for cross-origin links too - reading .sheet is allowed, only
        // .cssRules is blocked).
        var links = Array.prototype.slice.call(doc.querySelectorAll('link[rel~="stylesheet"]'))
        var pendingLinks = links.filter(function (l) {
            try { return !l.sheet } catch (e) { return false }
        })
        var pending = pendingImgs.concat(pendingLinks)
        if (!pending.length) { settle(); return }
        var remaining = pending.length
        var cap = setTimeout(settle, 10000) // don't wait forever on a stuck asset
        var onDone = function () {
            remaining--
            if (remaining <= 0) { clearTimeout(cap); settle() }
        }
        pending.forEach(function (el) {
            el.addEventListener("load", onDone)
            el.addEventListener("error", onDone)
        })
    })
}

// Remote images (logos, backgrounds) in real templates are usually served
// without CORS headers, so html2canvas can't rasterize them. We route them
// through a CORS-enabled image proxy so they can be drawn without tainting the
// canvas. Swap REPORT_IMAGE_PROXY if you prefer a different / self-hosted proxy
// (it must accept ?url=<encoded image url> and return the image with
// Access-Control-Allow-Origin).
var REPORT_IMAGE_PROXY = "https://images.weserv.nl/?url="

function reportProxyImageUrl(u) {
    // weserv expects the source without a protocol: "ssl:" prefix for https,
    // bare host for http. (This long-standing format is the most compatible.)
    var src = u.replace(/^https:\/\//i, "ssl:").replace(/^http:\/\//i, "")
    return REPORT_IMAGE_PROXY + encodeURIComponent(src)
}

// proxifyImagesForCapture - rewrites every remote (absolute http/https) image in
// the document to go through the CORS proxy: both <img src> and CSS
// background-image. Backgrounds are read from computed style so images defined
// in external stylesheets are caught too, then overridden inline. Returns true
// if anything changed, so the caller knows to wait for the new loads.
function proxifyImagesForCapture(doc) {
    var changed = false
    var isRemote = function (u) {
        return u && /^https?:\/\//i.test(u) && u.indexOf("images.weserv.nl") === -1
    }
    var view = doc.defaultView || window
    // <img> elements - img.src is the absolute resolved URL.
    Array.prototype.slice.call(doc.images || []).forEach(function (img) {
        var abs = img.src || img.getAttribute("src") || ""
        if (!isRemote(abs)) return
        img.removeAttribute("srcset") // srcset would override our rewritten src
        img.crossOrigin = "anonymous"
        img.src = reportProxyImageUrl(abs)
        changed = true
    })
    // CSS background-image (computed -> catches external stylesheets too).
    Array.prototype.slice.call(doc.querySelectorAll("*")).forEach(function (el) {
        var bg
        try { bg = view.getComputedStyle(el).backgroundImage } catch (e) { return }
        if (!bg || bg.indexOf("url(") === -1 || bg.indexOf("images.weserv.nl") !== -1) return
        var replaced = bg.replace(/url\(\s*(["']?)(https?:\/\/[^)"']+)\1\s*\)/gi, function (m, q, url) {
            changed = true
            return 'url("' + reportProxyImageUrl(url) + '")'
        })
        if (replaced !== bg) el.style.backgroundImage = replaced
    })
    return changed
}

// captureHtmlToImage - renders an HTML string off-screen and rasterizes it to a
// PNG data URI with html2canvas (sharp). Used when no render webhook is
// configured (REPORT_SHOT_WEBHOOK), or as the fallback when it fails - see
// captureOne. Resolves to null (never rejects) on failure - any failure is
// logged to the console under the "[report]" prefix so it can be diagnosed.
//
// Remote images without CORS headers are simply omitted by html2canvas (the
// canvas stays clean and toDataURL still works), so they degrade gracefully and
// are not a capture failure - any real failure is surfaced in the console.
function captureHtmlToImage(html, width) {
    if (typeof window.html2canvas !== "function") {
        if (window.console) console.warn("[report] html2canvas not loaded - cannot capture screenshot, using inline fallback")
        return Promise.resolve(null)
    }
    return new Promise(function (resolve) {
        var iframe = document.createElement("iframe")
        // allow-same-origin lets us read the rendered DOM; no allow-scripts so
        // the email/page content can't execute.
        iframe.setAttribute("sandbox", "allow-same-origin")
        iframe.style.position = "fixed"
        iframe.style.left = "-10000px"
        iframe.style.top = "0"
        iframe.style.width = width + "px"
        // Start at a realistic desktop viewport height so pages laid out with
        // 100vh (e.g. full-screen login pages) render naturally before we
        // measure their real content height.
        iframe.style.height = "900px"
        iframe.style.border = "0"
        iframe.style.background = "#ffffff"
        var done = false
        var cleanup = function (result) {
            if (done) return
            done = true
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
            resolve(result)
        }
        iframe.onload = function () {
            var doc = iframe.contentDocument
            // Guard against the initial about:blank load event some browsers fire
            // when the iframe is inserted: ignore it and wait for the real srcdoc
            // content so we don't capture (and lock in) an empty document.
            if (!doc || !doc.body || (!doc.body.childNodes.length && html)) return
            // Wait for CSS/images to load, route remote images through the CORS
            // proxy, then wait again for the proxied versions before capturing.
            waitForDocumentReady(doc).then(function () {
                var changed = proxifyImagesForCapture(doc)
                return changed ? waitForDocumentReady(doc) : null
            }).then(function () {
                try {
                    var body = doc.body
                    var docEl = doc.documentElement
                    // Full content height - measured from scrollHeight so the
                    // WHOLE page is captured, not just the first viewport.
                    var h = Math.max(body.scrollHeight, docEl.scrollHeight, body.offsetHeight, docEl.offsetHeight, 400)
                    iframe.style.height = h + "px"
                    // Browsers cap canvas dimensions (~16384px/side). Pick a scale
                    // that keeps both sides under a safe cap so a long page is
                    // captured in full (downscaled) instead of being truncated;
                    // never upscale past 2x.
                    var MAX_CANVAS_PX = 14000
                    var scale = Math.min(2, MAX_CANVAS_PX / Math.max(width, 1), MAX_CANVAS_PX / Math.max(h, 1))
                    if (window.console) console.log("[report] capturing", width + "x" + h, "@", scale + "x")
                    window.html2canvas(body, {
                        backgroundColor: "#ffffff",
                        useCORS: true,
                        allowTaint: false,
                        scale: scale,
                        width: width,
                        height: h,
                        windowWidth: width,
                        windowHeight: h,
                        scrollX: 0,
                        scrollY: 0,
                        imageTimeout: 15000,
                        logging: false,
                        onclone: function (clonedDoc) {
                            try {
                                var st = clonedDoc.createElement("style")
                                st.textContent =
                                    // Kill animations/transitions so the frame is
                                    // stable (don't touch background - that would
                                    // wipe the proxied background-image).
                                    "*{animation:none !important;transition:none !important;}" +
                                    // Real templates often define @font-face with a
                                    // custom family (e.g. 'Segoe UI Webfont') that
                                    // html2canvas mis-measures - text gets drawn at
                                    // zero width / not at all (while <input>/button
                                    // text, drawn on a separate path, still shows).
                                    // Force a concrete system font that is visually
                                    // identical so DOM text renders reliably.
                                    "*{font-family:'Segoe UI',-apple-system,'Helvetica Neue',Arial,'Noto Sans Hebrew',sans-serif !important;}" +
                                    // Views animated in with animation-fill-mode:both
                                    // freeze at the hidden 0% keyframe when the
                                    // animation doesn't run. Pin animated containers
                                    // to their final visible state. NOTE: only reset
                                    // transform on .animate (its transform is purely
                                    // the slide animation) - never on the lightbox,
                                    // whose transform centers the card.
                                    ".animate{opacity:1 !important;transform:none !important;}" +
                                    ".fade-in-lightbox,[class*='fade-in'],[class*='slide-in']{opacity:1 !important;}"
                                clonedDoc.head.appendChild(st)
                            } catch (e) { /* non-fatal */ }
                        }
                    }).then(function (canvas) {
                        var url = null
                        try {
                            url = canvas.toDataURL("image/png")
                        } catch (e) {
                            if (window.console) console.warn("[report] canvas.toDataURL failed (tainted canvas / cross-origin image):", e)
                            url = null
                        }
                        cleanup(url)
                    }).catch(function (e) {
                        if (window.console) console.warn("[report] html2canvas render failed:", e)
                        cleanup(null)
                    })
                } catch (e) {
                    if (window.console) console.warn("[report] screenshot capture threw:", e)
                    cleanup(null)
                }
            })
        }
        // Safety timeout in case onload/asset loading never completes.
        setTimeout(function () {
            if (!done && window.console) console.warn("[report] screenshot capture timed out after 30s, using inline fallback")
            cleanup(null)
        }, 30000)
        // Set srcdoc BEFORE inserting into the DOM so the first (and only) load
        // event is for the real content, not the initial about:blank document.
        iframe.srcdoc = html
        document.body.appendChild(iframe)
    })
}

// Optional render webhook (e.g. an n8n webhook). When set, the report POSTs the
// email / landing-page HTML to it and the webhook RESPONDS with the rendered PNG
// (a real headless browser = faithful fonts/layout/text). Nothing is stored:
// rendering happens on demand at report time, so no extra service or image host
// is needed - just n8n. Leave blank to render with html2canvas in the browser.
// See deploy/report-screenshots-n8n.md.
var REPORT_SHOT_WEBHOOK = "https://n8n.yazamco.pro/webhook/gophish-screenshot" // blank to disable

// captureViaWebhook - POSTs the HTML to the render webhook and returns the PNG
// as a data URI (so the report stays self-contained). Resolves to null on any
// failure so the caller can fall back to html2canvas.
function captureViaWebhook(html, width) {
    return fetch(REPORT_SHOT_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: html, width: width })
    }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status)
        return r.blob()
    }).then(function (blob) {
        // Accept image/* or an untyped/octet-stream binary; reject obvious
        // non-images (an n8n error is usually text/* or application/json).
        if (!blob || blob.size === 0) throw new Error("empty response")
        if (blob.type && /^(text\/|application\/json)/i.test(blob.type)) {
            throw new Error("response was not an image (" + blob.type + ")")
        }
        return new Promise(function (resolve, reject) {
            var fr = new FileReader()
            fr.onload = function () { resolve(fr.result) }
            fr.onerror = reject
            fr.readAsDataURL(blob)
        })
    }).catch(function (e) {
        if (window.console) console.warn("[report] render webhook failed, falling back to html2canvas:", e)
        return null
    })
}

// captureOne - render a single asset to a PNG data URI: the webhook (faithful)
// when configured, otherwise html2canvas. Falls back to html2canvas if the
// webhook errors.
function captureOne(html, width) {
    if (!html) return Promise.resolve(null)
    if (REPORT_SHOT_WEBHOOK) {
        return captureViaWebhook(html, width).then(function (img) {
            return img || captureHtmlToImage(html, width)
        })
    }
    return captureHtmlToImage(html, width)
}

// captureCampaignAssets - returns {emailImg, pageImg} PNG data URIs for the
// report (rendered via the webhook or html2canvas).
function captureCampaignAssets(campaign) {
    var recipient = reportSortByRisk(campaign.results)[0] || {}
    var tmpl = campaign.template || {}
    var emailHtml = tmpl.html
        ? renderGophishTemplate(tmpl.html, campaign, recipient)
        : (tmpl.text
            ? '<pre style="white-space:pre-wrap;font-family:monospace;padding:16px;margin:0;">' + escapeHtml(renderGophishTemplate(tmpl.text, campaign, recipient)) + '</pre>'
            : "")
    var pageHtml = renderGophishTemplate((campaign.page || {}).html || "", campaign, recipient)
    return Promise.all([
        captureOne(emailHtml, 800),
        // Landing pages are usually built for a desktop viewport - render at a
        // realistic desktop width so the layout matches what the victim saw.
        captureOne(pageHtml, 1280)
    ]).then(function (imgs) {
        return { emailImg: imgs[0], pageImg: imgs[1] }
    })
}

// renderReportPayload - renders the credentials a target submitted (password
// values masked) plus the source IP, for the high-risk timeline.
function renderReportPayload(detailsJson) {
    var details
    try { details = JSON.parse(detailsJson) } catch (e) { return "" }
    if (!details) return ""
    var rows = ""
    if (details.browser && details.browser.address) {
        rows += '<tr><td>כתובת IP</td><td>' + escapeHtml(details.browser.address) + '</td></tr>'
    }
    if (details.payload) {
        Object.keys(details.payload).forEach(function (param) {
            if (param === "rid") return
            var val = details.payload[param]
            if (Array.isArray(val)) val = val.join(", ")
            if (/pass/i.test(param)) val = "••••••••"
            rows += '<tr><td>' + escapeHtml(param) + '</td><td>' + escapeHtml(val) + '</td></tr>'
        })
    }
    if (!rows) return ""
    return '<table class="rt-payload"><thead><tr><th>שדה</th><th>ערך שהוזן</th></tr></thead><tbody>' + rows + '</tbody></table>'
}

// buildHighRiskTimeline - builds the event timeline for the highest-risk target
// (the first entry of the risk-sorted results), used in section 4.4.
function buildHighRiskTimeline(campaign, sortedResults) {
    if (!sortedResults || !sortedResults.length) {
        return '<div class="preview-empty">אין נתוני משתתפים בקמפיין</div>'
    }
    var top = sortedResults[0]
    var fullName = top.last_name ? (top.first_name + " " + top.last_name) : (top.first_name || top.email)
    var sev = reportFindingSeverity(top.status)
    var header = '<div class="rt-head"><span class="severity-badge severity-' + sev.Class + '">' + sev.Text + '</span> ' +
        '<strong>' + escapeHtml(fullName) + '</strong> <span style="color:var(--text-light);">(' + escapeHtml(top.email || "") + ')</span></div>'

    var events = (campaign.timeline || []).filter(function (e) { return e.email === top.email })
    events.sort(function (a, b) { return new Date(a.time) - new Date(b.time) })
    if (!events.length) {
        return header + '<div class="preview-empty">לא נרשמו אירועים עבור משתמש זה</div>'
    }
    var items = events.map(function (e) {
        var info = REPORT_EVENT_INFO[e.message] || { he: e.message, icon: "fa-circle", color: "var(--text-light)" }
        var when = reportHebrewDate(e.time) + " · " + new Date(e.time).toLocaleTimeString("he-IL")
        var extra = (e.message === "Submitted Data" && e.details) ? renderReportPayload(e.details) : ""
        return '<div class="rt-item">' +
            '<span class="rt-dot" style="background:' + info.color + '"><i class="fas ' + info.icon + '"></i></span>' +
            '<div class="rt-body"><div class="rt-title">' + info.he + '</div>' +
            '<div class="rt-time">' + when + '</div>' + extra + '</div></div>'
    }).join("")
    return header + '<div class="risk-timeline">' + items + '</div>'
}

// buildPreviewIframe - fallback used only when a PNG screenshot could not be
// captured. Renders the email body / landing page inside a sandboxed iframe, but
// frozen so it behaves like a static image rather than a live page: pointer
// events are disabled (links/buttons are not clickable) and print-color-adjust
// is forced so the background is included when the report is printed to PDF.
function buildPreviewIframe(html, isHtml, emptyMsg) {
    if (!html) return '<div class="preview-empty">' + emptyMsg + '</div>'
    // Inject a stylesheet that neutralizes interactivity and forces backgrounds
    // to print. (The sandbox has no allow-scripts, so the content's own JS never
    // runs; this only needs to handle links/forms and print color.)
    var freezeStyle = '<style>' +
        'html{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}' +
        '*{pointer-events:none !important;cursor:default !important;}' +
        'a{text-decoration:none !important;}' +
        '</style>'
    var body = isHtml
        ? html
        : '<pre style="white-space:pre-wrap;font-family:monospace;padding:16px;margin:0;">' + escapeHtml(html) + '</pre>'
    var doc = freezeStyle + body
    // pointer-events:none on the iframe element itself blocks all interaction
    // with the embedded document as a second line of defense.
    return '<iframe class="preview-frame" style="pointer-events:none;" sandbox srcdoc="' + reportAttrEscape(doc) + '"></iframe>'
}

// screenshotOrFallback - prefers a captured PNG screenshot; falls back to a
// sandboxed iframe preview, then to an empty-state message.
function screenshotOrFallback(imgDataUrl, html, isHtml, emptyMsg, altText) {
    if (imgDataUrl) {
        return '<div class="screenshot"><img src="' + imgDataUrl + '" alt="' + altText + '"></div>'
    }
    return buildPreviewIframe(html, isHtml, emptyMsg)
}

// buildPhishingReportHTML - returns the full standalone HTML document string.
// logoDataUrl is an optional base64 data URI for the Yazamco logo; assets holds
// the captured {emailImg, pageImg} PNG data URIs.
function buildPhishingReportHTML(campaign, companyName, logoDataUrl, assets) {
    assets = assets || {}
    var launchDate = reportHebrewDate(campaign.launch_date)
    var phishingUrl = campaign.url || ""

    var results = campaign.results || []
    var totalSent = results.length
    var emailsOpened = results.filter(function (r) { return r.status !== "Email Sent" }).length
    var linksClicked = results.filter(function (r) { return r.status === "Clicked Link" || r.status === "Submitted Data" }).length
    var dataSubmitted = results.filter(function (r) { return r.status === "Submitted Data" }).length

    var openRate = totalSent > 0 ? reportRound1((emailsOpened / totalSent) * 100) : 0
    var clickRate = emailsOpened > 0 ? reportRound1((linksClicked / totalSent) * 100) : 0
    var submitRate = linksClicked > 0 ? reportRound1((dataSubmitted / linksClicked) * 100) : 0

    var readinessLevel = reportSeverityLevel(clickRate)
    var readinessClass = reportSeverityClass(readinessLevel)

    var severityRate = dataSubmitted !== 0 ? "קריטית" :
        linksClicked !== 0 ? "גבוהה" :
            emailsOpened !== 0 ? "בינונית" : "נמוכה"

    var severityColor = severityRate === "קריטית" ? "severity-critical" :
        severityRate === "גבוהה" ? "severity-high" :
            severityRate === "בינונית" ? "severity-medium" : "severity-low"

    // Sort employees: Submitted Data > Clicked Link > Email Opened > Email Sent, then by first name.
    var sortedResults = reportSortByRisk(results)
    var topRecipient = sortedResults[0] || {}

    // Logo (data URI keeps the report self-contained), live previews and the
    // high-risk timeline that replace the manual screenshot placeholders.
    var logoTag = logoDataUrl
        ? '<img src="' + logoDataUrl + '" alt="Yazamco pro Cyber" style="max-width:380px; height:auto;">'
        : '<h2 style="color:var(--primary);margin:0;font-size:2.2rem;">Yazamco pro Cyber</h2>'

    var tmpl = campaign.template || {}
    // Render gophish tokens so the fallback iframe preview matches the screenshot.
    var emailFallback = tmpl.html
        ? renderGophishTemplate(tmpl.html, campaign, topRecipient)
        : renderGophishTemplate(tmpl.text || "", campaign, topRecipient)
    var pageFallback = renderGophishTemplate((campaign.page || {}).html || "", campaign, topRecipient)
    var emailPreview = screenshotOrFallback(assets.emailImg, emailFallback, !!tmpl.html,
        "לא הוגדר תוכן למייל בקמפיין זה", "צילום מסך של הודעת הדואר")
    var pagePreview = screenshotOrFallback(assets.pageImg, pageFallback, true,
        "לא הוגדר דף נחיתה בקמפיין זה", "צילום מסך של דף הנחיתה")
    var highRiskTimeline = buildHighRiskTimeline(campaign, sortedResults)

    var employeeRows = sortedResults.map(function (result) {
        var fullName = result.last_name ? (result.first_name + " " + result.last_name) : (result.first_name || "")
        var severity = reportFindingSeverity(result.status)
        var dateFormatted = reportHebrewDate(result.modified_date)
        return '' +
            '                            <tr>\n' +
            '                                <td>' + escapeHtml(fullName) + '</td>\n' +
            '                                <td>' + escapeHtml(result.email || "") + '</td>\n' +
            '                                <td><span class="severity-badge severity-' + severity.Class + '">' + severity.Text + '</span></td>\n' +
            '                                <td>' + dateFormatted + '</td>\n' +
            '                            </tr>\n'
    }).join("")

    return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>דוח מבדק פישינג - ${escapeHtml(companyName)}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>
        :root {
            --primary: #001A72;
            --accent: #3271FE;
            --critical: #8B0000;
            --high: #E74C3C;
            --medium: #F39C12;
            --low: #27AE60;
            --excellent: #27AE60;
            --good: #3498DB;
            --text-dark: #2C3E50;
            --text-light: #7F8C8D;
            --bg-light: #F8F9FA;
            --border: #E0E6ED;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: var(--text-dark);
            background: #fff;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
        }

        /* Sections */
        .section {
            margin-bottom: 50px;
            page-break-inside: avoid;
        }

        .section-header {
            background: var(--bg-light);
            padding: 15px 20px;
            margin-bottom: 20px;
        }

        .section-header h2 {
            font-size: 1.4rem;
            font-weight: 600;
            color: var(--primary);
        }

        .section-content {
            padding: 0 20px;
        }

        .section-content p {
            margin-bottom: 15px;
            line-height: 1.8;
            text-align: justify;
        }

        .section-content h3 {
            color: var(--primary);
            margin-bottom: 15px;
            font-size: 1.1rem;
        }

        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px 15px;
            text-align: center;
        }

        .stat-icon {
            font-size: 2rem;
            margin-bottom: 12px;
            opacity: 0.8;
        }

        .stat-card .stat-icon {
            color: var(--accent);
        }

        .stat-card.stat-opened .stat-icon {
            color: var(--medium);
        }

        .stat-card.stat-clicked .stat-icon {
            color: var(--high);
        }

        .stat-card.stat-submitted .stat-icon {
            color: var(--critical);
        }

        .stat-value {
            font-size: 2.2rem;
            font-weight: 700;
            color: var(--text-dark);
            margin-bottom: 5px;
            line-height: 1;
        }

        .stat-percentage {
            font-size: 0.9rem;
            font-weight: 600;
            color: var(--text-light);
            margin-bottom: 8px;
        }

        .stat-label {
            font-size: 0.85rem;
            color: var(--text-light);
            font-weight: 500;
        }

        /* Tables */
        .table-container {
            overflow-x: auto;
            margin-bottom: 30px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border: 1px solid var(--border);
        }

        thead {
            background: var(--primary);
            color: white;
        }

        th, td {
            padding: 12px;
            text-align: right;
            border: 1px solid var(--border);
        }

        th {
            font-weight: 600;
            font-size: 0.95rem;
        }

        td {
            font-size: 0.9rem;
        }

        tbody tr:hover {
            background: var(--bg-light);
        }

        /* Severity badges */
        .severity-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 0.85rem;
            font-weight: 600;
        }

        .severity-critical {
            background: rgba(139, 0, 0, 0.1);
            color: var(--critical);
        }

        .severity-high {
            background: rgba(231, 76, 60, 0.1);
            color: var(--high);
        }

        .severity-medium {
            background: rgba(243, 156, 18, 0.1);
            color: var(--medium);
        }

        .severity-low {
            background: rgba(39, 174, 96, 0.1);
            color: var(--low);
        }

        .severity-excellent {
            background: rgba(39, 174, 96, 0.1);
            color: var(--excellent);
        }

        .severity-good {
            background: rgba(52, 152, 219, 0.1);
            color: var(--good);
        }

        /* List styles */
        .content-list {
            list-style: none;
            padding-right: 0;
        }

        .content-list li {
            padding: 10px 0 10px 20px;
            margin-bottom: 10px;
            background: var(--bg-light);
        }

        .content-list li:before {
            content: "▪";
            color: var(--accent);
            font-weight: bold;
            margin-left: 10px;
        }

        /* Image placeholder */
        .image-placeholder {
            background: var(--bg-light);
            border: 2px dashed var(--border);
            padding: 60px 20px;
            text-align: center;
            color: var(--text-light);
            font-style: italic;
            margin: 20px 0;
            border-radius: 4px;
            cursor: pointer;
            position: relative;
        }

        .image-placeholder input[type="file"] {
            position: absolute;
            width: 100%;
            height: 100%;
            top: 0;
            left: 0;
            opacity: 0;
            cursor: pointer;
        }

        .image-placeholder img {
            max-width: 100%;
            height: auto;
            display: none;
            margin-top: 10px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
            border-radius: 4px;
        }

        .image-placeholder.has-image {
            padding: 0;
            border: none;
            background: none;
        }

        .image-placeholder.has-image img {
            display: block;
        }

        .image-placeholder.has-image .placeholder-text {
            display: none;
        }

        /* Readiness indicator */
        .readiness-indicator {
            background: white;
            border: 2px solid var(--border);
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            margin: 30px 0;
        }

        .readiness-indicator .level {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 10px;
        }

        .readiness-indicator .description {
            font-size: 1rem;
            color: var(--text-light);
        }


        /* Captured screenshots (email / landing page) - shown small & centered */
        .screenshot {
            margin: 14px auto;
            max-width: 440px;
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.10);
        }

        .screenshot img {
            display: block;
            width: 100%;
            height: auto;
        }

        /* Inline previews (fallback when a screenshot can't be captured) */
        .preview-frame {
            width: 100%;
            height: 640px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: #fff;
            margin: 10px 0;
        }

        .preview-empty {
            background: var(--bg-light);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            color: var(--text-light);
            font-style: italic;
            margin: 10px 0;
        }

        /* High-risk user timeline */
        .rt-head {
            margin-bottom: 18px;
            font-size: 1rem;
        }

        .risk-timeline {
            position: relative;
            padding-right: 8px;
        }

        .rt-item {
            position: relative;
            display: flex;
            gap: 14px;
            padding-bottom: 22px;
        }

        .rt-item:before {
            content: "";
            position: absolute;
            top: 30px;
            right: 14px;
            bottom: -4px;
            width: 2px;
            background: var(--border);
        }

        .rt-item:last-child:before {
            display: none;
        }

        .rt-dot {
            flex: 0 0 30px;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 0.85rem;
            z-index: 1;
        }

        .rt-body {
            flex: 1;
            min-width: 0;
        }

        .rt-title {
            font-weight: 600;
            color: var(--text-dark);
        }

        .rt-time {
            font-size: 0.82rem;
            color: var(--text-light);
            margin-top: 2px;
        }

        .rt-payload {
            margin-top: 10px;
            max-width: 480px;
            font-size: 0.82rem;
        }

        .rt-payload th {
            background: var(--primary);
            color: #fff;
        }

        /* Print styles */
        @media print {
            body {
                font-size: 11pt;
            }

            .section {
                page-break-inside: avoid;
            }

            .cover {
                page-break-after: always;
            }
        }
    </style>
</head>
<body>

    <!-- Cover Page -->
    <div style="page-break-after:always; display:flex; flex-direction:column; min-height:100vh; background:#fff; text-align:center; padding:2rem;">
        <!-- Logo at top -->
            <div style="margin-bottom:auto;">
                ${logoTag}
            </div>
        <!-- Title in center -->
        <div style="margin:auto;">
            <svg xmlns="http://www.w3.org/2000/svg" width="100px" height="100px" viewBox="0 0 512 512" style="opacity:0.9;">
                <path fill="#001A72" d="M264 25c-34.9 0-63 28.1-63 63s28.1 63 63 63 63-28.1 63-63-28.1-63-63-63zm0 30c18.1 0 33 14.88 33 33 0 18.1-14.9 33-33 33s-33-14.9-33-33c0-18.12 14.9-33 33-33zm0 18c-8.4 0-15 6.61-15 15s6.6 15 15 15 15-6.61 15-15-6.6-15-15-15zm-45.3 82.1c-3.7 9.1-9.5 17.5-16.4 25.6-11.7 13.6-26.6 26.7-41.2 41.5-29 29.4-56.4 64.2-55.2 120 .6 32.9 21.2 67.6 51 93.9 29.8 26.3 68.4 43.8 101.8 44.2 28.9.4 62-7.4 87.1-25.1 25.2-17.7 42.7-44.5 42.6-85.6 0-16.8-10.5-43.4-15.1-67.4-2.3-12-3.3-23.9 1.1-34.8 3.8-9.7 12.7-17.2 25.1-20.7 3-7.3 2-11.1-.2-13.9-2.5-3.1-8.6-5.9-16.3-5.8-7.6.1-16.1 2.9-22.3 8.1-6.1 5.3-10.4 12.8-10.4 24.6.1 27.9-3.6 54.7-13 77-9.5 22.3-25.4 40.3-48.6 48-18.7 6.1-40 1.5-58.1-8.2-18.1-9.8-33.6-25.1-38.9-44.1-5.9-21.5-.4-43.2 10.1-63.4 10.5-20.2 26.1-39.4 42.3-57.3 15.1-16.7 30.6-32.4 42.9-46.1-7.3 2.2-15 3.4-23 3.4-16.8 0-32.4-5.1-45.3-13.9z"/>
            </svg>
            <h1 style="font-size:3.5rem; font-weight:700; margin:0; color:var(--primary);">מבדק הממד האנושי - פישינג</h1>
        </div>

        <!-- Details at bottom -->
        <div style="margin-top:auto;">
            <div style="width:150px; height:3px; background:var(--accent); margin:0 auto 2rem auto;"></div>

            <div style="font-size:1.3rem; color:var(--text-light); margin-bottom:2rem;">
                <div style="margin-bottom:0.5rem;">
                    <strong style="color:var(--primary);">חברה:</strong> ${escapeHtml(companyName)}
                </div>
                <div>
                    <strong style="color:var(--primary);">תאריך:</strong> ${launchDate}
                </div>
            </div>
        </div>
    </div>

    <div class="container">

        <!-- Section 1: Introduction -->
        <div class="section">
            <div class="section-header">
                <h2>1. כללי</h2>
            </div>
            <div class="section-content">
                <p>פישינג (Phishing, או בעברית: דיוג) הוא כיום אחת מהשיטות הנפוצות ביותר לפריצה לרשתות ולגניבת מידע, תוך התחזות לגורם לגיטימי במרחב הדיגיטלי. לרוב, ההונאה מתבצעת באמצעות שליחת הודעות דוא"ל שנראות כאילו הגיעו ממקור מהימן, במטרה לשכנע את המשתמש למסור מידע רגיש או לבצע פעולה שמאפשרת חדירה לרשת הארגונית.</p>
                <p>לעיתים, די בעובד אחד שיילכד בפיתיון של התוקף כדי לאפשר גישה למערכות החברה ולגרום לנזק משמעותי. גם תאגידי ענק כמו אמזון, גוגל ופייסבוק נפגעו בשנים האחרונות מתקיפות פישינג, מה שפגע בשמם הטוב וגרם להם להפסדים כלכליים כבדים.</p>
            </div>
        </div>

        <!-- Section 2: Objectives -->
        <div class="section">
            <div class="section-header">
                <h2>2. מטרות המבדק</h2>
            </div>
            <div class="section-content">
                <ul class="content-list">
                    <li><strong>הגברת המודעות</strong> - המטרה המרכזית של המבדק היא לחזק את מודעות העובדים לאיומי פישינג ולהקנות להם כלים לזיהוי ותגובה נכונה</li>
                    <li><strong>בחינת רמת ההיכרות עם איומי פישינג</strong> - לבדוק עד כמה העובדים מסוגלים לזהות ניסיונות התחזות ולקבל החלטות מושכלות בעת קבלת הודעות חשודות</li>
                    <li><strong>הערכת ההשפעה של המודעות</strong> - לבחון כיצד רמת המודעות של העובדים משפיעה בפועל על החשיפה של מערכות הארגון לסיכונים</li>
                </ul>
            </div>
        </div>

        <!-- Section 3: Methodology -->
        <div class="section">
            <div class="section-header">
                <h2>3. שיטת הפעולה</h2>
            </div>
            <div class="section-content">
                <p>המבדק בוצע באמצעות שליחת הודעת פישינג יזומה לדואר האלקטרוני של עובדי החברה. ההודעה תוכננה כך שתדמה פנייה לגיטימית, ובה התבקשו העובדים למסור פרטים אישיים.</p>
                <p>לצורך ביצוע המבדק, הוקמה תשתית ייעודית שכללה כתובת דוא"ל ואתר אינטרנט דמה (<strong>${escapeHtml(phishingUrl)}</strong>), אשר שימשו כגורם המתחזה.</p>
            </div>
        </div>

        <!-- Section 4: Results -->
        <div class="section">
            <div class="section-header">
                <h2>4. תוצאות המבדק</h2>
            </div>
            <div class="section-content">

                <h3>4.1 סקירת נתונים</h3>

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">
                            <i class="fas fa-paper-plane"></i>
                        </div>
                        <div class="stat-value">${totalSent}</div>
                        <div class="stat-label">מיילים נשלחו</div>
                    </div>
                    <div class="stat-card stat-opened">
                        <div class="stat-icon">
                            <i class="fas fa-envelope-open"></i>
                        </div>
                        <div class="stat-value">${emailsOpened}</div>
                        <div class="stat-percentage">${openRate}%</div>
                        <div class="stat-label">פתיחות</div>
                    </div>
                    <div class="stat-card stat-clicked">
                        <div class="stat-icon">
                            <i class="fas fa-mouse-pointer"></i>
                        </div>
                        <div class="stat-value">${linksClicked}</div>
                        <div class="stat-percentage">${clickRate}%</div>
                        <div class="stat-label">קליקים על קישור</div>
                    </div>
                    <div class="stat-card stat-submitted">
                        <div class="stat-icon">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div class="stat-value">${dataSubmitted}</div>
                        <div class="stat-percentage">${submitRate}%</div>
                        <div class="stat-label">הזנת נתונים</div>
                    </div>
                </div>

                <h3>4.2 תיאור הממצאים וחומרתם</h3>
                <p>הודעת הפישינג נשלחה ל-${totalSent} עובדים במסגרת המבדק. ממצאי המבדק וחומרתם מוצגים בטבלה שלהלן:</p>

                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 50px;">#</th>
                                <th>כמות עובדים</th>
                                <th>תיאור הממצא</th>
                                <th style="width: 120px;">רמת חומרה</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>1</td>
                                <td>${totalSent}</td>
                                <td>הודעות פישינג שנשלחו לעובדים</td>
                                <td><span class="severity-badge severity-low">נמוכה</span></td>
                            </tr>
                            <tr>
                                <td>2</td>
                                <td>${emailsOpened}</td>
                                <td>עובדים שפתחו את הודעת הפישינג</td>
                                <td><span class="severity-badge severity-medium">בינונית</span></td>
                            </tr>
                            <tr>
                                <td>3</td>
                                <td>${linksClicked}</td>
                                <td>עובדים שלחצו על הקישור הזדוני</td>
                                <td><span class="severity-badge severity-high">גבוהה</span></td>
                            </tr>
                            <tr>
                                <td>4</td>
                                <td>${dataSubmitted}</td>
                                <td>עובדים שמילאו את הפרטים שנתבקשו למסור</td>
                                <td><span class="severity-badge severity-critical">קריטית</span></td>
                            </tr>
                            <tr style="background: #f8f9fa; font-weight: 600; border-top: 2px solid var(--primary);">
                                <td colspan="3" style="text-align: center;">
                                    <strong>מסקנה כללית:</strong> שקלול המדדים מוביל לרמת חומרה כוללת
                                    <div style="font-size: 0.85rem; color: var(--text-light); font-weight: normal; margin-top: 5px;">
                                        ממוצע בין רמת אחוזים גבוהה לבין חומרת ממצא שאינה קריטית
                                    </div>
                                </td>
                                <td style="text-align: center;">
                                    <span class="severity-badge ${severityColor}">${severityRate}</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div style="page-break-inside: avoid;">
                <h3>4.3 מוכנות החברה לתקיפת פישינג</h3>
                    <div class="readiness-indicator">
                        <div class="level severity-${readinessClass}">${readinessLevel}</div>
                        <div class="description">רמת המוכנות מבוססת על הנתון כי ${clickRate}% מסך כל העובדים לחצו על הקישור או הזינו פרטים</div>
                    </div>
                </div>

                <p>חשוב לציין כי רמת המוכנות נקבעה ביחס לעובדים שלחצו על הקישור שמייל.</p>

                <div class="table-container" style="max-width: 600px; margin: 20px auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>שיעור לוחצים על קישור</th>
                                <th>רמת מוכנות</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>עד 5%</td>
                                <td><span class="severity-badge severity-excellent">מצוינת</span></td>
                            </tr>
                            <tr>
                                <td>6%-15%</td>
                                <td><span class="severity-badge severity-good">טובה מאוד</span></td>
                            </tr>
                            <tr>
                                <td>16%-25%</td>
                                <td><span class="severity-badge severity-medium">בינונית</span></td>
                            </tr>
                            <tr>
                                <td>26%-30%</td>
                                <td><span class="severity-badge severity-high">נמוכה</span></td>
                            </tr>
                            <tr>
                                <td>יותר מ-30%</td>
                                <td><span class="severity-badge severity-critical">נמוכה מאוד</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div style="page-break-inside: avoid;">
                <h3>4.4 ציר זמן של המשתמש בסיכון הגבוה ביותר</h3>
                    ${highRiskTimeline}
                </div>

            </div>
        </div>
        <!-- Section 5: Recommendations -->
        <div class="section">
            <div class="section-header">
                <h2>5. המלצות לשיפור</h2>
            </div>
            <div class="section-content">
                <ul class="content-list">
                    <li>מומלץ להגביר את מודעות העובדים לתקיפות הנדסה חברתית ולתקיפות מסוג פישינג</li>
                    <li>מומלץ לערוך מבדקי הנדסה חברתית לפחות פעם ברבעון</li>
                    <li>מומלץ להדריך עובדים בנושא פעמיים בשנה ולשים דגש על כללי אבטחת מידע ועל נוהלי אבטחת מידע</li>
                    <li>מומלץ להנחות את העובדים לפנות לאנשי ה-IT בעת זיהוי הודעה חשודה ולהשתמש בכפתור הדיווח המובנה</li>
                    <li>מומלץ לבצע סקר סיכונים מקיף לזיהוי נכסים קריטיים ואיומים פוטנציאליים בסביבת הארגון</li>
                    <li>מומלץ לבצע סריקות חולשות תקופתיות במערכות הארגון לזיהוי ותיקון פרצות אבטחה</li>
                    <li>מומלץ לבצע מבדקי חדירות תקופתיים על ידי גורם חיצוני מוסמך לבדיקת עמידות הארגון בפני תקיפות</li>
                </ul>

                <h3 style="text-decoration: underline; margin-top: 30px;">המלצות המשך ל-IT:</h3>
                <ul class="content-list">
                    <li>יש לאפס את הסיסמאות של עובדים שמסרו את הסיסמה שלהם במבדק</li>
                    <li>יש להוציא את אתר הדמה של המבדק מרשימת ה-Whitelist</li>
                    <li>יש לבטל חוקי Bypass בשער הדואר הארגוני שאפשרו מעבר של הודעת הפישינג</li>
                </ul>
            </div>
        </div>

        <!-- Section 6: Process Description -->
        <div class="section">
            <div class="section-header">
                <h2>6. תהליך המבדק</h2>
            </div>
            <div class="section-content">
                    <div style="page-break-inside: avoid;">
                    <h3>6.1 שלב 1: הודעת הדואר האלקטרוני</h3>
                    <p>הודעת דואר אלקטרוני המדמה הודעת פישינג נפוצה נשלחה לעובדים, ובהודעה היה קישור לדף הזדהות מזויף. להלן תצוגת הודעת הדואר שנשלחה במסגרת המבדק:</p>
                    ${emailPreview}
                </div>
                <h3>6.2 שלב 3: לחיצה על הקישור</h3>
                <p>${linksClicked} עובדים מתוך ${emailsOpened} שפתחו את ההודעה לחצו על הקישור שבהודעה.</p>

                <div style="page-break-inside: avoid;">
                    <h3>6.3 שלב 4: דף הנחיתה</h3>
                    <p>העובדים שלחצו על הקישור הגיעו לדף מזויף, ובדף זה התבקשו למלא את פרטי ההזדהות שלהם. יש לציין שכתובת האתר אינה מאובטחת כפי שמאובטחים אתרים המבקשים פרטים אישיים. להלן תצוגת דף הנחיתה שהוגדר במבדק:</p>
                    ${pagePreview}
                </div>

                <h3>6.4 שלב 5: הזנת נתונים</h3>
                <p>${dataSubmitted} עובדים מתוך ${linksClicked} שהגיעו לדף הנחיתה מילאו את פרטי ההזדהות שלהם ושלחו אותם.</p>

            </div>
        </div>

        <!-- Section 7: Detailed Results by Employee -->
        <div class="section" style="page-break-after: always;">
            <div class="section-header">
                <h2>7. פירוט תוצאות לפי עובד</h2>
            </div>
            <div class="section-content">
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>שם</th>
                                <th>דואר אלקטרוני</th>
                                <th>סטטוס</th>
                                <th>תאריך שליחה</th>
                            </tr>
                        </thead>
                        <tbody>
${employeeRows}                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Appendix: Severity Levels -->
        <div class="section">
            <div class="section-header">
                <h2>נספח א': רמות החומרה</h2>
            </div>
            <div class="section-content">
                <p>מטרת ציוני החומרה היא לתת מושג כללי ו"מבט על" לגבי רמות החומרה שנמצאו במבדק.</p>
                <p>הציון מורכב משקלול הפרמטרים והממצאים הבאים:</p>
                <ul class="content-list">
                    <li>מדדים ומשקלות אובייקטיביים לכל סוג פעולה</li>
                    <li>ממצאי המבדק שנערך</li>
                    <li>הערכה סובייקטיבית בדבר הסיכון הנשקף לארגון</li>
                    <li>ההשפעות השליליות שעלולות להיות לפגיעה בנכס ארגוני</li>
                </ul>
                <p><strong>רמת החומרה של המבדק היא לפי הממצא החמור ביותר.</strong></p>

                <div class="table-container" style="max-width: 400px; margin: 30px auto;">
                    <table>
                        <thead>
                            <tr>
                                <th style="text-align: center;">רמה</th>
                                <th>חומרה</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="text-align: center; font-weight: bold;">4</td>
                                <td><span class="severity-badge severity-critical">קריטית</span></td>
                            </tr>
                            <tr>
                                <td style="text-align: center; font-weight: bold;">3</td>
                                <td><span class="severity-badge severity-high">גבוהה</span></td>
                            </tr>
                            <tr>
                                <td style="text-align: center; font-weight: bold;">2</td>
                                <td><span class="severity-badge severity-medium">בינונית</span></td>
                            </tr>
                            <tr>
                                <td style="text-align: center; font-weight: bold;">1</td>
                                <td><span class="severity-badge severity-low">נמוכה</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

    </div>

</body>
</html>`
}

// openReportWindow - opens the generated HTML in a new browser tab.
function openReportWindow(html) {
    var blob = new Blob([html], { type: "text/html;charset=utf-8" })
    var url = URL.createObjectURL(blob)
    var win = window.open(url, "_blank")
    if (!win) {
        // Popup blocked - fall back to a download.
        var a = document.createElement("a")
        a.href = url
        a.download = "GoPhish-Report.html"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }
    // Revoke later so the new tab has time to load.
    setTimeout(function () { URL.revokeObjectURL(url) }, 60000)
}

// promptCompanyAndOpen - asks for the company name (themed to match the SOC
// console UI), loads the logo, then builds & opens the report.
function promptCompanyAndOpen(campaign) {
    Swal.fire({
        title: "Generate Report",
        text: "Campaign: " + campaign.name,
        input: "text",
        inputPlaceholder: "Enter the company name",
        inputClass: "form-control",
        showCancelButton: true,
        confirmButtonText: "Generate Report",
        cancelButtonText: "Cancel",
        buttonsStyling: false,
        confirmButtonClass: "btn btn-primary",
        cancelButtonClass: "btn btn-default",
        customClass: "report-modal",
        reverseButtons: true,
        allowOutsideClick: false,
        inputValidator: function (value) {
            if (!value) {
                return "Please enter a company name"
            }
        }
    }).then(function (result) {
        if (!result.value) return
        var companyName = result.value
        // Show a loading dialog while we capture screenshots (can take a moment).
        Swal.fire({
            title: "Generating Report",
            html: "Capturing screenshots, please wait…",
            allowOutsideClick: false,
            allowEscapeKey: false,
            onOpen: function () { Swal.showLoading() }
        })
        // Load the logo (data URI -> self-contained) and capture the email +
        // landing-page screenshots in parallel; build regardless of failures.
        Promise.all([
            fetchImageAsDataURL("/images/yazamco-logo.png").catch(function () { return null }),
            captureCampaignAssets(campaign)
        ]).then(function (res) {
            Swal.close()
            openReportWindow(buildPhishingReportHTML(campaign, companyName, res[0], res[1]))
        }).catch(function () {
            Swal.close()
            openReportWindow(buildPhishingReportHTML(campaign, companyName, null, {}))
        })
    })
}

// openCampaignReport - entry point used from both the campaigns list and the
// campaign results page. Fetches the full campaign (url + results + timeline),
// then prompts for the company name and opens the report.
function openCampaignReport(campaignId) {
    api.campaignId.get(campaignId)
        .success(function (c) {
            promptCompanyAndOpen(c)
        })
        .error(function () {
            if (typeof errorFlash === "function") {
                errorFlash("Error loading campaign for report")
            } else {
                Swal.fire("שגיאה", "טעינת נתוני הקמפיין נכשלה", "error")
            }
        })
}
