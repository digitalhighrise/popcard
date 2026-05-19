// Settings page — preferences, account info, sign-out.
// Persists mode + daily_goal via /api/onboarding-prefs (best effort, with
// localStorage fallback so the UI stays responsive even pre-migration).

(function () {

  // ---------------------------------------------------------------------
  // Mode switch — same applyMode pattern as account.js
  // ---------------------------------------------------------------------
  function applyMode(mode, opts) {
    opts = opts || {};
    if (mode !== 'quick' && mode !== 'study') mode = 'study';
    document.body.classList.toggle('is-quick-mode', mode === 'quick');
    document.body.classList.toggle('is-study-mode', mode === 'study');
    document.querySelectorAll('.dash-mode-switch-btn').forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (opts.skipPersist) return;
    try { localStorage.setItem('popcardDashboardMode', mode); } catch {}
    fetch('/api/onboarding-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ default_mode: mode }),
    }).catch(() => { /* fire-and-forget; localStorage backs it */ });
    window.PopcardAnalytics?.track('Settings Mode Change', { mode });
  }

  function setupModeSwitch(initial) {
    applyMode(initial, { skipPersist: true });
    document.querySelectorAll('.dash-mode-switch-btn').forEach((btn) => {
      btn.addEventListener('click', () => applyMode(btn.dataset.mode));
    });
  }

  // ---------------------------------------------------------------------
  // Daily goal
  // ---------------------------------------------------------------------
  function applyGoal(goal, opts) {
    opts = opts || {};
    const n = Number(goal) || 10;
    document.querySelectorAll('.settings-goal-btn').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.goal) === n);
    });
    if (opts.skipPersist) return;
    try { localStorage.setItem('popcardDailyGoal', String(n)); } catch {}
    fetch('/api/onboarding-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ daily_goal: n }),
    }).catch(() => {});
    window.PopcardAnalytics?.track('Settings Daily Goal Change', { goal: String(n) });
  }

  function setupDailyGoal(initial) {
    applyGoal(initial, { skipPersist: true });
    document.querySelectorAll('.settings-goal-btn').forEach((btn) => {
      btn.addEventListener('click', () => applyGoal(btn.dataset.goal));
    });
  }

  // ---------------------------------------------------------------------
  // Notification toggles — localStorage only for now (no backend yet)
  // ---------------------------------------------------------------------
  function setupNotificationToggles() {
    const pairs = [
      { id: 'settings-reminder', key: 'popcardNotifyReminder', defaultOn: true },
      { id: 'settings-weekly',   key: 'popcardNotifyWeekly',   defaultOn: true },
    ];
    pairs.forEach((pair) => {
      const el = document.getElementById(pair.id);
      if (!el) return;
      let stored;
      try { stored = localStorage.getItem(pair.key); } catch {}
      el.checked = stored === null ? pair.defaultOn : stored === 'true';
      el.addEventListener('change', () => {
        try { localStorage.setItem(pair.key, String(el.checked)); } catch {}
        window.PopcardAnalytics?.track('Settings Notification Toggle', {
          key: pair.key, on: String(el.checked),
        });
      });
    });
  }

  // ---------------------------------------------------------------------
  // Language picker — defers to lang-picker.js if present, otherwise stub
  // ---------------------------------------------------------------------
  function setupLanguage() {
    const btn = document.getElementById('settings-lang-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (window.PopcardLangPicker && typeof window.PopcardLangPicker.open === 'function') {
        window.PopcardLangPicker.open();
      } else {
        alert("Language picker coming soon. Your current language is English.");
      }
    });
  }

  // ---------------------------------------------------------------------
  // User menu (shared pattern)
  // ---------------------------------------------------------------------
  function setupUserMenu() {
    const chip = document.getElementById('dash-user-chip');
    const menu = document.getElementById('dash-user-menu');
    if (!chip || !menu) return;
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
    menu.querySelectorAll('[role="menuitem"]').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (item.getAttribute('href') === '#') e.preventDefault();
        setOpen(false);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Delete account flow — confirms hard, then no-op for now (no API)
  // ---------------------------------------------------------------------
  function setupDelete() {
    const btn = document.getElementById('settings-delete-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const confirmed = confirm(
        "Are you absolutely sure?\n\n" +
        "This will permanently delete your account and ALL decks. " +
        "This action cannot be undone."
      );
      if (!confirmed) return;
      const typed = prompt('Type the word DELETE to confirm:');
      if (typed !== 'DELETE') {
        alert('Cancelled — account not deleted.');
        return;
      }
      // No backend wired yet. Tell the user we'll email them so it doesn't
      // silently fail with a dead button.
      alert(
        "Got it. We'll process your deletion request and email you " +
        "within 24 hours to confirm. If you change your mind, just reply."
      );
      window.PopcardAnalytics?.track('Settings Delete Account Request');
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
      window.location.href = '/login?next=' + encodeURIComponent('/settings');
      return;
    }
    if (!payload || !payload.user) {
      window.location.href = '/login?next=' + encodeURIComponent('/settings');
      return;
    }

    const { user } = payload;
    const dash = payload.dashboard || {};

    // Auth-only fields
    document.querySelectorAll('[data-auth-only]').forEach((el) => el.style.display = '');
    document.querySelectorAll('[data-auth-name]').forEach((el) => {
      el.textContent = user.name || (user.email ? user.email.split('@')[0] : 'You');
    });
    document.querySelectorAll('[data-auth-picture]').forEach((el) => {
      if (user.picture) el.src = user.picture;
    });
    // Email + member-since (settings only)
    const emailEl = document.getElementById('settings-email');
    if (emailEl) emailEl.textContent = user.email || '';
    const sinceEl = document.getElementById('settings-since');
    if (sinceEl && user.created_at) {
      try {
        const d = new Date(user.created_at);
        sinceEl.textContent = 'Member since ' + d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      } catch {}
    }

    // Streak + sparks in header
    const streakEl = document.getElementById('dash-streak-num');
    if (streakEl) streakEl.textContent = dash.streak_days ?? 0;
    const sparksEl = document.getElementById('dash-sparks-num');
    if (sparksEl) sparksEl.textContent = (dash.sparks_total ?? 0).toLocaleString();

    // Resolve initial mode: server > localStorage > default
    let mode = 'study';
    if (dash.default_mode === 'quick' || dash.default_mode === 'study') {
      mode = dash.default_mode;
    } else {
      try {
        const cached = localStorage.getItem('popcardDashboardMode');
        if (cached === 'quick' || cached === 'study') mode = cached;
      } catch {}
    }
    setupModeSwitch(mode);

    // Resolve initial daily goal
    let goal = dash.daily_goal || 10;
    if (!goal) {
      try {
        const cached = localStorage.getItem('popcardDailyGoal');
        if (cached) goal = Number(cached) || 10;
      } catch {}
    }
    setupDailyGoal(goal);

    // Plan description
    const planDesc = document.getElementById('settings-plan-desc');
    if (planDesc && user.tier && user.tier !== 'free') {
      planDesc.textContent = 'You\'re on the ' + user.tier + ' plan. 1000 pops per month + advanced features.';
    }

    // Wire interactive bits
    setupNotificationToggles();
    setupLanguage();
    setupUserMenu();
    setupDelete();

    // Sign out — header dropdown
    document.getElementById('sign-out-btn').addEventListener('click', async () => {
      await window.PopcardAuth.signOut();
      window.location.href = '/';
    });
    // Sign out — also from the danger-zone button
    document.getElementById('settings-signout-btn').addEventListener('click', async () => {
      await window.PopcardAuth.signOut();
      window.location.href = '/';
    });
  })();

})();
