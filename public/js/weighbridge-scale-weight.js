(function () {
  // Cada campo de peso tem dois botões: "usar peso da balança" (peso atual com
  // a foto atual) e "usar foto automática" (escolhe uma das últimas fotos
  // tiradas pelo AutoWeight, com o peso daquela foto). Os dois preenchem o
  // mesmo campo oculto foto_captura_id; vale a última escolha.
  const weightButtons = document.querySelectorAll('[data-scale-weight-target]');
  const pickButtons = document.querySelectorAll('[data-scale-photo-pick-target]');
  const weightFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const fields = new Map();

  function getField(button, targetId) {
    const input = document.getElementById(targetId);

    if (!input) {
      return null;
    }

    if (fields.has(input)) {
      return fields.get(input);
    }

    const form = input.closest('form');
    const label = input.closest('label');
    const field = {
      input,
      feedback: label?.querySelector('.weighbridge-weight-feedback') || null,
      captureInput: form?.querySelector('[data-scale-photo-capture]') || null,
      preview: label?.querySelector('[data-scale-photo-preview]') || null,
      getCsrfToken: () => form?.querySelector('input[name="_csrf"]')?.value || '',
    };

    fields.set(input, field);
    setupField(field);
    return field;
  }

  function setFeedback(field, text) {
    if (field.feedback) field.feedback.textContent = text;
  }

  function showPreview(field, captureId, caption) {
    const { preview } = field;
    if (!preview) return;

    const url = `/balanca/fotos/${encodeURIComponent(captureId)}`;
    preview.replaceChildren();

    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';

    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Foto da balança anexada a este peso';
    link.append(image);

    const text = document.createElement('span');
    text.textContent = caption;

    preview.append(link, text);
    preview.hidden = false;
  }

  function clearPhoto(field) {
    if (field.captureInput) {
      field.captureInput.value = '';
      delete field.captureInput.dataset.weight;
    }

    if (field.preview) {
      field.preview.hidden = true;
      field.preview.replaceChildren();
    }
  }

  function setupField(field) {
    const { input, captureInput } = field;

    // Formulário reaberto após erro de validação: a captura continua valendo
    // enquanto o peso não for alterado.
    if (captureInput?.value) {
      captureInput.dataset.weight = input.value;
      showPreview(field, captureInput.value, 'Foto da balança anexada a este peso.');
    }

    // A foto só vale para o peso que veio com ela. Se o operador alterar o
    // valor, a captura é removida (o servidor também confere o peso ao salvar).
    input.addEventListener('input', () => {
      if (captureInput?.value && input.value !== captureInput.dataset.weight) {
        clearPhoto(field);
        setFeedback(field, 'Peso alterado manualmente: a foto da balança não será anexada.');
      }
    });
  }

  // Preenche o peso e, quando houver, anexa a captura devolvida pelo servidor.
  function applyCapture(field, result, { caption, feedback }) {
    clearPhoto(field);
    field.input.value = String(result.peso_kg);

    if (result.foto && field.captureInput) {
      field.captureInput.value = result.foto.captura_id;
      field.captureInput.dataset.weight = field.input.value;
      showPreview(
        field,
        result.foto.captura_id,
        result.foto.contingencia
          ? 'Câmera indisponível no momento da foto: foi anexada a imagem de contingência.'
          : caption
      );
    }

    field.input.dispatchEvent(new Event('input', { bubbles: true }));
    field.input.focus();
    setFeedback(field, feedback);
  }

  async function requestJson(url, { method = 'GET', csrfToken } = {}) {
    const options = { method, headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' };

    if (method !== 'GET') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ _csrf: csrfToken });
    }

    const response = await fetch(url, options);
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Não foi possível falar com o servidor agora.');
    }

    return result;
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    if (busy) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  // --- Botão "usar peso da balança" -------------------------------------------

  weightButtons.forEach((button) => {
    const field = getField(button, button.dataset.scaleWeightTarget);
    if (!field) return;

    button.addEventListener('click', async () => {
      setBusy(button, true);
      setFeedback(field, 'Consultando balança...');

      try {
        const result = await requestJson('/balanca/balancas/1/peso-atual/captura', {
          method: 'POST',
          csrfToken: field.getCsrfToken(),
        });

        applyCapture(field, result, {
          caption: 'Foto da balança anexada a este peso.',
          feedback: result.foto
            ? 'Peso preenchido com a leitura da balança 1.'
            : 'Peso preenchido com a leitura da balança 1. Não há foto disponível para este peso.',
        });
      } catch (error) {
        setFeedback(field, error.message);
      } finally {
        setBusy(button, false);
      }
    });
  });

  // --- Botão "usar foto automática" -------------------------------------------

  if (!pickButtons.length) {
    return;
  }

  let dialog = null;
  let activeField = null;
  let activeButton = null;

  function buildDialog() {
    const element = document.createElement('dialog');
    element.className = 'scale-photo-picker';
    element.setAttribute('aria-labelledby', 'scale-photo-picker-title');
    element.innerHTML = `
      <div class="scale-photo-picker-header">
        <h2 id="scale-photo-picker-title">Escolher foto automática</h2>
        <button class="scale-photo-picker-close" type="button" aria-label="Fechar">×</button>
      </div>
      <p class="scale-photo-picker-help">Últimas fotos tiradas pelo AutoWeight ao final de cada pesagem. O peso da foto escolhida preenche o campo.</p>
      <p class="scale-photo-picker-status" aria-live="polite"></p>
      <div class="scale-photo-picker-grid"></div>
    `;

    element.querySelector('.scale-photo-picker-close').addEventListener('click', () => element.close());
    // Clique fora do conteúdo (no fundo escurecido) fecha o diálogo.
    element.addEventListener('click', (event) => {
      if (event.target === element) element.close();
    });
    element.addEventListener('close', () => {
      activeButton?.focus();
      activeField = null;
      activeButton = null;
    });

    document.body.append(element);
    return element;
  }

  function setPickerStatus(text) {
    dialog.querySelector('.scale-photo-picker-status').textContent = text;
  }

  function buildPhotoOption(photo) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'scale-photo-option';
    option.dataset.photoId = photo.id;

    const image = document.createElement('img');
    image.src = photo.url;
    image.alt = '';
    image.loading = 'lazy';

    const weight = document.createElement('strong');
    weight.textContent = `${weightFormatter.format(photo.peso_kg)} kg`;

    const time = document.createElement('span');
    time.textContent = photo.capturada_em_texto;

    option.append(image, weight, time);

    const notes = [];
    if (photo.contingencia) notes.push({ text: 'Câmera indisponível', warning: false });
    if (photo.substituida) notes.push({ text: 'Substituída por peso maior', warning: false });
    if (photo.usos.length) notes.push({ text: `Já usada: ${photo.usos.join(', ')}`, warning: true });

    notes.forEach((note) => {
      const tag = document.createElement('span');
      tag.className = note.warning ? 'scale-photo-option-tag is-warning' : 'scale-photo-option-tag';
      tag.textContent = note.text;
      option.append(tag);
    });

    option.setAttribute('aria-label', [
      `${weightFormatter.format(photo.peso_kg)} kg`,
      photo.capturada_em_texto,
      ...notes.map((note) => note.text),
    ].join(', '));

    option.addEventListener('click', () => choosePhoto(photo, option));
    return option;
  }

  async function loadPhotos() {
    const grid = dialog.querySelector('.scale-photo-picker-grid');
    grid.replaceChildren();
    setPickerStatus('Carregando fotos...');

    try {
      const { fotos = [] } = await requestJson('/balanca/fotos/automaticas/recentes');

      if (!fotos.length) {
        setPickerStatus('Nenhuma foto automática recebida ainda.');
        return;
      }

      setPickerStatus('');
      grid.append(...fotos.map(buildPhotoOption));
      grid.querySelector('.scale-photo-option')?.focus();
    } catch (error) {
      setPickerStatus(error.message);
    }
  }

  async function choosePhoto(photo, option) {
    const field = activeField;
    if (!field) return;

    const options = dialog.querySelectorAll('.scale-photo-option');
    options.forEach((item) => { item.disabled = true; });
    option.setAttribute('aria-busy', 'true');
    setPickerStatus('Anexando foto...');

    try {
      const result = await requestJson(`/balanca/fotos/automaticas/${encodeURIComponent(photo.id)}/captura`, {
        method: 'POST',
        csrfToken: field.getCsrfToken(),
      });
      const usedWarning = photo.usos.length ? ` Atenção: esta foto já foi usada em ${photo.usos.join(', ')}.` : '';

      // O foco vai para o campo de peso, e não de volta para o botão.
      activeButton = null;
      dialog.close();
      applyCapture(field, result, {
        caption: `Foto automática de ${result.capturada_em_texto} anexada a este peso.`,
        feedback: `Peso preenchido com a foto automática de ${result.capturada_em_texto}.${usedWarning}`,
      });
    } catch (error) {
      setPickerStatus(error.message);
      options.forEach((item) => { item.disabled = false; });
      option.removeAttribute('aria-busy');
    }
  }

  pickButtons.forEach((button) => {
    const field = getField(button, button.dataset.scalePhotoPickTarget);
    if (!field) return;

    button.addEventListener('click', () => {
      dialog = dialog || buildDialog();
      activeField = field;
      activeButton = button;
      dialog.showModal();
      loadPhotos();
    });
  });
})();
