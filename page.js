// Cross-page tracking: any element with data-track fires a Plausible event on click.
// Extra data-track-* attributes are passed as props.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-track]');
  if (!el) return;
  const event = el.dataset.track;
  const props = {};
  for (const [key, value] of Object.entries(el.dataset)) {
    if (key.startsWith('track') && key !== 'track') {
      const propName = key.slice(5);
      props[propName.charAt(0).toLowerCase() + propName.slice(1)] = value;
    }
  }
  window.PopcardAnalytics?.track(event, Object.keys(props).length ? props : undefined);
});
