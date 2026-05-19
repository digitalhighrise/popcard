// Quizzes page — Duolingo-style MCQ quiz.
//
// Interaction model:
//   1. User picks a deck → quiz fades in as a full-screen overlay.
//   2. Per question: tap an option to select it (no auto-grade) → CHECK
//      button activates → tap CHECK to grade → feedback panel slides up at
//      the bottom of the screen with mascot reaction → CONTINUE → next.
//   3. End → graduation/cheer/idle/sad mascot by score band, sparks tally.
//
// For each deck the user picks, we fetch all cards, pick up to 10 random
// ones, and generate 3 distractor options per question from OTHER cards'
// answers in the same deck. Need ≥4 cards in a deck to make a quiz.
//
// Mascot states are swapped via .is-active class on the matching element
// inside .qz-stage / .qz-complete-stage. Each state can be an <img> or
// <video> — see HTML for the swap pattern.

(function () {

  const QUESTIONS_PER_QUIZ = 10;
  const OPTIONS_PER_QUESTION = 4;
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  let decks = [];
  let currentQuiz = null;     // { deckIds, deckTitle, questions, index, score, rounds }
  let selectedIdx = null;     // null until user picks an answer
  let isGraded = false;       // false until CHECK clicked
  const selectedDeckIds = new Set();   // multi-deck selection from picker

  // Pool of cards held between the deck pick and the round-length pick.
  // Populated by startQuiz, consumed by launchQuiz.
  let pendingCards = null;
  let pendingDeckIds = null;
  let pendingDeckTitle = null;

  // Nominal round lengths (capped at available card count at runtime).
  const ROUND_TARGETS = { quick: 5, standard: 10, long: 20 };

  // Hearts (lives) + XP — Duolingo-style. Wrong answer costs a heart; XP
  // accrues per correct. Running out of hearts ends the quiz early.
  const STARTING_LIVES = 3;
  const XP_PER_CORRECT = 3;
  const XP_PERFECT_BONUS = 20;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Swap which mascot state is visible inside a stage element.
  // The matching child gets .is-active; others lose it. CSS handles display.
  // For <video> states (e.g. the dancing mascot), we also rewind to frame 0
  // and call .play() — browsers don't auto-play hidden videos and we want the
  // loop to start fresh each time the user gets a correct answer.
  function setStage(stageEl, state) {
    if (!stageEl) return;
    stageEl.dataset.state = state;
    stageEl.querySelectorAll('[data-state]').forEach((el) => {
      const active = el.dataset.state === state;
      el.classList.toggle('is-active', active);
      if (el.tagName === 'VIDEO') {
        if (active) {
          try { el.currentTime = 0; el.play(); } catch {}
        } else {
          try { el.pause(); } catch {}
        }
      }
    });
  }

  // ---------------------------------------------------------------------
  // Deck picker
  // ---------------------------------------------------------------------
  async function loadDecks() {
    const grid = document.getElementById('quiz-deck-grid');
    const loading = document.getElementById('quiz-loading');
    const empty = document.getElementById('quiz-empty');
    try {
      const r = await fetch('/api/decks?limit=50', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('failed');
      const data = await r.json();
      decks = data.decks || [];
    } catch {
      loading.textContent = "Couldn't load decks. Refresh to try again.";
      return;
    }
    loading.hidden = true;

    // Need to know cardCount to know which decks are quiz-able (≥4 cards)
    const quizzable = decks.filter((d) => (d.cardCount || 0) >= 4);
    if (!quizzable.length) {
      empty.hidden = false;
      return;
    }

    grid.innerHTML = quizzable.map((d) => `
      <div class="quiz-deck" data-deck-id="${escapeHtml(d.id)}" data-deck-title="${escapeHtml(d.title || 'Untitled')}" data-card-count="${d.cardCount}" role="button" tabindex="0" aria-pressed="false">
        <span class="quiz-deck-check" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </span>
        <span class="quiz-deck-mode" data-mode="${escapeHtml(d.mode)}">${escapeHtml(d.mode)}</span>
        <h3 class="quiz-deck-title">${escapeHtml(d.title || 'Untitled')}</h3>
        <div class="quiz-deck-meta">${d.cardCount} card${d.cardCount === 1 ? '' : 's'}</div>
        <button type="button" class="quiz-deck-cta">Quiz this deck</button>
      </div>
    `).join('');

    // Card body click → toggle selection (for multi-deck quiz).
    // "Quiz this deck" button click → single-deck quiz immediately (stop the
    // event from bubbling to the card so it doesn't also toggle selection).
    grid.querySelectorAll('.quiz-deck').forEach((el) => {
      el.addEventListener('click', () => {
        toggleDeckSelection(el.dataset.deckId, el);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggleDeckSelection(el.dataset.deckId, el);
        }
      });
      el.querySelector('.quiz-deck-cta').addEventListener('click', (e) => {
        e.stopPropagation();
        startQuiz([el.dataset.deckId], el.dataset.deckTitle);
      });
    });
    updateMultiBar();
  }

  // ---------------------------------------------------------------------
  // Multi-deck selection state
  // ---------------------------------------------------------------------
  function toggleDeckSelection(deckId, cardEl) {
    if (selectedDeckIds.has(deckId)) {
      selectedDeckIds.delete(deckId);
      cardEl.classList.remove('is-selected');
      cardEl.setAttribute('aria-pressed', 'false');
    } else {
      selectedDeckIds.add(deckId);
      cardEl.classList.add('is-selected');
      cardEl.setAttribute('aria-pressed', 'true');
    }
    updateMultiBar();
  }

  function clearDeckSelection() {
    selectedDeckIds.clear();
    document.querySelectorAll('.quiz-deck.is-selected').forEach((el) => {
      el.classList.remove('is-selected');
      el.setAttribute('aria-pressed', 'false');
    });
    updateMultiBar();
  }

  function updateMultiBar() {
    const bar = document.getElementById('quiz-multi-bar');
    if (!bar) return;
    const n = selectedDeckIds.size;
    if (n === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const decksMap = new Map(decks.map((d) => [d.id, d]));
    let totalCards = 0;
    selectedDeckIds.forEach((id) => {
      const d = decksMap.get(id);
      if (d) totalCards += d.cardCount || 0;
    });
    document.getElementById('quiz-multi-count').textContent = n;
    document.getElementById('quiz-multi-plural').textContent = n === 1 ? '' : 's';
    document.getElementById('quiz-multi-cards').textContent = totalCards;
  }

  function startQuizFromSelection() {
    if (selectedDeckIds.size === 0) return;
    const ids = Array.from(selectedDeckIds);
    const decksMap = new Map(decks.map((d) => [d.id, d]));
    const title = ids.length === 1
      ? (decksMap.get(ids[0])?.title || 'Quiz')
      : ids.length + ' decks';
    startQuiz(ids, title);
  }

  // ---------------------------------------------------------------------
  // Start a quiz from one or more decks. Phase 1 of the flow: fetch all
  // selected decks in parallel, combine cards, stash them, then show the
  // round-length picker. The actual quiz launch happens in launchQuiz
  // once the user has picked Quick/Standard/Long.
  // ---------------------------------------------------------------------
  async function startQuiz(deckIds, deckTitle) {
    if (!Array.isArray(deckIds)) deckIds = [deckIds];   // backwards compat
    if (deckIds.length === 0) return;

    const multiCta = document.getElementById('quiz-multi-cta');
    const singleCtas = deckIds.map((id) =>
      document.querySelector(`.quiz-deck[data-deck-id="${id}"] .quiz-deck-cta`)
    ).filter(Boolean);
    singleCtas.forEach((b) => { b.disabled = true; b.textContent = 'Loading…'; });
    if (multiCta) multiCta.disabled = true;

    let allCards = [];
    try {
      const results = await Promise.all(deckIds.map((id) =>
        fetch('/api/deck?id=' + encodeURIComponent(id), { credentials: 'same-origin' })
          .then((r) => r.ok ? r.json() : Promise.reject('deck ' + id + ' failed'))
      ));
      results.forEach((data) => {
        const cards = (data.cards || []).filter((c) => c.position !== 0);   // skip overview card
        allCards = allCards.concat(cards);
      });
    } catch (err) {
      alert("Couldn't load deck(s). Try a different selection.");
      singleCtas.forEach((b) => { b.disabled = false; b.textContent = 'Quiz this deck'; });
      if (multiCta) multiCta.disabled = false;
      return;
    }
    if (allCards.length < 4) {
      alert('Need at least 4 cards combined to build a quiz.');
      singleCtas.forEach((b) => { b.disabled = false; b.textContent = 'Quiz this deck'; });
      if (multiCta) multiCta.disabled = false;
      return;
    }

    // Stash for the round picker, then show it.
    pendingCards = allCards;
    pendingDeckIds = deckIds;
    pendingDeckTitle = deckTitle;
    singleCtas.forEach((b) => { b.disabled = false; b.textContent = 'Quiz this deck'; });
    if (multiCta) multiCta.disabled = false;
    showRoundPicker(allCards.length, deckIds.length);
  }

  // ---------------------------------------------------------------------
  // Show the round-length picker (Quick/Standard/Long). Adapts each
  // option's count to the available card pool — if you only have 7 cards,
  // "Long" caps at 7. Options that would collapse to the same count are
  // visually disabled to avoid confusion.
  // ---------------------------------------------------------------------
  function showRoundPicker(totalCards, deckCount) {
    document.getElementById('quiz-list').hidden = true;
    document.getElementById('quiz-session').hidden = true;
    document.getElementById('quiz-complete').hidden = true;
    document.getElementById('quiz-rounds').hidden = false;
    document.body.classList.add('is-quiz-active');

    const decksLabel = document.getElementById('quiz-rounds-decks');
    if (decksLabel) {
      decksLabel.textContent = deckCount + ' deck' + (deckCount === 1 ? '' : 's') +
        ' · ' + totalCards + ' cards';
    }

    // Cap each option at available cards and disable any that collapse to
    // the same count as a shorter option (so the user always sees distinct
    // choices).
    const cards = document.querySelectorAll('.quiz-round-card');
    let lastCount = 0;
    cards.forEach((card) => {
      const key = card.dataset.rounds;
      const nominal = ROUND_TARGETS[key] || 10;
      const actual = Math.min(nominal, totalCards);
      const countEl = card.querySelector('.quiz-round-count');
      if (countEl) countEl.textContent = actual;
      // Disable if same as previous option (collapsed) — except always allow
      // Quick to be picked.
      const collapsed = actual === lastCount && key !== 'quick';
      card.disabled = collapsed;
      lastCount = actual;
    });
  }

  // Round-card click handler — pulls the cached pendingCards, builds the
  // quiz with the chosen count, and launches the session.
  function pickRounds(roundsKey) {
    if (!pendingCards || pendingCards.length === 0) return;
    const nominal = ROUND_TARGETS[roundsKey] || 10;
    const target = Math.min(nominal, pendingCards.length);
    launchQuiz(roundsKey, target);
  }

  function launchQuiz(roundsKey, target) {
    const questions = buildQuestions(pendingCards, target);
    currentQuiz = {
      deckIds: pendingDeckIds,
      deckTitle: pendingDeckTitle,
      rounds: roundsKey,
      questions,
      index: 0,
      score: 0,
      lives: STARTING_LIVES,
      xp: 0,
    };

    document.getElementById('quiz-rounds').hidden = true;
    document.getElementById('quiz-session').hidden = false;
    document.getElementById('quiz-total').textContent = questions.length;
    document.getElementById('quiz-score-live').textContent = '0';
    paintHearts();
    renderQuestion();

    window.PopcardAnalytics?.track('Quiz Start', {
      deckIds: (pendingDeckIds || []).join(','),
      deckTitle: pendingDeckTitle,
      deckCount: String((pendingDeckIds || []).length),
      rounds: roundsKey,
      questionCount: String(questions.length),
    });
  }

  // Back button on the round picker — returns to the deck picker without
  // losing the multi-deck selection.
  function cancelRoundPicker() {
    document.getElementById('quiz-rounds').hidden = true;
    document.getElementById('quiz-list').hidden = false;
    document.body.classList.remove('is-quiz-active');
    pendingCards = null;
    pendingDeckIds = null;
    pendingDeckTitle = null;
  }

  // Build N MCQ questions from a card pool. `target` is the desired number
  // of questions (capped at the pool size). Falls back to the module-level
  // QUESTIONS_PER_QUIZ for callers that don't pass one.
  function buildQuestions(cards, target) {
    const sampleSize = Math.min(target || QUESTIONS_PER_QUIZ, cards.length);
    const chosen = shuffle(cards.slice()).slice(0, sampleSize);
    const allAnswers = cards.map((c) => c.answer).filter(Boolean);

    return chosen.map((card) => {
      const correct = card.answer;
      const distractors = pickDistractors(correct, allAnswers, OPTIONS_PER_QUESTION - 1);
      const options = shuffle([correct, ...distractors]);
      const correctIndex = options.indexOf(correct);
      return {
        cardId: card.id,
        type: card.type || 'idea',
        question: card.question,
        options,
        correctIndex,
      };
    });
  }
  function pickDistractors(correct, pool, n) {
    const others = pool.filter((a) => a && a !== correct);
    shuffle(others);
    const out = [];
    for (const a of others) {
      if (out.length >= n) break;
      if (a.length > 200 && correct.length <= 80) continue;
      out.push(a);
    }
    while (out.length < n) out.push('(N/A)');
    return out.slice(0, n);
  }

  // ---------------------------------------------------------------------
  // Render the current question
  // ---------------------------------------------------------------------
  function renderQuestion() {
    const q = currentQuiz.questions[currentQuiz.index];
    const total = currentQuiz.questions.length;

    // Reset per-question state
    selectedIdx = null;
    isGraded = false;

    document.getElementById('quiz-current').textContent = currentQuiz.index + 1;
    const pct = ((currentQuiz.index) / total) * 100;
    document.getElementById('quiz-progress-fill').style.width = pct + '%';

    document.getElementById('quiz-question-tag').textContent =
      q.type.charAt(0).toUpperCase() + q.type.slice(1);
    document.getElementById('quiz-question').textContent = q.question;

    // Mascot back to idle/asking state — randomly pick one of the quizmaster
    // variants per question so the reaction has variety.
    const ASK_STATES = ['ask', 'ask2'];
    const askState = ASK_STATES[Math.floor(Math.random() * ASK_STATES.length)];
    setStage(document.getElementById('quiz-stage'), askState);

    // Hide feedback, reset action bar color, hide XP badge
    const fb = document.getElementById('quiz-feedback');
    fb.hidden = true;
    const action = document.getElementById('quiz-action');
    action.classList.remove('is-correct', 'is-wrong');
    hideXpBadge();
    paintHearts();   // re-sync hearts in case lives changed last round

    // Reset CTA
    setCTA('check', false);

    // Render options
    const optsEl = document.getElementById('quiz-options');
    optsEl.innerHTML = q.options.map((opt, i) => `
      <button type="button" class="qz-option" data-idx="${i}" role="radio" aria-checked="false">
        <span class="qz-option-letter">${LETTERS[i]}</span>
        <span class="qz-option-text">${escapeHtml(opt)}</span>
        <span class="qz-option-mark" aria-hidden="true"></span>
      </button>
    `).join('');
    optsEl.querySelectorAll('.qz-option').forEach((btn) => {
      btn.addEventListener('click', () => selectOption(parseInt(btn.dataset.idx, 10)));
    });
  }

  // First step: user taps an option — just mark selected.
  function selectOption(idx) {
    if (isGraded) return;
    selectedIdx = idx;
    document.querySelectorAll('.qz-option').forEach((btn, i) => {
      const on = i === idx;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    setCTA('check', true);
  }

  // Second step: CHECK button grades the answer.
  function checkAnswer() {
    if (selectedIdx === null || isGraded) return;
    const q = currentQuiz.questions[currentQuiz.index];
    const correct = selectedIdx === q.correctIndex;
    if (correct) {
      currentQuiz.score += 1;
      currentQuiz.xp += XP_PER_CORRECT;
    } else {
      // Wrong answer costs a heart. paintHearts() in nextQuestion will
      // render the change, but we also animate it inline here.
      currentQuiz.lives = Math.max(0, currentQuiz.lives - 1);
      paintHearts();
    }
    isGraded = true;

    // Mark options visually
    const opts = document.querySelectorAll('.qz-option');
    opts.forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.remove('is-selected');
      if (i === q.correctIndex) {
        btn.classList.add('is-correct');
        btn.querySelector('.qz-option-mark').textContent = '✓';
      }
      if (i === selectedIdx && !correct) {
        btn.classList.add('is-wrong');
        btn.querySelector('.qz-option-mark').textContent = '✕';
      }
    });

    // Swap mascot + colour the action bar + show feedback panel.
    // Correct answers roll a random reaction: ~30% still cheer pose, ~70%
    // one of three dancing video variants (split evenly). Keeps it fresh
    // without the still pose disappearing entirely. To rebalance, change the
    // 0.3 threshold (lower = more dances) or add/remove keys from CORRECT_DANCES.
    const CORRECT_DANCES = ['correct-dance', 'correct-dance2', 'correct-dance3'];
    let mascotState;
    if (correct) {
      if (Math.random() < 0.3) {
        mascotState = 'correct';
      } else {
        mascotState = CORRECT_DANCES[Math.floor(Math.random() * CORRECT_DANCES.length)];
      }
    } else {
      mascotState = 'wrong';
    }
    setStage(document.getElementById('quiz-stage'), mascotState);
    const action = document.getElementById('quiz-action');
    action.classList.toggle('is-correct', correct);
    action.classList.toggle('is-wrong', !correct);

    const fb = document.getElementById('quiz-feedback');
    const fbIcon = document.getElementById('quiz-feedback-icon');
    const fbText = document.getElementById('quiz-feedback-text');
    const fbDetail = document.getElementById('quiz-feedback-detail');
    fb.hidden = false;
    fbIcon.textContent = correct ? '✓' : '✕';
    if (correct) {
      fbText.textContent = pickCheer();
      fbDetail.hidden = true;
      showXpBadge('+' + XP_PER_CORRECT + ' XP');
    } else {
      fbText.textContent = "Not quite.";
      fbDetail.innerHTML = 'Answer: <strong>' + escapeHtml(q.options[q.correctIndex]) + '</strong>';
      fbDetail.hidden = false;
      showXpBadge(currentQuiz.lives === 0 ? 'No hearts left' : '–1 ♥');
    }

    // CTA becomes CONTINUE
    setCTA('continue', true, correct ? 'correct' : 'wrong');

    document.getElementById('quiz-score-live').textContent = currentQuiz.score;
    // Bump progress bar to reflect the just-answered question
    const pct = ((currentQuiz.index + 1) / currentQuiz.questions.length) * 100;
    document.getElementById('quiz-progress-fill').style.width = pct + '%';
  }

  // Friendly randomized correct-answer copy, like Duolingo.
  function pickCheer() {
    const cheers = ['Nailed it!', 'Correct!', 'Nice one!', 'Spot on!', 'Sharp!', 'Yes!'];
    return cheers[Math.floor(Math.random() * cheers.length)];
  }

  // Paint the three hearts in the header based on currentQuiz.lives.
  // Hearts at position > lives get the .is-lost class (greyed + shrunk).
  function paintHearts() {
    if (!currentQuiz) return;
    document.querySelectorAll('.qz-heart').forEach((el) => {
      const pos = Number(el.dataset.heart);
      el.classList.toggle('is-lost', pos > currentQuiz.lives);
    });
  }

  function showXpBadge(text) {
    const badge = document.getElementById('quiz-xp-badge');
    if (!badge) return;
    badge.textContent = text;
    badge.hidden = false;
    // Reset the animation by removing + re-adding the element to the DOM order
    badge.style.animation = 'none';
    void badge.offsetWidth;   // force reflow
    badge.style.animation = '';
  }
  function hideXpBadge() {
    const badge = document.getElementById('quiz-xp-badge');
    if (badge) badge.hidden = true;
  }

  function nextQuestion() {
    if (!isGraded) return;
    // Out of hearts → end the quiz now (game over).
    if (currentQuiz.lives <= 0) {
      completeQuiz(/* gameOver */ true);
      return;
    }
    currentQuiz.index += 1;
    if (currentQuiz.index >= currentQuiz.questions.length) {
      completeQuiz();
    } else {
      renderQuestion();
    }
  }

  // One CTA element, two modes: CHECK and CONTINUE.
  function setCTA(mode, enabled, colour) {
    const btn = document.getElementById('quiz-cta');
    btn.dataset.mode = mode;
    btn.disabled = !enabled;
    btn.textContent = mode === 'check' ? 'CHECK' : 'CONTINUE';
    btn.classList.remove('is-correct', 'is-wrong');
    if (colour) btn.classList.add('is-' + colour);
  }
  function handleCTAClick() {
    const mode = document.getElementById('quiz-cta').dataset.mode;
    if (mode === 'check') checkAnswer();
    else nextQuestion();
  }

  // ---------------------------------------------------------------------
  // Complete
  // ---------------------------------------------------------------------
  function completeQuiz(gameOver) {
    const total = currentQuiz.questions.length;
    // If we ended early (game over), only count questions actually answered.
    const attempted = gameOver ? (currentQuiz.index + 1) : total;
    const score = currentQuiz.score;
    const pct = attempted > 0 ? (score / attempted) * 100 : 0;
    const heartsLeft = currentQuiz.lives;
    // Bonus XP only if user finished the round with all hearts AND all correct.
    const perfectBonus = (!gameOver && heartsLeft === STARTING_LIVES && score === total)
      ? XP_PERFECT_BONUS : 0;
    const sparks = currentQuiz.xp + perfectBonus;

    document.getElementById('quiz-session').hidden = true;
    document.getElementById('quiz-complete').hidden = false;
    document.getElementById('quiz-score-final').textContent = score;
    document.getElementById('quiz-score-total').textContent = attempted;
    document.getElementById('quiz-complete-sparks').textContent = sparks;

    const h = document.getElementById('quiz-complete-h');
    const sub = document.getElementById('quiz-complete-sub');
    const stage = document.getElementById('quiz-complete-stage');

    if (gameOver) {
      h.textContent = 'Out of hearts.';
      sub.textContent = "You earned " + currentQuiz.xp + " XP before running out of lives. "
        + "Practice this deck and try again — you've got this.";
      setStage(stage, 'sad');
    } else if (pct === 100 && heartsLeft === STARTING_LIVES) {
      h.textContent = 'Perfect score!';
      sub.textContent = "Full marks AND all hearts intact. +" + XP_PERFECT_BONUS + " XP bonus.";
      setStage(stage, 'grad');
    } else if (pct === 100) {
      h.textContent = 'Aced it!';
      sub.textContent = "Nice recovery — you finished with " + heartsLeft + " heart" + (heartsLeft === 1 ? '' : 's') + " to spare.";
      setStage(stage, 'cheer');
    } else if (pct >= 70) {
      h.textContent = 'Strong work.';
      sub.textContent = "Solid grasp. A practice session could push this to 100%.";
      setStage(stage, 'cheer');
    } else if (pct >= 40) {
      h.textContent = 'Mid result.';
      sub.textContent = "You're learning. Practice the deck and retake — it'll click.";
      setStage(stage, 'idle');
    } else {
      h.textContent = 'Early days.';
      sub.textContent = "Take this deck to Practice first, then retake the quiz.";
      setStage(stage, 'sad');
    }

    window.PopcardAnalytics?.track('Quiz Complete', {
      deckIds: (currentQuiz.deckIds || []).join(','),
      deckCount: String((currentQuiz.deckIds || []).length),
      rounds: currentQuiz.rounds || '',
      score: String(score),
      attempted: String(attempted),
      total: String(total),
      xp: String(sparks),
      livesLeft: String(heartsLeft),
      gameOver: String(!!gameOver),
    });
  }

  function retake() {
    if (!currentQuiz) return;
    startQuiz(currentQuiz.deckIds, currentQuiz.deckTitle);
  }

  function pickDifferentDeck() {
    currentQuiz = null;
    document.getElementById('quiz-complete').hidden = true;
    document.getElementById('quiz-session').hidden = true;
    document.getElementById('quiz-list').hidden = false;
    document.body.classList.remove('is-quiz-active');
  }

  function quitQuiz() {
    if (!confirm('Quit this quiz? Your progress will not be saved.')) return;
    pickDifferentDeck();
  }

  // ---------------------------------------------------------------------
  // User menu
  // ---------------------------------------------------------------------
  function setupUserMenu() {
    const chip = document.getElementById('dash-user-chip');
    const menu = document.getElementById('dash-user-menu');
    if (!chip || !menu) return;
    // See account.js setupUserMenu — manage open-state via .is-open class so
    // :hover doesn't stick on touch devices and leave the chip "stuck on".
    function setOpen(open) {
      menu.hidden = !open;
      chip.classList.toggle('is-open', open);
      chip.setAttribute('aria-expanded', String(open));
    }
    setOpen(false);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) { setOpen(false); chip.focus(); }
    });
    // Close menu when any menu item is clicked (see account.js for the why).
    menu.querySelectorAll('[role="menuitem"]').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (item.getAttribute('href') === '#') e.preventDefault();
        setOpen(false);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  (async function init() {
    let payload;
    try {
      const r = await fetch('/api/me?include=dashboard', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('not signed in');
      payload = await r.json();
    } catch {
      window.location.href = '/login?next=' + encodeURIComponent('/quizzes');
      return;
    }
    if (!payload || !payload.user) {
      window.location.href = '/login?next=' + encodeURIComponent('/quizzes');
      return;
    }

    const { user } = payload;
    const dash = payload.dashboard || {};

    document.querySelectorAll('[data-auth-only]').forEach((el) => el.style.display = '');
    document.querySelectorAll('[data-auth-name]').forEach((el) => {
      el.textContent = user.name ? user.name.split(' ')[0] : 'there';
    });
    const picEl = document.querySelector('[data-auth-picture]');
    if (picEl && user.picture) picEl.src = user.picture;
    document.getElementById('dash-streak-num').textContent = dash.streak_days ?? 0;
    document.getElementById('dash-sparks-num').textContent = (dash.sparks_total ?? 0).toLocaleString();

    setupUserMenu();
    document.getElementById('sign-out-btn').addEventListener('click', async () => {
      await window.PopcardAuth.signOut();
      window.location.href = '/';
    });
    document.getElementById('quiz-quit').addEventListener('click', quitQuiz);
    document.getElementById('quiz-cta').addEventListener('click', handleCTAClick);
    document.getElementById('quiz-again').addEventListener('click', retake);
    document.getElementById('quiz-different-deck').addEventListener('click', pickDifferentDeck);
    // Multi-deck selection bar buttons (deck picker only; the bar lives in
    // #quiz-list so it's hidden whenever the quiz session/complete is shown).
    const multiCta = document.getElementById('quiz-multi-cta');
    if (multiCta) multiCta.addEventListener('click', startQuizFromSelection);
    const multiClear = document.getElementById('quiz-multi-clear');
    if (multiClear) multiClear.addEventListener('click', clearDeckSelection);

    // Round-length picker buttons
    document.querySelectorAll('.quiz-round-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        pickRounds(btn.dataset.rounds);
      });
    });
    const roundsBack = document.getElementById('quiz-rounds-back');
    if (roundsBack) roundsBack.addEventListener('click', cancelRoundPicker);
    // The complete-close link routes back to the deck picker without reloading
    const completeClose = document.getElementById('quiz-complete-close');
    if (completeClose) completeClose.addEventListener('click', (e) => {
      e.preventDefault();
      pickDifferentDeck();
    });

    // Keyboard: A/B/C/D pick option; Enter/Space triggers the CTA (CHECK or CONTINUE)
    document.addEventListener('keydown', (e) => {
      if (!currentQuiz) return;
      if (document.getElementById('quiz-session').hidden) return;   // not in session
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' || e.key === ' ') {
        const btn = document.getElementById('quiz-cta');
        if (!btn.disabled) {
          e.preventDefault();
          handleCTAClick();
        }
        return;
      }
      const idx = ['a','b','c','d'].indexOf(e.key.toLowerCase());
      if (idx >= 0 && !isGraded) {
        const btn = document.querySelector(`.qz-option[data-idx="${idx}"]`);
        if (btn) btn.click();
      }
    });

    loadDecks();
  })();

})();
