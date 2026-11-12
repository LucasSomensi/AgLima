(function () {
  const buttons = document.querySelectorAll('[data-scale-weight-target]');

  function getPhotoElements(button) {
    const form = button.closest('form');
    return {
      captureInput: form?.querySelector('[data-scale-photo-capture]') || null,
      preview: button.closest('label')?.querySelector('[data-scale-photo-preview]') || null,
      csrfToken: form?.querySelector('input[name="_csrf"]')?.value || '',
    };
  }

  function showPreview(preview, captureId, contingency) {
    if (!preview) return;

    const url = `/balanca/fotos/${encodeURIComponent(captureId)}`;
    preview.replaceChildren();

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';

    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Foto da balança no momento da leitura do peso';
    link.append(image);

    const caption = document.createElement('span');
    caption.textContent = contingency
      ? 'Câmera indisponível no momento da leitura: foi anexada a imagem de contingência.'
      : 'Foto da balança anexada a este peso.';

    preview.append(link, caption);
    preview.hidden = false;
  }

  function clearPhoto(captureInput, preview) {
    if (captureInput) {
      captureInput.value = '';
      delete captureInput.dataset.weight;
    }

    if (preview) {
      preview.hidden = true;
      preview.replaceChildren();
    }
  }

  buttons.forEach((button) => {
    const input = document.getElementById(button.dataset.scaleWeightTarget);
    const feedback = button.closest('label')?.querySelector('.weighbridge-weight-feedback');
    const { captureInput, preview } = getPhotoElements(button);

    if (!input) {
      return;
    }

    // Formulário reaberto após erro de validação: a captura continua valendo
    // enquanto o peso não for alterado.
    if (captureInput?.value) {
      captureInput.dataset.weight = input.value;
      showPreview(preview, captureInput.value, false);
    }

    // A foto só vale para o peso lido da balança. Se o operador alterar o
    // valor, a captura é removida (o servidor também confere o peso ao salvar).
    input.addEventListener('input', () => {
      if (captureInput?.value && input.value !== captureInput.dataset.weight) {
        clearPhoto(captureInput, preview);
        if (feedback) feedback.textContent = 'Peso alterado manualmente: a foto da balança não será anexada.';
      }
    });

    button.addEventListener('click', async () => {
      const { csrfToken } = getPhotoElements(button);

      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (feedback) feedback.textContent = 'Consultando balança...';

      try {
        const response = await fetch('/balanca/balancas/1/peso-atual/captura', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ _csrf: csrfToken }),
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Não foi possível consultar o peso da balança.');
        }

        clearPhoto(captureInput, preview);
        input.value = String(result.peso_kg);

        if (result.foto && captureInput) {
          captureInput.value = result.foto.captura_id;
          captureInput.dataset.weight = input.value;
          showPreview(preview, result.foto.captura_id, result.foto.contingencia);
        }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        if (feedback) {
          feedback.textContent = result.foto
            ? 'Peso preenchido com a leitura da balança 1.'
            : 'Peso preenchido com a leitura da balança 1. Não há foto disponível para este peso.';
        }
      } catch (error) {
        if (feedback) feedback.textContent = error.message;
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  });
})();
