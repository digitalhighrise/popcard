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
    window.PopcardAnalytics?.track('Mode Toggle', { mode: currentMode });
  });
});

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

const popBtn = document.getElementById('pop-btn');
const popStatus = document.getElementById('pop-status');
const popLabel = document.getElementById('pop-btn-label');

function setStatus(msg, isError) {
  if (!popStatus) return;
  popStatus.textContent = msg || '';
  popStatus.classList.toggle('error', !!isError);
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

    try {
      const res = await fetch('/api/pop', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, mode: currentMode }),
      });

      if (res.status === 401) {
        // Stash the pending pop so the user can resume after sign-in
        try { sessionStorage.setItem('pendingPop', JSON.stringify({ input, mode: currentMode })); } catch {}
        window.location.href = '/login?next=' + encodeURIComponent('/');
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setStatus(data.message || data.error || 'Something went wrong.', true);
        window.PopcardAnalytics?.track('Pop Failed', { reason: data.error || 'unknown' });
      } else {
        window.PopcardAnalytics?.track('Pop Success', {
          mode: data.deck.mode,
          cards: String(data.deck.cardCount),
          cached: String(!!data.deck.fromCache),
        });
        window.location.href = '/deck/' + data.deck.id;
      }
    } catch (e) {
      setStatus('Network error. Try again.', true);
    } finally {
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
      const { input, mode } = JSON.parse(pending);
      heroInput.value = input;
      currentMode = mode;
      modeButtons.forEach((b) => {
        const active = b.dataset.mode === mode;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      window.PopcardAuth?.me().then((u) => {
        if (u) popBtn.click();
      });
    }
  } catch {}
}
