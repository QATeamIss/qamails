const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listReports() {
    console.log('Listing last 5 reports...');
    const { data: reports, error } = await supabase
        .from('reports')
        .select('id, project_name, timestamp, qa_name, total_issues')
        .order('timestamp', { ascending: false })
        .limit(5);
    
    if (error) {
        console.error('Error:', error);
    } else {
        console.log(JSON.stringify(reports, null, 2));
    }
}

listReports();
