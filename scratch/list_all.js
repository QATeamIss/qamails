const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listAll() {
    const { data: reports, error } = await supabase
        .from('reports')
        .select('id, project_name, timestamp, qa_name');
    
    if (error) {
        console.error('Error:', error);
    } else {
        console.log(`Found ${reports.length} reports.`);
        reports.forEach(r => {
            console.log(`${r.timestamp} | ${r.project_name} | ${r.qa_name}`);
        });
    }
}

listAll();
