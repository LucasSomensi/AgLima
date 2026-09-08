(function () {
  const buttons = document.querySelectorAll('[data-scale-weight-target]');

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const input = document.getElementById(button.dataset.scaleWeightTarget);
      const feedback = button.closest('label')?.querySelector('.weighbridge-weight-feedback');

      if (!input) {
        return;
      }

      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (feedback) feedback.textContent = 'Consultando balança...';

      try {
        const response = await fetch('/balanca/balancas/1/peso-atual', {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Não foi possível consultar o peso da balança.');
        }

        input.value = String(result.peso_kg);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        if (feedback) feedback.textContent = 'Peso preenchido com a leitura da balança 1.';
      } catch (error) {
        if (feedback) feedback.textContent = error.message;
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  });
})();
