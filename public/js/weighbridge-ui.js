(function () {
  // Comportamentos compartilhados das telas da balança:
  // - peso ao vivo da balança 1 na barra superior ([data-live-weight]);
  // - cópia com um clique ([data-copy] e [data-clipboard-report]);
  // - filtro das últimas movimentações ([data-movement-filter]);
  // - botões que abrem seções recolhíveis ([data-open-details]);
  // - atalhos de teclado das ações principais ([data-shortcut]).
  const SPRITE = '/icons/wb.svg';
  const weightFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Sem permissão para a API: tenta o método antigo abaixo.
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      if (!document.execCommand('copy')) {
        throw new Error('copy failed');
      }
    } finally {
      document.body.removeChild(textarea);
    }
  }

  function swapIcon(element, name) {
    const use = element.querySelector('svg.wb-i use');
    if (!use) return null;
    const previous = use.getAttribute('href');
    use.setAttribute('href', `${SPRITE}#i-${name}`);
    return previous;
  }

  function flashCopied(element, ok) {
    const previousIcon = swapIcon(element, ok ? 'check' : 'x');
    const label = element.querySelector('[data-copy-feedback]');
    const previousLabel = label ? label.textContent : null;
    if (label) label.textContent = ok ? 'Copiado' : 'Erro';
    element.classList.add(ok ? 'is-copied' : 'is-copy-error');

    window.clearTimeout(element.wbCopyTimer);
    element.wbCopyTimer = window.setTimeout(() => {
      element.classList.remove('is-copied', 'is-copy-error');
      if (previousIcon) element.querySelector('svg.wb-i use').setAttribute('href', previousIcon);
      if (label) label.textContent = previousLabel;
    }, 1400);
  }

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-copy], [data-clipboard-report]');
    if (!target) return;

    const text = target.hasAttribute('data-clipboard-report')
      ? target.getAttribute('data-clipboard-report')
      : target.getAttribute('data-copy');

    try {
      await copyText(text || '');
      flashCopied(target, true);
    } catch (error) {
      flashCopied(target, false);
    }
  });

  // Seções recolhíveis abertas por botões da barra de ações.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-details]');
    if (!button) return;

    const details = document.getElementById(button.getAttribute('data-open-details'));
    if (!details) return;

    event.preventDefault();
    details.open = true;
    details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstField = details.querySelector('input:not([type="hidden"]), select, textarea');
    if (firstField) window.setTimeout(() => firstField.focus({ preventScroll: true }), 250);
  });

  if (window.location.hash) {
    const details = document.getElementById(window.location.hash.slice(1));
    if (details && details.tagName === 'DETAILS') details.open = true;
  }

  // Filtro das últimas movimentações (todas, entradas, saídas, avulsas).
  document.querySelectorAll('[data-movement-filter]').forEach((group) => {
    const table = document.getElementById(group.getAttribute('data-movement-filter'));
    if (!table) return;

    group.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-filter]');
      if (!button) return;

      const filter = button.getAttribute('data-filter');
      group.querySelectorAll('button[data-filter]').forEach((item) => {
        item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
      });
      table.querySelectorAll('tr[data-movement-type]').forEach((row) => {
        row.hidden = filter !== 'todas' && row.getAttribute('data-movement-type') !== filter;
      });
    });
  });

  // Atalhos de teclado (fora de campos de texto): E, S, A...
  const shortcuts = new Map();
  document.querySelectorAll('[data-shortcut]').forEach((element) => {
    shortcuts.set(element.getAttribute('data-shortcut').toLowerCase(), element);
  });

  if (shortcuts.size) {
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const active = document.activeElement;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
      const element = shortcuts.get(event.key.toLowerCase());
      if (!element) return;
      event.preventDefault();
      element.click();
    });
  }

  // Peso ao vivo da balança 1.
  const live = document.querySelector('[data-live-weight]');

  if (live) {
    const valueElement = live.querySelector('[data-live-weight-value]');
    const ageElement = live.querySelector('[data-live-weight-age]');
    let timer = null;

    const describeAge = (seconds) => {
      if (seconds < 10) return 'agora';
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
      return `${Math.floor(seconds / 3600)} h`;
    };

    const refresh = async () => {
      if (document.hidden) return;

      try {
        const response = await fetch('/balanca/balancas/1/peso-atual', { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(String(response.status));
        const reading = await response.json();
        const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(reading.atualizado_em).getTime()) / 1000));
        valueElement.textContent = `${weightFormatter.format(Number(reading.peso_kg))} kg`;
        ageElement.textContent = describeAge(ageSeconds);
        live.classList.toggle('is-stale', ageSeconds > 60);
        live.classList.remove('is-offline');
        live.title = `Balança 1 · atualizado em ${new Date(reading.atualizado_em).toLocaleString('pt-BR')}`;
      } catch (error) {
        valueElement.textContent = '— kg';
        ageElement.textContent = 'sem leitura';
        live.classList.add('is-offline');
        live.title = 'Balança 1 sem leitura';
      }
    };

    const start = () => {
      window.clearInterval(timer);
      refresh();
      timer = window.setInterval(refresh, 3000);
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        window.clearInterval(timer);
      } else {
        start();
      }
    });

    start();
  }
}());
