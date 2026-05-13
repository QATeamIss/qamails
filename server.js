const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(bodyParser.json());
app.use(express.static('public'));

function formatDateForDB(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    const match = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    try {
        const d = new Date(s);
        if (isNaN(d.getTime())) return null;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) { return null; }
}

function parseBugs(text) {
    const issues = text.split(/Issue\s+/).filter(i => i.trim() !== '');
    const parsedBugsList = [];
    const totals = { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0, bugsOnly: 0 };
    const categories = {
        'Functional Bugs': { p0:0, p1:0, p2:0, p3:0, p4:0, total: 0 },
        'HTML / UI Bugs': { p0:0, p1:0, p2:0, p3:0, p4:0, total: 0 },
        'Enhancements': { p0:0, p1:0, p2:0, p3:0, p4:0, total: 0 },
        'Corrections': { p0:0, p1:0, p2:0, p3:0, p4:0, total: 0 }
    };

    issues.forEach(issue => {
        const priorityMatch = issue.match(/P([0-4])/);
        const severity = priorityMatch ? `P${priorityMatch[1]}` : 'P2';
        const lines = issue.split('\n');
        const titleMatch = lines[0].trim();
        const typeMatch = issue.match(/Type\s*:\s*([^\n|]+)/i);
        const categoryMatch = issue.match(/Category\s*:\s*([^\n|]+)/i);
        
        const type = typeMatch ? typeMatch[1].trim() : 'Bug';
        let category = categoryMatch ? categoryMatch[1].trim() : 'Functional Bugs';

        if (category.toLowerCase().includes('ui') || category.toLowerCase().includes('html')) category = 'HTML / UI Bugs';
        else if (category.toLowerCase().includes('enhancement')) category = 'Enhancements';
        else if (category.toLowerCase().includes('correction')) category = 'Corrections';
        else if (category.toLowerCase().includes('functional')) category = 'Functional Bugs';

        const bug = { title: titleMatch, severity: severity, type: type, category: category };
        parsedBugsList.push(bug);
        totals[severity.toLowerCase()]++;
        totals.total++;
        if (type.toLowerCase().includes('bug')) totals.bugsOnly++;
        
        if (!categories[category]) categories[category] = { p0:0, p1:0, p2:0, p3:0, p4:0, total: 0 };
        categories[category][severity.toLowerCase()]++;
        categories[category].total++;
    });

    return { bugs: parsedBugsList, matrix: { total: totals, categories: categories } };
}

function generateHTML(project, phase, start, end, qa, reportData, recurring) {
    const { total, categories } = reportData.matrix;
    const catKeys = Object.keys(categories);
    
    const criticalRisks = reportData.bugs.filter(b => b.severity === 'P0' || b.severity === 'P1').slice(0, 5);
    const functionalRisks = reportData.bugs.filter(b => b.category.includes('Functional') && b.severity !== 'P0').slice(0, 5);
    const uiRisks = reportData.bugs.filter(b => b.category.includes('HTML / UI') && b.severity !== 'P0').slice(0, 5);

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        /* Scoped to .report-body to avoid leaking background to parent app */
        .report-body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #334155; background-color: #ffffff; padding: 40px; }
        .intro { color: #1e293b; margin-bottom: 24px; font-size: 16px; }
        h1 { font-size: 26px; font-weight: 700; color: #1e293b; margin: 40px 0 24px 0; }
        h2 { font-size: 22px; font-weight: 700; color: #334155; margin: 40px 0 20px 0; border-left: 4px solid #3b82f6; padding-left: 12px; }
        
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .info-table th { background: #f8fafc; text-align: left; padding: 12px 15px; border: 1px solid #e2e8f0; width: 25%; font-weight: 600; color: #64748b; }
        .info-table td { padding: 12px 15px; border: 1px solid #e2e8f0; color: #1e293b; }

        .summary-row { display: table; width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 15px; border-radius: 4px; overflow: hidden; }
        .summary-cell { display: table-cell; padding: 25px 20px; color: white; text-align: center; width: 33.33%; }
        .critical { background-color: #eb4444; }
        .high-med { background-color: #f97316; }
        .minor-low { background-color: #3b82f6; }
        .summary-val { font-size: 38px; font-weight: 800; display: block; line-height: 1; }
        .summary-label { font-size: 13px; font-weight: 700; text-transform: uppercase; margin-top: 10px; display: block; }
        
        .totals-line { font-size: 14px; font-weight: 700; color: #334155; margin-bottom: 40px; padding-left: 5px; }

        .matrix-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
        .matrix-table th { background: #f8fafc; color: #475569; padding: 12px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 700; }
        .matrix-table td { padding: 12px; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
        .matrix-table .num-link { color: #2563eb; text-decoration: underline; font-weight: 600; }
        .matrix-table tr:first-child td { font-weight: 700; }

        .risk-group { margin-bottom: 25px; }
        .risk-header { font-weight: 700; color: #1e293b; margin-bottom: 10px; font-size: 16px; }
        .risk-list { margin: 0; padding-left: 20px; list-style-type: disc; }
        .risk-list li { margin-bottom: 8px; color: #475569; }

        .qa-notes-box { margin-top: 30px; }
        .qa-notes-text { color: #475569; font-size: 15px; margin-bottom: 15px; }

        .details-table { width: 100%; border-collapse: collapse; margin-top: 40px; font-size: 13px; }
        .details-table th { background: #1e293b; color: white; padding: 10px; text-align: left; }
        .details-table td { padding: 10px; border: 1px solid #e2e8f0; }
        .sev-p0 { color: #dc2626; font-weight: 700; }
        .sev-p1 { color: #ea580c; font-weight: 700; }

        .footer { margin-top: 60px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8; }
        
        /* Recurring style */
        .recurring-box { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 20px; margin: 30px 0; border-left: 5px solid #f59e0b; }
        .recurring-item { margin-bottom: 10px; }
        .recurring-title { font-weight: 700; color: #92400e; }
    </style>
</head>
<body style="margin:0; padding:0; background:transparent;">
    <div class="report-body">
        <div class="intro">
            Hi Team,<br><br>
            Please find the exploratory QA summary report for the <strong>${phase}</strong> validation of the <strong>${project}</strong> platform.
        </div>

        <h1>Exploratory QA Summary Report</h1>

        <h2>Testing Information</h2>
        <table class="info-table">
            <tr><th>Project Name</th><td>${project}</td></tr>
            <tr><th>Testing Phase</th><td>${phase}</td></tr>
            <tr><th>Environment</th><td>${phase.includes('Live') ? 'Live' : 'Dev'}</td></tr>
            <tr><th>Platform</th><td>Web / Mobile Web / Android / iOS</td></tr>
            <tr><th>Start Date</th><td>${start}</td></tr>
            <tr><th>End Date</th><td>${end}</td></tr>
            <tr><th>Testing Conducted By</th><td>${qa}</td></tr>
        </table>

        ${recurring.length > 0 ? `
            <div class="recurring-box">
                <div class="recurring-title">⚠️ Recurring Issues Detected</div>
                <p style="font-size: 14px; color: #92400e;">The following issues have appeared in previous reports:</p>
                <ul class="risk-list">
                    ${recurring.map(r => `<li><strong>${r.title}</strong>: Seen in ${r.matches.map(m => `${m.project} (${m.phase})`).join(', ')}</li>`).join('')}
                </ul>
            </div>
        ` : ''}

        <h2>Session Summary</h2>
        <div class="summary-row">
            <div class="summary-cell critical">
                <span class="summary-val">${total.p0}</span>
                <span class="summary-label">Critical (P0)</span>
            </div>
            <div class="summary-cell high-med">
                <span class="summary-val">${total.p1 + total.p2}</span>
                <span class="summary-label">High / Medium</span>
            </div>
            <div class="summary-cell minor-low">
                <span class="summary-val">${total.p3 + total.p4}</span>
                <span class="summary-label">Minor / Low</span>
            </div>
        </div>
        <div class="totals-line">
            Total Issues Identified: ${total.total} | Total Bugs: ${total.bugsOnly}
        </div>

        <h2>Issue Classification Matrix</h2>
        <table class="matrix-table">
            <thead>
                <tr>
                    <th>Category</th>
                    <th style="text-align: center">Total</th>
                    <th style="text-align: center">P0</th>
                    <th style="text-align: center">P1</th>
                    <th style="text-align: center">P2</th>
                    <th style="text-align: center">P3</th>
                    <th style="text-align: center">P4</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Total Issues</td>
                    <td style="text-align: center"><span class="num-link">${total.total}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p0}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p1}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p2}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p3}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p4}</span></td>
                </tr>
                <tr>
                    <td>Total Bugs</td>
                    <td style="text-align: center"><span class="num-link">${total.bugsOnly}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p0}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p1}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p2}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p3}</span></td>
                    <td style="text-align: center"><span class="num-link">${total.p4}</span></td>
                </tr>
                ${catKeys.map(cat => `
                    <tr>
                        <td>${cat}</td>
                        <td style="text-align: center">${categories[cat].total}</td>
                        <td style="text-align: center">${categories[cat].p0}</td>
                        <td style="text-align: center">${categories[cat].p1}</td>
                        <td style="text-align: center">${categories[cat].p2}</td>
                        <td style="text-align: center">${categories[cat].p3}</td>
                        <td style="text-align: center">${categories[cat].p4}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <h2>Key Risks Identified</h2>
        <div class="risk-group">
            <div class="risk-header">Critical Risks</div>
            <ul class="risk-list">
                ${criticalRisks.length > 0 ? criticalRisks.map(r => `<li>${r.title}</li>`).join('') : '<li>None identified.</li>'}
            </ul>
        </div>
        <div class="risk-group">
            <div class="risk-header">Functional Risks</div>
            <ul class="risk-list">
                ${functionalRisks.length > 0 ? functionalRisks.map(r => `<li>${r.title}</li>`).join('') : '<li>None identified.</li>'}
            </ul>
        </div>
        <div class="risk-group">
            <div class="risk-header">UI / UX Risks</div>
            <ul class="risk-list">
                ${uiRisks.length > 0 ? uiRisks.map(r => `<li>${r.title}</li>`).join('') : '<li>None identified.</li>'}
            </ul>
        </div>

        <h2>QA Notes</h2>
        <div class="qa-notes-box">
            <div class="qa-notes-text">
                Testing was exploratory in nature without predefined test cases. Coverage was driven by business-critical workflows and user behavior patterns.
            </div>
            <div class="qa-notes-text" style="font-weight: 700;">
                A total of ${total.total} actionable items were logged. Detailed issue list is available in the bug tracker.
            </div>
        </div>

        <h2>Detailed Issue List</h2>
        <table class="details-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Issue Description</th>
                    <th>Severity</th>
                    <th>Category</th>
                </tr>
            </thead>
            <tbody>
                ${reportData.bugs.map((b, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${b.title}</td>
                        <td class="sev-${b.severity.toLowerCase()}">${b.severity}</td>
                        <td>${b.category}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <div class="footer">
            Generated by QA Automation Suite | Reported By: ${qa}
        </div>
    </div>
</body>
</html>`;
}

async function findRecurringBugs(currentBugs) {
    const { data: pastReports } = await supabase.from('reports').select('project_name, phase, timestamp, bugs').order('timestamp', { ascending: false }).limit(50);
    if (!pastReports) return [];
    const recurring = [];
    currentBugs.forEach(bug => {
        const matches = [];
        pastReports.forEach(report => {
            if (report.bugs) {
                report.bugs.forEach(pastBug => {
                    const similarity = getSimilarity(bug.title, pastBug.title);
                    if (similarity > 0.6) matches.push({ project: report.project_name, phase: report.phase });
                });
            }
        });
        if (matches.length > 0) recurring.push({ title: bug.title, matches: matches.slice(0, 3) });
    });
    return recurring;
}

function getSimilarity(s1, s2) {
    const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    const words1 = normalize(s1);
    const words2 = normalize(s2);
    if (words1.length === 0 || words2.length === 0) return 0;
    const intersection = words1.filter(word => words2.includes(word));
    return (2 * intersection.length) / (words1.length + words2.length);
}

app.post('/api/generate-report', async (req, res) => {
    const { projectName, phase, startDate, endDate, qaName, bugList } = req.body;
    if (!projectName || !phase || !bugList) return res.status(400).json({ error: 'Missing fields' });
    try {
        const reportData = parseBugs(bugList);
        const recurringIssues = await findRecurringBugs(reportData.bugs);
        const htmlContent = generateHTML(projectName, phase, startDate, endDate, qaName, reportData, recurringIssues);
        const insertData = { project_name: projectName, phase: phase, start_date: formatDateForDB(startDate), end_date: formatDateForDB(endDate), qa_name: qaName, total_issues: reportData.bugs.length, severity_breakdown: reportData.matrix.total, bugs: reportData.bugs, raw_text: bugList, html_content: htmlContent, timestamp: new Date().toISOString() };
        await supabase.from('reports').insert([insertData]);
        res.json({ message: 'Success', reportContent: htmlContent });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/records', async (req, res) => {
    const { data: reports } = await supabase.from('reports').select('*').order('timestamp', { ascending: false });
    const tree = {};
    reports.forEach(d => {
        if (!tree[d.project_name]) tree[d.project_name] = {};
        if (!tree[d.project_name][d.phase]) tree[d.project_name][d.phase] = [];
        tree[d.project_name][d.phase].push({ id: d.id, timestamp: d.timestamp, totalIssues: d.total_issues, qaName: d.qa_name });
    });
    res.json(tree);
});

app.get('/api/records/:id', async (req, res) => {
    const { data } = await supabase.from('reports').select('*').eq('id', req.params.id).single();
    res.json({ projectName: data.project_name, phase: data.phase, rawText: data.raw_text, bugs: data.bugs, htmlContent: data.html_content, timestamp: data.timestamp });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
