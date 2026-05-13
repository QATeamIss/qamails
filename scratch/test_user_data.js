const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const data = {
        project_name: "Quantum Industries",
        phase: "Dev Test",
        start_date: "2026-05-13",
        end_date: "2026-05-13",
        qa_name: "Abhiram",
        total_issues: 1,
        severity_breakdown: { p0: 0, p1: 1, p2: 0, p3: 0, p4: 0, total: 1 },
        bugs: [{ title: "Functional", severity: "P1", type: "bug", category: "functional" }],
        raw_text: "Functional\nP1\nStatus : New\nType : Bug",
        html_content: "<html><body>Test</body></html>",
        timestamp: new Date().toISOString()
    };

    console.log('Inserting:', JSON.stringify(data, null, 2));
    const { error } = await supabase.from('reports').insert([data]);
    if (error) {
        console.error('Error:', JSON.stringify(error, null, 2));
    } else {
        console.log('Success!');
    }
}

test();
