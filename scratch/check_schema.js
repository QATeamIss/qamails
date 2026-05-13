const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('Checking columns for table "reports"...');
    const { data, error } = await supabase.rpc('get_table_columns', { table_name: 'reports' });
    
    if (error) {
        // RPC might not exist, try a direct query to information_schema
        console.log('RPC failed, trying information_schema...');
        const { data: cols, error: err2 } = await supabase
            .from('reports')
            .select('*')
            .limit(1);
        
        if (err2) {
            console.error('Error fetching data:', err2);
        } else {
            console.log('Successfully fetched one row. Columns present:');
            if (cols.length > 0) {
                console.log(Object.keys(cols[0]));
            } else {
                console.log('Table is empty, cannot infer columns from select *');
            }
        }
    } else {
        console.log('Columns:', data);
    }
}

checkSchema();
