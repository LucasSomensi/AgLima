(() => {
  const slot = document.querySelector('[data-panel-alerts-slot]');
  const POLL_INTERVAL_MS = 3000;
  let pollTimer;
  let requestInFlight = false;

  if (!slot) {
    return;
  }

  const weightFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

  function getNotificationsList({ create }) {
    let list = slot.querySelector('[data-dryer-notifications-list]');

    if (list || !create) {
      return list;
    }

    const section = document.createElement('section');
    section.className = 'admin-section dryer-notifications';
    section.setAttribute('data-dryer-notifications', '');
    section.setAttribute('aria-label', 'Notificações do secador');

    list = document.createElement('div');
    list.className = 'dryer-notifications-list';
    list.setAttribute('data-dryer-notifications-list', '');

    section.appendChild(list);
    slot.appendChild(section);

    return list;
  }

  function showWeight(weightKg) {
    const list = getNotificationsList({ create: true });
    let notification = list.querySelector('[data-scale-weight-notification]');

    if (!notification) {
      notification = document.createElement('div');
      notification.className = 'dryer-scale-notification';
      notification.setAttribute('data-scale-weight-notification', '');
      notification.setAttribute('role', 'status');

      const label = document.createElement('span');
      label.className = 'dryer-scale-notification-label';
      label.textContent = 'Caminhão na balança';

      const value = document.createElement('strong');
      value.className = 'dryer-scale-notification-weight';
      value.setAttribute('data-scale-weight-value', '');

      notification.append(label, value);
      list.prepend(notification);
    }

    notification.querySelector('[data-scale-weight-value]').textContent = `${weightFormatter.format(weightKg)} kg`;
  }

  function hideWeight() {
    const list = getNotificationsList({ create: false });
    const notification = list?.querySelector('[data-scale-weight-notification]');

    if (!notification) {
      return;
    }

    notification.remove();

    if (!list.children.length) {
      list.closest('[data-dryer-notifications]')?.remove();
    }
  }

  async function refreshWeight() {
    if (requestInFlight || document.hidden) {
      return;
    }

    requestInFlight = true;

    try {
      const response = await fetch('/secador/balanca/peso-atual', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (!response.ok) {
        return;
      }

      const result = await response.json();

      if (result.caminhao_na_balanca && Number.isFinite(Number(result.peso_kg))) {
        showWeight(Number(result.peso_kg));
      } else {
        hideWeight();
      }
    } catch (error) {
      // Sem conexão: mantém o último estado exibido até a próxima consulta.
    } finally {
      requestInFlight = false;
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = window.setInterval(refreshWeight, POLL_INTERVAL_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshWeight();
    }
  });
  window.addEventListener('online', refreshWeight);

  startPolling();
})();
