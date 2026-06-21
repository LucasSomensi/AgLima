(() => {
  const minimumReasonLength = 20;

  document.querySelectorAll('.deletion-reason-form').forEach((form) => {
    const reasonInput = form.querySelector('.deletion-reason-input');
    const submitButton = form.querySelector('.deletion-reason-submit');
    const helpText = form.querySelector('.deletion-reason-help');

    if (!reasonInput || !submitButton) {
      return;
    }

    function updateSubmitState() {
      const length = reasonInput.value.trim().replace(/\s+/g, ' ').length;
      const remaining = Math.max(minimumReasonLength - length, 0);
      submitButton.disabled = remaining > 0;

      if (helpText) {
        helpText.textContent = remaining > 0
          ? `Digite mais ${remaining} caractere${remaining === 1 ? '' : 's'} para habilitar o botão.`
          : 'Motivo suficiente para registrar a deleção na auditoria.';
      }
    }

    reasonInput.addEventListener('input', updateSubmitState);
    updateSubmitState();
  });
})();
