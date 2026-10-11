(() => {
  const button = document.getElementById('admin-money-toggle');
  if (!button) return;

  let visible = false;
  function setVisible(show) {
    visible = show;
    document.querySelectorAll('[data-money-value]').forEach((element) => { element.hidden = !show; });
    document.querySelectorAll('[data-money-mask]').forEach((element) => { element.hidden = show; });
    button.querySelector('[data-eye-open]').toggleAttribute('hidden', show);
    button.querySelector('[data-eye-closed]').toggleAttribute('hidden', !show);
    const label = show ? 'Esconder valores monetários' : 'Mostrar valores monetários';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(show));
  }

  button.addEventListener('click', () => setVisible(!visible));
  // Also reset when returning to the page through the browser's back/forward cache.
  window.addEventListener('pageshow', () => setVisible(false));
  setVisible(false);
})();
