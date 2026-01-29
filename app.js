/**
 * Magic Swiss Tournament Monte Carlo Simulator
 * Main Application Logic
 */

// ============================================================================
// Global State
// ============================================================================

let metagameData = null;
let matchupData = null;
let simulationWorker = null;
let simulationResults = null;
let winThresholds = [9, 10, 11, 12];
let charts = { win: null, top8: null };

// ============================================================================
// Toy Data for Testing
// ============================================================================

const TOY_METAGAME = `archetype,meta_pct,draw_pct,skill_adj
Mono Red Aggro,18.5,1.5,0
Azorius Control,14.2,9.8,0.02
Golgari Midrange,12.8,4.5,0
Boros Convoke,11.5,2.0,-0.01
Dimir Midrange,10.3,5.5,0.01
Esper Legends,8.7,6.2,0.015
Domain Ramp,7.5,3.8,0
Selesnya Enchantments,6.8,3.0,0
Rakdos Sacrifice,5.4,4.0,0
Gruul Aggro,4.3,2.2,-0.02`;

const TOY_MATCHUPS = `,Mono Red Aggro,Azorius Control,Golgari Midrange,Boros Convoke,Dimir Midrange,Esper Legends,Domain Ramp,Selesnya Enchantments,Rakdos Sacrifice,Gruul Aggro
Mono Red Aggro,50,42,48,52,45,43,58,55,47,51
Azorius Control,58,50,52,55,48,51,45,53,54,56
Golgari Midrange,52,48,50,54,52,49,55,51,48,53
Boros Convoke,48,45,46,50,44,42,52,49,45,50
Dimir Midrange,55,52,48,56,50,53,50,54,52,55
Esper Legends,57,49,51,58,47,50,48,52,50,54
Domain Ramp,42,55,45,48,50,52,50,47,53,46
Selesnya Enchantments,45,47,49,51,46,48,53,50,44,48
Rakdos Sacrifice,53,46,52,55,48,50,47,56,50,52
Gruul Aggro,49,44,47,50,45,46,54,52,48,50`;

// ============================================================================
// File Parsing
// ============================================================================

/**
 * Detect if values are in 0-100 scale or 0-1 scale
 */
function detectScale(values) {
    const numericValues = values.filter(v => typeof v === 'number' && !isNaN(v) && v !== 0);
    if (numericValues.length === 0) return 1;

    const maxVal = Math.max(...numericValues);
    const avgVal = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

    // If max > 1 or average > 1, assume 0-100 scale
    if (maxVal > 1 || avgVal > 1) {
        return 100;
    }
    return 1;
}

/**
 * Normalize percentage value to 0-1 range
 */
function normalizePercent(value, scale) {
    if (typeof value !== 'number' || isNaN(value)) return null;
    return scale === 100 ? value / 100 : value;
}

/**
 * Clamp value between 0 and 1
 */
function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Parse CSV text using PapaParse
 */
function parseCSV(text) {
    const result = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        transformHeader: h => h.trim().toLowerCase()
    });

    if (result.errors.length > 0) {
        console.warn('CSV parsing warnings:', result.errors);
    }

    return result.data;
}

/**
 * Parse XLSX file using SheetJS
 */
function parseXLSX(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet, { defval: null });

    // Normalize headers to lowercase
    return data.map(row => {
        const normalized = {};
        for (const key of Object.keys(row)) {
            normalized[key.trim().toLowerCase()] = row[key];
        }
        return normalized;
    });
}

/**
 * Read and parse file (CSV or XLSX)
 */
async function parseFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    if (extension === 'csv') {
        const text = await file.text();
        return parseCSV(text);
    } else if (['xlsx', 'xls'].includes(extension)) {
        const buffer = await file.arrayBuffer();
        return parseXLSX(buffer);
    }

    throw new Error(`Unsupported file format: ${extension}`);
}

// ============================================================================
// Metagame Data Processing
// ============================================================================

function processMetagameData(rawData) {
    const warnings = [];

    // Find archetype column
    const archetypeKey = Object.keys(rawData[0] || {}).find(k =>
        ['archetype', 'deck', 'name', 'deck_name', 'deckname'].includes(k)
    );

    if (!archetypeKey) {
        throw new Error('Missing archetype column. Expected: archetype, deck, or name');
    }

    // Find meta_pct column
    const metaKey = Object.keys(rawData[0] || {}).find(k =>
        ['meta_pct', 'metapct', 'meta', 'meta_percent', 'metashare', 'meta_share', 'share', 'percentage', 'pct'].includes(k)
    );

    if (!metaKey) {
        throw new Error('Missing meta_pct column. Expected: meta_pct, meta, or share');
    }

    // Find draw_pct column (optional)
    const drawKey = Object.keys(rawData[0] || {}).find(k =>
        ['draw_pct', 'drawpct', 'draw', 'draw_percent', 'draw_rate', 'drawrate'].includes(k)
    );

    // Find skill_adj column (optional)
    const skillKey = Object.keys(rawData[0] || {}).find(k =>
        ['skill_adj', 'skilladj', 'skill', 'skill_adjustment', 'pilot_skill'].includes(k)
    );

    // Detect scales
    const metaValues = rawData.map(r => r[metaKey]).filter(v => v != null);
    const metaScale = detectScale(metaValues);

    let drawScale = 1;
    if (drawKey) {
        const drawValues = rawData.map(r => r[drawKey]).filter(v => v != null);
        drawScale = detectScale(drawValues);
    }

    // Process rows
    const decks = [];
    let totalMeta = 0;

    for (const row of rawData) {
        const archetype = String(row[archetypeKey] || '').trim();
        if (!archetype) continue;

        const metaPct = normalizePercent(row[metaKey], metaScale);
        if (metaPct === null || metaPct <= 0) {
            warnings.push(`Skipping ${archetype}: invalid meta_pct`);
            continue;
        }

        const drawPct = drawKey ? (normalizePercent(row[drawKey], drawScale) || 0.03) : 0.03;
        const skillAdj = skillKey ? (parseFloat(row[skillKey]) || 0) : 0;

        decks.push({
            archetype,
            meta_pct: metaPct,
            draw_pct: clamp(drawPct, 0, 0.5),
            skill_adj: clamp(skillAdj, -0.5, 0.5)
        });

        totalMeta += metaPct;
    }

    // Normalize meta_pct to sum to 1.0
    if (totalMeta > 0) {
        for (const deck of decks) {
            deck.meta_pct = deck.meta_pct / totalMeta;
        }
    }

    return { decks, warnings };
}

// ============================================================================
// Matchup Matrix Processing
// ============================================================================

function processMatchupData(rawData, archetypes) {
    const warnings = [];
    const matrix = {};

    // Initialize matrix with defaults
    for (const a of archetypes) {
        matrix[a] = {};
        for (const b of archetypes) {
            matrix[a][b] = a === b ? 0.5 : null; // Mirror = 0.5
        }
    }

    // Parse first row to get column names (opponent decks)
    const firstRow = rawData[0] || {};
    const columns = Object.keys(firstRow);

    // Find the row identifier column (usually first or named 'deck', 'archetype', etc.)
    const rowKey = columns.find(k =>
        ['', 'deck', 'archetype', 'name', 'vs', 'player', 'row'].includes(k.toLowerCase())
    ) || columns[0];

    // Get opponent columns (all except the row identifier)
    const opponentCols = columns.filter(c => c !== rowKey);

    // Create column mapping (normalize names)
    const colToArchetype = {};
    for (const col of opponentCols) {
        const normalized = col.trim();
        const match = archetypes.find(a =>
            a.toLowerCase() === normalized.toLowerCase() ||
            a.toLowerCase().includes(normalized.toLowerCase()) ||
            normalized.toLowerCase().includes(a.toLowerCase())
        );
        if (match) {
            colToArchetype[col] = match;
        } else {
            warnings.push(`Unknown column archetype: ${col}`);
        }
    }

    // Detect scale from all win rate values
    const allWinRates = [];
    for (const row of rawData) {
        for (const col of opponentCols) {
            const val = row[col];
            if (typeof val === 'number' && !isNaN(val)) {
                allWinRates.push(val);
            }
        }
    }
    const winScale = detectScale(allWinRates);

    // Process each row
    for (const row of rawData) {
        const rowName = String(row[rowKey] || '').trim();
        if (!rowName) continue;

        // Find matching archetype
        const playerDeck = archetypes.find(a =>
            a.toLowerCase() === rowName.toLowerCase() ||
            a.toLowerCase().includes(rowName.toLowerCase()) ||
            rowName.toLowerCase().includes(a.toLowerCase())
        );

        if (!playerDeck) {
            warnings.push(`Unknown row archetype: ${rowName}`);
            continue;
        }

        // Process matchups
        for (const col of opponentCols) {
            const opponentDeck = colToArchetype[col];
            if (!opponentDeck) continue;

            const rawValue = row[col];
            if (rawValue === null || rawValue === undefined || rawValue === '') continue;

            const winPct = normalizePercent(parseFloat(rawValue), winScale);
            if (winPct !== null) {
                matrix[playerDeck][opponentDeck] = clamp(winPct, 0, 1);
            }
        }
    }

    // Fill in missing matchups with weighted average fallback
    for (const player of archetypes) {
        for (const opponent of archetypes) {
            if (matrix[player][opponent] === null) {
                // Calculate average winrate vs meta
                const avgWr = calculateFallbackWinrate(matrix, player, opponent, archetypes);
                matrix[player][opponent] = avgWr;
                warnings.push(`Fallback matchup ${player} vs ${opponent}: ${(avgWr * 100).toFixed(1)}%`);
            }
        }
    }

    return { matrix, warnings };
}

function calculateFallbackWinrate(matrix, player, opponent, archetypes) {
    // Try to use known matchups to estimate
    const knownVsOpponent = [];
    const knownForPlayer = [];

    for (const a of archetypes) {
        if (matrix[a] && matrix[a][opponent] !== null && a !== player) {
            knownVsOpponent.push(matrix[a][opponent]);
        }
        if (matrix[player] && matrix[player][a] !== null && a !== opponent) {
            knownForPlayer.push(matrix[player][a]);
        }
    }

    // Use average of player's known winrates and average vs opponent
    let fallback = 0.5;
    if (knownForPlayer.length > 0 && knownVsOpponent.length > 0) {
        const avgPlayerWr = knownForPlayer.reduce((a, b) => a + b) / knownForPlayer.length;
        const avgVsOpponent = knownVsOpponent.reduce((a, b) => a + b) / knownVsOpponent.length;
        fallback = (avgPlayerWr + (1 - avgVsOpponent)) / 2;
    } else if (knownForPlayer.length > 0) {
        fallback = knownForPlayer.reduce((a, b) => a + b) / knownForPlayer.length;
    } else if (knownVsOpponent.length > 0) {
        fallback = 1 - (knownVsOpponent.reduce((a, b) => a + b) / knownVsOpponent.length);
    }

    return clamp(fallback, 0.05, 0.95);
}

// ============================================================================
// File Upload Handlers
// ============================================================================

async function handleMetagameUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showError('');
        const rawData = await parseFile(file);
        const result = processMetagameData(rawData);

        metagameData = result.decks;

        updateMetagameStatus(true, `Loaded ${metagameData.length} decks from ${file.name}`);

        if (result.warnings.length > 0) {
            showWarning(result.warnings.join('\n'));
        }

        validateData();
    } catch (error) {
        showError(`Metagame file error: ${error.message}`);
        updateMetagameStatus(false, error.message);
    }
}

async function handleMatchupUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showError('');

        if (!metagameData || metagameData.length === 0) {
            throw new Error('Please load metagame data first');
        }

        const rawData = await parseFile(file);
        const archetypes = metagameData.map(d => d.archetype);
        const result = processMatchupData(rawData, archetypes);

        matchupData = result.matrix;

        updateMatchupStatus(true, `Loaded matchups from ${file.name}`);

        if (result.warnings.length > 0) {
            showWarning(result.warnings.slice(0, 10).join('\n') +
                (result.warnings.length > 10 ? `\n...and ${result.warnings.length - 10} more` : ''));
        }

        validateData();
    } catch (error) {
        showError(`Matchup file error: ${error.message}`);
        updateMatchupStatus(false, error.message);
    }
}

function parseMetagamePaste() {
    const text = document.getElementById('metagamePaste').value.trim();
    if (!text) return;

    try {
        showError('');
        const rawData = parseCSV(text);
        const result = processMetagameData(rawData);

        metagameData = result.decks;

        updateMetagameStatus(true, `Loaded ${metagameData.length} decks from paste`);

        if (result.warnings.length > 0) {
            showWarning(result.warnings.join('\n'));
        }

        validateData();
    } catch (error) {
        showError(`Metagame parse error: ${error.message}`);
    }
}

function parseMatchupPaste() {
    const text = document.getElementById('matchupPaste').value.trim();
    if (!text) return;

    try {
        showError('');

        if (!metagameData || metagameData.length === 0) {
            throw new Error('Please load metagame data first');
        }

        const rawData = parseCSV(text);
        const archetypes = metagameData.map(d => d.archetype);
        const result = processMatchupData(rawData, archetypes);

        matchupData = result.matrix;

        updateMatchupStatus(true, 'Loaded matchups from paste');

        if (result.warnings.length > 0) {
            showWarning(result.warnings.slice(0, 10).join('\n'));
        }

        validateData();
    } catch (error) {
        showError(`Matchup parse error: ${error.message}`);
    }
}

// ============================================================================
// Toy Data Loaders
// ============================================================================

function loadToyMetagame() {
    document.getElementById('metagamePaste').value = TOY_METAGAME;
    parseMetagamePaste();
}

function loadToyMatchups() {
    document.getElementById('matchupPaste').value = TOY_MATCHUPS;
    parseMatchupPaste();
}

// ============================================================================
// UI Helpers
// ============================================================================

function updateMetagameStatus(success, message) {
    const zone = document.getElementById('metagameUpload');
    const status = document.getElementById('metagameStatus');

    zone.classList.toggle('loaded', success);
    status.textContent = message;
}

function updateMatchupStatus(success, message) {
    const zone = document.getElementById('matchupUpload');
    const status = document.getElementById('matchupStatus');

    zone.classList.toggle('loaded', success);
    status.textContent = message;
}

function showError(message) {
    const el = document.getElementById('errorMessage');
    el.textContent = message;
    el.classList.toggle('active', !!message);
}

function showWarning(message) {
    const el = document.getElementById('warningMessage');
    el.textContent = message;
    el.classList.toggle('active', !!message);
}

function validateData() {
    const runBtn = document.getElementById('runBtn');

    if (metagameData && metagameData.length > 0 && matchupData) {
        runBtn.disabled = false;
    } else {
        runBtn.disabled = true;
    }
}

// ============================================================================
// Threshold Management
// ============================================================================

function addThreshold() {
    const input = document.getElementById('newThreshold');
    const value = parseInt(input.value);

    if (isNaN(value) || value < 0 || value > 20) return;
    if (winThresholds.includes(value)) return;

    winThresholds.push(value);
    winThresholds.sort((a, b) => a - b);
    renderThresholds();
    input.value = '';
}

function removeThreshold(value) {
    winThresholds = winThresholds.filter(t => t !== value);
    renderThresholds();
}

function renderThresholds() {
    const container = document.getElementById('thresholdsConfig');
    const input = container.querySelector('.threshold-input');
    const addBtn = container.querySelector('.btn');

    // Remove old tags
    container.querySelectorAll('.threshold-tag').forEach(t => t.remove());

    // Add new tags before input
    for (const t of winThresholds) {
        const tag = document.createElement('div');
        tag.className = 'threshold-tag';
        tag.dataset.value = t;
        tag.innerHTML = `≥${t} <button onclick="removeThreshold(${t})">×</button>`;
        container.insertBefore(tag, input);
    }
}

// ============================================================================
// Drag and Drop
// ============================================================================

function setupDragDrop() {
    ['metagameUpload', 'matchupUpload'].forEach(id => {
        const zone = document.getElementById(id);

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('dragover');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');

            const file = e.dataTransfer.files[0];
            if (!file) return;

            if (id === 'metagameUpload') {
                handleMetagameUpload({ target: { files: [file] } });
            } else {
                handleMatchupUpload({ target: { files: [file] } });
            }
        });
    });
}

// ============================================================================
// Simulation
// ============================================================================

function runSimulation() {
    if (!metagameData || !matchupData) {
        showError('Please load both metagame and matchup data');
        return;
    }

    // Get parameters
    const numPlayers = parseInt(document.getElementById('numPlayers').value) || 800;
    const numRounds = parseInt(document.getElementById('numRounds').value) || 14;
    const numTrials = parseInt(document.getElementById('numTrials').value) || 100000;
    const seed = document.getElementById('seed').value ? parseInt(document.getElementById('seed').value) : null;
    const cutTop8 = document.getElementById('cutTop8').checked;

    // Validate
    if (numPlayers < 8 || numPlayers > 10000) {
        showError('Players must be between 8 and 10000');
        return;
    }
    if (numRounds < 1 || numRounds > 20) {
        showError('Rounds must be between 1 and 20');
        return;
    }
    if (numTrials < 100 || numTrials > 1000000) {
        showError('Trials must be between 100 and 1,000,000');
        return;
    }

    // Prepare data for worker
    const simConfig = {
        metagame: metagameData,
        matchups: matchupData,
        numPlayers,
        numRounds,
        numTrials,
        seed,
        cutTop8,
        thresholds: winThresholds
    };

    // UI state
    document.getElementById('runBtn').classList.add('hidden');
    document.getElementById('cancelBtn').classList.remove('hidden');
    document.getElementById('progressContainer').classList.add('active');
    document.getElementById('resultsSection').classList.remove('active');
    showError('');
    showWarning('');

    // Create worker
    simulationWorker = new Worker('worker.js');

    simulationWorker.onmessage = (e) => {
        const { type, data } = e.data;

        switch (type) {
            case 'progress':
                updateProgress(data.completed, data.total);
                break;

            case 'complete':
                simulationResults = data;
                showResults(data);
                cleanupWorker();
                break;

            case 'error':
                showError(`Simulation error: ${data.message}`);
                cleanupWorker();
                break;
        }
    };

    simulationWorker.onerror = (error) => {
        showError(`Worker error: ${error.message}`);
        cleanupWorker();
    };

    // Start simulation
    simulationWorker.postMessage({ type: 'start', config: simConfig });
}

function cancelSimulation() {
    if (simulationWorker) {
        simulationWorker.terminate();
        cleanupWorker();
        showWarning('Simulation cancelled');
    }
}

function cleanupWorker() {
    if (simulationWorker) {
        simulationWorker.terminate();
        simulationWorker = null;
    }

    document.getElementById('runBtn').classList.remove('hidden');
    document.getElementById('cancelBtn').classList.add('hidden');
    document.getElementById('progressContainer').classList.remove('active');
}

function updateProgress(completed, total) {
    const pct = (completed / total) * 100;
    document.getElementById('progressFill').style.width = `${pct}%`;
    document.getElementById('progressText').textContent =
        `Running trial ${completed.toLocaleString()} of ${total.toLocaleString()} (${pct.toFixed(1)}%)`;
}

// ============================================================================
// Results Display
// ============================================================================

function showResults(results) {
    const section = document.getElementById('resultsSection');
    section.classList.add('active');

    // Summary stats
    const summaryHtml = `
        <div class="stat-card">
            <div class="value">${results.trials.toLocaleString()}</div>
            <div class="label">Trials Run</div>
        </div>
        <div class="stat-card">
            <div class="value">${results.config.numPlayers}</div>
            <div class="label">Players/Tournament</div>
        </div>
        <div class="stat-card">
            <div class="value">${results.config.numRounds}</div>
            <div class="label">Swiss Rounds</div>
        </div>
        <div class="stat-card">
            <div class="value">${results.decks.length}</div>
            <div class="label">Decks Analyzed</div>
        </div>
    `;
    document.getElementById('summaryStats').innerHTML = summaryHtml;

    // Build table
    renderResultsTable(results);

    // Charts
    renderCharts(results);

    // Scroll to results
    section.scrollIntoView({ behavior: 'smooth' });
}

function renderResultsTable(results, sortKey = 'pWin', sortDesc = true) {
    const header = document.getElementById('tableHeader');
    const body = document.getElementById('tableBody');

    // Define columns
    const columns = [
        { key: 'deck', label: 'Deck', format: v => v },
        { key: 'pWin', label: 'P(Win)', format: v => (v * 100).toFixed(3) + '%' },
        { key: 'pTop8', label: 'P(Top 8)', format: v => (v * 100).toFixed(2) + '%' },
        { key: 'avgPoints', label: 'Avg Points', format: v => v.toFixed(2) },
        { key: 'expectedMW', label: 'Expected MW%', format: v => (v * 100).toFixed(1) + '%' },
        { key: 'mostCommonRecord', label: 'Common Record', format: v => v }
    ];

    // Add threshold columns
    for (const t of results.thresholds) {
        columns.push({
            key: `p${t}Wins`,
            label: `P(≥${t}W)`,
            format: v => (v * 100).toFixed(2) + '%'
        });
    }

    // Build header
    header.innerHTML = columns.map(col => `
        <th data-key="${col.key}" class="${sortKey === col.key ? 'sorted' : ''}"
            onclick="sortResultsTable('${col.key}')">
            ${col.label}
            <span class="sort-indicator">${sortKey === col.key ? (sortDesc ? '▼' : '▲') : '○'}</span>
        </th>
    `).join('');

    // Sort data
    const sortedDecks = [...results.decks].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];

        if (typeof aVal === 'string') {
            return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        }
        return sortDesc ? bVal - aVal : aVal - bVal;
    });

    // Build rows
    body.innerHTML = sortedDecks.map(deck => `
        <tr>
            ${columns.map(col => `
                <td class="${col.key === 'deck' ? 'deck-name' : ''}">
                    ${col.format(deck[col.key])}
                </td>
            `).join('')}
        </tr>
    `).join('');

    // Store current sort state
    body.dataset.sortKey = sortKey;
    body.dataset.sortDesc = sortDesc;
}

function sortResultsTable(key) {
    const body = document.getElementById('tableBody');
    const currentKey = body.dataset.sortKey;
    const currentDesc = body.dataset.sortDesc === 'true';

    const newDesc = key === currentKey ? !currentDesc : true;
    renderResultsTable(simulationResults, key, newDesc);
}

function renderCharts(results) {
    const decks = results.decks.slice(0, 15); // Top 15 for readability

    const labels = decks.map(d => d.deck);
    const winData = decks.map(d => d.pWin * 100);
    const top8Data = decks.map(d => d.pTop8 * 100);

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false }
        },
        scales: {
            x: {
                ticks: {
                    color: '#a0a0a0',
                    maxRotation: 45,
                    minRotation: 45
                },
                grid: { color: 'rgba(255,255,255,0.1)' }
            },
            y: {
                ticks: { color: '#a0a0a0' },
                grid: { color: 'rgba(255,255,255,0.1)' }
            }
        }
    };

    // Win chart
    if (charts.win) charts.win.destroy();
    charts.win = new Chart(document.getElementById('winChart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: winData,
                backgroundColor: 'rgba(233, 69, 96, 0.8)',
                borderColor: 'rgba(233, 69, 96, 1)',
                borderWidth: 1
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: {
                    ...chartOptions.scales.y,
                    title: { display: true, text: 'P(Win) %', color: '#a0a0a0' }
                }
            }
        }
    });

    // Top 8 chart
    if (charts.top8) charts.top8.destroy();
    charts.top8 = new Chart(document.getElementById('top8Chart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: top8Data,
                backgroundColor: 'rgba(74, 222, 128, 0.8)',
                borderColor: 'rgba(74, 222, 128, 1)',
                borderWidth: 1
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: {
                    ...chartOptions.scales.y,
                    title: { display: true, text: 'P(Top 8) %', color: '#a0a0a0' }
                }
            }
        }
    });
}

// ============================================================================
// Export Functions
// ============================================================================

function downloadCSV() {
    if (!simulationResults) return;

    const columns = [
        'deck', 'pWin', 'pTop8', 'avgPoints', 'expectedMW', 'mostCommonRecord',
        ...simulationResults.thresholds.map(t => `p${t}Wins`)
    ];

    const headers = [
        'Deck', 'P(Win Tournament)', 'P(Top 8)', 'Avg Points', 'Expected MW%', 'Most Common Record',
        ...simulationResults.thresholds.map(t => `P(>=${t} Wins)`)
    ];

    let csv = headers.join(',') + '\n';

    for (const deck of simulationResults.decks) {
        const row = columns.map(col => {
            const val = deck[col];
            if (typeof val === 'string') return `"${val}"`;
            return val;
        });
        csv += row.join(',') + '\n';
    }

    downloadFile(csv, 'simulation_results.csv', 'text/csv');
}

function downloadJSON() {
    if (!simulationResults) return;

    const json = JSON.stringify(simulationResults, null, 2);
    downloadFile(json, 'simulation_results.json', 'application/json');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    setupDragDrop();
    renderThresholds();
    validateData();
});
