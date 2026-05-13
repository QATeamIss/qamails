

// Actually, I'll just use a small node script with http.request
const http = require('http');

const data = JSON.stringify({
    projectName: "Test Project",
    phase: "Dev Test",
    startDate: "12 May 2026",
    endDate: "13 May 2026",
    qaName: "Tester",
    bugList: "Issue 1\nP1\nType: Bug\nCategory: Functional\nThis is a test bug."
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/generate-report',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Body:', body);
    });
});

req.on('error', (e) => {
    console.error('Error:', e.message);
});

req.write(data);
req.end();
