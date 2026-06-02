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

// buildPhishingReportHTML - returns the full standalone HTML document string.
function buildPhishingReportHTML(campaign, companyName) {
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
    var sortOrder = { "Submitted Data": 1, "Clicked Link": 2, "Email Opened": 3, "Email Sent": 4 }
    var sortedResults = results.slice().sort(function (a, b) {
        var oa = sortOrder[a.status] || 99
        var ob = sortOrder[b.status] || 99
        if (oa !== ob) return oa - ob
        return (a.first_name || "").localeCompare(b.first_name || "")
    })

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
            <!-- Logo at top -->
            <div style="margin-bottom:auto;">
                <img src="https://yazamcocoil.sharepoint.com/:i:/s/AutomationManagement/EV4-FIGEOPZDpBNVdA23kQwBwl0N2QUYO7GqzZNtuhHUPw?e=x9J3g9&download=1" alt="CyPro Logo" style="max-width:350px; height:auto;">
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
                <h3>4.4 תיאור גרפי של תוצאות המבדק</h3>
                    <div class="image-placeholder">
                        הוסף כאן גרף המציג את תוצאות המבדק<br>
                        (גרף עוגה או בר המציג את התפלגות התוצאות)
                    </div>
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
                    <p>הודעת דואר אלקטרוני המדמה הודעת פישינג נפוצה נשלחה לעובדים, ובהודעה היה קישור לדף הזדהות מזויף.</p>
                    <div class="image-placeholder">
                        הוסף כאן צילום מסך של הודעת הדואר האלקטרוני
                    </div>
                </div>
                <h3>6.2 שלב 3: לחיצה על הקישור</h3>
                <p>${linksClicked} עובדים מתוך ${emailsOpened} שפתחו את ההודעה לחצו על הקישור שבהודעה.</p>

                <div style="page-break-inside: avoid;">
                    <h3>6.3 שלב 4: דף הנחיתה</h3>
                    <p>העובדים שלחצו על הקישור הגיעו לדף מזויף, ובדף זה התבקשו למלא את פרטי ההזדהות שלהם. יש לציין שכתובת האתר אינה מאובטחת כפי שמאובטחים אתרים המבקשים פרטים אישיים.</p>
                    <div class="image-placeholder">
                        הוסף כאן צילום מסך של דף הנחיתה המזויף
                    </div>
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

    <script>
        document.addEventListener('DOMContentLoaded', function () {
            const placeholders = document.querySelectorAll('.image-placeholder');

            placeholders.forEach(placeholder => {
                // יצירת input
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.style.position = 'absolute';
                input.style.width = '100%';
                input.style.height = '100%';
                input.style.top = '0';
                input.style.left = '0';
                input.style.opacity = '0';
                input.style.cursor = 'pointer';

                // יצירת img
                const img = document.createElement('img');
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
                img.style.display = 'none';

                // שמירת טקסט הפלייסהולדר
                const originalText = placeholder.innerHTML;
                const textSpan = document.createElement('span');
                textSpan.className = 'placeholder-text';
                textSpan.innerHTML = originalText;

                placeholder.innerHTML = '';
                placeholder.appendChild(textSpan);
                placeholder.appendChild(img);
                placeholder.appendChild(input);

                // בחירת קובץ
                input.addEventListener('change', function (e) {
                    const file = e.target.files[0];
                    if (!file || !file.type.startsWith('image/')) return;

                    const reader = new FileReader();
                    reader.onload = function (ev) {
                        img.src = ev.target.result;
                        img.style.display = 'block';

                        // העלמת הפלייסהולדר
                        placeholder.classList.add('has-image');
                    };
                    reader.readAsDataURL(file);
                });
            });
        });
    </script>


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

// promptCompanyAndOpen - asks for the company name, then builds & opens the report.
function promptCompanyAndOpen(campaign) {
    Swal.fire({
        title: "הפקת דוח פישינג",
        text: "קמפיין: " + campaign.name,
        input: "text",
        inputPlaceholder: "הזן את שם החברה",
        showCancelButton: true,
        confirmButtonText: "הפק דוח",
        cancelButtonText: "ביטול",
        confirmButtonColor: "#428bca",
        reverseButtons: true,
        allowOutsideClick: false,
        inputValidator: function (value) {
            if (!value) {
                return "יש להזין שם חברה"
            }
        }
    }).then(function (result) {
        if (result.value) {
            openReportWindow(buildPhishingReportHTML(campaign, result.value))
        }
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
