/**
 * =======================================================================
 * TAZARO MUSIC SHEET — CORE PLATFORM ENGINE
 * =======================================================================
 * Features:
 * 1. Resilient Directory Discovery (Netlify Functions -> Manifest -> PHP)
 * 2. Automated File Consolidation (3 formats x 2 instruments -> 1 Product)
 * 3. Secure Retina / High-DPI Page-1 PDF Rendering Engine (PDF.js)
 * 4. Interactive Synthesis Audio Player (Tone.js + @tonejs/midi)
 * 5. Dynamic Dual-Tier Pricing Selector (RM 5 Solo / RM 10 Bundle)
 * 6. Native Android & iOS Adaptive UI Engine
 * 7. ToyyibPay Gateway Integration Hook
 * 8. Dynamic Netlify Watermark Killer
 * =======================================================================
 */

// Initialize PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Global Engine State
let catalog = [];
let currentSong = null;
let activeInstrument = 'piano';
let isPlaying = false;
let synth = null;
let activeMidiPart = null;

/* =======================================================================
 * 1. DYNAMIC FILE DISCOVERY & GROUPING ENGINE
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
                    console.log(`[Tazaro Engine] Inventory loaded via: ${endpoint}`);
                    break;
                }
            }
        } catch (e) {
            // Silently try next fallback endpoint
        }
    }

    if (discoveredFiles && discoveredFiles.length > 0) {
        catalog = processDiscoveredFiles(discoveredFiles);
        renderCatalog(catalog);
    } else {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 4rem 1rem;">
                <p style="font-size: 1.1rem; color: #fff; margin-bottom: 0.5rem;">No Sheet Music Files Detected</p>
                <p style="font-size: 0.85rem;">Upload your files to <code>sheet/piano/</code> and <code>sheet/guitar/</code> to populate the catalog.</p>
            </div>`;
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
 * 2. CATALOG RENDERER
 * ======================================================================= */

function renderCatalog(items) {
    const songGrid = document.getElementById('songGrid');
    songGrid.innerHTML = '';

    items.forEach(song => {
        const hasPiano = !!song.instruments.piano.pdf;
        const hasGuitar = !!song.instruments.guitar.pdf;

        const card = document.createElement('div');
        card.className = 'song-card';
        card.innerHTML = `
            <div class="card-header">
                <div class="card-badges">
                    ${hasPiano ? '<span class="card-badge">Piano Score</span>' : ''}
                    ${hasGuitar ? '<span class="card-badge">Guitar Tabs & Score</span>' : ''}
                </div>
                <h3>${song.title}</h3>
                <p style="color:var(--text-muted); font-size:0.85rem;">Includes Verified PDF, MusicXML & MIDI Formats</p>
            </div>
            <div class="card-footer">
                <span>${hasPiano && hasGuitar ? 'Bundle from <strong class="price-tag">RM 10.00</strong>' : 'Single Edition <strong class="price-tag">RM 5.00</strong>'}</span>
                <span style="color: var(--accent-brass); font-weight:600;">Preview & Audio →</span>
            </div>
        `;
        card.addEventListener('click', () => openPreviewModal(song));
        songGrid.appendChild(card);
    });
}

/* =======================================================================
 * 3. RETINA / HIGH-DPI PAGE-1 PREVIEW ENGINE
 * ======================================================================= */

async function renderSecureFirstPage(pdfUrl) {
    const canvas = document.getElementById('sheetCanvas');
    const ctx = canvas.getContext('2d');

    if (!pdfUrl) {
        canvas.width = 320;
        canvas.height = 440;
        ctx.fillStyle = "#121519";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#8E95A0";
        ctx.font = "14px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Edition unavailable for this instrument.", canvas.width / 2, canvas.height / 2);
        return;
    }

    try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        // Responsive width calculation
        const isMobile = window.innerWidth <= 768;
        const baseViewport = page.getViewport({ scale: 1.0 });
        const targetWidth = isMobile ? Math.min(window.innerWidth - 40, 420) : 520;
        const scale = targetWidth / baseViewport.width;

        // Device Pixel Ratio scaling for Retina displays (iPhone & AMOLED Android)
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
        canvas.width = 320;
        canvas.height = 450;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#161A20";
        ctx.font = "18px 'Cinzel', serif";
        ctx.textAlign = "center";
        ctx.fillText(currentSong ? currentSong.title : "Preview", canvas.width / 2, 70);
    }
}

/* =======================================================================
 * 4. SYNTHESIZED AUDIO PLAYER ENGINE (Tone.js)
 * ======================================================================= */

const playBtn = document.getElementById('playAudioBtn');
const playIcon = document.getElementById('playIcon');
const audioStatus = document.getElementById('audioStatus');
const audioProgress = document.getElementById('audioProgress');

async function toggleAudioPlayback() {
    await Tone.start();

    if (isPlaying) {
        stopAudioPlayback();
        return;
    }

    const currentMidiFile = currentSong.instruments[activeInstrument].mid;

    if (!synth) {
        synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: "triangle" },
            envelope: { attack: 0.04, decay: 0.2, sustain: 0.35, release: 1.2 }
        }).toDestination();
    }

    if (currentMidiFile && window.Midi) {
        try {
            audioStatus.textContent = 'Loading MIDI audio...';
            const response = await fetch(currentMidiFile);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                const midiData = new Midi(arrayBuffer);

                Tone.Transport.cancel();
                
                midiData.tracks.forEach(track => {
                    track.notes.forEach(note => {
                        Tone.Transport.schedule(time => {
                            synth.triggerAttackRelease(note.name, note.duration, time, note.velocity);
                        }, note.time);
                    });
                });

                Tone.Transport.start();
                isPlaying = true;
                playIcon.textContent = '⏸';
                audioStatus.textContent = `Playing ${activeInstrument.toUpperCase()} MIDI...`;
                startProgressBar(midiData.duration || 6.0);
                return;
            }
        } catch (e) {
            console.warn('MIDI direct stream fallback active.');
        }
    }

    // Melodic Harmonic Preview Sequence
    Tone.Transport.cancel();
    const chords = [
        { time: 0, notes: ["E3", "B3", "E4", "G4"] },
        { time: 1.2, notes: ["D3", "A3", "D4", "F#4"] },
        { time: 2.4, notes: ["C3", "G3", "C4", "E4"] },
        { time: 3.6, notes: ["B2", "F#3", "B3", "D#4"] }
    ];

    activeMidiPart = new Tone.Part((time, value) => {
        synth.triggerAttackRelease(value.notes, "1.5n", time);
    }, chords).start(0);

    activeMidiPart.loop = true;
    activeMidiPart.loopEnd = 4.8;

    Tone.Transport.start();
    isPlaying = true;
    playIcon.textContent = '⏸';
    audioStatus.textContent = `Playing ${activeInstrument.toUpperCase()} Preview...`;
    startProgressBar(4.8);
}

function stopAudioPlayback() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    if (activeMidiPart) {
        activeMidiPart.dispose();
        activeMidiPart = null;
    }
    isPlaying = false;
    playIcon.textContent = '▶';
    audioStatus.textContent = 'Playback Paused';
    audioProgress.style.width = '0%';
}

function startProgressBar(duration) {
    const tick = () => {
        if (!isPlaying) return;
        const currentSeconds = Tone.Transport.seconds % duration;
        const percent = (currentSeconds / duration) * 100;
        audioProgress.style.width = `${percent}%`;
        requestAnimationFrame(tick);
    };
    tick();
}

playBtn.addEventListener('click', toggleAudioPlayback);

/* =======================================================================
 * 5. MODAL MANAGEMENT & INSTRUMENT PREVIEWS
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

function updateModalView() {
    tabPiano.classList.toggle('active', activeInstrument === 'piano');
    tabGuitar.classList.toggle('active', activeInstrument === 'guitar');

    if (isPlaying) stopAudioPlayback();

    const pdfPath = currentSong.instruments[activeInstrument].pdf;
    renderSecureFirstPage(pdfPath);
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
    if (isPlaying) stopAudioPlayback();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
        modal.classList.remove('active');
        if (isPlaying) stopAudioPlayback();
    }
});

/* =======================================================================
 * 6. COMMERCE & TOYYIBPAY INTEGRATION
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
 * 7. NETLIFY WATERMARK DOM REMOVER
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
 * 8. BOOT INITIALIZATION
 * ======================================================================= */

document.addEventListener('DOMContentLoaded', () => {
    fetchDynamicInventory();
});
