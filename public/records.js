let allProjectsTree = {};
let filteredProjectsArray = [];
let currentPage = 1;
const projectsPerPage = 12;

document.addEventListener('DOMContentLoaded', () => {
    loadArchives();

    // Search logic
    const searchInput = document.getElementById('reportSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            handleSearch(e.target.value);
        });
    }

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
        });

        analysisTabBtn.addEventListener('click', () => {
            analysisTabBtn.classList.add('active');
            archiveTabBtn.classList.remove('active');
            analysisSection.style.display = 'block';
            archivesSection.style.display = 'none';
            loadRepeatedAnalysis();
        });
    }

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
        allProjectsTree = await response.json();
        handleSearch(''); // Initialize view
    } catch (error) {
        grid.innerHTML = '<div class="error">Failed to load archives.</div>';
    }
}

function handleSearch(query) {
    const q = query.toLowerCase();
    
    // Filter projects: either project name matches OR any report within matches
    filteredProjectsArray = Object.entries(allProjectsTree).filter(([projectName, phases]) => {
        if (projectName.toLowerCase().includes(q)) return true;
        
        // Check if any report inside contains the query (QA Name or Content placeholder)
        return Object.values(phases).some(reports => 
            reports.some(r => 
                r.qaName.toLowerCase().includes(q) || 
                (r.totalIssues && r.totalIssues.toString().includes(q))
            )
        );
    });

    currentPage = 1;
    renderGrid();
}

function renderGrid() {
    const grid = document.getElementById('recordsGrid');
    if (!grid) return;

    const start = (currentPage - 1) * projectsPerPage;
    const end = start + projectsPerPage;
    const paginated = filteredProjectsArray.slice(start, end);

    if (paginated.length === 0) {
        grid.innerHTML = '<div class="no-records">No matching records found.</div>';
        renderPagination(0);
        return;
    }

    grid.innerHTML = '';
    paginated.forEach(([projectName, phases]) => {
        const folder = document.createElement('div');
        folder.className = 'project-folder';
        folder.innerHTML = `
            <span class="folder-icon">📁</span>
            <span class="project-name">${projectName.replace(/_/g, ' ')}</span>
        `;
        
        const phaseList = document.createElement('div');
        phaseList.className = 'phase-list';
        
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
                                    <div>👤 ${r.qaName}</div>
                                    <div>🐞 ${r.totalIssues} Issues</div>
                                </div>
                                <button class="btn-view-bugs" onclick="viewBugs('${projectName}', '${phase}', '${r.id}')">View Report</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        phaseList.innerHTML = phasesHtml;
        
        folder.onclick = (e) => {
            // Close other active folders first for clean accordion look
            document.querySelectorAll('.project-folder.active').forEach(f => {
                if (f !== folder) {
                    f.classList.remove('active');
                    f.nextElementSibling.style.display = 'none';
                }
            });

            const isActive = folder.classList.toggle('active');
            phaseList.style.display = isActive ? 'grid' : 'none';
        };

        grid.appendChild(folder);
        grid.appendChild(phaseList);
    });

    renderPagination(filteredProjectsArray.length);
}

function renderPagination(totalItems) {
    const container = document.getElementById('pagination');
    if (!container) return;

    const totalPages = Math.ceil(totalItems / projectsPerPage);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = `
        <button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">Prev</button>
    `;

    for (let i = 1; i <= totalPages; i++) {
        html += `
            <button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>
        `;
    }

    html += `
        <button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">Next</button>
    `;

    container.innerHTML = html;
}

function changePage(page) {
    currentPage = page;
    renderGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

async function viewBugs(project, phase, id) {
    const modal = document.getElementById('bugModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    
    if (!modal || !modalBody) return;

    modalTitle.innerText = `${project.replace(/_/g, ' ')} - ${phase.replace(/_/g, ' ')}`;
    modalBody.innerHTML = '<div class="loader"></div>';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    try {
        const response = await fetch(`/api/records/${id}`);
        const data = await response.json();
        
        if (data.htmlContent) {
            // Use an iframe to safely render the report and avoid style leaks
            modalBody.innerHTML = `
                <iframe id="reportFrame" style="width:100%; height:75vh; border:none; background:white; border-radius:8px;"></iframe>
            `;
            const frame = document.getElementById('reportFrame');
            const doc = frame.contentWindow.document;
            doc.open();
            doc.write(data.htmlContent);
            doc.close();
        } else {
            modalBody.innerHTML = '<div class="error">Report content not found.</div>';
        }
    } catch (error) {
        modalBody.innerHTML = '<div class="error">Failed to load report details.</div>';
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
