(function () {
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-clipboard-report]');

    if (!button) {
      return;
    }

    try {
      await copyText(button.dataset.clipboardReport || '');
      const originalText = button.textContent;
      button.setAttribute('data-original-text', originalText);
      button.textContent = 'Copiado!';
      window.setTimeout(() => {
        button.textContent = originalText;
      }, 1200);
    } catch (error) {
      button.textContent = 'Erro ao copiar';
      window.setTimeout(() => {
        button.textContent = button.getAttribute('data-original-text') || 'Copiar';
      }, 1200);
    }
  });
}());
