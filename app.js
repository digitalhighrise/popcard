// ---------- Hero deck cycling + mode-aware content ----------
const HERO_ICON_PLAY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const HERO_ICON_PHOTO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>';

// Content in HTML element order (top-to-bottom in the stack: blue, green, yellow, orange, pink, purple).
const HERO_CONTENT = {
  simple: [
    { count: '11:34', q: '"How TikTok decides what you see next"',     body: 'Three signals: how long you watched, what you watched right before, and what people like you watched. Engagement beats relevance.', icon: HERO_ICON_PLAY },
    { count: '6:42',  q: '"What caffeine actually does to your brain"', body: "It doesn't give you energy. It blocks the chemical that makes you tired. Then it wears off — and you crash twice as hard.",            icon: HERO_ICON_PLAY },
    { count: '9:18',  q: '"Why Costco hot dogs are still $1.50"',       body: "Costco loses money on the food court on purpose. The hot dog isn't the product — getting you back inside the warehouse is.",      icon: HERO_ICON_PLAY },
    { count: '8:21',  q: '"Why your brain loves procrastination"',      body: "It's not laziness — it's your brain dodging anticipated emotional pain. The fix isn't more discipline; it's making the start feel safer.", icon: HERO_ICON_PLAY },
    { count: '18:30', q: '"What actually ended the Roman Empire"',      body: "No single thing. Currency debasement, plagues, fifty emperors in fifty years. The West didn't fall — it slowly dissolved.",       icon: HERO_ICON_PLAY },
    { count: '14:50', q: '"How to learn anything in 20 hours"',         body: 'The plateau between beginner and "pretty good" is short. Most quit during the awkward middle. Push past it — you\'re suddenly competent.', icon: HERO_ICON_PLAY },
  ],
  study: [
    { count: '4 / 15', q: 'Law of supply and demand?',           body: 'As price rises, supply grows and demand drops — the meeting point is the market equilibrium.',          icon: HERO_ICON_PHOTO },
    { count: '5 / 22', q: 'Function of mitochondria?',           body: "The powerhouse of the cell — it generates most of the cell's ATP through cellular respiration.",         icon: HERO_ICON_PHOTO },
    { count: '2 / 18', q: "Newton's third law?",                 body: 'For every action there is an equal and opposite reaction — push a wall, the wall pushes back.',          icon: HERO_ICON_PHOTO },
    { count: '7 / 30', q: 'When did the French Revolution start?', body: '14 July 1789 — the storming of the Bastille marked its beginning.',                                    icon: HERO_ICON_PHOTO },
    { count: '3 / 12', q: 'Pythagorean theorem?',                body: 'In a right triangle, a² + b² = c² — the hypotenuse squared equals the sum of the other two sides squared.', icon: HERO_ICON_PHOTO },
    { count: '1 / 24', q: 'What is photosynthesis?',             body: 'Photosynthesis is the process plants, algae and some bacteria use to convert light energy into chemical energy.', icon: HERO_ICON_PHOTO },
  ],
};

function renderHeroDeck(mode) {
  const stack = document.getElementById('hero-deck-stack');
  if (!stack) return;
  const cards = Array.from(stack.querySelectorAll('.deck-card'));
  const data = HERO_CONTENT[mode] || HERO_CONTENT.simple;
  cards.forEach((card, i) => {
    const d = data[i];
    if (!d) return;
    const cEl = card.querySelector('.count');
    const qEl = card.querySelector('.q');
    const bEl = card.querySelector('.body');
    const iEl = card.querySelector('.ph-icon');
    if (cEl) cEl.textContent = d.count;
    if (qEl) qEl.textContent = d.q;
    if (bEl) bEl.textContent = d.body;
    if (iEl) iEl.innerHTML = d.icon;
  });
}

(function () {
  const stack = document.getElementById('hero-deck-stack');
  const prev = document.getElementById('hero-prev');
  const next = document.getElementById('hero-next');
  if (!stack || !prev || !next) return;

  const cards = Array.from(stack.querySelectorAll('.deck-card'));
  const TOTAL = cards.length;
  let busy = false;

  function cycle(dir) {
    if (busy) return;
    busy = true;
    cards.forEach((card) => {
      const m = card.className.match(/\bl(\d)\b/);
      if (!m) return;
      const cur = parseInt(m[1], 10);
      const next_ = dir === 'next'
        ? (cur - 1 + TOTAL) % TOTAL  // front → back: 0→5, 1→0, 2→1, …
        : (cur + 1) % TOTAL;         // back → front: 5→0, 0→1, …
      card.className = card.className.replace(/\bl\d\b/, 'l' + next_);
    });
    window.PopcardAnalytics?.track('Hero Deck Cycle', { direction: dir });
    setTimeout(() => { busy = false; }, 600);
  }

  next.addEventListener('click', (e) => { e.stopPropagation(); cycle('next'); });
  prev.addEventListener('click', (e) => { e.stopPropagation(); cycle('prev'); });
})();

const modeButtons = document.querySelectorAll('.mode');
let currentMode = 'simple';
modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    modeButtons.forEach((b) => {
      const isActive = b === btn;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    currentMode = btn.dataset.mode;
    renderHeroDeck(currentMode);
    window.PopcardAnalytics?.track('Mode Toggle', { mode: currentMode });
  });
});

// ---- Language picker ----
// The actual picker lives in the header (lang-picker.js, loaded on every
// page). We just read its current value when popping.
const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'zh', 'hi', 'ar', 'pt', 'fr', 'de', 'ja', 'ru']);
function getCurrentLanguage() {
  const v = window.PopcardLang?.current;
  return v && SUPPORTED_LANGUAGES.has(v) ? v : 'en';
}

const pasteBtn = document.getElementById('paste-btn');
const heroInput = document.getElementById('hero-input');
if (pasteBtn && heroInput) {
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      heroInput.value = text;
      heroInput.focus();
      window.PopcardAnalytics?.track('Paste Click', { success: 'true' });
    } catch {
      heroInput.focus();
      window.PopcardAnalytics?.track('Paste Click', { success: 'false' });
    }
  });
}

// ---------- Ebook upload (EPUB / PDF / TXT) ----------
const uploadBtn = document.getElementById('upload-btn');
const uploadFile = document.getElementById('upload-file');
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30MB

if (uploadBtn && uploadFile && heroInput) {
  uploadBtn.addEventListener('click', () => uploadFile.click());
  uploadFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    uploadFile.value = ''; // allow re-uploading the same file
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 30 MB.`, true);
      return;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    uploadBtn.disabled = true;
    const pb = document.getElementById('pop-btn');
    pb?.classList.add('loading'); // makes the progress bar visible during extraction
    setStatus(`Reading "${file.name}"…`);
    setPopProgress(2, 200);
    try {
      const text = await extractTextFromFile(file, ext, (pct) => setPopProgress(pct, 200));
      if (!text || text.trim().length < 200) {
        throw new Error(ext === 'pdf'
          ? "Couldn't extract usable text. Scanned/image-only PDFs need OCR (not supported yet)."
          : "Couldn't extract usable text from this file.");
      }
      setPopProgress(50, 200);
      heroInput.value = text;
      window.PopcardAnalytics?.track('Ebook Upload', { type: ext, chars: text.length });
      setStatus(`Extracted ${text.length.toLocaleString()} chars from "${file.name}" — popping…`);
      if (pb) pb.click();
    } catch (err) {
      pb?.classList.remove('loading');
      resetPopProgress();
      setStatus(err.message || 'Upload failed.', true);
      window.PopcardAnalytics?.track('Ebook Upload Failed', { type: ext, reason: err.message || 'unknown' });
    } finally {
      uploadBtn.disabled = false;
    }
  });
}

async function extractTextFromFile(file, ext, onProgress) {
  if (ext === 'txt' || ext === 'md') {
    onProgress?.(25);
    const t = await file.text();
    onProgress?.(50);
    return t;
  }
  if (ext === 'epub') return await extractEpubText(file, onProgress);
  if (ext === 'pdf') return await extractPdfText(file, onProgress);
  throw new Error('Unsupported file type. Use .epub, .pdf, .txt or .md.');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', resolve);
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.src = src;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function extractEpubText(file, onProgress) {
  if (!window.JSZip) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  }
  onProgress?.(5);
  const zip = await window.JSZip.loadAsync(file);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Not a valid EPUB (missing container.xml).');
  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Could not locate OPF in container.xml.');
  const opfDir = opfPath.split('/').slice(0, -1).join('/');
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('Could not read OPF.');
  const opfDoc = parser.parseFromString(opfXml, 'application/xml');

  const manifest = {};
  opfDoc.querySelectorAll('manifest > item').forEach((it) => {
    const id = it.getAttribute('id');
    const href = it.getAttribute('href');
    if (id && href) manifest[id] = href;
  });
  const spine = Array.from(opfDoc.querySelectorAll('spine > itemref'))
    .map((r) => r.getAttribute('idref'))
    .filter(Boolean);

  const parts = [];
  for (let i = 0; i < spine.length; i++) {
    const id = spine[i];
    const href = manifest[id];
    if (href) {
      const decodedHref = decodeURIComponent(href);
      const path = opfDir ? `${opfDir}/${decodedHref}` : decodedHref;
      const content = await zip.file(path)?.async('string');
      if (content) parts.push(stripHtml(content));
    }
    onProgress?.(5 + ((i + 1) / spine.length) * 45);
  }
  return parts.join('\n\n').trim();
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdfText(file, onProgress) {
  if (!window.pdfjsLib) {
    await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/legacy/build/pdf.min.js');
    if (!window.pdfjsLib) throw new Error('PDF library failed to load.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/legacy/build/pdf.worker.min.js';
  }
  onProgress?.(5);
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const pieces = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pieces.push(content.items.map((it) => it.str).join(' '));
    if (i % 20 === 0) setStatus(`Reading PDF… page ${i} / ${pdf.numPages}`);
    onProgress?.(5 + (i / pdf.numPages) * 45);
  }
  return pieces.join('\n\n').trim();
}

const popBtn = document.getElementById('pop-btn');
const popStatus = document.getElementById('pop-status');
const popLabel = document.getElementById('pop-btn-label');

function setStatus(msg, isError) {
  if (!popStatus) return;
  popStatus.textContent = msg || '';
  popStatus.classList.toggle('error', !!isError);
}

// ---- Pop progress bar ----
// 0–50% is "real" progress driven by extraction (per-page / per-spine-item).
// 50–90% is a linear ramp during the /api/pop call (no streaming, so it's
// time-based). 100% snaps on success; resets to 0% on failure.
let popProgress = 0;
function setPopProgress(targetPct, durationMs = 300) {
  const bar = document.getElementById('pop-bar-fill');
  popProgress = Math.max(0, Math.min(100, targetPct));
  if (!bar) return;
  bar.style.transition = `width ${durationMs}ms linear, opacity 200ms ease-out`;
  bar.style.width = `${popProgress}%`;
}
function resetPopProgress() {
  popProgress = 0;
  const bar = document.getElementById('pop-bar-fill');
  if (!bar) return;
  bar.style.transition = 'width 200ms ease-out, opacity 200ms ease-out';
  bar.style.width = '0%';
}

// Classify the input so the progress bar + status messages match expected
// duration. Books / long PDFs spend 2-3 minutes in the LLM; a YouTube link or
// a paragraph of text might be done in 10s. Without this, the bar finishes
// its ramp in 25s and then hangs for two minutes, looking broken.
function classifyPopInput(input) {
  if (/youtube\.com|youtu\.be/.test(input)) {
    return { kind: 'youtube', expectedSec: 75 };
  }
  const chars = (input || '').length;
  if (chars < 5_000)   return { kind: 'short_text', expectedSec: 18 };
  if (chars < 50_000)  return { kind: 'article',    expectedSec: 60 };
  if (chars < 200_000) return { kind: 'long_text',  expectedSec: 130 };
  return { kind: 'book', expectedSec: 240 };
}

const POP_MESSAGES = {
  youtube: [
    "Pulling the transcript from YouTube…",
    "Reading what they said…",
    "Picking the moments that matter…",
    "Spotting the lines worth quoting…",
    "Drafting the overview card…",
    "Writing the first batch of cards…",
    "Working through the middle…",
    "Pulling speaker quotes with timestamps…",
    "Building cards on the harder ideas…",
    "Polishing card-by-card…",
    "Almost there — making them shine…",
    "Just wrapping up the final cards…",
  ],
  short_text: [
    "Reading your text…",
    "Picking the key ideas…",
    "Drafting your cards…",
    "Almost there — making them shine…",
  ],
  article: [
    "Reading the article…",
    "Finding the load-bearing points…",
    "Drafting the overview card…",
    "Writing the first batch of cards…",
    "Pulling key quotes from the piece…",
    "Working through the body…",
    "Capturing the conclusion…",
    "Polishing card-by-card…",
    "Almost done — final pass…",
  ],
  long_text: [
    "Reading your file…",
    "Skimming the opening sections…",
    "Finding the load-bearing ideas…",
    "Identifying the author and main argument…",
    "Drafting the overview card…",
    "Pulling key quotes with attribution…",
    "Building the first batch of cards…",
    "Working through the middle sections…",
    "Tracking the author's central themes…",
    "Cards from the later sections coming through…",
    "Polishing quotes and bolding key terms…",
    "Reviewing for duplicates…",
    "Almost done — final polish…",
    "Just finalising the last cards…",
  ],
  book: [
    "Reading your book…",
    "Skimming the opening chapters…",
    "Finding the load-bearing arguments…",
    "Identifying the author and core thesis…",
    "Drafting the overview card with author + breakdown…",
    "Pulling memorable quotes with chapter references…",
    "Building cards on early chapters…",
    "Working through the middle of the book…",
    "Tracking the author's central frameworks…",
    "Halfway there — staying with it…",
    "Cards from the later chapters coming in…",
    "Capturing turning-point moments…",
    "Pulling the strongest quotes with attribution…",
    "Polishing bold emphasis on names and titles…",
    "Reviewing for duplicates and weak cards…",
    "Almost done — final polish…",
    "Just finalising the last cards…",
    "Wrapping the deck…",
  ],
};

function startPopProgress(input) {
  const { kind, expectedSec } = classifyPopInput(input);
  const msgs = POP_MESSAGES[kind] || POP_MESSAGES.article;
  // Spread the messages over the expected duration so they don't all cycle
  // through in the first 20 seconds and then sit on the last message.
  const interval = Math.max(2500, Math.round((expectedSec * 1000) / msgs.length));
  let i = 0;
  setStatus(msgs[0]);
  return setInterval(() => {
    i = Math.min(i + 1, msgs.length - 1);
    setStatus(msgs[i]);
  }, interval);
}

if (popBtn && heroInput) {
  popBtn.addEventListener('click', async () => {
    const input = heroInput.value.trim();
    if (!input) {
      heroInput.focus();
      setStatus('Paste a YouTube link or some text first.', true);
      return;
    }

    popBtn.classList.add('loading');
    popBtn.disabled = true;
    popLabel.textContent = 'Popping…';
    setStatus('');
    const progressTimer = startPopProgress(input);

    // Adaptive progress bar: ramp duration scales with expected pop time.
    // After reaching 85%, slowly creep toward 97% over the remaining window
    // so the bar never visibly stalls on long pops (books = 2–4 min).
    const { expectedSec } = classifyPopInput(input);
    const startPct = popProgress < 5 ? 5 : popProgress;
    setPopProgress(startPct, 200);
    const rampToMainMs = Math.max(8000, ((85 - startPct) / 90) * expectedSec * 1000 * 0.75);
    const creepMs = expectedSec * 1000 * 1.2; // slow creep from 85% to 97%
    setTimeout(() => setPopProgress(85, rampToMainMs), 220);
    setTimeout(() => setPopProgress(97, creepMs), 220 + rampToMainMs);

    try {
      const language = getCurrentLanguage();
      const res = await fetch('/api/pop', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, mode: currentMode, language }),
      });

      if (res.status === 401) {
        // Stash the pending pop so the user can resume after sign-in
        try { sessionStorage.setItem('pendingPop', JSON.stringify({ input, mode: currentMode, language })); } catch {}
        window.location.href = '/login?next=' + encodeURIComponent('/');
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        resetPopProgress();
        setStatus(data.message || data.error || 'Something went wrong.', true);
        window.PopcardAnalytics?.track('Pop Failed', { reason: data.error || 'unknown' });
      } else {
        setPopProgress(100, 250);
        window.PopcardAnalytics?.track('Pop Success', {
          mode: data.deck.mode,
          cards: String(data.deck.cardCount),
          cached: String(!!data.deck.fromCache),
        });
        await new Promise((r) => setTimeout(r, 250)); // let the bar visibly hit 100
        window.location.href = '/deck/' + data.deck.id;
        return;
      }
    } catch (e) {
      resetPopProgress();
      setStatus('Network error. Try again.', true);
    } finally {
      clearInterval(progressTimer);
      popBtn.classList.remove('loading');
      popBtn.disabled = false;
      popLabel.textContent = 'Pop it into cards';
    }
  });

  // Auto-resume after sign-in redirect
  try {
    const pending = sessionStorage.getItem('pendingPop');
    if (pending) {
      sessionStorage.removeItem('pendingPop');
      const { input, mode, language } = JSON.parse(pending);
      heroInput.value = input;
      currentMode = mode;
      if (language && SUPPORTED_LANGUAGES.has(language)) {
        window.PopcardLang?.set(language);
      }
      modeButtons.forEach((b) => {
        const active = b.dataset.mode === mode;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      renderHeroDeck(currentMode);
      window.PopcardAuth?.me().then((u) => {
        if (u) popBtn.click();
      });
    }
  } catch {}
}
