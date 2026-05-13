const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.from('reports').select('*').limit(5);
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Data:', JSON.stringify(data, null, 2));
    }
}

check();
