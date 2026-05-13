window.PopcardAuth = {
  async me() {
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.user || null;
    } catch {
      return null;
    }
  },

  async signInWithGoogle(credential) {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    return res.json();
  },

  async signOut() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  },

  async startCheckout(tier) {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    });
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent('/pricing')}`;
      return;
    }
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      console.error('Checkout failed', data);
    }
    return data;
  },
};

// Update nav avatar/state on every page that includes auth.js after the DOM is ready.
(async function paintNav() {
  function paint(user) {
    document.querySelectorAll('[data-auth-only]').forEach((el) => {
      el.style.display = user ? '' : 'none';
    });
    document.querySelectorAll('[data-guest-only]').forEach((el) => {
      el.style.display = user ? 'none' : '';
    });
    const nameEl = document.querySelector('[data-auth-name]');
    if (nameEl && user) nameEl.textContent = user.name || user.email;
    const tierEl = document.querySelector('[data-auth-tier]');
    if (tierEl && user) tierEl.textContent = user.tier;
    const picEl = document.querySelector('[data-auth-picture]');
    if (picEl && user && user.picture) picEl.src = user.picture;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => paint(await window.PopcardAuth.me()));
  } else {
    paint(await window.PopcardAuth.me());
  }
})();
