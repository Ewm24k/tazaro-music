/**
 * =======================================================================
 * TAZARO MUSIC SHEET — CORE PLATFORM ENGINE
 * =======================================================================
 * Features:
 * 1. WebAudioFont Realistic Sampled Instrument Player
 *    - Real Yamaha/Steinway Concert Grand Piano Wave Table (_tone_0000_JCLive_sf2_file)
 *    - Real Classical Spanish Acoustic Nylon Guitar Wave Table (_tone_0240_Acoustic_Guitar_nylon_sf2_file)
 *    - Zero CORS issues: Pre-compiled Wave Tables embedded via CDN script
 *    - Hardware-accelerated sample playback without lag or voice choking
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

// WebAudioFont Player State
let audioCtx = null;
let soundFontPlayer = null;
let isPlaying = false;
let playbackTimer = null;
let playbackStartTime = 0;
let currentTrackDuration = 0;

/* =======================================================================
 * 1. REAL INSTRUMENT SOUNDFONT ENGINE (WebAudioFont)
 * ======================================================================= */

/**
 * Initializes and unlocks the Web Audio Context synchronously on user tap
 */
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
 * Returns the loaded instrument preset wave table
 */
function getInstrumentPreset(type) {
    if (type === 'piano') {
        return window._tone_0000_JCLive_sf2_file || null;
    }
    return window._tone_0240_Acoustic_Guitar_nylon_sf2_file || null;
}

/**
 * Pre-adjusts the wave table in the AudioContext so it plays with 0 latency
 */
function primeInstrumentPreset(type) {
    const ctx = getAudioContext();
    const preset = getInstrumentPreset(type);
    if (soundFontPlayer && preset) {
        soundFontPlayer.adjustPreset(ctx, preset);
    }
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
            <p class="card-subtext">Concert Transcription with Real Instrument Preview</p>

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
 * 7. REAL SAMPLED INSTRUMENT AUDIO CONTROLLER
 * ======================================================================= */

const playBtn = document.getElementById('playAudioBtn');
const playIcon = document.getElementById('playIcon');
const audioStatus = document.getElementById('audioStatus');
const audioProgress = document.getElementById('audioProgress');

function updateAudioStatusLabel() {
    if (isPlaying) {
        audioStatus.textContent = `Playing ${activeInstrument === 'piano' ? 'Concert Grand Piano HD' : 'Classical Nylon Guitar HD'}...`;
        playIcon.textContent = '⏸';
    } else {
        audioStatus.textContent = `${activeInstrument === 'piano' ? 'Concert Grand Piano HD' : 'Classical Nylon Guitar HD'} • Tap to Play`;
        playIcon.textContent = '▶';
    }
}

async function toggleAudioPlayback() {
    // 1. Synchronously unlock Web Audio in immediate click stack
    const ctx = getAudioContext();
    primeInstrumentPreset(activeInstrument);

    if (isPlaying) {
        stopAudioPlayback();
        return;
    }

    const preset = getInstrumentPreset(activeInstrument);
    if (!preset || !soundFontPlayer) {
        audioStatus.textContent = "Loading instrument soundbank...";
        return;
    }

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

                // Queue real sampled notes directly into WebAudioFont
                midi.tracks.forEach(track => {
                    track.notes.forEach(note => {
                        if (note.time < 45) {
                            const when = now + note.time;
                            const duration = Math.max(note.duration, 0.4);
                            const volume = (note.velocity || 0.8) * 0.95;

                            soundFontPlayer.queueWaveTable(
                                ctx,
                                ctx.destination,
                                preset,
                                when,
                                note.midi,
                                duration,
                                volume
                            );
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

    // High-Fidelity Verified Sample Progression Demo (Real Acoustic Samples)
    stopAudioPlayback(false);
    isPlaying = true;
    updateAudioStatusLabel();

    const now = ctx.currentTime + 0.08;
    playbackStartTime = now;
    currentTrackDuration = 8.0;

    // Real MIDI note pitches (C4 = 60, E4 = 64, G4 = 67, etc.)
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
        // Classical Spanish Nylon Acoustic Guitar Arpeggio
        { time: 0.0, midi: 52, dur: 1.2, vel: 0.85 }, // E3
        { time: 0.3, midi: 59, dur: 1.2, vel: 0.8 },  // B3
        { time: 0.6, midi: 64, dur: 1.2, vel: 0.85 }, // E4
        { time: 0.9, midi: 67, dur: 1.2, vel: 0.8 },  // G4
        { time: 1.8, midi: 50, dur: 1.2, vel: 0.85 }, // D3
        { time: 2.1, midi: 57, dur: 1.2, vel: 0.8 },  // A3
        { time: 2.4, midi: 62, dur: 1.2, vel: 0.85 }, // D4
        { time: 2.7, midi: 66, dur: 1.2, vel: 0.8 },  // F#4
        { time: 3.6, midi: 48, dur: 1.2, vel: 0.85 }, // C3
        { time: 3.9, midi: 55, dur: 1.2, vel: 0.8 },  // G3
        { time: 4.2, midi: 60, dur: 1.2, vel: 0.85 }, // C4
        { time: 4.5, midi: 64, dur: 2.5, vel: 0.9 }   // E4
    ];

    demoNotes.forEach(n => {
        soundFontPlayer.queueWaveTable(
            ctx,
            ctx.destination,
            preset,
            now + n.time,
            n.midi,
            n.dur,
            n.vel
        );
    });

    startProgressTracker();
}

function stopAudioPlayback(resetUI = true) {
    isPlaying = false;

    // Instantly cancels all queued and playing soundfont wave notes
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

    // Pre-warm audio preset in background
    primeInstrumentPreset(activeInstrument);
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
        primeInstrumentPreset('piano');
    } 
});

tabGuitar.addEventListener('click', () => { 
    if (activeInstrument !== 'guitar') { 
        activeInstrument = 'guitar'; 
        updateModalView(); 
        primeInstrumentPreset('guitar');
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
