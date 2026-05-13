document.addEventListener('DOMContentLoaded', () => {
    loadArchives();

    // Tab Switching
    const archiveTabBtn = document.getElementById('archiveTabBtn');
    const analysisTabBtn = document.getElementById('analysisTabBtn');
    const archivesSection = document.getElementById('archivesSection');
    const analysisSection = document.getElementById('analysisSection');

    if (archiveTabBtn && analysisTabBtn) {
        archiveTabBtn.addEventListener('click', () => {
            archiveTabBtn.classList.add('active');
            analysisTabBtn.classList.remove('active');
            archivesSection.style.display = 'block';
            analysisSection.style.display = 'none';
            loadArchives();
        });

        analysisTabBtn.addEventListener('click', () => {
            analysisTabBtn.classList.add('active');
            archiveTabBtn.classList.remove('active');
            analysisSection.style.display = 'block';
            archivesSection.style.display = 'none';
            loadRepeatedAnalysis();
        });
    }

    // Modal Close
    const closeBtn = document.getElementById('closeModal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
});

async function loadArchives() {
    const grid = document.getElementById('recordsGrid');
    if (!grid) return;

    try {
        const response = await fetch('/api/records');
        const tree = await response.json();
        
        if (Object.keys(tree).length === 0) {
            grid.innerHTML = '<div class="no-records">No records found. Generate a report first!</div>';
            return;
        }

        grid.innerHTML = '';
        for (const [project, phases] of Object.entries(tree)) {
            const projectEl = document.createElement('div');
            projectEl.className = 'project-folder';
            
            let phasesHtml = '';
            for (const [phase, reports] of Object.entries(phases)) {
                phasesHtml += `
                    <div class="phase-item">
                        <div class="phase-header">${phase.replace(/_/g, ' ')}</div>
                        <div class="reports-list">
                            ${reports.map(r => `
                                <div class="report-card">
                                    <div class="report-meta">
                                        <div>📅 ${new Date(r.timestamp).toLocaleDateString()}</div>
                                        <div>🕒 ${new Date(r.timestamp).toLocaleTimeString()}</div>
                                        <div>👤 ${r.qaName}</div>
                                        <div>🐞 ${r.totalIssues} Issues</div>
                                    </div>
                                    <button class="btn-view-bugs" onclick="viewBugs('${project}', '${phase}', '${r.id}')">View Details</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            projectEl.innerHTML = `
                <div class="folder-header">
                    <span class="folder-icon">📂</span>
                    <span class="project-name">${project.replace(/_/g, ' ')}</span>
                </div>
                <div class="phase-list">${phasesHtml}</div>
            `;
            grid.appendChild(projectEl);
        }
    } catch (error) {
        grid.innerHTML = '<div class="error">Failed to load archives.</div>';
    }
}

async function viewBugs(project, phase, id) {
    try {
        const response = await fetch(`/api/records/${project}/${phase}/${id}`);
        const data = await response.json();
        
        document.getElementById('mProject').textContent = data.projectName;
        document.getElementById('mPhase').textContent = data.phase;
        document.getElementById('rawBugs').textContent = data.rawText;
        
        document.getElementById('bugModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    } catch (error) {
        alert('Failed to load bug details');
    }
}

async function loadRepeatedAnalysis() {
    const list = document.getElementById('repeatedBugsList');
    if (!list) return;

    list.innerHTML = '<div class="loader"></div>';
    
    try {
        const response = await fetch('/api/find-repeated');
        const repeats = await response.json();
        
        if (repeats.length === 0) {
            list.innerHTML = '<div class="no-records">No repeating bugs detected! Great job!</div>';
            return;
        }

        list.innerHTML = repeats.map(r => `
            <div class="repeated-card">
                <div class="bug-title-warning">
                    ⚠️ ${r.title} <span class="count-badge">${r.count} times</span>
                </div>
                <div class="occurrences">
                    ${r.occurrences.map(occ => `
                        <div class="occurrence-item">
                            📍 ${occ.project} (${occ.phase}) - ${new Date(occ.date).toLocaleDateString()}
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = '<div class="error">Failed to run analysis.</div>';
    }
}

function closeModal() {
    document.getElementById('bugModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

window.onclick = function(event) {
    const modal = document.getElementById('bugModal');
    if (event.target == modal) {
        closeModal();
    }
}
