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
        if (year > 2100 || year < 1900) return new Date().toISOString().split('T')[0];
        return `${year}-${month}-${day}`;
    } catch (e) {
        return null;
    }
}

function parseBugs(text) {
    const issues = text.split(/Issue\s+/).filter(i => i.trim() !== '');
    const parsedBugsList = [];
    const totals = { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0, bugsOnly: 0 };
    const categories = {};

    issues.forEach(issue => {
        const priorityMatch = issue.match(/P([0-4])/);
        const severity = priorityMatch ? `P${priorityMatch[1]}` : 'P2';
        
        const lines = issue.split('\n');
        const titleMatch = lines[0].trim();
        const typeMatch = issue.match(/Type\s*:\s*([^\n|]+)/i);
        const categoryMatch = issue.match(/Category\s*:\s*([^\n|]+)/i);
        
        const type = typeMatch ? typeMatch[1].trim() : 'Bug';
        const category = categoryMatch ? categoryMatch[1].trim() : 'Functional';

        const bug = {
            title: titleMatch,
            severity: severity,
            type: type,
            category: category
        };

        parsedBugsList.push(bug);
        totals[severity.toLowerCase()]++;
        totals.total++;
        if (type.toLowerCase() === 'bug') totals.bugsOnly++;
        
        if (!categories[category]) {
            categories[category] = { p0:0, p1:0, p2:0, p3:0, p4:0, total: 0 };
        }
        categories[category][severity.toLowerCase()]++;
        categories[category].total++;
    });

    return { bugs: parsedBugsList, matrix: { total: totals, categories: categories } };
}

function generateHTML(project, phase, start, end, qa, reportData, recurring) {
    const { total, categories } = reportData.matrix;
    const catKeys = Object.keys(categories);
    
    const criticalRisks = reportData.bugs.filter(b => b.severity === 'P0' || b.severity === 'P1').slice(0, 6);
    const functionalRisks = reportData.bugs.filter(b => b.category.toLowerCase().includes('functional') && b.severity !== 'P0').slice(0, 5);
    const uiRisks = reportData.bugs.filter(b => (b.category.toLowerCase().includes('ui') || b.category.toLowerCase().includes('ux')) && b.severity !== 'P0').slice(0, 5);

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 20px; background-color: #f1f5f9; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .header-top { color: #64748b; margin-bottom: 24px; font-size: 15px; }
        h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin: 32px 0 16px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
        h2 { font-size: 20px; font-weight: 700; color: #1e293b; margin-top: 32px; margin-bottom: 16px; display: flex; align-items: center; }
        h2::before { content: ""; display: inline-block; width: 4px; height: 24px; background: #3b82f6; margin-right: 12px; border-radius: 2px; }
        
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 32px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
        .info-table th { background: #f8fafc; text-align: left; padding: 12px 16px; border: 1px solid #e2e8f0; width: 30%; color: #475569; font-size: 13px; text-transform: uppercase; letter-spacing: 0.025em; }
        .info-table td { padding: 12px 16px; border: 1px solid #e2e8f0; color: #1e293b; font-weight: 500; }

        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; }
        .summary-card { padding: 24px; border-radius: 12px; text-align: center; color: white; }
        .p0-card { background: linear-gradient(135deg, #ef4444, #b91c1c); }
        .p12-card { background: linear-gradient(135deg, #f97316, #c2410c); }
        .p34-card { background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
        .summary-num { font-size: 36px; font-weight: 800; display: block; line-height: 1; }
        .summary-label { font-size: 12px; font-weight: 700; text-transform: uppercase; margin-top: 8px; opacity: 0.9; }
        
        .total-banner { background: #f8fafc; padding: 12px; border-radius: 8px; border-left: 4px solid #0f172a; font-weight: 700; margin-bottom: 32px; color: #334155; text-align: center; }

        .matrix-table { width: 100%; border-collapse: collapse; margin-bottom: 32px; font-size: 14px; }
        .matrix-table th { background: #0f172a; color: white; padding: 12px; text-align: center; border: 1px solid #334155; }
        .matrix-table td { padding: 12px; text-align: center; border: 1px solid #e2e8f0; }
        .matrix-table td:first-child { text-align: left; font-weight: 700; background: #f8fafc; }
        
        .risk-section { margin-bottom: 24px; }
        .risk-title { font-weight: 700; color: #0f172a; margin-bottom: 8px; font-size: 15px; text-decoration: underline; }
        .risk-list { margin: 0; padding-left: 20px; color: #475569; }
        .risk-list li { margin-bottom: 6px; }

        .qa-notes { background: #fdf2f2; padding: 20px; border-radius: 8px; border: 1px solid #fee2e2; color: #7f1d1d; }
        .footer { margin-top: 48px; border-top: 1px solid #e2e8f0; padding-top: 24px; color: #64748b; font-size: 13px; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header-top">
            Hi Team,<br><br>
            Please find the exploratory QA summary report for the <strong>${phase}</strong> validation of the <strong>${project}</strong> platform.
        </div>

        <h1>Exploratory QA Summary Report</h1>

        <h2>Testing Information</h2>
        <table class="info-table">
            <tr><th>Project Name</th><td>${project}</td></tr>
            <tr><th>Testing Phase</th><td>${phase}</td></tr>
            <tr><th>Environment</th><td>${phase.includes('Live') ? 'Production' : 'Dev / Staging'}</td></tr>
            <tr><th>Platform</th><td>Web / Mobile Web / Android / iOS</td></tr>
            <tr><th>Start Date</th><td>${start}</td></tr>
            <tr><th>End Date</th><td>${end}</td></tr>
            <tr><th>Testing Conducted By</th><td>${qa}</td></tr>
        </table>

        <h2>Session Summary</h2>
        <div class="summary-grid">
            <div class="summary-card p0-card">
                <span class="summary-num">${total.p0}</span>
                <span class="summary-label">Critical (P0)</span>
            </div>
            <div class="summary-card p12-card">
                <span class="summary-num">${total.p1 + total.p2}</span>
                <span class="summary-label">High / Medium</span>
            </div>
            <div class="summary-card p34-card">
                <span class="summary-num">${total.p3 + total.p4}</span>
                <span class="summary-label">Minor / Low</span>
            </div>
        </div>
        <div class="total-banner">
            Total Issues Identified: ${total.total} | Total Bugs: ${total.bugsOnly}
        </div>

        <h2>Issue Classification Matrix</h2>
        <table class="matrix-table">
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Total</th>
                    <th>P0</th>
                    <th>P1</th>
                    <th>P2</th>
                    <th>P3</th>
                    <th>P4</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Total Issues</td>
                    <td>${total.total}</td>
                    <td>${total.p0}</td>
                    <td>${total.p1}</td>
                    <td>${total.p2}</td>
                    <td>${total.p3}</td>
                    <td>${total.p4}</td>
                </tr>
                ${catKeys.map(cat => `
                    <tr>
                        <td>${cat}</td>
                        <td>${categories[cat].total}</td>
                        <td>${categories[cat].p0}</td>
                        <td>${categories[cat].p1}</td>
                        <td>${categories[cat].p2}</td>
                        <td>${categories[cat].p3}</td>
                        <td>${categories[cat].p4}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        <h2>Key Risks Identified</h2>
        <div class="risk-section">
            <div class="risk-title">Critical Risks</div>
            <ul class="risk-list">
                ${criticalRisks.length > 0 ? criticalRisks.map(r => `<li>${r.title}</li>`).join('') : '<li>No critical risks identified.</li>'}
            </ul>
        </div>

        <div class="risk-section">
            <div class="risk-title">Functional Risks</div>
            <ul class="risk-list">
                ${functionalRisks.length > 0 ? functionalRisks.map(r => `<li>${r.title}</li>`).join('') : '<li>No functional risks identified.</li>'}
            </ul>
        </div>

        <div class="risk-section">
            <div class="risk-title">UI / UX Risks</div>
            <ul class="risk-list">
                ${uiRisks.length > 0 ? uiRisks.map(r => `<li>${r.title}</li>`).join('') : '<li>No UI/UX risks identified.</li>'}
            </ul>
        </div>

        <h2>QA Notes</h2>
        <div class="qa-notes">
            Testing was exploratory in nature without predefined test cases. Coverage was driven by business-critical workflows and user behavior patterns.<br><br>
            A total of <strong>${total.total}</strong> actionable items were logged. Detailed issue list is available in the bug tracker.
        </div>

        <div class="footer">
            Generated by QA Automation Suite | Reported By: ${qa}
        </div>
    </div>
</body>
</html>`;
}

async function findRecurringBugs(currentBugs) {
    const { data: pastReports, error } = await supabase
        .from('reports')
        .select('project_name, phase, timestamp, bugs')
        .order('timestamp', { ascending: false })
        .limit(20);
    if (error || !pastReports) return [];
    const recurring = [];
    currentBugs.forEach(bug => {
        const matches = [];
        pastReports.forEach(report => {
            if (report.bugs) {
                report.bugs.forEach(pastBug => {
                    const similarity = getSimilarity(bug.title, pastBug.title);
                    if (similarity > 0.7) matches.push({ project: report.project_name, phase: report.phase });
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
    if (!projectName || !phase || !bugList) return res.status(400).json({ error: 'Missing required fields' });

    try {
        const reportData = parseBugs(bugList);
        const recurringIssues = await findRecurringBugs(reportData.bugs);
        const htmlContent = generateHTML(projectName, phase, startDate, endDate, qaName, reportData, recurringIssues);

        const insertData = {
            project_name: projectName,
            phase: phase,
            start_date: formatDateForDB(startDate),
            end_date: formatDateForDB(endDate),
            qa_name: qaName,
            total_issues: reportData.bugs.length,
            severity_breakdown: reportData.matrix.total,
            bugs: reportData.bugs,
            raw_text: bugList,
            html_content: htmlContent,
            timestamp: new Date().toISOString()
        };

        const { error: dbError } = await supabase.from('reports').insert([insertData]);

        if (dbError) {
            return res.status(500).json({ error: 'DB Save Failed', debug: dbError.message, reportContent: htmlContent });
        }

        res.json({ message: 'Success', reportContent: htmlContent });
    } catch (error) {
        res.status(500).json({ error: 'Generation failed' });
    }
});

app.get('/api/records', async (req, res) => {
    const { data: reports, error } = await supabase.from('reports').select('*').order('timestamp', { ascending: false });
    if (error) return res.status(500).json({ error: 'Fetch failed' });
    const tree = {};
    reports.forEach(d => {
        if (!tree[d.project_name]) tree[d.project_name] = {};
        if (!tree[d.project_name][d.phase]) tree[d.project_name][d.phase] = [];
        tree[d.project_name][d.phase].push({ id: d.id, timestamp: d.timestamp, totalIssues: d.total_issues, qaName: d.qa_name });
    });
    res.json(tree);
});

app.get('/api/records/:id', async (req, res) => {
    const { data, error } = await supabase.from('reports').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Not found' });
    res.json({ projectName: data.project_name, phase: data.phase, rawText: data.raw_text, bugs: data.bugs, htmlContent: data.html_content, timestamp: data.timestamp });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
