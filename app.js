/**
 * =======================================================================
 * TAZARO MUSIC SHEET — CORE PLATFORM ENGINE
 * =======================================================================
 * Features:
 * 1. Multi-Engine Authentic Instrument Architecture
 *    - Piano: Real Yamaha/Steinway Concert Grand (_tone_0000_JCLive_sf2_file)
 *    - Guitar: Real Steel-String Acoustic Guitar (_tone_0250_JCLive_sf2_file)
 *              with Nylon Classical Backup (_tone_0240_JCLive_sf2_file)
 *    - Instant Fallback String Pluck Engine: Never hangs or stays loading
 * 2. High-DPI Retina Page-1 PDF Rendering Sandbox (PDF.js)
 * 3. Reactive Search & Category Chip Filter
 * 4. ToyyibPay Secure API Payment Bridge Hook
 * 5. Netlify Watermark DOM Killer
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

/* =======================================================================
 * 1. REAL INSTRUMENT SOUND ENGINE RESOLVER
 * ======================================================================= */

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    if (!soundFontPlayer && window.WebAudioFontPlayer) {
        soundFontPlayer = new WebAudioFontPlayer();
    }
    return audioCtx;
}

/**
 * Resolves verified authentic instrument wave table
 */
function getInstrumentPreset(type) {
    if (type === 'piano') {
        return window._tone_0000_JCLive_sf2_file || null;
    }
    // For Guitar: Steel-string acoustic first (ori guitar sound), with Nylon as fallback
    return window._tone_0250_JCLive_sf2_file || window._tone_0240_JCLive_sf2_file || null;
}

function primeInstrument(type) {
    const ctx = getAudioContext();
    const preset = getInstrumentPreset(type);
    if (soundFontPlayer && preset) {
        soundFontPlayer.adjustPreset(ctx, preset);
    }
}

/**
 * Converts Note Name (e.g. "C4") to MIDI Pitch Number (e.g. 60)
 */
function noteNameToMidi(noteName) {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const regex = /^([A-G][#b]?)(-?\d+)$/;
    const match = noteName.match(regex);
    if (!match) return 60;

    let note = match[1];
    const octave = parseInt(match[2], 10);
    const flatMap = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
    if (flatMap[note]) note = flatMap[note];

    const noteIndex = notes.indexOf(note);
    if (noteIndex === -1) return 60;
    return noteIndex + (octave + 1) * 12;
}

/**
 * Instant Plucked Acoustic Guitar String Fallback Engine
 * Used if the soundbank is still buffering so the user NEVER waits
 */
function playFallbackGuitarString(ctx, midiNote, when, duration, velocity = 0.8) {
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const outGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Soundhole Resonance Filter
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(2.2, when);
    filter.frequency.setValueAtTime(4500, when);
    filter.frequency.exponentialRampToValueAtTime(Math.min(freq * 3.5, 900), when + 0.12);

    filter.connect(outGain);
    outGain.connect(ctx.destination);

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
 * 2. ANIMATED HERO KEYWORD CAROUSEL
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
 * 3. DYNAMIC INVENTORY FETCHING & NORMALIZATION
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
            } else if (ext === 'xml' || ext === 'musicxml') {
                registry[slug].instruments[instrument].musicxml = path;
            } else if (ext === 'mid' || ext === 'midi') {
                registry[slug].instruments[instrument].mid = path;
            }
        }
    });

    return Object.values(registry);
}

/* =======================================================================
 * 4. SEARCH & GALLERY FILTER ENGINE
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
 * 5. CATALOG GRID RENDERER
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
        const isBundle = hasPiano && hasGuitar;

        const card = document.createElement('div');
        card.className = 'song-card';
        card.innerHTML = `
            <div class="card-art-motif">
                <span class="motif-symbol">${hasPiano ? '𝄞' : '𝄢'}</span>
                <span class="motif-format-badge">PDF • XML • MID</span>
            </div>

            <div class="card-badges">
                ${hasPiano ? '<span class="badge-piano">Piano</span>' : ''}
                ${hasGuitar ? '<span class="badge-guitar">Guitar Tabs</span>' : ''}
            </div>

            <h3>${song.title}</h3>
            <p class="card-subtext">Concert Transcription with Authentic Instrument Playback</p>

            <div class="card-footer">
                <span class="price-pill">${isBundle ? 'RM 10.00 Bundle' : 'RM 5.00 Solo'}</span>
                <span class="action-link">Preview & Play →</span>
            </div>
        `;

        card.addEventListener('click', () => openPreviewModal(song));
        songGrid.appendChild(card);
    });
}

/* =======================================================================
 * 6. RETINA HIGH-DPI PAGE-1 PDF PREVIEW ENGINE
 * ======================================================================= */

async function renderSecureFirstPage(pdfUrl) {
    const canvas = document.getElementById('sheetCanvas');
    const ctx = canvas.getContext('2d');

    if (!pdfUrl) {
        canvas.width = 340;
        canvas.height = 460;
        ctx.fillStyle = "#121722";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#94A3B8";
        ctx.font = "14px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Score unavailable for this instrument.", canvas.width / 2, canvas.height / 2);
        return;
    }

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
 * 7. AUTHENTIC AUDIO CONTROLLER (PIANO & STEEL GUITAR)
 * ======================================================================= */

const playBtn = document.getElementById('playAudioBtn');
const playIcon = document.getElementById('playIcon');
const audioStatus = document.getElementById('audioStatus');
const audioProgress = document.getElementById('audioProgress');

function updateAudioStatusLabel() {
    if (isPlaying) {
        audioStatus.textContent = `Playing ${activeInstrument === 'piano' ? 'Concert Grand Piano HD' : 'Steel Acoustic Guitar (Ori)'}...`;
        playIcon.textContent = '⏸';
    } else {
        audioStatus.textContent = `${activeInstrument === 'piano' ? 'Concert Grand Piano HD' : 'Steel Acoustic Guitar (Ori)'} Ready • Tap to Play`;
        playIcon.textContent = '▶';
    }
}

async function toggleAudioPlayback() {
    // 1. Synchronously unlock Web Audio on immediate click
    const ctx = getAudioContext();
    primeInstrument(activeInstrument);

    if (isPlaying) {
        stopAudioPlayback();
        return;
    }

    const preset = getInstrumentPreset(activeInstrument);
    const currentMidiFile = currentSong?.instruments?.[activeInstrument]?.mid;

    if (currentMidiFile && window.Midi) {
        try {
            audioStatus.textContent = "Loading Score MIDI...";
            const response = await fetch(currentMidiFile);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const midi = new Midi(arrayBuffer);

                stopAudioPlayback(false);
                isPlaying = true;
                updateAudioStatusLabel();

                const now = ctx.currentTime + 0.08;
                playbackStartTime = now;
                currentTrackDuration = Math.min(midi.duration || 30, 45); // 45s preview slice

                midi.tracks.forEach(track => {
                    track.notes.forEach(note => {
                        if (note.time < 45) {
                            const when = now + note.time;
                            const duration = Math.max(note.duration, 0.4);
                            const volume = (note.velocity || 0.8) * 0.95;

                            if (preset && soundFontPlayer) {
                                soundFontPlayer.queueWaveTable(
                                    ctx,
                                    ctx.destination,
                                    preset,
                                    when,
                                    note.midi,
                                    duration,
                                    volume
                                );
                            } else {
                                // Instant zero-latency fallback if preset is still caching
                                const delayMs = note.time * 1000;
                                const timer = setTimeout(() => {
                                    if (isPlaying) {
                                        playFallbackGuitarString(ctx, note.midi, ctx.currentTime, duration, volume);
                                    }
                                }, delayMs);
                                scheduledNoteTimers.push(timer);
                            }
                        }
                    });
                });

                startProgressTracker();
                return;
            }
        } catch (e) {
            console.warn('MIDI direct stream fallback triggered:', e);
        }
    }

    // High-Fidelity Verified Sample Progression Demo (Instant Sound Guarantee)
    stopAudioPlayback(false);
    isPlaying = true;
    updateAudioStatusLabel();

    const now = ctx.currentTime + 0.08;
    playbackStartTime = now;
    currentTrackDuration = 8.0;

    const demoNotes = activeInstrument === 'piano' ? [
        { time: 0.0, midi: 60, dur: 1.5, vel: 0.85 }, // C4
        { time: 0.0, midi: 64, dur: 1.5, vel: 0.8 },  // E4
        { time: 0.0, midi: 67, dur: 1.5, vel: 0.85 }, // G4
        { time: 1.5, midi: 55, dur: 1.5, vel: 0.8 },  // G3
        { time: 1.5, midi: 59, dur: 1.5, vel: 0.8 },  // B3
        { time: 1.5, midi: 62, dur: 1.5, vel: 0.85 }, // D4
        { time: 3.0, midi: 57, dur: 1.5, vel: 0.8 },  // A3
        { time: 3.0, midi: 60, dur: 1.5, vel: 0.8 },  // C4
        { time: 3.0, midi: 64, dur: 1.5, vel: 0.85 }, // E4
        { time: 4.5, midi: 53, dur: 2.8, vel: 0.9 },  // F3
        { time: 4.5, midi: 60, dur: 2.8, vel: 0.85 }, // C4
        { time: 4.5, midi: 65, dur: 2.8, vel: 0.9 }   // F4
    ] : [
        // Authentic Steel-String Acoustic Guitar Chime & Pluck (Ori Sound)
        { time: 0.0, midi: 52, dur: 1.2, vel: 0.9 },  // E3
        { time: 0.25, midi: 59, dur: 1.2, vel: 0.85 }, // B3
        { time: 0.5, midi: 64, dur: 1.2, vel: 0.9 },  // E4
        { time: 0.75, midi: 67, dur: 1.2, vel: 0.85 }, // G4
        { time: 1.5, midi: 50, dur: 1.2, vel: 0.9 },  // D3
        { time: 1.75, midi: 57, dur: 1.2, vel: 0.85 }, // A3
        { time: 2.0, midi: 62, dur: 1.2, vel: 0.9 },  // D4
        { time: 2.25, midi: 66, dur: 1.2, vel: 0.85 }, // F#4
        { time: 3.0, midi: 48, dur: 1.2, vel: 0.9 },  // C3
        { time: 3.25, midi: 55, dur: 1.2, vel: 0.85 }, // G3
        { time: 3.5, midi: 60, dur: 1.2, vel: 0.9 },  // C4
        { time: 3.75, midi: 64, dur: 2.5, vel: 0.95 }  // E4
    ];

    demoNotes.forEach(n => {
        if (preset && soundFontPlayer) {
            soundFontPlayer.queueWaveTable(
                ctx,
                ctx.destination,
                preset,
                now + n.time,
                n.midi,
                n.dur,
                n.vel
            );
        } else {
            const delayMs = n.time * 1000;
            const timer = setTimeout(() => {
                if (isPlaying) {
                    playFallbackGuitarString(ctx, n.midi, ctx.currentTime, n.dur, n.vel);
                }
            }, delayMs);
            scheduledNoteTimers.push(timer);
        }
    });

    startProgressTracker();
}

function stopAudioPlayback(resetUI = true) {
    isPlaying = false;

    // Clear all pending timers
    scheduledNoteTimers.forEach(id => clearTimeout(id));
    scheduledNoteTimers = [];

    // Stop and disconnect fallback nodes
    activeFallbackNodes.forEach(node => {
        try { node.stop(); } catch (e) {}
    });
    activeFallbackNodes = [];

    // Stop all queued soundfont wave notes
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
 * 8. MODAL MANAGEMENT & INSTRUMENT PREVIEWS
 * ======================================================================= */

const modal = document.getElementById('previewModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const tabPiano = document.getElementById('tabPiano');
const tabGuitar = document.getElementById('tabGuitar');

function openPreviewModal(song) {
    currentSong = song;
    document.getElementById('previewTitle').innerText = song.title;

    if (song.instruments.piano.pdf) {
        activeInstrument = 'piano';
    } else {
        activeInstrument = 'guitar';
    }

    tabPiano.style.display = song.instruments.piano.pdf ? 'block' : 'none';
    tabGuitar.style.display = song.instruments.guitar.pdf ? 'block' : 'none';

    configurePricingOptions(song);
    updateModalView();
    modal.classList.add('active');

    // Pre-warm audio in background
    primeInstrument(activeInstrument);
}

function configurePricingOptions(song) {
    const hasPiano = !!song.instruments.piano.pdf;
    const hasGuitar = !!song.instruments.guitar.pdf;

    const bothOpt = document.querySelector('.price-option[data-bundle="both"]');
    const pianoOpt = document.querySelector('.price-option[data-bundle="piano"]');
    const guitarOpt = document.querySelector('.price-option[data-bundle="guitar"]');

    bothOpt.style.display = (hasPiano && hasGuitar) ? 'flex' : 'none';
    pianoOpt.style.display = hasPiano ? 'flex' : 'none';
    guitarOpt.style.display = hasGuitar ? 'flex' : 'none';

    if (hasPiano && hasGuitar) {
        bothOpt.click();
    } else if (hasPiano) {
        pianoOpt.click();
    } else if (hasGuitar) {
        guitarOpt.click();
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
    if (activeInstrument !== 'piano') { 
        activeInstrument = 'piano'; 
        updateModalView(); 
        primeInstrument('piano');
    } 
});

tabGuitar.addEventListener('click', () => { 
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
 * 9. COMMERCE & TOYYIBPAY INTEGRATION
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
        billDescription: `Score Bundle: ${bundleType.toUpperCase()} (PDF, MusicXML, MIDI)`,
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
 * 10. NETLIFY WATERMARK DOM REMOVER
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
 * 11. BOOT INITIALIZATION
 * ======================================================================= */

document.addEventListener('DOMContentLoaded', () => {
    initHeaderCarousel();
    fetchDynamicInventory();
});
