(async function () {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  const loading = document.getElementById('deck-loading');
  const errBox = document.getElementById('deck-error');
  const meta = document.getElementById('deck-meta');
  const wrap = document.getElementById('deck-card-wrap');
  const titleEl = document.getElementById('deck-title');
  const sourceEl = document.getElementById('deck-source');
  const modePill = document.getElementById('deck-mode-pill');
  const card = document.getElementById('deck-card');
  const qEl = document.getElementById('deck-card-question');
  const aEl = document.getElementById('deck-card-answer');
  const hintEl = document.getElementById('deck-card-hint');
  const countEl = document.getElementById('deck-card-count');
  const countBackEl = document.getElementById('deck-card-count-back');
  const progress = document.getElementById('deck-progress');
  const prev = document.getElementById('deck-prev');
  const next = document.getElementById('deck-next');

  function showError(msg) {
    loading.hidden = true;
    errBox.hidden = false;
    errBox.textContent = msg;
  }

  if (!id) {
    showError('No deck ID provided.');
    return;
  }

  let res;
  try {
    res = await fetch('/api/deck?id=' + encodeURIComponent(id), { credentials: 'same-origin' });
  } catch (e) {
    showError('Network error. Try refreshing.');
    return;
  }

  if (res.status === 401) {
    window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showError(data.error || 'Could not load this deck.');
    return;
  }

  const { deck, cards } = await res.json();

  loading.hidden = true;
  meta.hidden = false;
  wrap.hidden = false;

  titleEl.textContent = deck.title || 'Untitled deck';
  modePill.textContent = deck.mode;
  if (deck.sourceUrl) {
    sourceEl.hidden = false;
    sourceEl.href = deck.sourceUrl;
    sourceEl.textContent = deck.sourceUrl;
  }

  if (!cards.length) {
    showError("This deck doesn't have any cards yet.");
    return;
  }

  let idx = 0;
  let flipped = false;

  function render() {
    const c = cards[idx];
    qEl.textContent = c.question;
    aEl.textContent = c.answer;
    if (c.hint) {
      hintEl.hidden = false;
      hintEl.textContent = '💡 ' + c.hint;
    } else {
      hintEl.hidden = true;
    }
    countEl.textContent = countBackEl.textContent = `${idx + 1} / ${cards.length}`;
    progress.style.setProperty('--p', `${((idx + 1) / cards.length) * 100}%`);
    flipped = false;
    card.classList.remove('flipped');
    prev.disabled = idx === 0;
    next.disabled = false;
    next.querySelector('svg').style.opacity = idx === cards.length - 1 ? '0.4' : '1';
  }

  card.addEventListener('click', () => {
    flipped = !flipped;
    card.classList.toggle('flipped', flipped);
    window.PopcardAnalytics?.track('Card Flip', { side: flipped ? 'answer' : 'question' });
  });

  prev.addEventListener('click', (e) => {
    e.stopPropagation();
    if (idx > 0) { idx--; render(); }
  });

  next.addEventListener('click', (e) => {
    e.stopPropagation();
    if (idx < cards.length - 1) { idx++; render(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && idx > 0) { idx--; render(); }
    else if (e.key === 'ArrowRight' && idx < cards.length - 1) { idx++; render(); }
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      card.click();
    }
  });

  render();
  window.PopcardAnalytics?.track('Deck Viewed', { mode: deck.mode, cards: String(cards.length), cached: String(deck.fromCache || false) });
})();
