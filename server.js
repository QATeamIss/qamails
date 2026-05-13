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
    const s = String(dateStr).trim();
    
    // Robustly extract YYYY-MM-DD if it exists anywhere in the string
    const match = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }
    
    try {
        const d = new Date(s);
        if (isNaN(d.getTime())) return null;
        
        // Manual formatting to be absolutely safe from ISO string weirdness
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        
        // Prevent huge years
        if (year > 2100 || year < 1900) {
            console.error('Invalid year detected:', year);
            return new Date().toISOString().split('T')[0]; // Fallback to today
        }
        
        return `${year}-${month}-${day}`;
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

        const { error: dbError } = await supabase
            .from('reports')
            .insert([insertData]);

        if (dbError) {
            console.error('--- SUPABASE INSERT ERROR ---');
            console.error('Error Details:', JSON.stringify(dbError, null, 2));
            console.error('Data attempted:', JSON.stringify(insertData, null, 2));
            
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
    const categories = {};

    issues.forEach(issue => {
        const priorityMatch = issue.match(/P([0-4])/);
        const severity = priorityMatch ? `P${priorityMatch[1]}` : 'P2';
        
        const titleMatch = issue.split('\n')[0].trim();
        const typeMatch = issue.match(/Type\s*:\s*(\w+)/i);
        const categoryMatch = issue.match(/Category\s*:\s*([^\n]+)/i);
        
        const category = categoryMatch ? categoryMatch[1].trim() : 'Functional';

        const bug = {
            title: titleMatch,
            severity: severity,
            type: typeMatch ? typeMatch[1] : 'Bug',
            category: category
        };

        parsedBugsList.push(bug);
        totals[severity.toLowerCase()]++;
        totals.total++;
        
        if (!categories[category]) {
            categories[category] = { p0:0, p1:0, p2:0, p3:0, p4:0, total: 0 };
        }
        categories[category][severity.toLowerCase()]++;
        categories[category].total++;
    });

    return { bugs: parsedBugsList, matrix: { total: totals, categories: categories } };
}

function generateHTML(project, phase, start, end, qa, reportData, recurring) {
    const categories = Object.keys(reportData.matrix.categories);
    
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #334155; margin: 0; padding: 0; background-color: #f8fafc; }
        .container { max-width: 850px; margin: 20px auto; padding: 40px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        h1 { color: #1e293b; font-size: 28px; font-weight: 800; border-bottom: 3px solid #3b82f6; padding-bottom: 12px; margin-bottom: 24px; }
        h2 { color: #1e293b; font-size: 20px; font-weight: 700; margin-top: 32px; margin-bottom: 16px; border-left: 5px solid #3b82f6; padding-left: 12px; }
        p { margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
        th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
        th { background-color: #f1f5f9; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.025em; }
        .severity-p0 { background-color: #fef2f2; color: #991b1b; font-weight: bold; border-left: 4px solid #ef4444; }
        .severity-p1 { background-color: #fff7ed; color: #9a3412; font-weight: bold; border-left: 4px solid #f97316; }
        .risk-list { list-style: none; padding: 0; margin: 0; }
        .risk-list li { margin-bottom: 12px; padding: 12px; background-color: #f8fafc; border-radius: 6px; border-left: 4px solid #3b82f6; }
        .matrix-table th, .matrix-table td { text-align: center; }
        .matrix-table td:first-child { text-align: left; font-weight: 600; background-color: #f8fafc; }
        .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 13px; }
        .summary-box { display: flex; gap: 16px; margin: 24px 0; }
        .summary-item { flex: 1; padding: 20px; border-radius: 12px; text-align: center; color: white; }
        .critical { background-color: #ef4444; }
        .high { background-color: #f97316; }
        .minor { background-color: #3b82f6; }
        .summary-val { font-size: 32px; font-weight: 800; display: block; }
        .summary-label { font-size: 12px; text-transform: uppercase; font-weight: 700; opacity: 0.9; }
    </style>
</head>
<body>
    <div class="container">
        <p>Hi Team,</p>
        <p>Please find the exploratory QA summary report for the <strong>${phase}</strong> validation of the <strong>${project}</strong> platform.</p>

        <h1>Exploratory QA Summary Report</h1>

        <h2>Testing Overview</h2>
        <p>An exploratory QA session was performed to validate critical business workflows, UI consistency, user interactions, error handling, responsive behavior, and overall product stability.</p>
        <p>Testing was conducted using real-user scenarios without predefined test cases, focusing on discovering functional defects, usability gaps, integration issues, and production risks.</p>

        <h2>Testing Information</h2>
        <table>
            <tr><th>Project Name</th><td>${project}</td></tr>
            <tr><th>Testing Phase</th><td>${phase}</td></tr>
            <tr><th>Start Date</th><td>${start}</td></tr>
            <tr><th>End Date</th><td>${end}</td></tr>
            <tr><th>Testing Conducted By</th><td>${qa}</td></tr>
            <tr><th>Environment</th><td>Live / Production</td></tr>
        </table>

        <h2>Testing Approach</h2>
        <ul style="padding-left: 20px;">
            <li>Session-Based Exploratory Testing</li>
            <li>Risk-Based Validation</li>
            <li>Ad-hoc Negative Testing</li>
            <li>UI / UX Inspection</li>
            <li>Browser Console Monitoring</li>
        </ul>

        <h2>Session Summary</h2>
        <div class="summary-box">
            <div class="summary-item critical">
                <span class="summary-val">${reportData.matrix.total.p0}</span>
                <span class="summary-label">Critical (P0)</span>
            </div>
            <div class="summary-item high">
                <span class="summary-val">${reportData.matrix.total.p1 + reportData.matrix.total.p2}</span>
                <span class="summary-label">High / Medium</span>
            </div>
            <div class="summary-item minor">
                <span class="summary-val">${reportData.matrix.total.p3 + reportData.matrix.total.p4}</span>
                <span class="summary-label">Minor / Low</span>
            </div>
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
                    <td>${reportData.matrix.total.total}</td>
                    <td>${reportData.matrix.total.p0}</td>
                    <td>${reportData.matrix.total.p1}</td>
                    <td>${reportData.matrix.total.p2}</td>
                    <td>${reportData.matrix.total.p3}</td>
                    <td>${reportData.matrix.total.p4}</td>
                </tr>
                ${categories.map(cat => `
                    <tr>
                        <td>${cat}</td>
                        <td>${reportData.matrix.categories[cat].total}</td>
                        <td>${reportData.matrix.categories[cat].p0}</td>
                        <td>${reportData.matrix.categories[cat].p1}</td>
                        <td>${reportData.matrix.categories[cat].p2}</td>
                        <td>${reportData.matrix.categories[cat].p3}</td>
                        <td>${reportData.matrix.categories[cat].p4}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>

        ${recurring.length > 0 ? `
            <h2>Recurring Issues Detected</h2>
            <ul class="risk-list">
                ${recurring.map(r => `<li><strong>${r.title}</strong>: Previously seen in ${r.matches.map(m => `${m.project} (${m.phase})`).join(', ')}</li>`).join('')}
            </ul>
        ` : ''}

        <h2>QA Notes</h2>
        <p>Testing was exploratory in nature without predefined test cases. Coverage was driven by business-critical workflows, user behavior patterns, and risk-based exploration.</p>
        <p>A total of <strong>${reportData.bugs.length}</strong> actionable items were logged during this session.</p>

        <div class="footer">
            <p>This report was automatically generated and archived by the QA Automation Suite.</p>
            <p><strong>Reported By:</strong> ${qa}</p>
        </div>
    </div>
</body>
</html>`;
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
