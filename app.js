/**
 * =======================================================================
 * TAZARO MUSIC SHEET — CORE PLATFORM ENGINE
 * =======================================================================
 * Features:
 * 1. 100% Authentic Sampled Acoustic Concert Sound Engine:
 *    - Piano: Real Yamaha/Steinway Concert Grand (_tone_0000_JCLive_sf2_file)
 *    - Guitar: Real Steel-String Acoustic Guitar (_tone_0250_JCLive_sf2_file)
 *    - Pure Acoustic Wavetable Only: Zero synthetic oscillators / zero beeps
 *    - Concert Hall Acoustic Reverb: Authentic live stage resonance & sustain
 *    - Single-Voice Hardware Audio Clock: Zero double-piano / zero echo
 * 2. MusicXML (.mxl) & Master Timeline (.mid) Parser with Tied-Note Filtering
 * 3. Dynamic Global Currency Preview (Auto-detects USD, IDR, SGD, EUR, GBP, AUD)
 * 4. Retina High-DPI Page-1 PDF Rendering (PDF.js)
 * 5. Catalog Grid with Clef Header Sub-Card & Fixed-Size Thumbnails
 * 6. Stripe Hosted Checkout Integration (Cards, Apple Pay, Google Pay, GrabPay)
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

// WebAudioFont & Acoustic Audio State
let audioCtx = null;
let soundFontPlayer = null;
let acousticReverb = null;
let isPlaying = false;
let activeEnvelopes = [];
let playbackTimer = null;
let playbackStartTime = 0;
let currentTrackDuration = 0;

// --- Audio Performance Optimization State (device-aware, no instrument/model changes) ---
// Detects low-power / mobile hardware so voice count and scheduling can be tuned down,
// which is what actually causes crackling, stutter, and dropped notes on phones.
const isMobileDevice = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
let isTogglingAudio = false;                 // debounce guard against double-fire touch/click events
let audioToggleCooldown = false;
let schedulingBatchTimers = [];              // pending setTimeout ids from chunked note scheduling
const instrumentsPreloaded = { piano: false, guitar: false };

// Maximum simultaneous acoustic voices allowed in dense chords to preserve clarity
// Lowered automatically on mobile to prevent the wavetable engine from being overloaded.
const MAX_CONCURRENT_NOTES_PER_CHORD = isMobileDevice ? 7 : 12;

// Hard safety ceiling on total simultaneously-active acoustic voices across the whole
// scheduled preview buffer. Without this, long/dense scores can pile up far more
// simultaneous wavetable voices than any device's audio hardware can cleanly mix,
// which is a common cause of crackling and audio-thread glitches.
const MAX_TOTAL_ACTIVE_VOICES = isMobileDevice ? 24 : 48;

// Exchange Rates & Currency State
const baseExchangeRates = {
    MYR: 1.0,
    USD: 0.23,       // RM 10.00 ≈ $2.30 USD
    IDR: 3550,       // RM 10.00 ≈ Rp 35,500 IDR
    SGD: 0.30,       // RM 10.00 ≈ S$ 3.00 SGD
    EUR: 0.21,       // RM 10.00 ≈ €2.10 EUR
    GBP: 0.18,       // RM 10.00 ≈ £1.80 GBP
    AUD: 0.34        // RM 10.00 ≈ A$ 3.40 AUD
};
let liveExchangeRates = { ...baseExchangeRates };
let activeCurrency = 'USD';

/* ==========================================================
 * 1. REAL CONCERT ACOUSTIC SOUND ENGINE (ZERO OSCILLATORS)
 * ========================================================== */

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
    }

    if (!soundFontPlayer && window.WebAudioFontPlayer) {
        soundFontPlayer = new WebAudioFontPlayer();
    }

    // Live Concert Hall Reverberator (Gives deep, rich, authentic room resonance)
    if (!acousticReverb && soundFontPlayer && audioCtx) {
        try {
            acousticReverb = soundFontPlayer.createReverberator(audioCtx);
            acousticReverb.output.connect(audioCtx.destination);
        } catch (e) {
            acousticReverb = null;
        }
    }

    // Kick off background sample decoding as soon as the engine exists, so the first
    // note played never has to wait on a mid-performance decodeAudioData() call —
    // this is the main source of "laggy/buggy" first-note stutter, especially on phones.
    preloadInstrumentSamples();

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

/**
 * Pre-decodes the concert grand piano and acoustic guitar sample banks ahead of time
 * (instead of letting WebAudioFont decode them lazily, note-by-note, during playback).
 * This is purely a performance optimization — the exact same real sampled instruments
 * (_tone_0000_JCLive_sf2_file / _tone_0250_JCLive_sf2_file) are used, nothing about the
 * sound model itself changes.
 */
function preloadInstrumentSamples() {
    if (!soundFontPlayer || !audioCtx) return;

    ['piano', 'guitar'].forEach(type => {
        if (instrumentsPreloaded[type]) return;

        const preset = getInstrumentPreset(type);
        if (!preset) return;

        try {
            if (soundFontPlayer.loader && typeof soundFontPlayer.loader.decodeAfterLoading === 'function') {
                const varName = type === 'piano'
                    ? '_tone_0000_JCLive_sf2_file'
                    : (window._tone_0250_JCLive_sf2_file ? '_tone_0250_JCLive_sf2_file' : '_tone_0240_JCLive_sf2_file');
                soundFontPlayer.loader.decodeAfterLoading(audioCtx, varName);
            }
            instrumentsPreloaded[type] = true;
        } catch (e) {
            // Non-fatal — playback will simply fall back to on-demand decoding for this preset.
        }
    });
}

function primeInstrument(type) {
    const ctx = getAudioContext();
    const preset = getInstrumentPreset(type);
    if (soundFontPlayer && preset) {
        try {
            if (typeof soundFontPlayer.adjustPreset === 'function') {
                soundFontPlayer.adjustPreset(ctx, preset);
            }
        } catch (e) {}
    }
}

/* ==========================================================
 * 2. NATIVE MUSICXML SCORE PARSER (WITH TIED-NOTE FILTERING)
 * ========================================================== */

async function extractMusicXMLText(arrayBuffer) {
    const uint8 = new Uint8Array(arrayBuffer.slice(0, 4));
    // Check ZIP signature: 'PK\x03\x04'
    if (uint8[0] === 0x50 && uint8[1] === 0x4B && window.JSZip) {
        const zip = await JSZip.loadAsync(arrayBuffer);
        for (const filename of Object.keys(zip.files)) {
            const lower = filename.toLowerCase();
            if ((lower.endsWith('.xml') || lower.endsWith('.musicxml')) && !lower.includes('container.xml')) {
                return await zip.files[filename].async('text');
            }
        }
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(arrayBuffer);
}

function parseMusicXMLToNotes(rawXmlString) {
    const cleanXml = rawXmlString.replace(/<!DOCTYPE[\s\S]*?>/gi, '');

    const parser = new DOMParser();
    let xmlDoc = parser.parseFromString(cleanXml, "text/xml");

    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
        xmlDoc = parser.parseFromString(cleanXml, "text/html");
    }

    const stepOffsets = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
    let parsedNotes = [];
    let longestPartDuration = 0;

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

    let parts = xmlDoc.getElementsByTagName('part');
    if (!parts || parts.length === 0) {
        parts = [xmlDoc];
    }

    Array.from(parts).forEach(part => {
        let currentBpm = globalInitialBpm;
        let divisions = 1;
        let partTimeInSeconds = 0;

        const measures = part.getElementsByTagName('measure');

        Array.from(measures).forEach(measure => {
            const soundTags = measure.getElementsByTagName('sound');
            for (let s of soundTags) {
                const t = parseFloat(s.getAttribute('tempo'));
                if (!isNaN(t) && t > 30) {
                    currentBpm = t;
                    break;
                }
            }

            const metTags = measure.getElementsByTagName('per-minute');
            if (metTags.length > 0) {
                const t = parseFloat(metTags[0].textContent);
                if (!isNaN(t) && t > 30) currentBpm = t;
            }

            const divTags = measure.getElementsByTagName('divisions');
            if (divTags.length > 0) {
                const newDiv = parseInt(divTags[0].textContent, 10);
                if (!isNaN(newDiv) && newDiv > 0) divisions = newDiv;
            }

            const secondsPerDivision = (60 / currentBpm) / divisions;

            let measureCursorDivisions = 0;
            let maxMeasureDivisions = 0;
            let lastNoteStartDivisions = 0;

            const children = Array.from(measure.children || measure.childNodes).filter(n => n.nodeType === 1);

            for (let i = 0; i < children.length; i++) {
                const el = children[i];
                const tagName = (el.localName || el.tagName || '').toLowerCase();

                if (tagName === 'note') {
                    const isRest = el.getElementsByTagName('rest').length > 0;
                    const isChord = el.getElementsByTagName('chord').length > 0;
                    const isGrace = el.getElementsByTagName('grace').length > 0;

                    // FILTER OUT TIED NOTES: Do not re-strike a note tied from the previous measure
                    const tieEls = el.getElementsByTagName('tie');
                    let isTieStop = false;
                    for (let t of tieEls) {
                        if (t.getAttribute('type') === 'stop') isTieStop = true;
                    }

                    const durTags = el.getElementsByTagName('duration');
                    const noteDivisions = durTags.length > 0 ? parseInt(durTags[0].textContent, 10) : 0;

                    let noteStartDivision = 0;

                    if (isChord) {
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

                    if (!isRest && !isGrace && !isTieStop) {
                        const pitchEls = el.getElementsByTagName('pitch');
                        if (pitchEls.length > 0) {
                            const pitch = pitchEls[0];
                            const step = pitch.getElementsByTagName('step')[0]?.textContent.trim().toUpperCase() || 'C';
                            const alter = parseInt(pitch.getElementsByTagName('alter')[0]?.textContent || '0', 10);
                            const octave = parseInt(pitch.getElementsByTagName('octave')[0]?.textContent || '4', 10);

                            const midi = (octave + 1) * 12 + (stepOffsets[step] || 0) + alter;
                            const startTime = partTimeInSeconds + (noteStartDivision * secondsPerDivision);
                            const durationSeconds = Math.max(noteDivisions * secondsPerDivision, 0.45);

                            parsedNotes.push({
                                midi: midi,
                                time: startTime,
                                duration: durationSeconds,
                                velocity: 0.85
                            });
                        }
                    }
                } else if (tagName === 'backup') {
                    const durTags = el.getElementsByTagName('duration');
                    const backupDiv = durTags.length > 0 ? parseInt(durTags[0].textContent, 10) : 0;
                    measureCursorDivisions = Math.max(0, measureCursorDivisions - backupDiv);
                } else if (tagName === 'forward') {
                    const durTags = el.getElementsByTagName('duration');
                    const fwdDiv = durTags.length > 0 ? parseInt(durTags[0].textContent, 10) : 0;
                    measureCursorDivisions += fwdDiv;
                    if (measureCursorDivisions > maxMeasureDivisions) {
                        maxMeasureDivisions = measureCursorDivisions;
                    }
                }
            }

            partTimeInSeconds += (maxMeasureDivisions * secondsPerDivision);
        });

        if (partTimeInSeconds > longestPartDuration) {
            longestPartDuration = partTimeInSeconds;
        }
    });

    parsedNotes.sort((a, b) => a.time - b.time);

    // DEDUPLICATION: Prevents double-striking identical notes at the same timestamp
    const deduplicatedNotes = [];
    const seenNotes = new Set();

    parsedNotes.forEach(n => {
        const timeKey = `${Math.round(n.time * 40)}_${n.midi}`;
        if (!seenNotes.has(timeKey)) {
            seenNotes.add(timeKey);
            deduplicatedNotes.push(n);
        }
    });

    return {
        notes: deduplicatedNotes,
        duration: longestPartDuration || 30
    };
}

/* ==========================================================
 * 3. ANIMATED HERO KEYWORD CAROUSEL
 * ========================================================== */

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

/* ==========================================================
 * 4. DYNAMIC INVENTORY FETCHING & GROUPING
 * ========================================================== */

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
                thumbnail: null,
                instruments: {
                    piano: { pdf: null, musicxml: null, mid: null, image: null },
                    guitar: { pdf: null, musicxml: null, mid: null, image: null }
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
            } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
                registry[slug].instruments[instrument].image = path;
                if (!registry[slug].thumbnail) {
                    registry[slug].thumbnail = path;
                }
            }
        }
    });

    return Object.values(registry);
}

/* ==========================================================
 * 5. SEARCH & GALLERY FILTER ENGINE
 * ========================================================== */

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

/* ==========================================================
 * 6. CATALOG GRID RENDERER
 * ========================================================== */

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

        // Dedicated Cover Thumbnail directly below the motif header
        const thumbnailHTML = song.thumbnail ? `
            <div class="card-thumbnail-box">
                <img src="${song.thumbnail}" 
                     alt="${song.title}" 
                     class="card-thumbnail-img" 
                     loading="lazy" 
                     onerror="this.parentElement.style.display='none'">
            </div>
        ` : '';

        const card = document.createElement('div');
        card.className = 'song-card';
        card.innerHTML = `
            <!-- HEADER SUB-CARD (Treble / Bass Clef & Format Badge Preserved) -->
            <div class="card-art-motif">
                <span class="motif-symbol">${hasPiano ? '𝄞' : '𝄢'}</span>
                <span class="motif-format-badge">PDF • MusicXML</span>
            </div>

            <!-- THUMBNAIL IMAGE (Placed directly below header) -->
            ${thumbnailHTML}

            <!-- CARD BODY & BADGES -->
            <div class="card-badges">
                ${badgeHTML}
            </div>

            <h3>${song.title}</h3>
            <p class="card-subtext">${subtextHTML}</p>

            <!-- CARD FOOTER -->
            <div class="card-footer">
                <span class="price-pill">${priceTagHTML}</span>
                <span class="action-link">Preview Score →</span>
            </div>
        `;

        card.addEventListener('click', () => openPreviewModal(song));
        songGrid.appendChild(card);
    });
}

/* ==========================================================
 * 7. RETINA HIGH-DPI PAGE-1 PDF PREVIEW ENGINE
 * ========================================================== */

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

/* ==========================================================
 * 8. AUTHENTIC AUDIO CONTROLLER (REAL CONCERT INSTRUMENTS ONLY)
 * ========================================================== */

const playBtn = document.getElementById('playAudioBtn');
const playIcon = document.getElementById('playIcon');
const audioStatus = document.getElementById('audioStatus');
const audioProgress = document.getElementById('audioProgress');

function updateAudioStatusLabel() {
    const hasCurrentInstrument = !!currentSong?.instruments?.[activeInstrument]?.pdf;

    if (!hasCurrentInstrument) {
        audioStatus.textContent = `No ${activeInstrument.toUpperCase()} score for this piece`;
        playIcon.textContent = '✕';
        playBtn.style.opacity = '0.4';
        playBtn.style.pointerEvents = 'none';
        return;
    }

    playBtn.style.opacity = '1';
    playBtn.style.pointerEvents = 'auto';

    if (isPlaying) {
        audioStatus.textContent = `Playing ${activeInstrument === 'piano' ? 'Concert Grand Piano HD' : 'Steel Acoustic Guitar'}...`;
        playIcon.textContent = '⏸';
    } else {
        audioStatus.textContent = `${activeInstrument === 'piano' ? 'Concert Grand Piano HD' : 'Steel Acoustic Guitar'} Ready • Tap to Play`;
        playIcon.textContent = '▶';
    }
}

async function toggleAudioPlayback() {
    // Debounce: phones commonly fire both a touch event and a click event for a single tap,
    // which used to double-trigger playback (stacked/overlapping audio = the "buggy" sound).
    if (audioToggleCooldown) return;
    audioToggleCooldown = true;
    setTimeout(() => { audioToggleCooldown = false; }, 250);

    const ctx = getAudioContext();

    // Resume AudioContext inside the user gesture
    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch (e) {}
    }

    primeInstrument(activeInstrument);

    if (isPlaying) {
        stopAudioPlayback(true);
        return;
    }

    const hasCurrentInstrument = !!currentSong?.instruments?.[activeInstrument]?.pdf;
    if (!hasCurrentInstrument) return;

    const currentXmlFile = currentSong?.instruments?.[activeInstrument]?.musicxml;
    const currentMidiFile = currentSong?.instruments?.[activeInstrument]?.mid;

    // 1. MUSICXML / MXL ENGINE
    if (currentXmlFile) {
        try {
            audioStatus.textContent = "Loading Concert Score...";
            const response = await fetch(encodeURI(currentXmlFile));
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const xmlText = await extractMusicXMLText(arrayBuffer);
                const parsedScore = parseMusicXMLToNotes(xmlText);

                if (parsedScore.notes && parsedScore.notes.length > 0) {
                    startScorePlayback(parsedScore.notes, parsedScore.duration);
                    return;
                }
            }
        } catch (e) {
            console.warn('[Audio Engine] Falling back to companion MIDI:', e);
        }
    }

    // 2. MIDI COMPANION ENGINE
    if (currentMidiFile && (window.Midi || window.Tone?.Midi)) {
        try {
            audioStatus.textContent = "Loading Concert Audio...";
            const response = await fetch(encodeURI(currentMidiFile));
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const MidiConstructor = window.Midi?.Midi || window.Midi || window.Tone?.Midi;
                const midi = new MidiConstructor(arrayBuffer);

                const rawNotes = [];
                let longestDur = midi.duration || 30;

                midi.tracks.forEach(track => {
                    if (track.notes && track.notes.length > 0) {
                        track.notes.forEach(n => {
                            rawNotes.push({
                                midi: n.midi,
                                time: n.time,
                                duration: n.duration,
                                velocity: n.velocity || 0.8
                            });
                        });
                    }
                });

                rawNotes.sort((a, b) => a.time - b.time);

                // STRICT MIDI DEDUPLICATION: Prevents duplicate merged tracks
                const deduplicatedNotes = [];
                const seenNotes = new Set();
                rawNotes.forEach(n => {
                    const timeKey = `${Math.round(n.time * 40)}_${n.midi}`;
                    if (!seenNotes.has(timeKey)) {
                        seenNotes.add(timeKey);
                        deduplicatedNotes.push(n);
                    }
                });

                if (deduplicatedNotes.length > 0) {
                    startScorePlayback(deduplicatedNotes, longestDur);
                    return;
                }
            }
        } catch (e) {
            console.warn('[Audio Engine] MIDI fallback note:', e);
        }
    }

    // 3. REAL SAMPLED SOUND PROGRESSION FALLBACK (Strictly Real Instruments)
    const demoNotes = activeInstrument === 'piano' ? [
        { time: 0.0, midi: 60, duration: 1.8, velocity: 0.85 },
        { time: 0.0, midi: 64, duration: 1.8, velocity: 0.8 },
        { time: 0.0, midi: 67, duration: 1.8, velocity: 0.85 },
        { time: 1.5, midi: 55, duration: 1.8, velocity: 0.8 },
        { time: 1.5, midi: 59, duration: 1.8, velocity: 0.8 },
        { time: 1.5, midi: 62, duration: 1.8, velocity: 0.85 },
        { time: 3.0, midi: 57, duration: 1.8, velocity: 0.8 },
        { time: 3.0, midi: 60, duration: 1.8, velocity: 0.8 },
        { time: 3.0, midi: 64, duration: 1.8, velocity: 0.85 },
        { time: 4.5, midi: 53, duration: 2.8, velocity: 0.9 },
        { time: 4.5, midi: 60, duration: 2.8, velocity: 0.85 },
        { time: 4.5, midi: 65, duration: 2.8, velocity: 0.9 }
    ] : [
        { time: 0.0, midi: 52, duration: 1.5, velocity: 0.9 },
        { time: 0.25, midi: 59, duration: 1.5, velocity: 0.85 },
        { time: 0.5, midi: 64, duration: 1.5, velocity: 0.9 },
        { time: 0.75, midi: 67, duration: 1.5, velocity: 0.85 },
        { time: 1.5, midi: 50, duration: 1.5, velocity: 0.9 },
        { time: 1.75, midi: 57, duration: 1.5, velocity: 0.85 },
        { time: 2.0, midi: 62, duration: 1.5, velocity: 0.9 },
        { time: 2.25, midi: 66, duration: 1.5, velocity: 0.85 },
        { time: 3.0, midi: 48, duration: 1.5, velocity: 0.9 },
        { time: 3.25, midi: 55, duration: 1.5, velocity: 0.85 },
        { time: 3.5, midi: 60, duration: 1.5, velocity: 0.9 },
        { time: 3.75, midi: 64, duration: 2.5, velocity: 0.95 }
    ];

    startScorePlayback(demoNotes, 8.0);
}

/**
 * Pure Acoustic Hardware Clock Playback:
 * Sends notes directly into the Real Concert Grand / Real Guitar wavetable
 * through the Concert Hall acoustic reverberator. Zero synthetic oscillators.
 *
 * Optimization: notes are scheduled in small batches (spread across the event loop)
 * instead of one long synchronous loop, and a hard total-voice ceiling is enforced,
 * on top of the existing per-chord cap. Same instrument presets, same per-note
 * volume/duration math — only the scheduling mechanics changed.
 */
function startScorePlayback(notes, duration) {
    const ctx = getAudioContext();
    stopAudioPlayback(false);

    isPlaying = true;
    updateAudioStatusLabel();

    currentTrackDuration = Math.max(Math.min(duration || 30, 45), 5); // 45s preview
    const now = ctx.currentTime + 0.08;
    playbackStartTime = now;

    const preset = getInstrumentPreset(activeInstrument);
    if (!preset || !soundFontPlayer) {
        console.warn('[Audio Engine] Soundfont wavetable preset not ready yet.');
        return;
    }

    const audioDestination = acousticReverb ? acousticReverb.input : (ctx.masterBus || ctx.destination);
    const timeSlotCounter = {};
    let totalVoicesScheduled = 0;

    const notesInWindow = notes.filter(n => n.time < 45);
    const BATCH_SIZE = isMobileDevice ? 16 : 32;

    const scheduleBatch = (startIndex) => {
        if (!isPlaying) return; // playback was stopped while batches were still pending

        const endIndex = Math.min(startIndex + BATCH_SIZE, notesInWindow.length);

        for (let i = startIndex; i < endIndex; i++) {
            const note = notesInWindow[i];

            const slotKey = Math.round(note.time * 20);
            timeSlotCounter[slotKey] = (timeSlotCounter[slotKey] || 0) + 1;
            if (timeSlotCounter[slotKey] > MAX_CONCURRENT_NOTES_PER_CHORD) continue;
            if (totalVoicesScheduled >= MAX_TOTAL_ACTIVE_VOICES) continue;

            const when = now + note.time;
            const naturalAcousticDuration = Math.max(note.duration || 0.8, 1.6);
            const volume = (note.velocity || 0.8) * 0.85;

            try {
                const env = soundFontPlayer.queueWaveTable(
                    ctx,
                    audioDestination,
                    preset,
                    when,
                    note.midi,
                    naturalAcousticDuration,
                    volume
                );
                if (env) {
                    activeEnvelopes.push(env);
                    totalVoicesScheduled++;
                }
            } catch (err) {
                console.warn('[Audio Engine] Wavetable queue error:', err);
            }
        }

        if (endIndex < notesInWindow.length) {
            const timerId = setTimeout(() => scheduleBatch(endIndex), 0);
            schedulingBatchTimers.push(timerId);
        }
    };

    scheduleBatch(0);
    startProgressTracker();
}

function stopAudioPlayback(resetUI = true) {
    isPlaying = false;

    // Cancel any note-scheduling batches still pending from startScorePlayback()
    if (schedulingBatchTimers.length > 0) {
        schedulingBatchTimers.forEach(id => clearTimeout(id));
        schedulingBatchTimers = [];
    }

    // Immediately cancel and release all scheduled acoustic audio envelopes
    if (activeEnvelopes && activeEnvelopes.length > 0) {
        activeEnvelopes.forEach(env => {
            try {
                if (typeof env.cancel === 'function') env.cancel();
            } catch (e) {}
        });
        activeEnvelopes = [];
    }

    if (soundFontPlayer && audioCtx) {
        try {
            soundFontPlayer.cancelQueue(audioCtx);
        } catch (e) {}
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
        const progress = Math.min(Math.max((elapsed / currentTrackDuration) * 100, 0), 100);

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

/* ==========================================================
 * 9. MODAL MANAGEMENT & ASYMMETRIC UI HANDLER
 * ========================================================== */

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

    updateCurrencyPreview();
}

function updateModalView() {
    tabPiano.classList.toggle('active', activeInstrument === 'piano');
    tabGuitar.classList.toggle('active', activeInstrument === 'guitar');

    const pianoSpecCard = document.getElementById('pianoSpecCard');
    if (pianoSpecCard) {
        pianoSpecCard.style.display = (activeInstrument === 'piano') ? 'flex' : 'none';
    }

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

/* ==========================================================
 * 10. COMMERCE, CURRENCY CONVERTER & STRIPE CHECKOUT DISPATCH
 * ========================================================== */

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

        updateCurrencyPreview();
    });
});

/**
 * Intelligent Regional Currency Auto-Detection:
 * Inspects browser timezone to select the most relevant local currency automatically.
 */
function detectUserCurrency() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        if (tz.includes('Jakarta') || tz.includes('Pontianak') || tz.includes('Makassar') || tz.includes('Jayapura')) {
            return 'IDR';
        } else if (tz.includes('Singapore')) {
            return 'SGD';
        } else if (tz.includes('Kuala_Lumpur') || tz.includes('Kuching')) {
            return 'MYR';
        } else if (tz.includes('London')) {
            return 'GBP';
        } else if (tz.includes('Europe') || tz.includes('Paris') || tz.includes('Berlin') || tz.includes('Rome') || tz.includes('Madrid') || tz.includes('Amsterdam')) {
            return 'EUR';
        } else if (tz.includes('Australia') || tz.includes('Sydney') || tz.includes('Melbourne') || tz.includes('Brisbane') || tz.includes('Perth')) {
            return 'AUD';
        } else if (tz.includes('New_York') || tz.includes('Chicago') || tz.includes('Denver') || tz.includes('Los_Angeles') || tz.includes('America')) {
            return 'USD';
        }
    } catch (e) {}
    return 'USD';
}

function updateCurrencyPreview() {
    const convertedLabel = document.getElementById('convertedPriceLabel');
    const baseNotice = document.getElementById('baseCurrencyNotice');
    if (!convertedLabel) return;

    const amountInRM = parseFloat(selectedPrice) || 10.00;
    if (baseNotice) baseNotice.textContent = `RM ${amountInRM.toFixed(2)}`;

    const rate = liveExchangeRates[activeCurrency] || baseExchangeRates[activeCurrency] || 1.0;
    const estimatedValue = amountInRM * rate;

    let formattedString = '';
    switch (activeCurrency) {
        case 'IDR':
            formattedString = `~Rp ${Math.round(estimatedValue).toLocaleString('id-ID')} IDR`;
            break;
        case 'USD':
            formattedString = `~$${estimatedValue.toFixed(2)} USD`;
            break;
        case 'SGD':
            formattedString = `~S$${estimatedValue.toFixed(2)} SGD`;
            break;
        case 'EUR':
            formattedString = `~€${estimatedValue.toFixed(2)} EUR`;
            break;
        case 'GBP':
            formattedString = `~£${estimatedValue.toFixed(2)} GBP`;
            break;
        case 'AUD':
            formattedString = `~A$${estimatedValue.toFixed(2)} AUD`;
            break;
        case 'MYR':
        default:
            formattedString = `RM ${amountInRM.toFixed(2)} MYR`;
            break;
    }

    convertedLabel.textContent = formattedString;
}

// Background rate synchronization (uses open exchange feed with graceful fallback)
async function syncLiveExchangeRates() {
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/MYR');
        if (res.ok) {
            const data = await res.json();
            if (data && data.rates) {
                ['USD', 'IDR', 'SGD', 'EUR', 'GBP', 'AUD'].forEach(curr => {
                    if (data.rates[curr]) {
                        liveExchangeRates[curr] = data.rates[curr];
                    }
                });
                updateCurrencyPreview();
            }
        }
    } catch (e) {}
}

const currencySelect = document.getElementById('currencySelect');
if (currencySelect) {
    activeCurrency = detectUserCurrency();
    currencySelect.value = activeCurrency;
    currencySelect.addEventListener('change', (e) => {
        activeCurrency = e.target.value;
        updateCurrencyPreview();
    });
}

const checkoutBtn = document.getElementById('checkoutSubmit') || document.getElementById('toyyibpaySubmit');
if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
        if (!currentSong) return;

        const payerName = document.getElementById('custName')?.value.trim();
        const payerEmail = document.getElementById('custEmail')?.value.trim();
        const payerPhone = document.getElementById('custPhone')?.value.trim();

        if (!payerEmail) {
            alert("Please provide a valid Email Address to receive your score fulfillment.");
            return;
        }

        initiateStripeCheckout({
            songSlug: currentSong.slug,
            title: currentSong.title,
            bundleType: selectedBundle,
            amountRM: selectedPrice,
            payerName: payerName,
            payerEmail: payerEmail,
            payerPhone: payerPhone
        });
    });
}

async function initiateStripeCheckout({ songSlug, title, bundleType, amountRM, payerName, payerEmail, payerPhone }) {
    const btn = document.getElementById('checkoutSubmit') || document.getElementById('toyyibpaySubmit');
    const originalBtnText = btn.innerHTML;

    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.innerHTML = `<span>Connecting to Secure Checkout...</span><strong>Please wait</strong>`;

    try {
        const response = await fetch('/.netlify/functions/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                songSlug,
                title,
                bundleType,
                amountRM,
                payerName,
                payerEmail,
                payerPhone
            })
        });

        const data = await response.json();

        if (!response.ok || !data.checkoutUrl) {
            throw new Error(data.error || 'Failed to initialize Stripe checkout session.');
        }

        // Direct redirect to Stripe Hosted Checkout
        window.location.href = data.checkoutUrl;

    } catch (err) {
        console.error('[Stripe Error]:', err);
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerHTML = originalBtnText;
        alert(err.message);
    }
}

/* ==========================================================
 * 11. PAGE-LOAD & REFRESH WELCOME ANNOUNCEMENT POPUP
 * ========================================================== */

function initWelcomeAnnouncementModal() {
    const welcomeModal = document.getElementById('welcomeModal');
    const welcomeCloseBtn = document.getElementById('welcomeCloseBtn');
    const welcomeAckBtn = document.getElementById('welcomeAckBtn');

    if (!welcomeModal) return;

    welcomeModal.classList.add('active');

    const closeWelcomeModal = () => {
        welcomeModal.classList.remove('active');
    };

    if (welcomeCloseBtn) {
        welcomeCloseBtn.addEventListener('click', closeWelcomeModal);
    }

    if (welcomeAckBtn) {
        welcomeAckBtn.addEventListener('click', closeWelcomeModal);
    }

    welcomeModal.addEventListener('click', (e) => {
        if (e.target === welcomeModal) {
            closeWelcomeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (welcomeModal.classList.contains('active')) {
                closeWelcomeModal();
            } else if (modal.classList.contains('active')) {
                modal.classList.remove('active');
                if (isPlaying) stopAudioPlayback(true);
            }
        }
    });
}

/* ==========================================================
 * 12. NETLIFY WATERMARK DOM REMOVER
 * ========================================================== */

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

/* ==========================================================
 * 13. BOOT INITIALIZATION
 * ========================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initHeaderCarousel();
    initWelcomeAnnouncementModal();
    fetchDynamicInventory();
    syncLiveExchangeRates();

    // Warm up authentic soundfont on page load and pre-decode both instrument sample
    // banks in the background so the very first tap on Play never stutters.
    try {
        primeInstrument('piano');
        preloadInstrumentSamples();
    } catch (e) {}
});
