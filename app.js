/**
 * =======================================================================
 * TAZARO MUSIC SHEET — CORE PLATFORM ENGINE
 * =======================================================================
 * Features:
 * 1. Background Soundfont Pre-Warming (Pre-loads Piano & Guitar)
 * 2. Play Button State Machine (Strict Disabled during Load -> Auto Ready)
 * 3. Fast Soundfont Engine (Steinway Grand & Nylon Guitar)
 * 4. Fuzzy Live Search & Category Chip Filter
 * 5. Retina High-DPI Page-1 PDF Sandbox
 * 6. Dynamic Dual-Tier Pricing Selector (RM 5 / RM 10)
 * 7. ToyyibPay Secure API Payment Bridge Hook
 * 8. Dynamic Netlify Watermark DOM Killer
 * =======================================================================
 */

// Initialize PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Global Catalog State
let masterCatalog = [];
let filteredCatalog = [];
let currentSong = null;
let activeInstrument = 'piano';
let activeFilter = 'all';
let searchQuery = '';

// Soundfont Native Audio Engine State
let audioCtx = null;
const soundfontCache = {
    piano: null,
    guitar: null
};
const loadPromises = {
    piano: null,
    guitar: null
};

let isPlaying = false;
let activeAudioNodes = [];
let playbackTimer = null;
let playbackStartTime = 0;
let currentTrackDuration = 0;

/* =======================================================================
 * 1. OPTIMIZED HD AUDIO ENGINE & PLAY BUTTON STATE CONTROLLER
 * ======================================================================= */

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

/**
 * UI State Machine for Play Button & Audio Track Info
 * @param {'loading' | 'ready' | 'playing' | 'error'} state 
 */
function setAudioUIState(state, message = '') {
    const playBtn = document.getElementById('playAudioBtn');
    const playIcon = document.getElementById('playIcon');
    const audioStatus = document.getElementById('audioStatus');

    if (!playBtn || !playIcon || !audioStatus) return;

    if (state === 'loading') {
        playBtn.disabled = true;
        playIcon.innerHTML = '<span class="audio-spinner"></span>';
        audioStatus.className = 'audio-status';
        audioStatus.textContent = message || `Loading ${activeInstrument === 'piano' ? 'Concert Piano HD' : 'Acoustic Guitar HD'}...`;
    } else if (state === 'ready') {
        playBtn.disabled = false;
        playIcon.textContent = '▶';
        audioStatus.className = 'audio-status ready';
        audioStatus.textContent = message || `HD ${activeInstrument === 'piano' ? 'Grand Piano' : 'Nylon Guitar'} Ready • Tap to Play`;
    } else if (state === 'playing') {
        playBtn.disabled = false;
        playIcon.textContent = '⏸';
        audioStatus.className = 'audio-status ready';
        audioStatus.textContent = message || `Playing ${activeInstrument === 'piano' ? 'Concert Piano' : 'Acoustic Guitar'} HD...`;
    } else if (state === 'error') {
        playBtn.disabled = true;
        playIcon.textContent = '✕';
        audioStatus.className = 'audio-status';
        audioStatus.textContent = message || 'Audio playback unavailable';
    }
}

/**
 * High-Performance Soundfont Loader with Deduplicated Promises and Memory Caching
 */
function loadInstrumentFast(type) {
    if (soundfontCache[type]) {
        return Promise.resolve(soundfontCache[type]);
    }

    if (loadPromises[type]) {
        return loadPromises[type];
    }

    const ctx = getAudioContext();
    const instName = type === 'piano' ? 'acoustic_grand_piano' : 'acoustic_guitar_nylon';

    loadPromises[type] = Soundfont.instrument(ctx, instName, {
        soundfont: 'FluidR3_GM',
        gain: 2.2
    }).then(instrument => {
        soundfontCache[type] = instrument;
        console.log(`[Tazaro Audio Engine] Cached: ${type}`);
        return instrument;
    }).catch(err => {
        console.warn(`[Tazaro Audio Engine] Failed loading ${type}:`, err);
        loadPromises[type] = null;
        return null;
    });

    return loadPromises[type];
}

/**
 * Warm up audio soundfonts in the background so they are instant upon modal click
 */
function prewarmAudioEngine() {
    // Warm up piano first during idle period
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            loadInstrumentFast('piano');
        });
    } else {
        setTimeout(() => {
            loadInstrumentFast('piano');
        }, 1200);
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
        } catch (e) {
            // Silently cascade to next fallback
        }
    }

    if (discoveredFiles && discoveredFiles.length > 0) {
        masterCatalog = processDiscoveredFiles(discoveredFiles);
        updateFilterCounts(masterCatalog);
        applyFiltersAndSearch();
        prewarmAudioEngine();
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
            <p class="card-subtext">Concert Transcription with Performance Accompaniment</p>

            <div class="card-footer">
                <span class="price-pill">${isBundle ? 'RM 10.00 Bundle' : 'RM 5.00 Solo'}</span>
                <span class="action-link">Preview & Play →</span>
            </div>
        `;

        // Pre-warm guitar soundfont on card hover/touch
        card.addEventListener('mouseenter', () => {
            loadInstrumentFast('guitar');
        });
        card.addEventListener('touchstart', () => {
            loadInstrumentFast('guitar');
        }, { passive: true });

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
 * 7. HD SOUNDFONT PLAYBACK ENGINE
 * ======================================================================= */

const playBtn = document.getElementById('playAudioBtn');
const audioProgress = document.getElementById('audioProgress');

async function toggleAudioPlayback() {
    const ctx = getAudioContext();

    if (isPlaying) {
        stopAudioPlayback();
        return;
    }

    const player = soundfontCache[activeInstrument];
    if (!player) {
        setAudioUIState('loading');
        return;
    }

    setAudioUIState('playing');

    const currentMidiFile = currentSong?.instruments?.[activeInstrument]?.mid;

    if (currentMidiFile && window.Midi) {
        try {
            const response = await fetch(currentMidiFile);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const midi = new Midi(arrayBuffer);

                stopAudioPlayback(false); // Clean previous notes without changing UI to paused
                isPlaying = true;
                setAudioUIState('playing', `Playing ${activeInstrument === 'piano' ? 'Concert Grand' : 'Acoustic Guitar'} HD...`);

                const now = ctx.currentTime + 0.08;
                playbackStartTime = now;
                currentTrackDuration = Math.min(midi.duration || 30, 45);

                midi.tracks.forEach(track => {
                    track.notes.forEach(note => {
                        if (note.time < 45) {
                            const scheduledNode = player.play(
                                note.name, 
                                now + note.time, 
                                { 
                                    duration: Math.min(note.duration, 4.0), 
                                    gain: note.velocity * 2.2 
                                }
                            );
                            if (scheduledNode) activeAudioNodes.push(scheduledNode);
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

    // Fallback: Harmonic progression
    stopAudioPlayback(false);
    isPlaying = true;
    setAudioUIState('playing', `Playing ${activeInstrument === 'piano' ? 'Concert Grand' : 'Acoustic Guitar'} HD...`);

    const now = ctx.currentTime + 0.08;
    playbackStartTime = now;
    currentTrackDuration = 8.0;

    const demoNotes = activeInstrument === 'piano' ? [
        { time: 0.0, note: "C4", dur: 1.2 }, { time: 0.0, note: "E4", dur: 1.2 }, { time: 0.0, note: "G4", dur: 1.2 },
        { time: 1.2, note: "G3", dur: 1.2 }, { time: 1.2, note: "D4", dur: 1.2 }, { time: 1.2, note: "B4", dur: 1.2 },
        { time: 2.4, note: "A3", dur: 1.2 }, { time: 2.4, note: "C4", dur: 1.2 }, { time: 2.4, note: "E4", dur: 1.2 },
        { time: 3.6, note: "F3", dur: 2.4 }, { time: 3.6, note: "A4", dur: 2.4 }, { time: 3.6, note: "C5", dur: 2.4 }
    ] : [
        { time: 0.0, note: "E3", dur: 0.8 }, { time: 0.3, note: "B3", dur: 0.8 }, { time: 0.6, note: "E4", dur: 0.8 }, { time: 0.9, note: "G4", dur: 0.8 },
        { time: 1.5, note: "D3", dur: 0.8 }, { time: 1.8, note: "A3", dur: 0.8 }, { time: 2.1, note: "D4", dur: 0.8 }, { time: 2.4, note: "F#4", dur: 0.8 },
        { time: 3.0, note: "C3", dur: 0.8 }, { time: 3.3, note: "G3", dur: 0.8 }, { time: 3.6, note: "C4", dur: 0.8 }, { time: 3.9, note: "E4", dur: 1.5 }
    ];

    demoNotes.forEach(n => {
        const node = player.play(n.note, now + n.time, { duration: n.dur, gain: 2.0 });
        if (node) activeAudioNodes.push(node);
    });

    startProgressTracker();
}

function stopAudioPlayback(resetUI = true) {
    isPlaying = false;
    
    if (resetUI) {
        setAudioUIState('ready', `HD ${activeInstrument === 'piano' ? 'Grand Piano' : 'Nylon Guitar'} Ready • Tap to Play`);
        audioProgress.style.width = '0%';
    }

    if (activeAudioNodes && activeAudioNodes.length > 0) {
        activeAudioNodes.forEach(node => {
            try { 
                if (node.stop) node.stop(); 
            } catch (e) {}
        });
        activeAudioNodes = [];
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
            setAudioUIState('ready', 'Preview Complete • Tap to Replay');
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

/**
 * Handles tab switching, stopping any active audio, locking the button
 * if the instrument is loading, and auto-enabling when ready.
 */
function updateModalView() {
    tabPiano.classList.toggle('active', activeInstrument === 'piano');
    tabGuitar.classList.toggle('active', activeInstrument === 'guitar');

    if (isPlaying) stopAudioPlayback(true);

    const pdfPath = currentSong.instruments[activeInstrument].pdf;
    renderSecureFirstPage(pdfPath);

    // Instrument Soundfont Loading & Auto-Enable State Management
    if (soundfontCache[activeInstrument]) {
        // Already loaded: Instant auto-ready!
        setAudioUIState('ready');
    } else {
        // Disabled & Loading: Auto-enables as soon as promise resolves
        setAudioUIState('loading');
        loadInstrumentFast(activeInstrument).then(player => {
            if (player && modal.classList.contains('active')) {
                setAudioUIState('ready');
            }
        });
    }
}

tabPiano.addEventListener('click', () => { 
    if (activeInstrument !== 'piano') { 
        activeInstrument = 'piano'; 
        updateModalView(); 
    } 
});

tabGuitar.addEventListener('click', () => { 
    if (activeInstrument !== 'guitar') { 
        activeInstrument = 'guitar'; 
        updateModalView(); 
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
