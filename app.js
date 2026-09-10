/**
 * TAZARO MUSIC SHEET - SYSTEM ARCHITECTURE
 * 1. File Discovery & Automatic Consolidation Engine
 * 2. Secure Page 1 PDF Rendering Engine (PDF.js)
 * 3. MIDI Audio Synthesis (Tone.js)
 * 4. ToyyibPay Gateway Integration Hook
 */

// Configure PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* -------------------------------------------------------------
 * 1. FILE SYSTEM SIMULATOR & GROUPING LOGIC
 * Consolidates matching files from sheet/piano & sheet/guitar
 * ------------------------------------------------------------- */
const rawFileSystemInventory = [
    // Piano Directory Entries
    "sheet/piano/moonlight-sonata.pdf",
    "sheet/piano/moonlight-sonata.musicxml",
    "sheet/piano/moonlight-sonata.mid",
    "sheet/piano/canon-in-d.pdf",
    "sheet/piano/canon-in-d.musicxml",
    "sheet/piano/canon-in-d.mid",
    // Guitar Directory Entries
    "sheet/guitar/moonlight-sonata.pdf",
    "sheet/guitar/moonlight-sonata.musicxml",
    "sheet/guitar/moonlight-sonata.mid",
    "sheet/guitar/canon-in-d.pdf",
    "sheet/guitar/canon-in-d.musicxml",
    "sheet/guitar/canon-in-d.mid"
];

function groupSheetFiles(fileList) {
    const registry = {};

    fileList.forEach(path => {
        const parts = path.split('/');
        const instrument = parts[1]; // 'piano' or 'guitar'
        const filename = parts[2];
        const lastDot = filename.lastIndexOf('.');
        const slug = filename.substring(0, lastDot);
        const extension = filename.substring(lastDot + 1);

        if (!registry[slug]) {
            registry[slug] = {
                slug: slug,
                title: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                instruments: {
                    piano: { pdf: null, musicxml: null, mid: null },
                    guitar: { pdf: null, musicxml: null, mid: null }
                }
            };
        }

        if (registry[slug].instruments[instrument]) {
            registry[slug].instruments[instrument][extension] = path;
        }
    });

    return Object.values(registry);
}

const catalog = groupSheetFiles(rawFileSystemInventory);

/* -------------------------------------------------------------
 * 2. CATALOG RENDERER
 * ------------------------------------------------------------- */
const songGrid = document.getElementById('songGrid');

function renderCatalog() {
    songGrid.innerHTML = '';
    catalog.forEach(item => {
        const card = document.createElement('div');
        card.className = 'song-card';
        card.innerHTML = `
            <div class="card-header">
                <div class="card-badges">
                    <span class="card-badge">Piano</span>
                    <span class="card-badge">Guitar</span>
                </div>
                <h3>${item.title}</h3>
                <p style="color:var(--text-muted); font-size:0.85rem;">Includes Complete Score, MusicXML & MIDI</p>
            </div>
            <div class="card-footer">
                <span>Starts at <strong class="price-tag">RM 5.00</strong></span>
                <span style="color: var(--accent-brass); font-weight:600;">Inspect & Play →</span>
            </div>
        `;
        card.addEventListener('click', () => openPreviewModal(item));
        songGrid.appendChild(card);
    });
}

/* -------------------------------------------------------------
 * 3. PREVIEW STAGE (PDF PAGE 1 STRICT ISOLATION)
 * ------------------------------------------------------------- */
let currentSong = null;
let activeInstrument = 'piano';
let pdfDoc = null;

async function renderSecureFirstPage(pdfUrl) {
    const canvas = document.getElementById('sheetCanvas');
    const ctx = canvas.getContext('2d');

    try {
        // Load PDF document safely
        pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
        // Strictly request Page 1 ONLY
        const page = await pdfDoc.getPage(1);
        
        const viewport = page.getViewport({ scale: 1.4 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        await page.render(renderContext).promise;
    } catch (err) {
        console.warn('Local preview placeholder mode: Rendering canvas dummy representation.');
        // High-end fallback if path unavailable in local demo without web server
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 450, 600);
        ctx.fillStyle = "#222222";
        ctx.font = "20px Cinzel";
        ctx.fillText(`${currentSong.title} (${activeInstrument.toUpperCase()})`, 30, 80);
        ctx.font = "14px 'Plus Jakarta Sans'";
        ctx.fillText("Page 1 Preview (Watermarked Demo)", 30, 120);
        ctx.beginPath();
        for(let i = 160; i < 550; i += 40) {
            ctx.moveTo(30, i); ctx.lineTo(420, i);
        }
        ctx.strokeStyle = "#dddddd";
        ctx.stroke();
    }
}

/* -------------------------------------------------------------
 * 4. AUDIO SYNTHESIS & PREVIEW ENGINE (Tone.js)
 * ------------------------------------------------------------- */
let synth = null;
let isPlaying = false;
const playBtn = document.getElementById('playAudioBtn');
const playIcon = document.getElementById('playIcon');
const audioStatus = document.getElementById('audioStatus');
const audioProgress = document.getElementById('audioProgress');

async function toggleAudio() {
    await Tone.start();

    if (isPlaying) {
        Tone.Transport.stop();
        Tone.Transport.cancel();
        isPlaying = false;
        playIcon.textContent = '▶';
        audioStatus.textContent = "Audio Paused";
        return;
    }

    // Modern polyphonic acoustic-style synth
    if (!synth) {
        synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: "triangle" },
            envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 1 }
        }).toDestination();
    }

    // Play representative progression (Moonlight / Classical Demo preview)
    const chords = [
        { time: 0, notes: ["C#3", "G#3", "C#4", "E4"] },
        { time: 1.5, notes: ["B2", "G#3", "D#4", "E4"] },
        { time: 3.0, notes: ["A2", "A3", "C#4", "E4"] },
        { time: 4.5, notes: ["F#2", "A3", "D4", "F#4"] }
    ];

    const part = new Tone.Part((time, value) => {
        synth.triggerAttackRelease(value.notes, "2n", time);
    }, chords).start(0);

    part.loop = true;
    part.loopEnd = 6.0;

    Tone.Transport.start();
    isPlaying = true;
    playIcon.textContent = '⏸';
    audioStatus.textContent = `Playing ${activeInstrument.toUpperCase()} MIDI preview...`;

    // Visualizer loop
    const updateProgress = () => {
        if (!isPlaying) return;
        const progress = (Tone.Transport.seconds % 6.0) / 6.0;
        audioProgress.style.width = `${progress * 100}%`;
        requestAnimationFrame(updateProgress);
    };
    updateProgress();
}

playBtn.addEventListener('click', toggleAudio);

/* -------------------------------------------------------------
 * 5. MODAL INTERACTION & INSTRUMENT SWITCHING
 * ------------------------------------------------------------- */
const modal = document.getElementById('previewModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const tabPiano = document.getElementById('tabPiano');
const tabGuitar = document.getElementById('tabGuitar');

function openPreviewModal(song) {
    currentSong = song;
    document.getElementById('previewTitle').innerText = song.title;
    activeInstrument = 'piano';
    updateModalView();
    modal.classList.add('active');
}

function updateModalView() {
    tabPiano.classList.toggle('active', activeInstrument === 'piano');
    tabGuitar.classList.toggle('active', activeInstrument === 'guitar');
    
    // Stop audio if running
    if(isPlaying) toggleAudio();

    const pdfPath = currentSong.instruments[activeInstrument].pdf;
    renderSecureFirstPage(pdfPath);
}

tabPiano.addEventListener('click', () => { activeInstrument = 'piano'; updateModalView(); });
tabGuitar.addEventListener('click', () => { activeInstrument = 'guitar'; updateModalView(); });

modalCloseBtn.addEventListener('click', () => {
    modal.classList.remove('active');
    if (isPlaying) toggleAudio();
});

/* -------------------------------------------------------------
 * 6. COMMERCE: PRICING ENGINE & TOYYIBPAY INTEGRATION
 * ------------------------------------------------------------- */
const priceOptions = document.querySelectorAll('.price-option');
const dynamicPriceLabel = document.getElementById('dynamicPriceLabel');
let selectedBundle = 'both';
let selectedPrice = "10.00";

priceOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        priceOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        opt.querySelector('input').checked = true;
        
        selectedBundle = opt.getAttribute('data-bundle');
        selectedPrice = opt.getAttribute('data-price');
        dynamicPriceLabel.textContent = `RM ${parseFloat(selectedPrice).toFixed(2)}`;
    });
});

document.getElementById('toyyibpaySubmit').addEventListener('click', () => {
    executeToyyibPayCheckout({
        songSlug: currentSong.slug,
        bundleType: selectedBundle,
        amountRM: selectedPrice,
        title: currentSong.title
    });
});

/**
 * ToyyibPay Integration Hook (Ready for Production Server Hookup)
 */
function executeToyyibPayCheckout({ songSlug, bundleType, amountRM, title }) {
    console.log(`[TOYYIBPAY DISPATCH] Preparing bill for ${title}...`);
    
    const payload = {
        userSecretKey: "YOUR_TOYYIBPAY_USER_SECRET_KEY", // Place your private key in your backend
        categoryCode: "YOUR_CATEGORY_CODE",
        billName: `Tazaro Sheet: ${title}`,
        billDescription: `Format: PDF, MusicXML, MIDI (${bundleType.toUpperCase()})`,
        billPriceSetting: 1,
        billPayorInfo: 1,
        billAmount: (parseFloat(amountRM) * 100).toString(), // Toyyibpay uses Cents (RM 10 = 1000)
        billReturnUrl: window.location.origin + "/payment-success",
        billCallbackUrl: window.location.origin + "/api/toyyibpay-callback",
        billExternalReferenceNo: `TAZ-${songSlug}-${bundleType}-${Date.now()}`
    };

    // Demonstrating the outgoing handoff:
    alert(`[ToyyibPay Bridge Initialization]\nAmount: RM ${amountRM}\nSong: ${title}\nVariant: ${bundleType}\n\nRedirecting to ToyyibPay secure gateway...`);
    
    /* 
     PRODUCTION POST-CALL EXAMPLE:
     fetch('/api/create-toyyibpay-bill', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload)
     })
     .then(res => res.json())
     .then(data => {
         if(data[0] && data[0].BillCode) {
             window.location.href = `https://toyyibpay.com/${data[0].BillCode}`;
         }
     });
    */
}

// Initial Boot
renderCatalog();
