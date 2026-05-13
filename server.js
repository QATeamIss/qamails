require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 3000;

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));

const OUTPUT_DIR = path.resolve(__dirname, '..');

function formatDateForDB(dateStr) {
    if (!dateStr) return null;
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
    } catch (e) {
        return null;
    }
}


function getSimilarity(s1, s2) {
    // Stop words and generic phrases to ignore
    const stopWords = new Set(['unable', 'to', 'is', 'not', 'working', 'the', 'a', 'an', 'and', 'for', 'in', 'on', 'with', 'issue', 'bug']);
    
    const normalize = (str) => {
        return str.toLowerCase()
            .replace(/^(bug|issue|defect|ticket|task)\s*[:#-]*\s*/i, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const getKeywords = (str) => {
        return normalize(str).split(' ').filter(word => word.length > 1 && !stopWords.has(word));
    };

    const s1_norm = normalize(s1);
    const s2_norm = normalize(s2);
    const kw1 = getKeywords(s1);
    const kw2 = getKeywords(s2);

    if (s1_norm === s2_norm) return 1.0;
    
    // 1. Keyword Overlap (Most important for "Technically Same")
    const set1 = new Set(kw1);
    const set2 = new Set(kw2);
    const intersect = kw1.filter(w => set2.has(w));
    const unionSize = new Set([...kw1, ...kw2]).size;
    const keywordSim = unionSize > 0 ? (intersect.length / unionSize) : 0;

    // 2. Character-level bigrams (For typos)
    const getBigrams = (str) => {
        const bigrams = new Set();
        const clean = str.replace(/\s/g, '');
        for (let i = 0; i < clean.length - 1; i++) {
            bigrams.add(clean.substring(i, i + 2));
        }
        return bigrams;
    };

    const b1 = getBigrams(s1_norm);
    const b2 = getBigrams(s2_norm);
    const charIntersect = new Set([...b1].filter(x => b2.has(x)));
    const charSim = (b1.size + b2.size) > 0 ? (2.0 * charIntersect.size) / (b1.size + b2.size) : 0;

    // Final Score: If keywords match significantly, weight it very high
    // Even a 50% keyword match with some character overlap should trigger a warning
    return (keywordSim * 0.7) + (charSim * 0.3);
}


async function findRecurringBugs(currentBugs) {
    const recurring = [];
    
    // Fetch all historical bugs from Supabase
    const { data: allHistoricalReports, error } = await supabase
        .from('reports')
        .select('project_name, phase, timestamp, bugs');

    if (error || !allHistoricalReports) return recurring;

    const allHistoricalBugs = [];
    allHistoricalReports.forEach(report => {
        if (report.bugs) {
            allHistoricalBugs.push(...report.bugs.map(b => ({
                ...b,
                project: report.project_name,
                phase: report.phase,
                date: report.timestamp
            })));
        }
    });

    currentBugs.forEach(bug => {
        const matches = allHistoricalBugs.filter(h => getSimilarity(bug.title, h.title) > 0.65);
        if (matches.length > 0) {
            recurring.push({
                title: bug.title,
                matches: matches.slice(0, 3)
            });
        }
    });

    return recurring;
}

app.post('/api/generate-report', async (req, res) => {
    const { projectName, phase, startDate, endDate, qaName, bugList } = req.body;

    if (!projectName || !phase || !bugList) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const reportData = parseBugs(bugList);
        const recurringIssues = await findRecurringBugs(reportData.bugs);
        const htmlContent = generateHTML(projectName, phase, startDate, endDate, qaName, reportData, recurringIssues);

        // Save to Supabase
        const { error: dbError } = await supabase
            .from('reports')
            .insert([{
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
            }]);


        res.json({ 
            message: 'Report generated successfully!', 
            reportContent: htmlContent,
            recurringCount: recurringIssues.length
        });
    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

app.get('/api/records', async (req, res) => {
    try {
        const { data: reports, error } = await supabase
            .from('reports')
            .select('*')
            .order('timestamp', { ascending: false });

        if (error) throw error;

        const tree = {};
        reports.forEach(data => {
            const project = data.project_name;
            const phase = data.phase;
            
            if (!tree[project]) tree[project] = {};
            if (!tree[project][phase]) tree[project][phase] = [];
            
            tree[project][phase].push({
                id: data.id,
                timestamp: data.timestamp,
                totalIssues: data.total_issues,
                qaName: data.qa_name
            });
        });

        res.json(tree);
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch records' });
    }
});

app.get('/api/records/:project/:phase/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
            .from('reports')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        
        // Transform back to the format the frontend expects
        res.json({
            projectName: data.project_name,
            phase: data.phase,
            rawText: data.raw_text,
            bugs: data.bugs,
            htmlContent: data.html_content,
            timestamp: data.timestamp
        });
    } catch (error) {
        res.status(404).json({ error: 'Record not found' });
    }
});

app.get('/api/find-repeated', async (req, res) => {
    try {
        const { data: reports, error } = await supabase
            .from('reports')
            .select('project_name, phase, timestamp, bugs');

        if (error) throw error;

        const allBugs = [];
        reports.forEach(data => {
            if (data.bugs) {
                data.bugs.forEach(bug => {
                    allBugs.push({
                        title: bug.title,
                        project: data.project_name,
                        phase: data.phase,
                        date: data.timestamp
                    });
                });
            }
        });

        // Grouping logic remains similar but uses the cloud data
        const groups = {};
        allBugs.forEach(bug => {
            const key = bug.title.toLowerCase().trim();
            if (!groups[key]) groups[key] = [];
            groups[key].push(bug);
        });

        const repeats = Object.keys(groups)
            .filter(key => groups[key].length > 1)
            .map(key => ({
                title: groups[key][0].title,
                count: groups[key].length,
                occurrences: groups[key]
            }))
            .sort((a, b) => b.count - a.count);

        res.json(repeats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to run analysis' });
    }
});

// Endpoint for Weekly QA Report
app.post('/api/weekly-report', async (req, res) => {
    const { fromDate, toDate } = req.body;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);

    try {
        const { data: reports, error } = await supabase
            .from('reports')
            .select('*')
            .gte('timestamp', start.toISOString())
            .lte('timestamp', end.toISOString());

        if (error) throw error;

        if (!reports || reports.length === 0) {
            return res.status(404).json({ error: 'No testing activities found for this period.' });
        }

        // Aggregate data
        let grandTotal = 0;
        let grandHigh = 0;
        const projectSummary = reports.map(s => {
            const high = (s.severity_breakdown.p0 || 0) + (s.severity_breakdown.p1 || 0);
            const total = s.total_issues;
            grandTotal += total;
            grandHigh += high;
            return {
                project: s.project_name,
                phase: s.phase,
                status: 'Completed',
                start: s.start_date,
                end: s.end_date,
                total: total,
                high: high,
                fixed: total - high
            };
        });

        // Find repeats in this week
        const allBugsThisWeek = [];
        reports.forEach(s => allBugsThisWeek.push(...s.bugs));
        const repeats = [];
        const bugGroups = {};
        allBugsThisWeek.forEach(b => {
            const key = b.title.toLowerCase().trim();
            if (!bugGroups[key]) bugGroups[key] = [];
            bugGroups[key].push(b);
        });
        Object.keys(bugGroups).forEach(key => {
            if (bugGroups[key].length > 1) {
                repeats.push(bugGroups[key][0].title);
            }
        });

        const html = generateWeeklyHTML(fromDate, toDate, projectSummary, grandTotal, grandHigh, repeats);
        res.json({ reportContent: html });
    } catch (error) {
        console.error('Weekly report error:', error);
        res.status(500).json({ error: 'Failed to generate weekly report' });
    }
});

function generateWeeklyHTML(from, to, sessions, total, high, repeats) {
    const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    // Sort projects by bug count for the summary text
    const sorted = [...sessions].sort((a, b) => b.total - a.total);
    const topProjects = sorted.slice(0, 3).map(s => `${s.project} (${s.total} bugs)`).join(', ');

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 900px; margin: 0 auto; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
        th { background-color: #f8fafc; font-weight: 600; }
        .total-row { background-color: #f1f5f9; font-weight: 800; }
        .repeats-box { background: #fef2f2; border: 1px solid #ef4444; padding: 15px; border-radius: 8px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <p>Hi Saneesh,</p>
        <p>Please find the weekly QA bug report for <strong>${formatDate(from)} to ${formatDate(to)}</strong>.</p>

        <table>
            <thead>
                <tr>
                    <th>Project</th>
                    <th>Phase</th>
                    <th>Status</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Total Bugs</th>
                    <th>High</th>
                    <th>Fixed</th>
                </tr>
            </thead>
            <tbody>
                ${sessions.map(s => `
                    <tr>
                        <td>${s.project}</td>
                        <td>${s.phase}</td>
                        <td>${s.status}</td>
                        <td>${s.start}</td>
                        <td>${s.end}</td>
                        <td>${s.total}</td>
                        <td>${s.high}</td>
                        <td>${s.fixed}</td>
                    </tr>
                `).join('')}
                <tr class="total-row">
                    <td colspan="5">Total</td>
                    <td>${total}</td>
                    <td>${high}</td>
                    <td>${total - high}</td>
                </tr>
            </tbody>
        </table>

        <h2>Summary</h2>
        <p>During this week, the QA team completed <strong>${sessions.length}</strong> testing activities successfully. A total of <strong>${total}</strong> bugs were identified, including <strong>${high}</strong> high-priority bugs and <strong>${total - high}</strong> medium/normal issues, all reported to the development team for fixing. The highest defect count was found in <strong>${topProjects}</strong>. All scheduled QA tasks were completed within the planned timeline with no deviations.</p>

        ${repeats.length > 0 ? `
            <div class="repeats-box">
                <h3 style="color: #991b1b; margin-top: 0;">⚠️ Repeated Issues This Week</h3>
                <ul>${repeats.map(r => `<li>${r}</li>`).join('')}</ul>
            </div>
        ` : ''}

        <p style="margin-top: 40px; color: #64748b; font-size: 12px; border-top: 1px solid #eee; padding-top: 10px;">Developed By Abhiram</p>
    </div>
</body>
</html>
    `;
}

function parseBugs(text) {
    const issues = text.split(/Issue\s+/).filter(i => i.trim() !== '');
    let totalIssues = issues.length;
    
    const matrix = {
        total: { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 },
        bugs: { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 },
        functional: { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 },
        html: { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 },
        enhancements: { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 },
        corrections: { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 },
        suggestions: { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 }
    };

    const risks = {
        critical: [],
        functional: [],
        ui: [],
        security: [],
        accessibility: []
    };

    const parsedBugsList = [];

    issues.forEach(issue => {
        const priorityMatch = issue.match(/P([0-4])/);
        const typeMatch = issue.match(/Type\s*:\s*(\w+)/i);
        const categoryMatch = issue.match(/^(Functional|HTML|SEO)/im);
        const titleMatch = issue.split('\n')[0].trim();

        const priority = priorityMatch ? parseInt(priorityMatch[1]) : 3;
        const type = typeMatch ? typeMatch[1].toLowerCase() : 'bug';
        const category = categoryMatch ? categoryMatch[1].toLowerCase() : 'functional';

        parsedBugsList.push({ title: titleMatch, severity: `P${priority}`, type, category });

        const pKey = `p${priority}`;
        matrix.total[pKey]++;
        matrix.total.total++;

        if (type === 'bug') {
            matrix.bugs[pKey]++;
            matrix.bugs.total++;
            if (category === 'functional') {
                matrix.functional[pKey]++;
                matrix.functional.total++;
            } else if (category === 'html' || category === 'seo') {
                matrix.html[pKey]++;
                matrix.html.total++;
            }
        } else if (type === 'enhancement') {
            matrix.enhancements[pKey]++;
            matrix.enhancements.total++;
        } else if (type === 'correction') {
            matrix.corrections[pKey]++;
            matrix.corrections.total++;
        } else if (type === 'suggestion') {
            matrix.suggestions[pKey]++;
            matrix.suggestions.total++;
        }

        if (priority === 0) risks.critical.push(titleMatch);
        else if (category === 'functional') risks.functional.push(titleMatch);
        else if (category === 'html') risks.ui.push(titleMatch);
    });

    return { totalIssues, matrix, risks, bugs: parsedBugsList };
}

function generateHTML(projectName, phase, startDate, endDate, qaName, data, recurringIssues = []) {
    const { totalIssues, matrix, risks } = data;
    const severityBreakdown = {
        p0: matrix.total.p0,
        highMed: matrix.total.p1 + matrix.total.p2,
        minorLow: matrix.total.p3 + matrix.total.p4
    };

    const recurringHtml = recurringIssues.length > 0 ? `
        <div style="background-color: #fff1f2; border: 2px solid #ef4444; border-radius: 8px; padding: 15px; margin-top: 25px;">
            <h2 style="color: #991b1b; margin-top: 0; border: none; padding: 0;">⚠️ Recurring Issues Detected</h2>
            <p style="color: #b91c1c; font-size: 14px;">The following bugs appear to be identical or very similar to issues found in previous sessions:</p>
            <ul style="margin: 0; padding-left: 20px;">
                ${recurringIssues.map(r => `
                    <li style="color: #991b1b; margin-bottom: 5px;">
                        <strong>${r.title}</strong>
                        <span style="font-size: 12px; color: #7f1d1d;">(Previous: ${r.matches.map(m => `${m.project}/${m.phase}`).join(', ')})</span>
                    </li>
                `).join('')}
            </ul>
        </div>
    ` : '';

    const styles = `
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; border: 1px solid #eee; }
        h1 { color: #1e293b; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; margin-bottom: 20px; }
        h2 { color: #334155; margin-top: 30px; border-left: 4px solid #3b82f6; padding-left: 10px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
        th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
        th { background-color: #f8fafc; color: #475569; font-weight: 600; }
        .severity-p0 { background-color: #fef2f2; color: #991b1b; font-weight: bold; border-left: 4px solid #ef4444; }
        .severity-high { background-color: #fff7ed; color: #9a3412; font-weight: bold; border-left: 4px solid #f97316; }
        .severity-low { background-color: #eff6ff; color: #1e40af; font-weight: bold; border-left: 4px solid #3b82f6; }
        .risk-list { list-style: none; padding: 0; }
        .risk-list li { margin-bottom: 8px; padding-left: 20px; position: relative; }
        .risk-list li::before { content: '•'; position: absolute; left: 0; color: #3b82f6; font-weight: bold; }
    `;

    return `
<!DOCTYPE html>
<html>
<head>
    <style>${styles}</style>
</head>
<body>
    <div class="container">
        <p>Hi Team,</p>
        <p>Please find the exploratory QA summary report for the <strong>${phase}</strong> validation of the <strong>${projectName}</strong> platform.</p>

        <h1>Exploratory QA Summary Report</h1>

        ${recurringHtml}

        <h2>Testing Information</h2>
        <table>
            <tr><th>Project Name</th><td>${projectName}</td></tr>
            <tr><th>Testing Phase</th><td>${phase}</td></tr>
            <tr><th>Environment</th><td>${phase.toLowerCase().includes('live') ? 'Live' : 'Dev'}</td></tr>
            <tr><th>Platform</th><td>Web / Mobile Web / Android / iOS</td></tr>
            <tr><th>Start Date</th><td>${startDate}</td></tr>
            <tr><th>End Date</th><td>${endDate}</td></tr>
            <tr><th>Testing Conducted By</th><td>${qaName}</td></tr>
        </table>

        <h2>Session Summary</h2>
        <table style="width: 100%; text-align: center;">
            <tr>
                <td style="padding: 15px; background-color: #ef4444; color: white; width: 33%;">
                    <div style="font-size: 24px; font-weight: 800;">${severityBreakdown.p0}</div>
                    <div style="font-size: 12px; text-transform: uppercase;">Critical (P0)</div>
                </td>
                <td style="padding: 15px; background-color: #f97316; color: white; width: 33%;">
                    <div style="font-size: 24px; font-weight: 800;">${severityBreakdown.highMed}</div>
                    <div style="font-size: 12px; text-transform: uppercase;">High / Medium</div>
                </td>
                <td style="padding: 15px; background-color: #3b82f6; color: white; width: 33%;">
                    <div style="font-size: 24px; font-weight: 800;">${severityBreakdown.minorLow}</div>
                    <div style="font-size: 12px; text-transform: uppercase;">Minor / Low</div>
                </td>
            </tr>
        </table>
        <p><strong>Total Issues Identified:</strong> ${totalIssues} | <strong>Total Bugs:</strong> ${matrix.bugs.total}</p>

        <h2>Issue Classification Matrix</h2>
        <table>
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
                <tr style="font-weight: 600;"><td>Total Issues</td><td>${matrix.total.total}</td><td>${matrix.total.p0}</td><td>${matrix.total.p1}</td><td>${matrix.total.p2}</td><td>${matrix.total.p3}</td><td>${matrix.total.p4}</td></tr>
                <tr><td>Total Bugs</td><td>${matrix.bugs.total}</td><td>${matrix.bugs.p0}</td><td>${matrix.bugs.p1}</td><td>${matrix.bugs.p2}</td><td>${matrix.bugs.p3}</td><td>${matrix.bugs.p4}</td></tr>
                <tr><td>Functional Bugs</td><td>${matrix.functional.total}</td><td>${matrix.functional.p0}</td><td>${matrix.functional.p1}</td><td>${matrix.functional.p2}</td><td>${matrix.functional.p3}</td><td>${matrix.functional.p4}</td></tr>
                <tr><td>HTML / UI Bugs</td><td>${matrix.html.total}</td><td>${matrix.html.p0}</td><td>${matrix.html.p1}</td><td>${matrix.html.p2}</td><td>${matrix.html.p3}</td><td>${matrix.html.p4}</td></tr>
                <tr><td>Enhancements</td><td>${matrix.enhancements.total}</td><td>${matrix.enhancements.p0}</td><td>${matrix.enhancements.p1}</td><td>${matrix.enhancements.p2}</td><td>${matrix.enhancements.p3}</td><td>${matrix.enhancements.p4}</td></tr>
                <tr><td>Corrections</td><td>${matrix.corrections.total}</td><td>${matrix.corrections.p0}</td><td>${matrix.corrections.p1}</td><td>${matrix.corrections.p2}</td><td>${matrix.corrections.p3}</td><td>${matrix.corrections.p4}</td></tr>
            </tbody>
        </table>

        <h2>Key Risks Identified</h2>
        <div class="severity-p0" style="padding: 10px; margin-bottom: 10px;">Critical Risks</div>
        <ul class="risk-list">${risks.critical.length > 0 ? risks.critical.slice(0, 5).map(r => `<li>${r}</li>`).join('') : '<li>None</li>'}</ul>

        <div class="severity-high" style="padding: 10px; margin-bottom: 10px;">Functional Risks</div>
        <ul class="risk-list">${risks.functional.length > 0 ? risks.functional.slice(0, 5).map(r => `<li>${r}</li>`).join('') : '<li>None</li>'}</ul>

        <div class="severity-low" style="padding: 10px; margin-bottom: 10px;">UI / UX Risks</div>
        <ul class="risk-list">${risks.ui.length > 0 ? risks.ui.slice(0, 5).map(r => `<li>${r}</li>`).join('') : '<li>None</li>'}</ul>

        <h2>QA Notes</h2>
        <p>Testing was exploratory in nature without predefined test cases. Coverage was driven by business-critical workflows and user behavior patterns.</p>
        <p>A total of <strong>${totalIssues}</strong> actionable items were logged. Detailed issue list is available in the bug tracker.</p>
        
        <p style="margin-top: 40px; color: #64748b; font-size: 12px; border-top: 1px solid #eee; padding-top: 10px;">Developed By Abhiram</p>
    </div>
</body>
</html>
    `;
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
