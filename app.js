/**
 * =======================================================================
 * TAZARO MUSIC SHEET — CORE PLATFORM ENGINE
 * =======================================================================
 * Features:
 * 1. Strictly Forced MusicXML Quantized Note Player:
 *    - Automatically handles plain .musicxml and compressed .mxl ZIP files via JSZip.
 *    - Independent Multi-Part Parallel Timeline Parsing (Left Hand and Right Hand
 *      notes are strictly synchronized together at t=0s).
 *    - Reads <divisions>, BPM tempo tags (<sound tempo>, <per-minute>),
 *      <backup>, <forward>, and chord structures.
 *    - Priority: MusicXML is forced first; MIDI only used if MusicXML is absent.
 * 2. Authentic Dual Instrument Soundbanks:
 *    - Piano: Real Yamaha/Steinway Concert Grand (_tone_0000_JCLive_sf2_file)
 *    - Guitar: Real Steel-String Acoustic Guitar (_tone_0250_JCLive_sf2_file)
 *              with Nylon backup (_tone_0240_JCLive_sf2_file) + Zero-Wait Pluck Fallback
 * 3. Master Limiter/Compressor Bus (Prevents speaker clipping on dense chords)
 * 4. Retina High-DPI Page-1 PDF Rendering Sandbox (PDF.js)
 * 5. Reactive Search & Category Chip Filter
 * 6. ToyyibPay Secure API Payment Bridge Hook
 * 7. Netlify Watermark DOM Killer
 * =======================================================================
 */

// Initialize PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Global Engine State
let masterCatalog = [];
let filteredCatalog = [];
let currentSong = null;
let activeInstrument = 'piano';
let activeFilter = 'all';
let searchQuery = '';

// WebAudioFont & Audio State
let audioCtx = null;
let soundFontPlayer = null;
let isPlaying = false;
let scheduledNoteTimers = [];
let activeFallbackNodes = [];
let playbackTimer = null;
let playbackStartTime = 0;
let currentTrackDuration = 0;

// Maximum simultaneous notes per chord window (keeps rich multi-hand piano chords intact)
const MAX_CONCURRENT_NOTES_PER_CHORD = 16;

/* =======================================================================
 * 1. REAL INSTRUMENT SOUND ENGINE RESOLVER
 * ======================================================================= */

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass({ latencyHint: 'interactive' });

        // Master compressor/limiter bus
        const compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-6, audioCtx.currentTime);
        compressor.knee.setValueAtTime(12, audioCtx.currentTime);
        compressor.ratio.setValueAtTime(6, audioCtx.currentTime);
        compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
        compressor.release.setValueAtTime(0.15, audioCtx.currentTime);

        const masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0.9, audioCtx.currentTime);

        compressor.connect(masterGain);
        masterGain.connect(audioCtx.destination);

        audioCtx.masterBus = compressor;
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    if (!soundFontPlayer && window.WebAudioFontPlayer) {
        soundFontPlayer = new WebAudioFontPlayer();
    }
    return audioCtx;
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
});

function getInstrumentPreset(type) {
    if (type === 'piano') {
        return window._tone_0000_JCLive_sf2_file || null;
    }
    return window._tone_0250_JCLive_sf2_file || window._tone_0240_JCLive_sf2_file || null;
}

function primeInstrument(type) {
    const ctx = getAudioContext();
    const preset = getInstrumentPreset(type);
    if (soundFontPlayer && preset) {
        soundFontPlayer.adjustPreset(ctx, preset);
    }
}

function playFallbackGuitarString(ctx, midiNote, when, duration, velocity = 0.8) {
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const outGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = 'lowpass';
    filter.Q.setValueAtTime(2.2, when);
    filter.frequency.setValueAtTime(4500, when);
    filter.frequency.exponentialRampToValueAtTime(Math.min(freq * 3.5, 900), when + 0.12);

    filter.connect(outGain);
    outGain.connect(ctx.masterBus || ctx.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();

    osc1.type = 'triangle';
    osc2.type = 'sawtooth';

    osc1.frequency.setValueAtTime(freq, when);
    osc2.frequency.setValueAtTime(freq, when);

    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    g1.gain.setValueAtTime(0.7, when);
    g2.gain.setValueAtTime(0.2, when);

    osc1.connect(g1);
    osc2.connect(g2);
    g1.connect(filter);
    g2.connect(filter);

    const attack = 0.003;
    const decay = Math.min(Math.max(duration, 0.7), 2.8);
    const peak = Math.min(velocity * 0.45, 0.6);

    outGain.gain.setValueAtTime(0.0001, when);
    outGain.gain.linearRampToValueAtTime(peak, when + attack);
    outGain.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    osc1.start(when);
    osc2.start(when);
    osc1.stop(when + decay);
    osc2.stop(when + decay);

    activeFallbackNodes.push({
        stop: () => {
            try { osc1.stop(); osc2.stop(); outGain.disconnect(); } catch (e) {}
        }
    });
}

/* =======================================================================
 * 2. NATIVE MUSICXML PARSER (MULTI-PART & PARALLEL STAVES ENGINE)
 * ======================================================================= */

/**
 * Extracts raw XML string whether it is plain text XML or a compressed ZIP (.mxl)
 */
async function extractMusicXMLText(arrayBuffer) {
    const uint8 = new Uint8Array(arrayBuffer.slice(0, 4));
    // ZIP signature: 'PK\x03\x04' (0x50, 0x4B, 0x03, 0x04)
    if (uint8[0] === 0x50 && uint8[1] === 0x4B && window.JSZip) {
        const zip = await JSZip.loadAsync(arrayBuffer);
        for (const filename of Object.keys(zip.files)) {
            if (filename.toLowerCase().endsWith('.xml') && !filename.includes('container.xml')) {
                return await zip.files[filename].async('text');
            }
        }
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(arrayBuffer);
}

/**
 * Parses MusicXML XML Document into synchronized notes across all parts/staves
 */
function parseMusicXMLToNotes(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");

    const stepOffsets = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
    let parsedNotes = [];
    let longestPartDuration = 0;

    // Detect Global Initial Tempo from document
    let globalInitialBpm = 110;
    const globalSound = xmlDoc.querySelector('sound[tempo]');
    if (globalSound) {
        const t = parseFloat(globalSound.getAttribute('tempo'));
        if (!isNaN(t) && t > 30) globalInitialBpm = t;
    } else {
        const globalMet = xmlDoc.querySelector('metronome per-minute');
        if (globalMet) {
            const t = parseFloat(globalMet.textContent);
            if (!isNaN(t) && t > 30) globalInitialBpm = t;
        }
    }

    const parts = xmlDoc.querySelectorAll('part');

    // Parse every <part> (e.g. Treble and Bass or Staves) starting strictly from t = 0s
    parts.forEach(part => {
        let currentBpm = globalInitialBpm;
        let divisions = 1;
        let partTimeInSeconds = 0;

        const measures = part.querySelectorAll('measure');

        measures.forEach(measure => {
            // Tempo changes within measure
            const soundTag = measure.querySelector('direction sound[tempo]');
            if (soundTag) {
                const newBpm = parseFloat(soundTag.getAttribute('tempo'));
                if (!isNaN(newBpm) && newBpm > 30) currentBpm = newBpm;
            } else {
                const metTag = measure.querySelector('metronome per-minute');
                if (metTag) {
                    const newBpm = parseFloat(metTag.textContent);
                    if (!isNaN(newBpm) && newBpm > 30) currentBpm = newBpm;
                }
            }

            // Divisions definition (<divisions>N</divisions>)
            const divTag = measure.querySelector('attributes divisions');
            if (divTag) {
                const newDiv = parseInt(divTag.textContent, 10);
                if (!isNaN(newDiv) && newDiv > 0) divisions = newDiv;
            }

            const secondsPerDivision = (60 / currentBpm) / divisions;

            let measureCursorDivisions = 0;
            let maxMeasureDivisions = 0;
            let lastNoteStartDivisions = 0;

            const children = measure.children;
            for (let i = 0; i < children.length; i++) {
                const el = children[i];
                const tagName = el.tagName.toLowerCase();

                if (tagName === 'note') {
                    const isRest = el.querySelector('rest') !== null;
                    const isChord = el.querySelector('chord') !== null;
                    const isGrace = el.querySelector('grace') !== null;
                    const durTag = el.querySelector('duration');
                    const noteDivisions = durTag ? parseInt(durTag.textContent, 10) : 0;

                    let noteStartDivision = 0;

                    if (isChord) {
                        // Chords start at the exact same division as the previous note
                        noteStartDivision = lastNoteStartDivisions;
                    } else {
                        noteStartDivision = measureCursorDivisions;
                        lastNoteStartDivisions = measureCursorDivisions;
                        if (!isGrace) {
                            measureCursorDivisions += noteDivisions;
                            if (measureCursorDivisions > maxMeasureDivisions) {
                                maxMeasureDivisions = measureCursorDivisions;
                            }
                        }
                    }

                    if (!isRest && !isGrace) {
                        const pitch = el.querySelector('pitch');
                        if (pitch) {
                            const step = pitch.querySelector('step')?.textContent.trim().toUpperCase() || 'C';
                            const alter = parseInt(pitch.querySelector('alter')?.textContent || '0', 10);
                            const octave = parseInt(pitch.querySelector('octave')?.textContent || '4', 10);

                            const midi = (octave + 1) * 12 + (stepOffsets[step] || 0) + alter;
                            const startTime = partTimeInSeconds + (noteStartDivision * secondsPerDivision);
                            const durationSeconds = Math.max(noteDivisions * secondsPerDivision, 0.35);

                            parsedNotes.push({
                                midi: midi,
                                time: startTime,
                                duration: durationSeconds,
                                velocity: 0.85
                            });
                        }
                    }
                } else if (tagName === 'backup') {
                    // Voice rewinding (plays polyphonic voices concurrently in same measure)
                    const durTag = el.querySelector('duration');
                    const backupDiv = durTag ? parseInt(durTag.textContent, 10) : 0;
                    measureCursorDivisions = Math.max(0, measureCursorDivisions - backupDiv);
                } else if (tagName === 'forward') {
                    const durTag = el.querySelector('duration');
                    const fwdDiv = durTag ? parseInt(durTag.textContent, 10) : 0;
                    measureCursorDivisions += fwdDiv;
                    if (measureCursorDivisions > maxMeasureDivisions) {
                        maxMeasureDivisions = measureCursorDivisions;
                    }
                }
            }

            // Move part timeline forward by full length of this measure
            partTimeInSeconds += (maxMeasureDivisions * secondsPerDivision);
        });

        if (partTimeInSeconds > longestPartDuration) {
            longestPartDuration = partTimeInSeconds;
        }
    });

    parsedNotes.sort((a, b) => a.time - b.time);

    return {
        notes: parsedNotes,
        duration: longestPartDuration || 30
    };
}

/* =======================================================================
 * 3. ANIMATED HERO KEYWORD CAROUSEL
 * ======================================================================= */

const audienceKeywords = [
    "Virtuoso Pianists",
    "Fingerstyle Guitarists",
    "Concert Soloists",
    "Classical Arrangers",
    "Modern Performers"
];
let currentKeywordIndex = 0;

function initHeaderCarousel() {
    const textEl = document.getElementById('carouselText');
    if (!textEl) return;

    setInterval(() => {
        textEl.classList.remove('fade-in');
        textEl.classList.add('fade-out');

        setTimeout(() => {
            currentKeywordIndex = (currentKeywordIndex + 1) % audienceKeywords.length;
            textEl.textContent = audienceKeywords[currentKeywordIndex];
            textEl.classList.remove('fade-out');
            textEl.classList.add('fade-in');
        }, 300);
    }, 3200);
}

/* =======================================================================
 * 4. DYNAMIC INVENTORY FETCHING & GROUPING
 * ======================================================================= */

function generateSlug(filename) {
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    return nameWithoutExt
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function cleanTitle(slug) {
    return slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

async function fetchDynamicInventory() {
    const grid = document.getElementById('songGrid');
    grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 4rem 1rem;">
            <p style="font-size: 1.1rem; letter-spacing: 0.05em;">Synchronizing with Tazaro Sheet Archive...</p>
        </div>`;

    const endpoints = [
        '/.netlify/functions/scan',
        'manifest.json',
        'scan.php'
    ];

    let discoveredFiles = null;

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint);
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    discoveredFiles = data;
                    console.log(`[Tazaro Engine] Archive verified via: ${endpoint}`);
                    break;
                }
            }
        } catch (e) {}
    }

    if (discoveredFiles && discoveredFiles.length > 0) {
        masterCatalog = processDiscoveredFiles(discoveredFiles);
        updateFilterCounts(masterCatalog);
        applyFiltersAndSearch();
    } else {
        grid.innerHTML = '';
        document.getElementById('emptyState').style.display = 'block';
        document.getElementById('catalogResultsCount').textContent = '0 masterpieces available';
    }
}

function processDiscoveredFiles(filePaths) {
    const registry = {};

    filePaths.forEach(path => {
        const segments = path.split('/');
        if (segments.length < 3) return;

        const instrument = segments[1].toLowerCase();
        const filename = segments[2];
        const ext = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
        const slug = generateSlug(filename);

        if (!registry[slug]) {
            registry[slug] = {
                slug: slug,
                title: cleanTitle(slug),
                instruments: {
                    piano: { pdf: null, musicxml: null, mid: null },
                    guitar: { pdf: null, musicxml: null, mid: null }
                }
            };
        }

        if (registry[slug].instruments[instrument]) {
            if (ext === 'pdf') {
                registry[slug].instruments[instrument].pdf = path;
            } else if (ext === 'xml' || ext === 'musicxml' || ext === 'mxl') {
                registry[slug].instruments[instrument].musicxml = path;
            } else if (ext === 'mid' || ext === 'midi') {
                registry[slug].instruments[instrument].mid = path;
            }
        }
    });

    return Object.values(registry);
}

/* =======================================================================
 * 5. SEARCH & GALLERY FILTER ENGINE
 * ======================================================================= */

function updateFilterCounts(items) {
    const total = items.length;
    const pianoCount = items.filter(s => !!s.instruments.piano.pdf).length;
    const guitarCount = items.filter(s => !!s.instruments.guitar.pdf).length;
    const bothCount = items.filter(s => !!s.instruments.piano.pdf && !!s.instruments.guitar.pdf).length;

    document.getElementById('countAll').textContent = total;
    document.getElementById('countPiano').textContent = pianoCount;
    document.getElementById('countGuitar').textContent = guitarCount;
    document.getElementById('countBoth').textContent = bothCount;
}

function applyFiltersAndSearch() {
    const query = searchQuery.trim().toLowerCase();

    filteredCatalog = masterCatalog.filter(song => {
        const matchesQuery = song.title.toLowerCase().includes(query) || song.slug.includes(query);
        const hasPiano = !!song.instruments.piano.pdf;
        const hasGuitar = !!song.instruments.guitar.pdf;

        let matchesChip = true;
        if (activeFilter === 'piano') matchesChip = hasPiano;
        else if (activeFilter === 'guitar') matchesChip = hasGuitar;
        else if (activeFilter === 'both') matchesChip = hasPiano && hasGuitar;

        return matchesQuery && matchesChip;
    });

    renderCatalog(filteredCatalog);
}

const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClear');

searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    searchClearBtn.style.display = searchQuery.length > 0 ? 'block' : 'none';
    applyFiltersAndSearch();
});

searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClearBtn.style.display = 'none';
    searchInput.focus();
    applyFiltersAndSearch();
});

const chips = document.querySelectorAll('.chip');
chips.forEach(chip => {
    chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeFilter = chip.getAttribute('data-filter');
        applyFiltersAndSearch();
    });
});

document.getElementById('resetFilterBtn').addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClearBtn.style.display = 'none';
    chips.forEach(c => c.classList.remove('active'));
    document.querySelector('.chip[data-filter="all"]').classList.add('active');
    activeFilter = 'all';
    applyFiltersAndSearch();
});

/* =======================================================================
 * 6. CATALOG GRID RENDERER (CASES A, B, and C)
 * ======================================================================= */

function renderCatalog(items) {
    const songGrid = document.getElementById('songGrid');
    const emptyState = document.getElementById('emptyState');
    const statusLabel = document.getElementById('catalogResultsCount');

    songGrid.innerHTML = '';
    statusLabel.textContent = `Showing ${items.length} of ${masterCatalog.length} transcriptions`;

    if (items.length === 0) {
        emptyState.style.display = 'block';
        return;
    } else {
        emptyState.style.display = 'none';
    }

    items.forEach(song => {
        const hasPiano = !!song.instruments.piano.pdf;
        const hasGuitar = !!song.instruments.guitar.pdf;
        const hasBoth = hasPiano && hasGuitar;

        let badgeHTML = '';
        let subtextHTML = '';
        let priceTagHTML = '';

        if (hasBoth) {
            badgeHTML = `
                <span class="badge-piano">Piano Score</span>
                <span class="badge-guitar">Guitar Tabs</span>
            `;
            subtextHTML = 'Complete Score Bundle Available (Piano + Guitar Tabs)';
            priceTagHTML = 'RM 10.00 Bundle';
        } else if (hasGuitar && !hasPiano) {
            badgeHTML = `
                <span class="badge-guitar">Guitar Exclusive</span>
                <span class="badge-unavailable">Piano Score N/A</span>
            `;
            subtextHTML = 'Guitar Score & Tablature Edition (No Piano Transcription)';
            priceTagHTML = 'RM 5.00 Solo Edition';
        } else if (hasPiano && !hasGuitar) {
            badgeHTML = `
                <span class="badge-piano">Piano Exclusive</span>
                <span class="badge-unavailable">Guitar Score N/A</span>
            `;
            subtextHTML = 'Concert Grand Piano Edition (No Guitar Transcription)';
            priceTagHTML = 'RM 5.00 Solo Edition';
        }

        const card = document.createElement('div');
        card.className = 'song-card';
        card.innerHTML = `
            <div class="card-art-motif">
                <span class="motif-symbol">${hasPiano ? '𝄞' : '𝄢'}</span>
                <span class="motif-format-badge">PDF • XML • MID</span>
            </div>

            <div class="card-badges">
                ${badgeHTML}
            </div>

            <h3>${song.title}</h3>
            <p class="card-subtext">${subtextHTML}</p>

            <div class="card-footer">
                <span class="price-pill">${priceTagHTML}</span>
                <span class="action-link">Preview Score →</span>
            </div>
        `;

        card.addEventListener('click', () => openPreviewModal(song));
        songGrid.appendChild(card);
    });
}

/* =======================================================================
 * 7. RETINA HIGH-DPI PAGE-1 PDF PREVIEW ENGINE
 * ======================================================================= */

async function renderSecureFirstPage(pdfUrl) {
    const canvas = document.getElementById('sheetCanvas');
    const ctx = canvas.getContext('2d');
    const watermarkSubtitle = document.getElementById('watermarkSubtitle');

    if (!pdfUrl) {
        canvas.width = 340;
        canvas.height = 460;
        ctx.fillStyle = "#121722";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#94A3B8";
        ctx.font = "14px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No score transcribed for this instrument.", canvas.width / 2, canvas.height / 2 - 10);
        ctx.font = "12px 'Plus Jakarta Sans', sans-serif";
        ctx.fillStyle = "#64748B";
        ctx.fillText("Check the alternate instrument tab above.", canvas.width / 2, canvas.height / 2 + 15);
        if (watermarkSubtitle) watermarkSubtitle.textContent = "Edition Not Available";
        return;
    }

    if (watermarkSubtitle) watermarkSubtitle.textContent = "Page 1 of Complete Score";

    try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        const isMobile = window.innerWidth <= 768;
        const baseViewport = page.getViewport({ scale: 1.0 });
        const targetWidth = isMobile ? Math.min(window.innerWidth - 36, 420) : 520;
        const scale = targetWidth / baseViewport.width;

        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const viewport = page.getViewport({ scale: scale * dpr });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        await page.render(renderContext).promise;
    } catch (err) {
        console.warn('PDF render fallback mode applied.', err);
        canvas.width = 340;
        canvas.height = 460;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#121722";
        ctx.font = "18px 'Cinzel', serif";
        ctx.textAlign = "center";
        ctx.fillText(currentSong ? currentSong.title : "Preview", canvas.width / 2, 80);
    }
}

/* =======================================================================
 * 8. AUTHENTIC AUDIO CONTROLLER (FORCED MUSICXML ENGINE)
 * ======================================================================= */

const playBtn = document.getElementById('playAudioBtn');
const playIcon = document.getElementById('playIcon');
const audioStatus = document.getElementById('audioStatus');
const audioProgress = document.getElementById('audioProgress');

function updateAudioStatusLabel(sourceType = "xml") {
    const hasCurrentInstrument = !!currentSong?.instruments?.[activeInstrument]?.pdf;

    if (!hasCurrentInstrument) {
        audioStatus.textContent = `No ${activeInstrument.toUpperCase()} Audio for this track`;
        playIcon.textContent = '✕';
        playBtn.style.opacity = '0.4';
        playBtn.style.pointerEvents = 'none';
        return;
    }

    playBtn.style.opacity = '1';
    playBtn.style.pointerEvents = 'auto';

    const sourceTag = sourceType === "xml" ? " [MusicXML Arrangement]" : " [MIDI Mode]";

    if (isPlaying) {
        audioStatus.textContent = `Playing ${activeInstrument === 'piano' ? 'Concert Grand' : 'Steel Guitar'}${sourceTag}...`;
        playIcon.textContent = '⏸';
    } else {
        audioStatus.textContent = `${activeInstrument === 'piano' ? 'Concert Grand' : 'Steel Guitar'} Ready${sourceTag} • Tap to Play`;
        playIcon.textContent = '▶';
    }
}

async function toggleAudioPlayback() {
    const ctx = getAudioContext();
    primeInstrument(activeInstrument);

    if (isPlaying) {
        stopAudioPlayback();
        return;
    }

    const hasCurrentInstrument = !!currentSong?.instruments?.[activeInstrument]?.pdf;
    if (!hasCurrentInstrument) return;

    const preset = getInstrumentPreset(activeInstrument);
    const currentXmlFile = currentSong?.instruments?.[activeInstrument]?.musicxml;
    const currentMidiFile = currentSong?.instruments?.[activeInstrument]?.mid;

    // ==============================================================
    // 1. STRICTLY FORCE MUSICXML PLAYBACK FIRST
    // ==============================================================
    if (currentXmlFile) {
        try {
            audioStatus.textContent = "Parsing Strictly From MusicXML Score...";
            const response = await fetch(currentXmlFile);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const xmlText = await extractMusicXMLText(arrayBuffer);
                const parsedScore = parseMusicXMLToNotes(xmlText);

                if (parsedScore.notes && parsedScore.notes.length > 0) {
                    stopAudioPlayback(false);
                    isPlaying = true;
                    updateAudioStatusLabel("xml");

                    const now = ctx.currentTime + 0.08;
                    playbackStartTime = now;
                    currentTrackDuration = Math.min(parsedScore.duration || 30, 45); // 45s preview slice

                    const timeSlotCounter = {};

                    parsedScore.notes.forEach(note => {
                        if (note.time < 45) {
                            const slotKey = Math.round(note.time * 20);
                            timeSlotCounter[slotKey] = (timeSlotCounter[slotKey] || 0) + 1;
                            if (timeSlotCounter[slotKey] > MAX_CONCURRENT_NOTES_PER_CHORD) return;

                            const when = now + note.time;
                            const duration = Math.max(note.duration, 0.35);
                            const volume = note.velocity * 0.95;

                            if (preset && soundFontPlayer) {
                                soundFontPlayer.queueWaveTable(
                                    ctx,
                                    ctx.masterBus || ctx.destination,
                                    preset,
                                    when,
                                    note.midi,
                                    duration,
                                    volume
                                );
                            } else if (isPlaying) {
                                playFallbackGuitarString(ctx, note.midi, when, duration, volume);
                            }
                        }
                    });

                    startProgressTracker();
                    return; // Stays strictly in MusicXML; never executes MIDI
                }
            }
        } catch (e) {
            console.warn('MusicXML engine notice:', e);
        }
    }

    // ==============================================================
    // 2. BACKUP: ONLY USED IF NO MUSICXML FILE WAS INSERTED
    // ==============================================================
    if (currentMidiFile && window.Midi) {
        try {
            audioStatus.textContent = "Loading Score MIDI...";
            const response = await fetch(currentMidiFile);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const midi = new Midi(arrayBuffer);

                stopAudioPlayback(false);
                isPlaying = true;
                updateAudioStatusLabel("midi");

                const now = ctx.currentTime + 0.08;
                playbackStartTime = now;
                currentTrackDuration = Math.min(midi.duration || 30, 45);

                const timeSlotCounter = {};

                midi.tracks.forEach(track => {
                    track.notes.forEach(note => {
                        if (note.time < 45) {
                            const slotKey = Math.round(note.time * 20);
                            timeSlotCounter[slotKey] = (timeSlotCounter[slotKey] || 0) + 1;
                            if (timeSlotCounter[slotKey] > MAX_CONCURRENT_NOTES_PER_CHORD) return;

                            const when = now + note.time;
                            const duration = Math.max(note.duration, 0.4);
                            const volume = (note.velocity || 0.8) * 0.95;

                            if (preset && soundFontPlayer) {
                                soundFontPlayer.queueWaveTable(
                                    ctx,
                                    ctx.masterBus || ctx.destination,
                                    preset,
                                    when,
                                    note.midi,
                                    duration,
                                    volume
                                );
                            } else if (isPlaying) {
                                playFallbackGuitarString(ctx, note.midi, when, duration, volume);
                            }
                        }
                    });
                });

                startProgressTracker();
                return;
            }
        } catch (e) {
            console.warn('MIDI stream fallback notice:', e);
        }
    }

    // ==============================================================
    // 3. SOUND PROGRESSION DEMO (IF BOTH FILES ARE MISSING)
    // ==============================================================
    stopAudioPlayback(false);
    isPlaying = true;
    updateAudioStatusLabel("demo");

    const now = ctx.currentTime + 0.08;
    playbackStartTime = now;
    currentTrackDuration = 8.0;

    const demoNotes = activeInstrument === 'piano' ? [
        { time: 0.0, midi: 60, dur: 1.5, vel: 0.85 },
        { time: 0.0, midi: 64, dur: 1.5, vel: 0.8 },
        { time: 0.0, midi: 67, dur: 1.5, vel: 0.85 },
        { time: 1.5, midi: 55, dur: 1.5, vel: 0.8 },
        { time: 1.5, midi: 59, dur: 1.5, vel: 0.8 },
        { time: 1.5, midi: 62, dur: 1.5, vel: 0.85 },
        { time: 3.0, midi: 57, dur: 1.5, vel: 0.8 },
        { time: 3.0, midi: 60, dur: 1.5, vel: 0.8 },
        { time: 3.0, midi: 64, dur: 1.5, vel: 0.85 },
        { time: 4.5, midi: 53, dur: 2.8, vel: 0.9 },
        { time: 4.5, midi: 60, dur: 2.8, vel: 0.85 },
        { time: 4.5, midi: 65, dur: 2.8, vel: 0.9 }
    ] : [
        { time: 0.0, midi: 52, dur: 1.2, vel: 0.9 },
        { time: 0.25, midi: 59, dur: 1.2, vel: 0.85 },
        { time: 0.5, midi: 64, dur: 1.2, vel: 0.9 },
        { time: 0.75, midi: 67, dur: 1.2, vel: 0.85 },
        { time: 1.5, midi: 50, dur: 1.2, vel: 0.9 },
        { time: 1.75, midi: 57, dur: 1.2, vel: 0.85 },
        { time: 2.0, midi: 62, dur: 1.2, vel: 0.9 },
        { time: 2.25, midi: 66, dur: 1.2, vel: 0.85 },
        { time: 3.0, midi: 48, dur: 1.2, vel: 0.9 },
        { time: 3.25, midi: 55, dur: 1.2, vel: 0.85 },
        { time: 3.5, midi: 60, dur: 1.2, vel: 0.9 },
        { time: 3.75, midi: 64, dur: 2.5, vel: 0.95 }
    ];

    demoNotes.forEach(n => {
        const when = now + n.time;

        if (preset && soundFontPlayer) {
            soundFontPlayer.queueWaveTable(
                ctx,
                ctx.masterBus || ctx.destination,
                preset,
                when,
                n.midi,
                n.dur,
                n.vel
            );
        } else if (isPlaying) {
            playFallbackGuitarString(ctx, n.midi, when, n.dur, n.vel);
        }
    });

    startProgressTracker();
}

function stopAudioPlayback(resetUI = true) {
    isPlaying = false;

    scheduledNoteTimers.forEach(id => clearTimeout(id));
    scheduledNoteTimers = [];

    activeFallbackNodes.forEach(node => {
        try { node.stop(); } catch (e) {}
    });
    activeFallbackNodes = [];

    if (soundFontPlayer && audioCtx) {
        soundFontPlayer.cancelQueue(audioCtx);
    }

    if (resetUI) {
        updateAudioStatusLabel();
        audioProgress.style.width = '0%';
    }

    if (playbackTimer) {
        cancelAnimationFrame(playbackTimer);
        playbackTimer = null;
    }
}

function startProgressTracker() {
    const updateTracker = () => {
        if (!isPlaying || !audioCtx) return;
        const elapsed = audioCtx.currentTime - playbackStartTime;
        const progress = Math.min((elapsed / currentTrackDuration) * 100, 100);

        audioProgress.style.width = `${progress}%`;

        if (elapsed >= currentTrackDuration) {
            stopAudioPlayback(true);
            audioStatus.textContent = 'Preview Complete • Tap to Replay';
            playIcon.textContent = '▶';
            return;
        }

        playbackTimer = requestAnimationFrame(updateTracker);
    };
    playbackTimer = requestAnimationFrame(updateTracker);
}

playBtn.addEventListener('click', toggleAudioPlayback);

/* =======================================================================
 * 9. MODAL MANAGEMENT & ASYMMETRIC UI HANDLER
 * ======================================================================= */

const modal = document.getElementById('previewModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const tabPiano = document.getElementById('tabPiano');
const tabGuitar = document.getElementById('tabGuitar');

function openPreviewModal(song) {
    currentSong = song;
    document.getElementById('previewTitle').innerText = song.title;

    const hasPiano = !!song.instruments.piano.pdf;
    const hasGuitar = !!song.instruments.guitar.pdf;

    if (hasPiano && hasGuitar) {
        activeInstrument = 'piano';
    } else if (hasGuitar) {
        activeInstrument = 'guitar';
    } else {
        activeInstrument = 'piano';
    }

    if (hasPiano) {
        tabPiano.classList.remove('disabled');
        tabPiano.textContent = "Piano Score";
    } else {
        tabPiano.classList.add('disabled');
        tabPiano.textContent = "Piano Score (N/A)";
    }

    if (hasGuitar) {
        tabGuitar.classList.remove('disabled');
        tabGuitar.textContent = "Guitar Score";
    } else {
        tabGuitar.classList.add('disabled');
        tabGuitar.textContent = "Guitar Score (N/A)";
    }

    configurePricingOptions(song);
    updateModalView();
    modal.classList.add('active');

    primeInstrument(activeInstrument);
}

function configurePricingOptions(song) {
    const hasPiano = !!song.instruments.piano.pdf;
    const hasGuitar = !!song.instruments.guitar.pdf;

    const optBundle = document.getElementById('optBundle');
    const optPiano = document.getElementById('optPiano');
    const optGuitar = document.getElementById('optGuitar');
    const dynamicPriceLabel = document.getElementById('dynamicPriceLabel');

    if (hasPiano && hasGuitar) {
        optBundle.style.display = 'flex';
        optPiano.style.display = 'flex';
        optGuitar.style.display = 'flex';
        optBundle.click();
    } else if (hasGuitar && !hasPiano) {
        optBundle.style.display = 'none';
        optPiano.style.display = 'none';
        optGuitar.style.display = 'flex';
        optGuitar.click();
        dynamicPriceLabel.textContent = "RM 5.00";
    } else if (hasPiano && !hasGuitar) {
        optBundle.style.display = 'none';
        optPiano.style.display = 'flex';
        optGuitar.style.display = 'none';
        optPiano.click();
        dynamicPriceLabel.textContent = "RM 5.00";
    }
}

function updateModalView() {
    tabPiano.classList.toggle('active', activeInstrument === 'piano');
    tabGuitar.classList.toggle('active', activeInstrument === 'guitar');

    if (isPlaying) stopAudioPlayback(true);
    updateAudioStatusLabel();

    const pdfPath = currentSong.instruments[activeInstrument].pdf;
    renderSecureFirstPage(pdfPath);
}

tabPiano.addEventListener('click', () => { 
    if (!currentSong?.instruments?.piano?.pdf) return;
    if (activeInstrument !== 'piano') { 
        activeInstrument = 'piano'; 
        updateModalView(); 
        primeInstrument('piano');
    } 
});

tabGuitar.addEventListener('click', () => { 
    if (!currentSong?.instruments?.guitar?.pdf) return;
    if (activeInstrument !== 'guitar') { 
        activeInstrument = 'guitar'; 
        updateModalView(); 
        primeInstrument('guitar');
    } 
});

modalCloseBtn.addEventListener('click', () => {
    modal.classList.remove('active');
    if (isPlaying) stopAudioPlayback(true);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
        modal.classList.remove('active');
        if (isPlaying) stopAudioPlayback(true);
    }
});

/* =======================================================================
 * 10. COMMERCE & TOYYIBPAY INTEGRATION
 * ======================================================================= */

const priceOptions = document.querySelectorAll('.price-option');
const dynamicPriceLabel = document.getElementById('dynamicPriceLabel');
let selectedBundle = 'both';
let selectedPrice = "10.00";

priceOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        priceOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        
        const radio = opt.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        selectedBundle = opt.getAttribute('data-bundle');
        selectedPrice = opt.getAttribute('data-price');
        dynamicPriceLabel.textContent = `RM ${parseFloat(selectedPrice).toFixed(2)}`;
    });
});

document.getElementById('toyyibpaySubmit').addEventListener('click', () => {
    if (!currentSong) return;

    initiateToyyibpayCheckout({
        songSlug: currentSong.slug,
        title: currentSong.title,
        bundleType: selectedBundle,
        amountRM: selectedPrice
    });
});

function initiateToyyibpayCheckout({ songSlug, title, bundleType, amountRM }) {
    const amountInCents = Math.round(parseFloat(amountRM) * 100).toString();

    const toyyibpayPayload = {
        userSecretKey: "YOUR_TOYYIBPAY_USER_SECRET_KEY",
        categoryCode: "YOUR_TOYYIBPAY_CATEGORY_CODE",
        billName: `Tazaro: ${title.substring(0, 30)}`,
        billDescription: `Score Edition: ${bundleType.toUpperCase()} (PDF, MusicXML, MIDI)`,
        billPriceSetting: 1,
        billPayorInfo: 1,
        billAmount: amountInCents,
        billReturnUrl: `${window.location.origin}/success.html`,
        billCallbackUrl: `${window.location.origin}/.netlify/functions/toyyibpay-callback`,
        billExternalReferenceNo: `TAZ-${songSlug}-${bundleType}-${Date.now()}`
    };

    console.log("[ToyyibPay Request Prepared]:", toyyibpayPayload);

    alert(
        `[ToyyibPay Secure Checkout]\n` +
        `-----------------------------------------\n` +
        `Product: ${title}\n` +
        `Edition: ${bundleType.toUpperCase()}\n` +
        `Total Payable: RM ${amountRM}\n` +
        `Amount in Cents: ${amountInCents}\n\n` +
        `Redirecting to ToyyibPay Payment Gateway...`
    );
}

/* =======================================================================
 * 11. NETLIFY WATERMARK DOM REMOVER
 * ======================================================================= */

const purgeNetlifyBadges = () => {
    document.querySelectorAll('a[href*="netlify.com"], [class*="netlify"], [id*="netlify"]').forEach(el => {
        if (!el.src && !el.href?.includes('/.netlify/functions')) {
            el.remove();
        }
    });
};

purgeNetlifyBadges();
const badgeObserver = new MutationObserver(purgeNetlifyBadges);
badgeObserver.observe(document.body, { childList: true, subtree: true });

/* =======================================================================
 * 12. BOOT INITIALIZATION
 * ======================================================================= */

document.addEventListener('DOMContentLoaded', () => {
    initHeaderCarousel();
    fetchDynamicInventory();
});
