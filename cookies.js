// Consent store + Vercel Web Analytics / Speed Insights loader.
// Both scripts are served from /_vercel/* by Vercel's edge — they 404 locally,
// which is expected and harmless during dev.
(function () {
  const KEY = 'popcard-consent';
  const ANALYTICS_SRC = '/_vercel/insights/script.js';
  const SPEED_SRC = '/_vercel/speed-insights/script.js';

  function loadVercel() {
    if (document.querySelector('script[data-popcard-vercel]')) return;

    // Queue events that fire before the real script lands.
    window.va = window.va || function () {
      (window.vaq = window.vaq || []).push(arguments);
    };
    window.si = window.si || function () {
      (window.siq = window.siq || []).push(arguments);
    };

    const analytics = document.createElement('script');
    analytics.defer = true;
    analytics.src = ANALYTICS_SRC;
    analytics.dataset.popcardVercel = 'analytics';
    document.head.appendChild(analytics);

    const speed = document.createElement('script');
    speed.defer = true;
    speed.src = SPEED_SRC;
    speed.dataset.popcardVercel = 'speed';
    document.head.appendChild(speed);
  }

  function getConsent() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(KEY, value); } catch {}
    if (value === 'accepted') loadVercel();
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.remove();
  }

  window.PopcardConsent = {
    get: getConsent,
    set: setConsent,
    reset() {
      try { localStorage.removeItem(KEY); } catch {}
    },
  };

  function showBanner() {
    if (document.getElementById('cookie-banner')) return;
    const div = document.createElement('div');
    div.id = 'cookie-banner';
    div.className = 'cookie-banner';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-label', 'Analytics preferences');
    div.innerHTML =
      '<div class="cookie-banner-text">' +
        '<strong>Cookies &amp; analytics.</strong> ' +
        'When you sign in, we set one essential cookie to keep your session active. We also use <a href="https://vercel.com/docs/analytics" target="_blank" rel="noopener">Vercel Web Analytics</a> &amp; Speed Insights — cookieless, no personal data. You can opt out of analytics anytime.' +
      '</div>' +
      '<div class="cookie-banner-actions">' +
        '<button type="button" class="cookie-btn cookie-decline">Decline</button>' +
        '<button type="button" class="cookie-btn cookie-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(div);
    div.querySelector('.cookie-accept').addEventListener('click', () => setConsent('accepted'));
    div.querySelector('.cookie-decline').addEventListener('click', () => setConsent('declined'));
  }

  function init() {
    const consent = getConsent();
    if (consent === 'accepted') loadVercel();
    else if (consent === null) showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
