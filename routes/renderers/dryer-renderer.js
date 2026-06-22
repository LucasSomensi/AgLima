const { calculateDischargeForecast } = require('../dryer-forecast');
const {
  escapeHtml,
  formatDateTime,
  formatMoisture,
  formatPlainDecimal,
  formatTime,
} = require('../utils');
const { buildAlertHtml, renderTemplate } = require('./template-utils');

function formatProductLabel(value) {
  const labels = { milho: 'Milho', soja: 'Soja' };
  return labels[value] || value || '-';
}

function formatDecimalInput(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return String(value).replace(',', '.');
}

function formatDischargeForecast(dischargeForecast) {
  if (!dischargeForecast || dischargeForecast.status === 'unavailable') {
    return '-';
  }

  if (dischargeForecast.status === 'started') {
    return `Iniciada em ${formatDateTime(dischargeForecast.dischargeStartedAt)}`;
  }

  if (dischargeForecast.status === 'immediate') {
    return 'Descarga imediata';
  }

  return formatDateTime(dischargeForecast.forecastAt);
}

function formatDryerStatus(batch) {
  if (!batch) {
    return `<span class="status-pill status-empty">Parado</span>`;
  }

  if (batch.discharge_started_at) {
    return `<span class="status-pill status-active">Descarregando</span>`;
  }

  return `<span class="status-pill status-active">Secando</span>`;
}

function renderUnclassifiedInputNotifications(inputs = []) {
  if (!inputs.length) {
    return '';
  }

  const notificationItems = inputs
    .map((input) => `
          <article class="dryer-classification-notification">
            <div>
              <span class="dryer-card-label">Entrada sem classificação</span>
              <strong>${escapeHtml(input.placa_caminhao)}</strong>
              <p>${escapeHtml(formatDateTime(input.data_entrada))} · ${escapeHtml(formatProductLabel(input.produto))}</p>
            </div>
            <a class="btn-primary-action" href="/secador/entradas/${escapeHtml(input.id)}/classificacao">Classificar</a>
          </article>
        `)
    .join('');

  return `
        <section class="admin-section dryer-notifications" aria-labelledby="dryer-notifications-title">
          <div class="dryer-notifications-header">
            <div>
              <span class="eyebrow">Classificação</span>
              <h2 id="dryer-notifications-title">Entradas pendentes</h2>
            </div>
            <span class="status-pill status-warning">${escapeHtml(inputs.length)} pendente${inputs.length === 1 ? '' : 's'}</span>
          </div>
          <div class="dryer-notifications-list">
            ${notificationItems}
          </div>
        </section>
      `;
}

function renderDryerInputClassificationPage(res, { input, formValues = {}, error }) {
  const html = renderTemplate('dryer-input-classification-form.html', {
    DRYER_CLASSIFICATION_ERROR: buildAlertHtml(error, 'error'),
    ENTRADA_ID: escapeHtml(input.id),
    INPUT_SUMMARY: escapeHtml(`${formatDateTime(input.data_entrada)} · ${input.placa_caminhao} · ${formatProductLabel(input.produto)}`),
    UMIDADE_PERCENT: escapeHtml(formatDecimalInput(formValues.umidade_percent ?? input.umidade_percent ?? 14)),
    IMPUREZA_PERCENT: escapeHtml(formatDecimalInput(formValues.impureza_percent ?? input.impureza_percent ?? 1)),
    GRAOS_AVARIADOS_PERCENT: escapeHtml(formatDecimalInput(formValues.graos_avariados_percent ?? input.graos_avariados_percent ?? 0)),
  });

  res.send(html);
}

function renderDryerStartBatchPage(res, { defaultInitialMoisture, error }) {
  const dryerHtml = renderTemplate('dryer-start-batch.html', {
    DRYER_ERROR: buildAlertHtml(error, 'error'),
    DEFAULT_INITIAL_MOISTURE: escapeHtml(formatPlainDecimal(defaultInitialMoisture)),
  });

  res.send(dryerHtml);
}

function renderDryerPanelPage(res, { batch, readings, settings, message, error, unclassifiedInputs = [] }) {
  const dischargeForecast = calculateDischargeForecast({ batch, readings });
  const startedAt = batch ? formatDateTime(batch.started_at) : 'Nenhuma batelada ativa';
  const dischargeStartedAt = formatDischargeForecast(dischargeForecast);
  const initialMoisture = batch ? `${formatMoisture(batch.umidade_inicial)}%` : '-';
  const readingsRows = readings
    .map((reading) => {
      const detailId = `reading-detail-${reading.id}`;

      return `
        <tr class="dryer-reading-row" tabindex="0" role="button" aria-expanded="false" data-detail-target="${escapeHtml(detailId)}">
          <td>${escapeHtml(formatTime(reading.measured_at))}</td>
          <td>${escapeHtml(formatMoisture(reading.moisture_percent))}%</td>
        </tr>
        <tr class="dryer-reading-detail" id="${escapeHtml(detailId)}" hidden>
          <td colspan="2">Operador: ${escapeHtml(reading.measured_by_login)}</td>
        </tr>
      `;
    })
    .join('');
  const emptyReadings = '<tr><td colspan="2">Nenhuma medição lançada.</td></tr>';
  const batchStatusHtml = formatDryerStatus(batch);
  const moistureFormDisabled = batch ? '' : 'disabled';
  const batchAction = batch && !batch.discharge_started_at
    ? {
        action: '/secador/bateladas/descarga',
        label: 'Iniciar descarga',
        cssClass: 'btn-primary-action',
        confirm: 'Registrar início da descarga para os silos?',
      }
    : {
        action: '/secador/bateladas/nova',
        method: 'get',
        label: 'Iniciar nova batelada',
        cssClass: batch?.discharge_started_at ? 'btn-new-batch-action' : 'btn-primary-action',
        confirm: '',
      };
  const stopDryerAction = batch
    ? `
          <form class="dryer-stop-action" action="/secador/bateladas/parar" method="post" data-confirm-message="Parar o secador e concluir a batelada atual?" data-loading-message="Parando batelada...">
            <button class="btn-danger-action" type="submit">Parar secador</button>
          </form>`
    : '';

  const dryerHtml = renderTemplate('dryer-panel.html', {
    DRYER_MESSAGE: buildAlertHtml(message),
    DRYER_ERROR: buildAlertHtml(error, 'error'),
    DRYER_NOTIFICATIONS: renderUnclassifiedInputNotifications(unclassifiedInputs),
    BATCH_STATUS: batchStatusHtml,
    BATCH_STARTED_AT: escapeHtml(startedAt),
    DISCHARGE_STARTED_AT: escapeHtml(dischargeStartedAt),
    INITIAL_MOISTURE: escapeHtml(initialMoisture),
    BATCH_ACTION_URL: escapeHtml(batchAction.action),
    BATCH_ACTION_METHOD: escapeHtml(batchAction.method || 'post'),
    BATCH_ACTION_CONFIRM: escapeHtml(batchAction.confirm),
    BATCH_ACTION_CLASS: escapeHtml(batchAction.cssClass),
    BATCH_ACTION_LABEL: escapeHtml(batchAction.label),
    READINGS_ROWS: readingsRows || emptyReadings,
    STOP_DRYER_ACTION: stopDryerAction,
    MOISTURE_FORM_DISABLED: moistureFormDisabled,
    MOISTURE_ACTION_HELPER: batch ? 'Digite a umidade medida e toque em Registrar umidade.' : 'Inicie uma batelada para liberar o registro de umidade.',
    BATCH_ACTION_LOADING: batch && !batch.discharge_started_at ? 'Iniciando descarga...' : 'Iniciando batelada...',
  });

  res.send(dryerHtml);
}

module.exports = {
  renderDryerInputClassificationPage,
  renderDryerPanelPage,
  renderDryerStartBatchPage,
};
