/*
    soc.js — SOC redesign UI glue (theme, topbar, sidebar counts).
    Loaded on every page after gophish.js. Purely additive: it wires the
    new chrome to the existing app and never touches the data layer.
*/
(function () {
    "use strict";

    // ---- chart / map theming -----------------------------------------
    // Highcharts and Datamaps render SVG with hardcoded light colors. We
    // expose a small theme-aware palette (window.SOC) used by the chart
    // files, and register a dark Highcharts default. Highcharts colors must
    // be hex/rgb (its Color class can't parse oklch), so these are literal.
    function isDark() {
        return (document.documentElement.getAttribute("data-theme") || "dark") !== "light";
    }
    var PALETTE = {
        dark:  { text: "#c9ced6", faint: "#8a909c", grid: "rgba(255,255,255,0.07)", line: "rgba(255,255,255,0.13)", tip: "#272b33", tipText: "#e7e9ee", pieRemainder: "rgba(255,255,255,0.08)", mapLand: "#2a2f38", mapBorder: "#3a414c", mapBubble: "#7c5cff", mapHighlight: "#3a414c" },
        light: { text: "#3a4150", faint: "#7a828f", grid: "rgba(0,0,0,0.07)", line: "rgba(0,0,0,0.13)", tip: "#ffffff", tipText: "#222831", pieRemainder: "#e7ebf0", mapLand: "#e9edf2", mapBorder: "#cfd6df", mapBubble: "#3b6ef5", mapHighlight: "#d4dae2" }
    };
    function pal() { return isDark() ? PALETTE.dark : PALETTE.light; }
    window.SOC = {
        isDark: isDark,
        pal: pal,
        pieRemainder: function () { return pal().pieRemainder; },
        map: function () { var p = pal(); return { defaultFill: p.mapLand, point: p.mapBubble, border: p.mapBorder, highlight: p.mapHighlight }; }
    };
    function themeHighcharts() {
        if (!window.Highcharts || !Highcharts.setOptions) return;
        var p = pal();
        Highcharts.setOptions({
            chart: { backgroundColor: "transparent", style: { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } },
            title: { style: { color: p.text } },
            subtitle: { style: { color: p.faint } },
            xAxis: { gridLineColor: p.grid, lineColor: p.line, tickColor: p.line, labels: { style: { color: p.faint } }, title: { style: { color: p.faint } } },
            yAxis: { gridLineColor: p.grid, lineColor: p.line, tickColor: p.line, labels: { style: { color: p.faint } }, title: { style: { color: p.faint } } },
            legend: { itemStyle: { color: p.text }, itemHoverStyle: { color: isDark() ? "#fff" : "#000" }, itemHiddenStyle: { color: p.faint } },
            tooltip: { backgroundColor: p.tip, borderColor: p.line, style: { color: p.tipText } },
            plotOptions: { series: { dataLabels: { color: p.text, style: { textOutline: "none" } } } },
            credits: { enabled: false }
        });
    }
    // Apply immediately (synchronously) so charts rendered later pick it up.
    themeHighcharts();

    var SUBTITLES = {
        "/": "real-time overview · all campaigns",
        "/campaigns": "manage & launch simulations",
        "/groups": "target population",
        "/templates": "phishing email library",
        "/landing_pages": "credential capture pages",
        "/sending_profiles": "SMTP sending configuration",
        "/settings": "account & system configuration",
        "/users": "user administration",
        "/webhooks": "event integrations"
    };

    // ---- theme toggle -------------------------------------------------
    function currentTheme() {
        return document.documentElement.getAttribute("data-theme") || "dark";
    }
    function paintToggle() {
        var btn = document.getElementById("themeToggle");
        if (!btn) return;
        var icon = btn.querySelector("i");
        if (!icon) return;
        // show the icon for the theme you'd switch TO
        icon.className = currentTheme() === "dark" ? "fa fa-sun-o" : "fa fa-moon-o";
    }
    function setupTheme() {
        var btn = document.getElementById("themeToggle");
        if (!btn) return;
        paintToggle();
        btn.addEventListener("click", function () {
            var next = currentTheme() === "dark" ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", next);
            try { localStorage.setItem("gophish-theme", next); } catch (e) { }
            paintToggle();
            // SVG charts/maps can't pick up CSS variables; reload so they
            // re-render in the new theme. Only when such widgets exist.
            var hasCharts = (window.Highcharts && Highcharts.charts && Highcharts.charts.some(Boolean)) ||
                document.getElementById("resultsMap");
            if (hasCharts) { location.reload(); }
        });
    }

    // ---- topbar subtitle ---------------------------------------------
    function setupSubtitle() {
        var el = document.getElementById("topbarSub");
        if (!el) return;
        var sub = SUBTITLES[location.pathname];
        if (!sub && location.pathname.indexOf("/campaigns/") === 0) sub = "campaign results · live";
        el.textContent = sub || "";
    }

    // ---- topbar search filters any DataTables on the page ------------
    function setupSearch() {
        var input = document.getElementById("topbarSearch");
        if (!input || !window.jQuery) return;
        var $ = window.jQuery;
        input.addEventListener("input", function () {
            var v = input.value;
            if (!$.fn.dataTable) return;
            $.fn.dataTable.tables({ visible: true, api: true }).search(v).draw();
            // also filter card-grids (templates / pages)
            var q = v.toLowerCase();
            $(".card-grid .tcard").each(function () {
                var name = ($(this).attr("data-name") || "").toLowerCase();
                this.style.display = (!q || name.indexOf(q) !== -1) ? "" : "none";
            });
        });
        // press "/" to focus search (unless already typing in a field)
        document.addEventListener("keydown", function (e) {
            if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || "")) &&
                !e.target.isContentEditable) {
                e.preventDefault();
                input.focus();
            }
        });
    }

    // ---- avatar initials ---------------------------------------------
    function setupAvatar() {
        var el = document.getElementById("userAvatar");
        if (!el) return;
        var name = (el.textContent || "").trim();
        el.textContent = name ? name.slice(0, 2).toUpperCase() : "GP";
    }

    // ---- sidebar count badges (cached per session) -------------------
    function fetchJSON(path) {
        if (!window.jQuery || typeof user === "undefined") return null;
        return window.jQuery.ajax({
            url: "/api" + path, method: "GET", dataType: "json",
            beforeSend: function (xhr) { xhr.setRequestHeader("Authorization", "Bearer " + user.api_key); }
        });
    }
    function setCount(key, n) {
        var badges = document.querySelectorAll('[data-count="' + key + '"]');
        for (var i = 0; i < badges.length; i++) {
            badges[i].textContent = n;
            badges[i].style.display = "";
        }
        try { sessionStorage.setItem("gophish-count-" + key, n); } catch (e) { }
    }
    function setupCounts() {
        var sources = {
            campaigns: "/campaigns/summary",
            groups: "/groups/",
            templates: "/templates/",
            pages: "/pages/",
            smtp: "/smtp/"
        };
        Object.keys(sources).forEach(function (key) {
            // hide empty badge until we have a value
            var badges = document.querySelectorAll('[data-count="' + key + '"]');
            var cached = null;
            try { cached = sessionStorage.getItem("gophish-count-" + key); } catch (e) { }
            if (cached !== null) { setCount(key, cached); }
            else { for (var i = 0; i < badges.length; i++) badges[i].style.display = "none"; }

            var req = fetchJSON(sources[key]);
            if (!req) return;
            req.done(function (data) {
                var n = 0;
                if (key === "campaigns" && data && data.campaigns) n = data.campaigns.length;
                else if (Array.isArray(data)) n = data.length;
                else if (data && typeof data.total === "number") n = data.total;
                setCount(key, n);
            });
        });
    }

    function init() {
        setupTheme();
        setupSubtitle();
        setupSearch();
        setupAvatar();
        setupCounts();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
