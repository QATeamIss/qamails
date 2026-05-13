-- Run this in your Supabase SQL Editor to setup the database
CREATE TABLE reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_name TEXT NOT NULL,
    phase TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    qa_name TEXT,
    total_issues INTEGER DEFAULT 0,
    severity_breakdown JSONB,
    bugs JSONB,
    raw_text TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    html_content TEXT
);

-- Enable RLS (Optional but recommended)
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all access for now (using service role key in code)
CREATE POLICY "Allow all access" ON reports FOR ALL USING (true);
