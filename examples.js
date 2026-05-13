const chips = document.querySelectorAll('.filter-chip');
const examples = document.querySelectorAll('.example');

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const filter = chip.dataset.filter;
    chips.forEach((c) => c.classList.toggle('active', c === chip));
    examples.forEach((ex) => {
      const show = filter === 'all' || ex.dataset.category === filter;
      ex.style.display = show ? '' : 'none';
    });
    window.PopcardAnalytics?.track('Examples Filter', { filter });
  });
});
