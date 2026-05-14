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
  const gridWrap = $('deck-grid-wrap');
  const gridEl = $('deck-grid');
  const gridCountEl = $('deck-grid-count');
  const titleEl = $('deck-title');
  const sourceEl = $('deck-source');
  const modePill = $('deck-mode-pill');

  const card = $('deck-card');
  const qEl = $('deck-card-question');
  const aEl = $('deck-card-answer');
  const aInlineEl = $('deck-card-answer-inline');
  const hintEl = $('deck-card-hint');
  const countEl = $('deck-card-count');
  const countBackEl = $('deck-card-count-back');
  const typeBadge = $('deck-card-type');
  const typeBadgeBack = $('deck-card-type-back');
  const importanceBadge = $('deck-card-importance');
  const tsLink = $('deck-card-timestamp');
  const tsLabel = $('deck-card-timestamp-label');
  const tapReveal = $('deck-card-tap-reveal');
  const actionsFront = $('deck-card-actions-front');

  const progress = $('deck-progress');
  const prev = $('deck-prev');
  const next = $('deck-next');
  const showAllBtn = $('deck-show-all');
  const gridBack = $('deck-grid-back');
  const startQuizBtn = $('deck-start-quiz');

  // Deck-level action refs
  const pinBtn = $('deck-pin');
  const pinLabel = $('deck-pin-label');
  const renameBtn = $('deck-rename');
  const deleteBtn = $('deck-delete');

  // Quiz refs
  const quizWrap = $('deck-quiz-wrap');
  const quizLoading = $('deck-quiz-loading');
  const quizError = $('deck-quiz-error');
  const quizActive = $('deck-quiz-active');
  const quizResults = $('deck-quiz-results');
  const quizQuestionEl = $('quiz-question');
  const quizOptionsEl = $('quiz-options');
  const quizFeedback = $('quiz-feedback');
  const quizFeedbackStatus = $('quiz-feedback-status');
  const quizFeedbackText = $('quiz-feedback-text');
  const quizNextBtn = $('quiz-next');
  const quizCurrentNum = $('quiz-current-num');
  const quizTotalNum = $('quiz-total-num');
  const quizProgressFill = $('quiz-progress-fill');
  const quizScoreEmoji = $('quiz-score-emoji');
  const quizScoreNum = $('quiz-score-num');
  const quizScoreLabel = $('quiz-score-label');
  const quizScoreSub = $('quiz-score-sub');
  const quizRetake = $('quiz-retake');
  const quizBackDeck = $('quiz-back-deck');
  const quizMissedList = $('quiz-missed-list');

  function showError(msg) {
    loading.hidden = true;
    errBox.hidden = false;
    errBox.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
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
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
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

    const isSimple = deck.mode === 'simple';
    card.classList.toggle('mode-simple', isSimple);

    let idx = 0;
    let flipped = false;

    function render() {
      const c = cards[idx];
      qEl.textContent = c.question;
      aEl.textContent = c.answer;
      aInlineEl.textContent = c.answer;
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

      if (isSimple) {
        aInlineEl.hidden = false;
        actionsFront.hidden = false;
        tapReveal.hidden = true;
      } else {
        aInlineEl.hidden = true;
        actionsFront.hidden = true;
        tapReveal.hidden = false;
      }

      progress.style.setProperty('--p', `${((idx + 1) / cards.length) * 100}%`);
      flipped = false;
      card.classList.remove('flipped');
      prev.disabled = idx === 0;
      next.disabled = false;
      next.querySelector('svg').style.opacity = idx === cards.length - 1 ? '1' : '1';
    }

    function showGrid(reason) {
      renderGrid();
      wrap.hidden = true;
      if (quizWrap) quizWrap.hidden = true;
      gridWrap.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.PopcardAnalytics?.track('Deck Grid View', { reason: reason || 'manual' });
    }

    function showCards() {
      wrap.hidden = false;
      gridWrap.hidden = true;
      if (quizWrap) quizWrap.hidden = true;
    }

    const GRID_PALETTE = [
      { bg: '#6E3DEA', tone: 'light' },  // purple
      { bg: '#FF3DA0', tone: 'light' },  // pink
      { bg: '#FF8A3D', tone: 'light' },  // orange
      { bg: '#FFD338', tone: 'dark'  },  // yellow
      { bg: '#2BC489', tone: 'light' },  // green
      { bg: '#3DAEFF', tone: 'light' },  // blue
    ];

    function renderGrid() {
      gridCountEl.textContent = cards.length;
      gridEl.innerHTML = cards.map((c, i) => {
        const color = GRID_PALETTE[i % GRID_PALETTE.length];
        const typeLabel = TYPE_LABELS[c.type] || c.type || 'Card';
        const impLabel = IMPORTANCE_LABELS[c.importance] || c.importance || 'Good to know';
        const tsUrl = ytTimestampUrl(deck.sourceUrl, c.sourceTimestampSeconds);
        const tsBlock = (tsUrl && deck.sourceType === 'youtube')
          ? `<a class="deck-grid-ts" href="${tsUrl}" target="_blank" rel="noopener">▶ Watch at ${formatSeconds(c.sourceTimestampSeconds)}</a>`
          : '';
        const hintBlock = c.hint
          ? `<div class="deck-grid-hint">💡 ${escapeHtml(c.hint)}</div>`
          : '';
        return `
          <article class="deck-grid-card" data-importance="${c.importance || 'good_to_know'}" data-tone="${color.tone}" style="background:${color.bg}">
            <div class="deck-grid-card-top">
              <span class="deck-grid-num">${i + 1} / ${cards.length}</span>
              <div class="deck-grid-card-badges">
                <span class="deck-grid-badge deck-grid-badge-type">${escapeHtml(typeLabel)}</span>
                <span class="deck-grid-badge deck-grid-badge-importance" data-kind="${c.importance || 'good_to_know'}">${escapeHtml(impLabel)}</span>
              </div>
            </div>
            <h3 class="deck-grid-q">${escapeHtml(c.question)}</h3>
            <p class="deck-grid-a">${escapeHtml(c.answer)}</p>
            ${hintBlock}
            ${tsBlock}
          </article>
        `;
      }).join('');
    }

    // Flip on click (study mode only)
    card.addEventListener('click', (e) => {
      if (isSimple) return;
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
      if (idx < cards.length - 1) {
        idx++;
        render();
      } else {
        // Reached the end → show all cards
        showGrid('end_of_deck');
      }
    });

    showAllBtn.addEventListener('click', () => showGrid('manual'));
    gridBack.addEventListener('click', () => showCards());

    // ---------- Quiz Mode (Study decks only) ----------
    let quizQuestions = null;       // cached so Retake doesn't re-pay
    let quizIdx = 0;
    let quizMissed = [];            // array of { q, given, correct, explanation }
    let quizAnswered = false;       // whether current question has been answered

    if (!isSimple) {
      startQuizBtn.hidden = false;
      startQuizBtn.addEventListener('click', () => startQuiz());
      quizNextBtn.addEventListener('click', () => advanceQuiz());
      quizRetake.addEventListener('click', () => resetQuiz());
      quizBackDeck.addEventListener('click', () => hideQuiz());
    }

    function showQuizSection() {
      wrap.hidden = true;
      gridWrap.hidden = true;
      quizWrap.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function hideQuiz() {
      quizWrap.hidden = true;
      gridWrap.hidden = true;
      wrap.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function startQuiz() {
      showQuizSection();
      quizLoading.hidden = false;
      quizActive.hidden = true;
      quizResults.hidden = true;
      quizError.hidden = true;

      if (quizQuestions) {
        // Already cached
        kickOffQuiz();
        return;
      }

      try {
        const r = await fetch('/api/quiz', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deckId: deck.id }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || data.error || 'Quiz failed');
        if (!data.questions?.length) throw new Error('No quiz questions returned');
        quizQuestions = data.questions;
        kickOffQuiz();
        window.PopcardAnalytics?.track('Quiz Started', { questions: String(quizQuestions.length) });
      } catch (e) {
        quizLoading.hidden = true;
        quizError.hidden = false;
        quizError.textContent = e.message || 'Could not generate quiz. Try again.';
      }
    }

    function kickOffQuiz() {
      quizLoading.hidden = true;
      quizError.hidden = true;
      quizResults.hidden = true;
      quizActive.hidden = false;
      quizIdx = 0;
      quizMissed = [];
      quizTotalNum.textContent = quizQuestions.length;
      renderQuizQuestion();
    }

    function resetQuiz() {
      kickOffQuiz();
      window.PopcardAnalytics?.track('Quiz Retake');
    }

    function renderQuizQuestion() {
      const q = quizQuestions[quizIdx];
      quizCurrentNum.textContent = quizIdx + 1;
      quizProgressFill.style.width = `${((quizIdx) / quizQuestions.length) * 100}%`;
      quizQuestionEl.textContent = q.question;
      quizFeedback.hidden = true;
      quizAnswered = false;
      quizOptionsEl.innerHTML = '';
      q.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'deck-quiz-option';
        btn.textContent = opt;
        btn.dataset.index = String(i);
        btn.addEventListener('click', () => selectQuizOption(i, btn));
        quizOptionsEl.appendChild(btn);
      });
    }

    function selectQuizOption(idx, btn) {
      if (quizAnswered) return;
      quizAnswered = true;
      const q = quizQuestions[quizIdx];
      const correct = idx === q.correctIndex;
      Array.from(quizOptionsEl.children).forEach((b, i) => {
        b.disabled = true;
        if (i === q.correctIndex) b.classList.add('is-correct');
        if (i === idx && !correct) b.classList.add('is-wrong');
      });
      quizFeedback.hidden = false;
      quizFeedbackStatus.textContent = correct ? '✓ Correct' : '✗ Not quite';
      quizFeedbackStatus.className = 'deck-quiz-feedback-status ' + (correct ? 'is-correct' : 'is-wrong');
      quizFeedbackText.textContent = q.explanation || '';
      quizNextBtn.textContent = (quizIdx === quizQuestions.length - 1) ? 'See results →' : 'Next question →';
      if (!correct) {
        quizMissed.push({
          q: q.question,
          given: q.options[idx],
          correct: q.options[q.correctIndex],
          explanation: q.explanation,
        });
      }
      window.PopcardAnalytics?.track('Quiz Answer', { correct: String(correct) });
      // Scroll feedback into view if needed
      quizFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function advanceQuiz() {
      if (quizIdx < quizQuestions.length - 1) {
        quizIdx++;
        renderQuizQuestion();
      } else {
        showQuizResults();
      }
    }

    function showQuizResults() {
      quizActive.hidden = true;
      quizResults.hidden = false;
      quizProgressFill.style.width = '100%';
      const total = quizQuestions.length;
      const right = total - quizMissed.length;
      const pct = Math.round((right / total) * 100);
      quizScoreNum.textContent = `${right} / ${total}`;
      quizScoreEmoji.textContent = pct === 100 ? '🏆' : pct >= 80 ? '🎉' : pct >= 60 ? '💪' : pct >= 40 ? '📚' : '🌱';
      quizScoreLabel.textContent =
        pct === 100 ? "Perfect — you've got this." :
        pct >= 80 ? "Strong work." :
        pct >= 60 ? "Solid, with a couple to revisit." :
        pct >= 40 ? "A few to brush up on." :
        "Worth another pass through the cards.";
      quizScoreSub.textContent = pct === 100
        ? 'Nothing to review.'
        : `${quizMissed.length} card${quizMissed.length === 1 ? '' : 's'} worth revisiting.`;

      if (quizMissed.length) {
        quizMissedList.hidden = false;
        quizMissedList.innerHTML = `
          <h3 class="deck-quiz-missed-title">Worth revisiting</h3>
          ${quizMissed.map((m) => `
            <article class="deck-quiz-missed-card">
              <div class="deck-quiz-missed-q">${escapeHtml(m.q)}</div>
              <div class="deck-quiz-missed-row"><span class="deck-quiz-missed-label deck-quiz-missed-label-wrong">You said</span> ${escapeHtml(m.given)}</div>
              <div class="deck-quiz-missed-row"><span class="deck-quiz-missed-label deck-quiz-missed-label-right">Correct</span> ${escapeHtml(m.correct)}</div>
              <p class="deck-quiz-missed-why">${escapeHtml(m.explanation || '')}</p>
            </article>
          `).join('')}
        `;
      } else {
        quizMissedList.hidden = true;
      }

      window.PopcardAnalytics?.track('Quiz Completed', {
        score: String(right),
        total: String(total),
        pct: String(pct),
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // Only handle keys while in single-card view
      if (gridWrap.hidden === false) {
        if (e.key === 'Escape') showCards();
        return;
      }
      if (e.key === 'ArrowLeft' && idx > 0) { idx--; render(); }
      else if (e.key === 'ArrowRight') {
        if (idx < cards.length - 1) { idx++; render(); }
        else { showGrid('end_of_deck'); }
      } else if (!isSimple && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        card.click();
      }
    });

    // Per-card refine actions (both front and back have the same buttons)
    document.querySelectorAll('.deck-action[data-refine]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.refine;
        const c = cards[idx];
        const originalAnswer = c.answer;
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
          // Update both visible answer slots (we may be on either side)
          aEl.textContent = data.answer;
          aInlineEl.textContent = data.answer;
          // Persist on the in-memory card so it sticks across navigation
          cards[idx].answer = data.answer;
          window.PopcardAnalytics?.track('Card Refine', { action });
        } catch {
          aEl.textContent = originalAnswer;
          aInlineEl.textContent = originalAnswer;
          alert("Couldn't rewrite that — try again.");
        } finally {
          btn.disabled = false;
          btn.textContent = originalLabel;
        }
      });
    });

    // ---------- Deck-level actions: rename, pin, delete ----------
    let isPinned = !!deck.pinned;
    function paintPin() {
      pinBtn.classList.toggle('is-pinned', isPinned);
      pinLabel.textContent = isPinned ? 'Pinned' : 'Pin';
      const svg = pinBtn.querySelector('svg');
      if (svg) svg.setAttribute('fill', isPinned ? 'currentColor' : 'none');
    }
    paintPin();

    pinBtn.addEventListener('click', async () => {
      pinBtn.disabled = true;
      try {
        const r = await fetch('/api/deck?id=' + encodeURIComponent(deck.id), {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: !isPinned }),
        });
        if (!r.ok) throw new Error('pin failed');
        isPinned = !isPinned;
        paintPin();
        window.PopcardAnalytics?.track('Deck Pin', { pinned: String(isPinned) });
      } catch {
        alert("Couldn't update pin — try again.");
      } finally {
        pinBtn.disabled = false;
      }
    });

    function startRename() {
      const old = titleEl.textContent;
      titleEl.contentEditable = 'true';
      titleEl.classList.add('is-editing');
      titleEl.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        titleEl.contentEditable = 'false';
        titleEl.classList.remove('is-editing');
        const next = titleEl.textContent.trim().slice(0, 140);
        if (!save || !next || next === old) {
          titleEl.textContent = old;
          return;
        }
        try {
          const r = await fetch('/api/deck?id=' + encodeURIComponent(deck.id), {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: next }),
          });
          if (!r.ok) throw new Error('rename failed');
          titleEl.textContent = next;
          window.PopcardAnalytics?.track('Deck Rename');
        } catch {
          titleEl.textContent = old;
          alert("Couldn't rename — try again.");
        }
      };

      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      };
      titleEl.addEventListener('keydown', onKey, { once: false });
      titleEl.addEventListener('blur', () => {
        titleEl.removeEventListener('keydown', onKey);
        finish(true);
      }, { once: true });
    }

    renameBtn.addEventListener('click', startRename);
    titleEl.addEventListener('click', () => {
      if (titleEl.classList.contains('is-editing')) return;
      startRename();
    });

    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${deck.title}"? This can't be undone.`)) return;
      deleteBtn.disabled = true;
      try {
        const r = await fetch('/api/deck?id=' + encodeURIComponent(deck.id), {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error('delete failed');
        window.PopcardAnalytics?.track('Deck Delete');
        window.location.href = '/account';
      } catch {
        deleteBtn.disabled = false;
        alert("Couldn't delete — try again.");
      }
    });

    wrap.hidden = false;
    render();
    window.PopcardAnalytics?.track('Deck Viewed', {
      mode: deck.mode,
      cards: String(cards.length),
      cached: String(!!deck.fromCache),
    });
  })();
})();
