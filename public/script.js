// Tab Switching Logic
const dailyTabBtn = document.getElementById('dailyTabBtn');
const weeklyTabBtn = document.getElementById('weeklyTabBtn');
const dailySection = document.getElementById('dailySection');
const weeklySection = document.getElementById('weeklySection');

if (dailyTabBtn && weeklyTabBtn) {
    dailyTabBtn.addEventListener('click', () => switchTab('daily'));
    weeklyTabBtn.addEventListener('click', () => switchTab('weekly'));
}

function switchTab(tab) {
    if (tab === 'daily') {
        dailyTabBtn.classList.add('active');
        weeklyTabBtn.classList.remove('active');
        dailySection.style.display = 'block';
        weeklySection.style.display = 'none';
    } else {
        weeklyTabBtn.classList.add('active');
        dailyTabBtn.classList.remove('active');
        weeklySection.style.display = 'block';
        dailySection.style.display = 'none';
    }
}

// Weekly Report Generation
const generateWeeklyBtn = document.getElementById('generateWeeklyBtn');
if (generateWeeklyBtn) {
    generateWeeklyBtn.addEventListener('click', async () => {
        const fromDate = document.getElementById('weeklyFrom').value;
        const toDate = document.getElementById('weeklyTo').value;

        if (!fromDate || !toDate) {
            showStatus('Please select both From and To dates.', 'error');
            return;
        }

        try {
            generateWeeklyBtn.disabled = true;
            generateWeeklyBtn.innerText = '⌛ Generating...';
            
            const response = await fetch('/api/weekly-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fromDate, toDate })
            });

            const result = await response.json();

            if (response.ok) {
                document.getElementById('reportPreview').innerHTML = result.reportContent;
                document.getElementById('previewSection').style.display = 'block';
                document.getElementById('previewSection').scrollIntoView({ behavior: 'smooth' });
                showStatus('Weekly report generated successfully!', 'success');
            } else {
                showStatus(result.error || 'Failed to generate weekly report.', 'error');
            }
        } catch (err) {
            showStatus('Error connecting to server.', 'error');
        } finally {
            generateWeeklyBtn.disabled = false;
            generateWeeklyBtn.innerText = '📊 Generate Weekly Report';
        }
    });
}

// Daily Report Generation
const reportForm = document.getElementById('reportForm');
if (reportForm) {
    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById('submitBtn');
        const btnText = submitBtn.querySelector('.btn-text');
        const loader = submitBtn.querySelector('.loader');
        
        const payload = {
            projectName: document.getElementById('projectName').value,
            phase: document.getElementById('phase').value,
            startDate: document.getElementById('startDate').value,
            endDate: document.getElementById('endDate').value,
            qaName: document.getElementById('qaName').value,
            bugList: document.getElementById('bugList').value
        };

        try {
            submitBtn.disabled = true;
            btnText.innerText = 'Generating...';
            loader.style.display = 'block';

            const response = await fetch('/api/generate-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (response.ok) {
                document.getElementById('reportPreview').innerHTML = result.reportContent;
                document.getElementById('previewSection').style.display = 'block';
                document.getElementById('previewSection').scrollIntoView({ behavior: 'smooth' });
                showStatus('Report generated and saved to archives!', 'success');
            } else {
                const errorMsg = result.error || 'Failed to generate report.';
                const debugInfo = result.debug ? '\n\nDebug Info: ' + (typeof result.debug === 'object' ? JSON.stringify(result.debug, null, 2) : result.debug) : '';
                showStatus(errorMsg + debugInfo, 'error');
            }
        } catch (err) {
            showStatus('Error connecting to server.', 'error');
        } finally {
            submitBtn.disabled = false;
            btnText.innerText = 'Generate & Save Report';
            loader.style.display = 'none';
        }
    });
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('statusMessage');
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = `status-message ${type}`;
    statusDiv.style.display = 'block';
    
    // Auto-hide only for success messages, keep errors visible for investigation
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
}

const copyBtn = document.getElementById('copyBtn');
if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
        const reportPreview = document.getElementById('reportPreview');
        
        try {
            const blob = new Blob([reportPreview.innerHTML], { type: 'text/html' });
            const data = [new ClipboardItem({ 'text/html': blob, 'text/plain': new Blob([reportPreview.innerText], { type: 'text/plain' }) })];
            await navigator.clipboard.write(data);
            
            const originalText = copyBtn.innerText;
            copyBtn.innerText = '✅ Copied!';
            setTimeout(() => {
                copyBtn.innerText = originalText;
            }, 2000);
        } catch (err) {
            console.error('Clipboard error:', err);
            try {
                await navigator.clipboard.writeText(reportPreview.innerText);
                alert('Rich copy failed, but plain text was copied to clipboard!');
            } catch (e) {
                alert('Failed to copy. Please select the text and copy manually.');
            }
        }
    });
}
