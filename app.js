/**
 * TAZARO MUSIC SHEET - DYNAMIC ZERO-HARDCODE ENGINE
 */

// Configure PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let catalog = [];
let currentSong = null;
let activeInstrument = 'piano';

/* -------------------------------------------------------------
 * 1. DYNAMIC FILE DISCOVERY & AGGREGATOR
 * ------------------------------------------------------------- */

// Normalizes file names into a clean group slug
// e.g., "Canon_In_D.final.pdf" and "Canon-In-D.mid" -> "canon-in-d"
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
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">
        Discovering sheet library...
    </div>`;

    try {
        // Fetch direct from the dynamic filesystem scanner
        const response = await fetch('scan.php');
        if (!response.ok) throw new Error('Failed to access scan.php endpoint');
        
        const fileList = await response.json();
        catalog = processDiscoveredFiles(fileList);
        renderCatalog(catalog);
    } catch (error) {
        console.error('Scan Error:', error);
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #ff6b6b; padding: 3rem;">
            Unable to auto-scan sheet folder. Ensure <code>scan.php</code> is hosted on a PHP/local server.
        </div>`;
    }
}

function processDiscoveredFiles(filePaths) {
    const registry = {};

    filePaths.forEach(path => {
        // Path format: sheet/{instrument}/{fileName}
        const segments = path.split('/');
        if (segments.length < 3) return;

        const instrument = segments[1].toLowerCase(); // 'piano' or 'guitar'
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
            // Map standard format keys
            if (ext === 'pdf') registry[slug].instruments[instrument].pdf = path;
            if (ext === 'xml' || ext === 'musicxml') registry[slug].instruments[instrument].musicxml = path;
            if (ext === 'mid' || ext === 'midi') registry[slug].instruments[instrument].mid = path;
        }
    });

    return Object.values(registry);
}

/* -------------------------------------------------------------
 * 2. CATALOG RENDERER
 * ------------------------------------------------------------- */
function renderCatalog(items) {
    const songGrid = document.getElementById('songGrid');
    songGrid.innerHTML = '';

    if (items.length === 0) {
        songGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">
            No sheets found in <code>/sheet/piano</code> or <code>/sheet/guitar</code>.
        </div>`;
        return;
    }

    items.forEach(song => {
        const hasPiano = !!song.instruments.piano.pdf;
        const hasGuitar = !!song.instruments.guitar.pdf;

        const card = document.createElement('div');
        card.className = 'song-card';
        card.innerHTML = `
            <div class="card-header">
                <div class="card-badges">
                    ${hasPiano ? '<span class="card-badge">Piano</span>' : ''}
                    ${hasGuitar ? '<span class="card-badge">Guitar</span>' : ''}
                </div>
                <h3>${song.title}</h3>
                <p style="color:var(--text-muted); font-size:0.85rem;">Includes Full Score, MusicXML & MIDI</p>
            </div>
            <div class="card-footer">
                <span>${hasPiano && hasGuitar ? 'Bundle Deal Available' : 'Single Edition'}</span>
                <span style="color: var(--accent-brass); font-weight:600;">Inspect & Play →</span>
            </div>
        `;
        card.addEventListener('click', () => openPreviewModal(song));
        songGrid.appendChild(card);
    });
}

/* -------------------------------------------------------------
 * 3. DYNAMIC PREVIEW & SECURITY (PAGE 1 ONLY)
 * ------------------------------------------------------------- */
async function renderSecureFirstPage(pdfUrl) {
    const canvas = document.getElementById('sheetCanvas');
    const ctx = canvas.getContext('2d');

    if (!pdfUrl) {
        ctx.fillStyle = "#121519";
        ctx.fillRect(0, 0, 450, 600);
        ctx.fillStyle = "#8E95A0";
        ctx.font = "14px 'Plus Jakarta Sans'";
        ctx.fillText("Edition not available for this instrument.", 70, 300);
        return;
    }

    try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        
        // Strict Security Constraint: Page 1 Only
        const page = await pdf.getPage(1);
        
        const viewport = page.getViewport({ scale: 1.4 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;
    } catch (err) {
        console.error("PDF Preview failure:", err);
    }
}

/* -------------------------------------------------------------
 * 4. AUDIO PREVIEW PLAYER (Tone.js + MIDI File Support)
 * ------------------------------------------------------------- */
let isPlaying = false;
let synth = null;
const playBtn = document.getElementById('playAudioBtn');
const playIcon = document.getElementById('playIcon');
const audioStatus = document.getElementById('audioStatus');
const audioProgress = document.getElementById('audioProgress');

async function toggleAudioPlayback() {
    await Tone.start();

    if (isPlaying) {
        Tone.Transport.stop();
        Tone.Transport.cancel();
        isPlaying = false;
        playIcon.textContent = '▶';
        audioStatus.textContent = 'Playback Paused';
        return;
    }

    const currentMidiFile = currentSong.instruments[activeInstrument].mid;

    if (!synth) {
        synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: "triangle" },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.4, release: 1.2 }
        }).toDestination();
    }

    if (currentMidiFile && window.Midi) {
        try {
            audioStatus.textContent = 'Loading MIDI audio...';
            const response = await fetch(currentMidiFile);
            const arrayBuffer = await response.arrayBuffer();
            const midiData = new Midi(arrayBuffer);

            Tone.Transport.cancel();
            
            // Schedule actual notes from the MIDI file
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
            trackProgress(midiData.duration);
            return;
        } catch (e) {
            console.warn('Direct MIDI parsing failed. Falling back to synth engine.');
        }
    }

    // Fallback: Acoustic melodic phrase preview
    const sampleChord = [
        { time: 0, notes: ["E3", "B3", "E4", "G4"] },
        { time: 1.2, notes: ["D3", "A3", "D4", "F#4"] },
        { time: 2.4, notes: ["C3", "G3", "C4", "E4"] },
        { time: 3.6, notes: ["B2", "F#3", "B3", "D#4"] }
    ];

    const part = new Tone.Part((time, value) => {
        synth.triggerAttackRelease(value.notes, "1.5n", time);
    }, sampleChord).start(0);

    part.loop = true;
    part.loopEnd = 4.8;

    Tone.Transport.start();
    isPlaying = true;
    playIcon.textContent = '⏸';
    audioStatus.textContent = `Playing ${activeInstrument.toUpperCase()} sample preview...`;
    trackProgress(4.8);
}

function trackProgress(duration) {
    const update = () => {
        if (!isPlaying) return;
        const curr = Tone.Transport.seconds % duration;
        audioProgress.style.width = `${(curr / duration) * 100}%`;
        requestAnimationFrame(update);
    };
    update();
}

playBtn.addEventListener('click', toggleAudioPlayback);

/* -------------------------------------------------------------
 * 5. MODAL CONTROLLER & COMMERCE OPTIONS
 * ------------------------------------------------------------- */
const modal = document.getElementById('previewModal');
const tabPiano = document.getElementById('tabPiano');
const tabGuitar = document.getElementById('tabGuitar');

function openPreviewModal(song) {
    currentSong = song;
    document.getElementById('previewTitle').innerText = song.title;

    // Detect default starting instrument based on what is available
    if (song.instruments.piano.pdf) {
        activeInstrument = 'piano';
    } else {
        activeInstrument = 'guitar';
    }

    // Visibility toggles for tabs if one doesn't exist
    tabPiano.style.display = song.instruments.piano.pdf ? 'block' : 'none';
    tabGuitar.style.display = song.instruments.guitar.pdf ? 'block' : 'none';

    // Configure pricing options based on inventory
    adjustPricingOptions(song);
    updateModalView();
    modal.classList.add('active');
}

function adjustPricingOptions(song) {
    const hasPiano = !!song.instruments.piano.pdf;
    const hasGuitar = !!song.instruments.guitar.pdf;
    const bothOption = document.querySelector('.price-option[data-bundle="both"]');
    const pianoOption = document.querySelector('.price-option[data-bundle="piano"]');
    const guitarOption = document.querySelector('.price-option[data-bundle="guitar"]');

    bothOption.style.display = (hasPiano && hasGuitar) ? 'flex' : 'none';
    pianoOption.style.display = hasPiano ? 'flex' : 'none';
    guitarOption.style.display = hasGuitar ? 'flex' : 'none';

    // Auto-select best option
    if (hasPiano && hasGuitar) {
        bothOption.click();
    } else if (hasPiano) {
        pianoOption.click();
    } else {
        guitarOption.click();
    }
}

function updateModalView() {
    tabPiano.classList.toggle('active', activeInstrument === 'piano');
    tabGuitar.classList.toggle('active', activeInstrument === 'guitar');

    if (isPlaying) toggleAudioPlayback();

    const pdfPath = currentSong.instruments[activeInstrument].pdf;
    renderSecureFirstPage(pdfPath);
}

tabPiano.addEventListener('click', () => { activeInstrument = 'piano'; updateModalView(); });
tabGuitar.addEventListener('click', () => { activeInstrument = 'guitar'; updateModalView(); });

document.getElementById('modalCloseBtn').addEventListener('click', () => {
    modal.classList.remove('active');
    if (isPlaying) toggleAudioPlayback();
});

/* -------------------------------------------------------------
 * 6. TOYYIBPAY INTEGRATION PLACEHOLDER
 * ------------------------------------------------------------- */
document.getElementById('toyyibpaySubmit').addEventListener('click', () => {
    const selected = document.querySelector('.price-option.selected');
    const bundle = selected.getAttribute('data-bundle');
    const price = selected.getAttribute('data-price');

    initiateToyyibpayCheckout({
        songSlug: currentSong.slug,
        title: currentSong.title,
        bundleType: bundle,
        amountRM: price
    });
});

function initiateToyyibpayCheckout({ songSlug, title, bundleType, amountRM }) {
    // Exact payload signature expected by ToyyibPay
    const paymentData = {
        userSecretKey: "YOUR_TOYYIBPAY_SECRET_KEY", // Configure in server-side proxy
        categoryCode: "YOUR_CATEGORY_CODE",
        billName: `Tazaro: ${title}`,
        billDescription: `Score Bundle: ${bundleType.toUpperCase()}`,
        billPriceSetting: 1,
        billPayorInfo: 1,
        billAmount: (parseFloat(amountRM) * 100).toString(), // Cents format (RM5 = 500)
        billReturnUrl: `${window.location.origin}/success.html`,
        billCallbackUrl: `${window.location.origin}/api/payment-callback.php`,
        billExternalReferenceNo: `TAZ-${songSlug}-${Date.now()}`
    };

    console.log("[ToyyibPay] Ready to forward payload:", paymentData);
    alert(`[ToyyibPay Trigger]\nBill: ${paymentData.billName}\nPrice: RM ${amountRM}\n\nRedirecting to payment gateway...`);
    
    // In production, execute POST call to your ToyyibPay proxy endpoint here
}

// Initial Boot: Discover all files automatically
fetchDynamicInventory();
