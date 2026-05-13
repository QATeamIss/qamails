const http = require('http');

const data = JSON.stringify({
    projectName: "Quantum Industries",
    phase: "Dev Test",
    startDate: "2026-05-13",
    endDate: "2026-05-13",
    qaName: "Abhiram",
    bugList: "Issue 1\nP1\nStatus : New\nType : Bug"
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
    let responseBody = '';
    console.log('Status Code:', res.statusCode);
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => {
        console.log('Response Body:', responseBody);
    });
});

req.on('error', (err) => {
    console.error('Error:', err.message);
});

req.write(data);
req.end();
