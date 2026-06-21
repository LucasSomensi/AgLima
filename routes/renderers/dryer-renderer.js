const { calculateDischargeForecast } = require('../dryer-forecast');
const {
  escapeHtml,
  formatDateTime,
  formatMoisture,
  formatTime,
} = require('../utils');
const { buildAlertHtml, renderTemplate } = require('./template-utils');

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

function renderDryerPanelPage(res, { batch, readings, settings, message, error }) {
  const dischargeForecast = calculateDischargeForecast({ batch, readings });
  const startedAt = batch ? formatDateTime(batch.started_at) : 'Nenhuma batelada ativa';
  const dischargeStartedAt = formatDischargeForecast(dischargeForecast);
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
        action: '/secador/bateladas',
        label: 'Iniciar nova batelada',
        cssClass: batch?.discharge_started_at ? 'btn-new-batch-action' : 'btn-primary-action',
        confirm: batch ? 'Iniciar uma nova batelada e encerrar a batelada ativa?' : 'Iniciar uma nova batelada?',
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
    BATCH_STATUS: batchStatusHtml,
    BATCH_STARTED_AT: escapeHtml(startedAt),
    DISCHARGE_STARTED_AT: escapeHtml(dischargeStartedAt),
    BATCH_ACTION_URL: escapeHtml(batchAction.action),
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
  renderDryerPanelPage,
};
