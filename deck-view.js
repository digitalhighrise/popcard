(function () {
  const TYPE_LABELS = {
    idea: 'Key idea',
    definition: 'Definition',
    example: 'Example',
    analogy: 'Analogy',
    mistake: 'Common mistake',
    comparison: 'Comparison',
    formula: 'Formula',
    action: 'Action step',
  };

  const IMPORTANCE_LABELS = {
    must_know: 'Must know',
    good_to_know: 'Good to know',
    extra_context: 'Extra',
  };

  const pathMatch = window.location.pathname.match(/^\/deck\/([\w-]+)/);
  const params = new URLSearchParams(window.location.search);
  const id = pathMatch?.[1] || params.get('id');

  const $ = (sel) => document.getElementById(sel);

  const loading = $('deck-loading');
  const errBox = $('deck-error');
  const meta = $('deck-meta');
  const wrap = $('deck-card-wrap');
  const titleEl = $('deck-title');
  const sourceEl = $('deck-source');
  const modePill = $('deck-mode-pill');

  const card = $('deck-card');
  const qEl = $('deck-card-question');
  const aEl = $('deck-card-answer');
  const hintEl = $('deck-card-hint');
  const countEl = $('deck-card-count');
  const countBackEl = $('deck-card-count-back');
  const typeBadge = $('deck-card-type');
  const typeBadgeBack = $('deck-card-type-back');
  const importanceBadge = $('deck-card-importance');
  const tsLink = $('deck-card-timestamp');
  const tsLabel = $('deck-card-timestamp-label');

  const progress = $('deck-progress');
  const prev = $('deck-prev');
  const next = $('deck-next');

  function showError(msg) {
    loading.hidden = true;
    errBox.hidden = false;
    errBox.textContent = msg;
  }

  function ytTimestampUrl(sourceUrl, seconds) {
    if (!sourceUrl || typeof seconds !== 'number') return null;
    try {
      const url = new URL(sourceUrl);
      url.searchParams.set('t', `${Math.max(0, Math.floor(seconds))}s`);
      return url.toString();
    } catch {
      return null;
    }
  }

  function formatSeconds(s) {
    const total = Math.max(0, Math.floor(s));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
  }

  function setBadge(el, label, kind) {
    if (!label) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = label;
    el.dataset.kind = kind;
  }

  if (!id) {
    showError('No deck ID provided.');
    return;
  }

  (async function init() {
    let res;
    try {
      res = await fetch('/api/deck?id=' + encodeURIComponent(id), { credentials: 'same-origin' });
    } catch {
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
      countEl.textContent = countBackEl.textContent = `${idx + 1} / ${cards.length}`;

      setBadge(typeBadge, TYPE_LABELS[c.type] || null, c.type || 'idea');
      setBadge(typeBadgeBack, TYPE_LABELS[c.type] || null, c.type || 'idea');
      setBadge(importanceBadge, IMPORTANCE_LABELS[c.importance] || null, c.importance || 'good_to_know');

      if (c.hint) {
        hintEl.hidden = false;
        hintEl.textContent = '💡 ' + c.hint;
      } else {
        hintEl.hidden = true;
      }

      const tsUrl = ytTimestampUrl(deck.sourceUrl, c.sourceTimestampSeconds);
      if (tsUrl && deck.sourceType === 'youtube') {
        tsLink.hidden = false;
        tsLink.href = tsUrl;
        tsLabel.textContent = `Watch at ${formatSeconds(c.sourceTimestampSeconds)}`;
      } else {
        tsLink.hidden = true;
      }

      progress.style.setProperty('--p', `${((idx + 1) / cards.length) * 100}%`);
      flipped = false;
      card.classList.remove('flipped');
      prev.disabled = idx === 0;
      next.disabled = false;
      next.querySelector('svg').style.opacity = idx === cards.length - 1 ? '0.4' : '1';
    }

    // Flip on click on either side (but not on action buttons or timestamp link)
    card.addEventListener('click', (e) => {
      if (e.target.closest('.deck-action, .deck-card-timestamp')) return;
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
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' && idx > 0) { idx--; render(); }
      else if (e.key === 'ArrowRight' && idx < cards.length - 1) { idx++; render(); }
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        card.click();
      }
    });

    // Per-card refine actions
    document.querySelectorAll('[data-refine]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.refine;
        const c = cards[idx];
        const originalAnswer = aEl.textContent;
        const originalLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const r = await fetch('/api/refine', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, question: c.question, answer: c.answer }),
          });
          if (!r.ok) throw new Error('refine failed');
          const data = await r.json();
          aEl.textContent = data.answer;
          window.PopcardAnalytics?.track('Card Refine', { action });
        } catch {
          aEl.textContent = originalAnswer;
          alert("Couldn't rewrite that — try again.");
        } finally {
          btn.disabled = false;
          btn.textContent = originalLabel;
        }
      });
    });

    render();
    window.PopcardAnalytics?.track('Deck Viewed', {
      mode: deck.mode,
      cards: String(cards.length),
      cached: String(!!deck.fromCache),
    });
  })();
})();
