const { calculateDischargeForecast } = require('../dryer-forecast');
const {
  escapeHtml,
  formatDateTime,
  formatMoisture,
  formatPlainDecimal,
  formatTime,
} = require('../utils');
const { buildAlertHtml, renderTemplate } = require('./template-utils');

function formatDurationBetween(start, end) {
  if (!start || !end) {
    return '-';
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  const durationMs = endDate.getTime() - startDate.getTime();

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '-';
  }

  const totalMinutes = Math.round(durationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) {
    return `${hours}h ${minutes}min`;
  }

  if (hours) {
    return `${hours}h`;
  }

  return `${minutes}min`;
}

function renderCompletedBatchSummaryCard(completedBatch, { title = 'Última batelada', showPreviousLink = false } = {}) {
  if (!completedBatch) {
    return '';
  }

  const initialMoisture = completedBatch.umidade_inicial !== null
    && completedBatch.umidade_inicial !== undefined
    ? `${formatMoisture(completedBatch.umidade_inicial)}%`
    : '-';
  const finalMoisture = completedBatch.discharge_average_moisture ?? completedBatch.final_moisture;
  const dischargeMoisture = finalMoisture !== null
    && finalMoisture !== undefined
    ? `${formatMoisture(finalMoisture)}%`
    : '-';

  return `
          <article class="dryer-status-card dryer-summary-card">
            <div class="dryer-summary-card-header">
              <span class="dryer-card-label">${escapeHtml(title)}</span>
              ${showPreviousLink ? '<a class="dryer-summary-link" href="/secador/bateladas/anteriores">Ver anteriores</a>' : ''}
            </div>
            <dl class="dryer-summary-list">
              <div>
                <dt>Umidade inicial</dt>
                <dd>${escapeHtml(initialMoisture)}</dd>
              </div>
              <div>
                <dt>Início</dt>
                <dd>${escapeHtml(formatDateTime(completedBatch.started_at))}</dd>
              </div>
              <div>
                <dt>Início descarga</dt>
                <dd>${escapeHtml(formatDateTime(completedBatch.discharge_started_at))}</dd>
              </div>
              <div>
                <dt>Fim descarga</dt>
                <dd>${escapeHtml(formatDateTime(completedBatch.completed_at))}</dd>
              </div>
              <div>
                <dt>Duração</dt>
                <dd>${escapeHtml(formatDurationBetween(completedBatch.started_at, completedBatch.completed_at))}</dd>
              </div>
              <div>
                <dt>Tempo secando</dt>
                <dd>${escapeHtml(formatDurationBetween(completedBatch.started_at, completedBatch.discharge_started_at))}</dd>
              </div>
              <div>
                <dt>Tempo descarga</dt>
                <dd>${escapeHtml(formatDurationBetween(completedBatch.discharge_started_at, completedBatch.completed_at))}</dd>
              </div>
              <div>
                <dt>Umidade final</dt>
                <dd>${escapeHtml(dischargeMoisture)}</dd>
              </div>
            </dl>
          </article>`;
}

function renderLastCompletedBatchSummary(lastCompletedBatch) {
  return renderCompletedBatchSummaryCard(lastCompletedBatch, { showPreviousLink: true });
}

function renderCompletedBatchHistoryPage(res, { completedBatches = [] }) {
  const cardsHtml = completedBatches.length
    ? completedBatches.map((batch, index) => renderCompletedBatchSummaryCard(batch, {
        title: `Batelada ${index + 1}`,
      })).join('')
    : '<p class="empty-state">Nenhuma batelada anterior encontrada.</p>';

  const html = renderTemplate('dryer-batch-history.html', {
    COMPLETED_BATCH_CARDS: cardsHtml,
  });

  res.send(html);
}

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

function buildPersistedForecast(reading) {
  if (!reading || !reading.discharge_forecast_status) {
    return null;
  }

  return {
    status: reading.discharge_forecast_status,
    averageMoisture: reading.average_moisture,
    forecastAt: reading.discharge_forecast_at ? new Date(reading.discharge_forecast_at) : null,
  };
}

function getLatestPersistedForecast(readings = []) {
  return [...readings].reverse().map(buildPersistedForecast).find(Boolean) || null;
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

function toReadingTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function renderDryerReadingRows(batch, readings = [], curveSettings) {
  const columns = 2;

  if (!readings.length) {
    return `<tr><td colspan="${columns}">Nenhuma medição lançada.</td></tr>`;
  }

  const validReadings = readings
    .filter((reading) => toReadingTimestamp(reading.measured_at) !== null)
    .sort((left, right) => toReadingTimestamp(left.measured_at) - toReadingTimestamp(right.measured_at));
  const evolutionById = new Map();

  validReadings.forEach((reading, index) => {
    const forecast = buildPersistedForecast(reading) || calculateDischargeForecast({
      batch: batch ? { ...batch, discharge_started_at: null } : null,
      readings: validReadings.slice(0, index + 1),
      now: new Date(reading.measured_at),
      curveSettings,
    });

    evolutionById.set(String(reading.id), {
      averageMoisture: forecast.averageMoisture,
      forecastLabel: formatDischargeForecast(forecast),
    });
  });

  return readings
    .map((reading) => {
      const detailId = `reading-detail-${reading.id}`;
      const evolution = evolutionById.get(String(reading.id)) || {};
      const averageMoisture = evolution.averageMoisture === null || evolution.averageMoisture === undefined
        ? '-'
        : `${formatMoisture(evolution.averageMoisture)}%`;
      const targetMoisture = batch?.target_moisture === null || batch?.target_moisture === undefined
        ? '-'
        : `${formatMoisture(batch.target_moisture)}%`;
      const actualDischarge = batch?.discharge_started_at ? formatDateTime(batch.discharge_started_at) : '-';

      return `
        <tr class="dryer-reading-row" tabindex="0" role="button" aria-expanded="false" data-detail-target="${escapeHtml(detailId)}" aria-label="Ver detalhes da medição de ${escapeHtml(formatTime(reading.measured_at))}">
          <td>${escapeHtml(formatTime(reading.measured_at))}</td>
          <td>${escapeHtml(formatMoisture(reading.moisture_percent))}%</td>
        </tr>
        <tr class="dryer-reading-detail" id="${escapeHtml(detailId)}" hidden>
          <td colspan="${columns}">
            <dl class="dryer-reading-detail-list">
              <div><dt>Umidade média</dt><dd>${escapeHtml(averageMoisture)}</dd></div>
              <div><dt>Previsão de descarga</dt><dd>${escapeHtml(evolution.forecastLabel || '-')}</dd></div>
              <div><dt>Umidade alvo</dt><dd>${escapeHtml(targetMoisture)}</dd></div>
              <div><dt>Operador</dt><dd>${escapeHtml(reading.measured_by_login)}</dd></div>
              <div><dt>Descarga real</dt><dd>${escapeHtml(actualDischarge)}</dd></div>
            </dl>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderUnclassifiedInputNotifications(inputs = []) {
  if (!inputs.length) {
    return '';
  }

  const notificationButtons = inputs
    .map((input) => `
            <a class="btn-primary-action" href="/secador/entradas/${escapeHtml(input.id)}/classificacao">Classificar ${escapeHtml(input.placa_caminhao)} ${escapeHtml(formatTime(input.data_entrada))}</a>
        `)
    .join('');

  return `
        <section class="admin-section dryer-notifications" aria-label="Classificações pendentes">
          <div class="dryer-notifications-list">
            ${notificationButtons}
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

function renderDryerPanelPage(res, { batch, readings, settings, message, error, unclassifiedInputs = [], lastCompletedBatch = null }) {
  const dischargeForecast = batch?.discharge_started_at
    ? calculateDischargeForecast({ batch, readings, curveSettings: settings })
    : (getLatestPersistedForecast(readings) || calculateDischargeForecast({ batch, readings, curveSettings: settings }));
  const startedAt = batch ? formatDateTime(batch.started_at) : 'Nenhuma batelada ativa';
  const dischargeStartedAt = formatDischargeForecast(dischargeForecast);
  const initialMoisture = batch ? `${formatMoisture(batch.umidade_inicial)}%` : '-';
  const readingsRows = renderDryerReadingRows(batch, readings, settings);
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
                <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
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
    LAST_COMPLETED_BATCH_SUMMARY: renderLastCompletedBatchSummary(lastCompletedBatch),
    BATCH_ACTION_URL: escapeHtml(batchAction.action),
    BATCH_ACTION_METHOD: escapeHtml(batchAction.method || 'post'),
    BATCH_ACTION_CSRF_INPUT: (batchAction.method || 'post') === 'post' ? '<input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">' : '',
    BATCH_ACTION_CONFIRM: escapeHtml(batchAction.confirm),
    BATCH_ACTION_CLASS: escapeHtml(batchAction.cssClass),
    BATCH_ACTION_LABEL: escapeHtml(batchAction.label),
    READINGS_ROWS: readingsRows,
    STOP_DRYER_ACTION: stopDryerAction,
    MOISTURE_FORM_DISABLED: moistureFormDisabled,
    MOISTURE_ACTION_HELPER: batch ? 'Digite a umidade medida e toque em Registrar umidade.' : 'Inicie uma batelada para liberar o registro de umidade.',
    BATCH_ACTION_LOADING: batch && !batch.discharge_started_at ? 'Iniciando descarga...' : 'Iniciando batelada...',
  });

  res.send(dryerHtml);
}

module.exports = {
  renderCompletedBatchHistoryPage,
  renderDryerInputClassificationPage,
  renderDryerPanelPage,
  renderDryerStartBatchPage,
};
