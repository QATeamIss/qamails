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
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word));
    };

    const words1 = normalize(s1);
    const words2 = normalize(s2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const intersection = words1.filter(word => words2.includes(word));
    return (2 * intersection.length) / (words1.length + words2.length);
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
                    if (similarity > 0.7) {
                        matches.push({
                            project: report.project_name,
                            phase: report.phase,
                            date: report.timestamp,
                            title: pastBug.title
                        });
                    }
                });
            }
        });

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

        if (dbError) {
            console.error('--- SUPABASE INSERT ERROR ---');
            console.error('Error Details:', JSON.stringify(dbError, null, 2));
            return res.status(500).json({ 
                error: 'Failed to save report to archives, but generation succeeded.', 
                debug: dbError.message || dbError,
                reportContent: htmlContent 
            });
        }

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

app.get('/api/records/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
            .from('reports')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        
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

        let grandTotal = 0;
        const projectSummary = reports.map(s => {
            grandTotal += s.total_issues;
            return {
                name: s.project_name,
                total: s.total_issues,
                high: (s.severity_breakdown.p0 || 0) + (s.severity_breakdown.p1 || 0)
            };
        });

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head><style>body { font-family: sans-serif; }</style></head>
            <body>
                <h1>Weekly QA Summary Report</h1>
                <p>Period: ${fromDate} to ${toDate}</p>
                <h2>Project Breakdown</h2>
                <ul>
                    ${projectSummary.map(p => `<li>${p.name}: ${p.total} issues (${p.high} High)</li>`).join('')}
                </ul>
                <p><strong>Grand Total: ${grandTotal}</strong></p>
            </body>
            </html>
        `;

        res.json({ reportContent: htmlContent });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate weekly report' });
    }
});

function parseBugs(text) {
    const issues = text.split(/Issue\s+/).filter(i => i.trim() !== '');
    const parsedBugsList = [];
    const totals = { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, total: 0 };

    issues.forEach(issue => {
        const priorityMatch = issue.match(/P([0-4])/);
        const severity = priorityMatch ? `P${priorityMatch[1]}` : 'P2';
        
        const titleMatch = issue.split('\n')[0].trim();
        const typeMatch = issue.match(/Type\s*:\s*(\w+)/i);
        const categoryMatch = issue.match(/Category\s*:\s*(\w+)/i);

        const bug = {
            title: titleMatch,
            severity: severity,
            type: typeMatch ? typeMatch[1] : 'Bug',
            category: categoryMatch ? categoryMatch[1] : 'Functional'
        };

        parsedBugsList.push(bug);
        totals[severity.toLowerCase()]++;
        totals.total++;
    });

    return { bugs: parsedBugsList, matrix: { total: totals } };
}

function generateHTML(project, phase, start, end, qa, reportData, recurring) {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
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
    </style>
</head>
<body>
    <div class="container">
        <p>Hi Team,</p>
        <p>Please find the exploratory QA summary report for the <strong>${phase}</strong> validation of the <strong>${project}</strong> platform.</p>

        <h1>Exploratory QA Summary Report</h1>

        <h2>Testing Information</h2>
        <table>
            <tr><th>Project Name</th><td>${project}</td></tr>
            <tr><th>Testing Phase</th><td>${phase}</td></tr>
            <tr><th>Start Date</th><td>${start}</td></tr>
            <tr><th>End Date</th><td>${end}</td></tr>
            <tr><th>Testing Conducted By</th><td>${qa}</td></tr>
        </table>

        <h2>Session Summary</h2>
        <table style="width: 100%; text-align: center;">
            <tr>
                <td style="padding: 15px; background-color: #ef4444; color: white; width: 33%;">
                    <div style="font-size: 24px; font-weight: 800;">${reportData.matrix.total.p0}</div>
                    <div style="font-size: 12px; text-transform: uppercase;">Critical (P0)</div>
                </td>
                <td style="padding: 15px; background-color: #f97316; color: white; width: 33%;">
                    <div style="font-size: 24px; font-weight: 800;">${reportData.matrix.total.p1}</div>
                    <div style="font-size: 12px; text-transform: uppercase;">High / Medium</div>
                </td>
                <td style="padding: 15px; background-color: #3b82f6; color: white; width: 33%;">
                    <div style="font-size: 24px; font-weight: 800;">${reportData.matrix.total.p2 + reportData.matrix.total.p3 + reportData.matrix.total.p4}</div>
                    <div style="font-size: 12px; text-transform: uppercase;">Minor / Low</div>
                </td>
            </tr>
        </table>

        <h2>Recurring Issues Detected</h2>
        ${recurring.length > 0 ? `
            <ul class="risk-list">
                ${recurring.map(r => `<li><strong>${r.title}</strong>: Seen in ${r.matches.map(m => `${m.project} (${m.phase})`).join(', ')}</li>`).join('')}
            </ul>
        ` : '<p>No recurring issues detected in this session.</p>'}

        <p style="margin-top: 40px; color: #64748b; font-size: 12px; border-top: 1px solid #eee; padding-top: 10px;">Developed By ${qa}</p>
    </div>
</body>
</html>`;
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
