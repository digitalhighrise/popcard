// Thin wrapper around Vercel Web Analytics. Safe to call before the script loads
// (events queue via window.vaq) or after the user has declined (no-op — window.va undefined).
window.PopcardAnalytics = {
  track(event, props) {
    if (typeof window.va === 'function') {
      window.va('event', { name: event, ...(props ? { data: props } : {}) });
    }
  },
};
