const fs = require('fs');
const path = require('path');
const { GRAIN_LABELS, ROOT_LOGIN, ROLES } = require('../constants');
const { calculateAverageMoisture, calculateDischargeForecast } = require('../dryer-forecast');
const {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatMoisture,
  formatTime,
  getRoleLabel,
  toDateOnlyInputValue,
  toDateTimeLocalValue,
} = require('../utils');
const { buildAlertHtml, renderEmptyRow, renderTemplate } = require('./template-utils');
const { buildScaleInputRows, buildScaleOutputRows } = require('./weighbridge-renderer');

function renderAdminUsersPage(res, { users, message, error }) {
  const adminPath = path.join(__dirname, '../../views/admin-users.html');
  const rowsHtml = users
    .map((user) => {
      const createdAt = formatDateTime(user.created_at);
      const canDelete = user.login !== ROOT_LOGIN;
      const actions = canDelete
        ? `
            <div class="admin-actions-stack">
              <form class="admin-password-form" action="/admin/usuarios/${escapeHtml(user.id)}/senha" method="post">
                <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
                <label class="sr-only" for="password-${escapeHtml(user.id)}">Nova senha para ${escapeHtml(user.login)}</label>
                <input class="form-control" id="password-${escapeHtml(user.id)}" name="password" type="password" placeholder="Nova senha" autocomplete="new-password" required>
                <button class="btn-secondary-action admin-small-action" type="submit">Definir senha</button>
              </form>
              <form action="/admin/usuarios/${escapeHtml(user.id)}/remover" method="post" onsubmit="return confirm('Remover este usuário do sistema?');">
                <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
                <button class="btn-danger-action" type="submit">Remover</button>
              </form>
            </div>
          `
        : '<span class="admin-muted">Protegido</span>';

      return `
        <tr>
          <td>${escapeHtml(user.login)}</td>
          <td>${escapeHtml(getRoleLabel(user.role))}</td>
          <td>${user.disabled ? 'Inativo' : 'Ativo'}</td>
          <td>${user.must_change_password ? 'Sim' : 'Não'}</td>
          <td>${escapeHtml(createdAt)}</td>
          <td>${actions}</td>
        </tr>
      `;
    })
    .join('');
  const emptyState = users.length
    ? ''
    : renderEmptyRow(6, 'Nenhum usuário cadastrado.');

  const adminHtml = fs
    .readFileSync(adminPath, 'utf8')
    .replace('{{ADMIN_MESSAGE}}', buildAlertHtml(message))
    .replace('{{ADMIN_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{USERS_ROWS}}', rowsHtml || emptyState);

  res.send(adminHtml);
}


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

function formatOptionalMoisture(value) {
  return value === null || value === undefined ? '-' : `${formatMoisture(value)}%`;
}

function calculateBatchDischargeAverageMoisture(batch, readings = []) {
  if (!batch) {
    return null;
  }

  const dischargeStartedAt = toChartTimestamp(batch.discharge_started_at);
  const completedAt = toChartTimestamp(batch.completed_at);

  if (dischargeStartedAt === null || completedAt === null) {
    return null;
  }

  return calculateAverageMoisture({
    readings: [
      {
        measured_at: batch.started_at,
        moisture_percent: batch.umidade_inicial,
      },
      ...readings,
    ],
    periodStart: dischargeStartedAt,
    periodEnd: completedAt,
  });
}

function formatProductLabel(value) {
  const labels = {
    milho: 'Milho',
    soja: 'Soja',
  };

  return labels[value] || value || '-';
}

function formatKg(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })} kg`;
}

function renderAdminStoragePage(res, { summary, recalibrations, ignoredInputs, message, error }) {
  const ignoredInputsByProduct = new Map(
    ignoredInputs.map((item) => [item.produto, Number(item.entradas_pendentes || 0)])
  );
  const summaryCards = summary
    .map((item) => `
        <article class="dryer-status-card storage-status-card">
          <span class="dryer-card-label">${escapeHtml(formatProductLabel(item.produto))}</span>
          <strong>${escapeHtml(formatKg(item.armazenado_kg))}</strong>
          <small>${item.data_recalibracao ? `Base: ${escapeHtml(formatDateTime(item.data_recalibracao))}` : 'Sem recalibração registrada'}</small>
        </article>
      `)
    .join('');
  const detailRows = summary
    .map((item) => {
      const pendingInputs = ignoredInputsByProduct.get(item.produto) || 0;
      return `
        <tr>
          <td>${escapeHtml(formatProductLabel(item.produto))}</td>
          <td>${item.data_recalibracao ? `${escapeHtml(formatKg(item.quantidade_recalibrada_kg))}<br><span class="admin-muted">${escapeHtml(formatDateTime(item.data_recalibracao))}</span>` : '-'}</td>
          <td>${escapeHtml(formatKg(item.entradas_desde_recalibracao_kg))}</td>
          <td>${escapeHtml(formatKg(item.saidas_desde_recalibracao_kg))}</td>
          <td><strong>${escapeHtml(formatKg(item.armazenado_kg))}</strong></td>
          <td>${pendingInputs ? `${escapeHtml(String(pendingInputs))} entrada(s)` : '-'}</td>
        </tr>
      `;
    })
    .join('') || '<tr><td colspan="6">Nenhum produto encontrado.</td></tr>';
  const recalibrationRows = recalibrations
    .map((item) => `
        <tr>
          <td>${escapeHtml(formatDateTime(item.data_recalibracao))}</td>
          <td>${escapeHtml(formatProductLabel(item.produto))}</td>
          <td>${escapeHtml(formatKg(item.quantidade_real_kg))}</td>
          <td>${escapeHtml(item.criado_por_login || '-')}</td>
          <td>${escapeHtml(item.observacoes || '-')}</td>
        </tr>
      `)
    .join('') || '<tr><td colspan="5">Nenhuma recalibração registrada.</td></tr>';

  const storageHtml = renderTemplate('admin-storage.html', {
    STORAGE_MESSAGE: buildAlertHtml(message),
    STORAGE_ERROR: buildAlertHtml(error, 'error'),
    STORAGE_SUMMARY_CARDS: summaryCards,
    CURRENT_DATE_TIME: escapeHtml(toDateTimeLocalValue()),
    STORAGE_DETAIL_ROWS: detailRows,
    STORAGE_RECALIBRATION_ROWS: recalibrationRows,
  });

  res.send(storageHtml);
}

function getGrainLabel(grainType) {
  return GRAIN_LABELS[grainType] || grainType || '-';
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

function getBatchDischargeForecast(batch, readings = []) {
  if (batch?.discharge_started_at) {
    return calculateDischargeForecast({ batch, readings });
  }

  return getLatestPersistedForecast(readings) || calculateDischargeForecast({ batch, readings });
}

function formatBatchStatusLabel(batch) {
  if (!batch) {
    return 'Parado';
  }

  if (batch.status !== 'active') {
    return 'Concluída';
  }

  return batch.discharge_started_at ? 'Descarregando' : 'Secando';
}

function buildReadingEvolutionRows(batch, readings = [], { includeOperator = true, compactTime = false, expandableOperator = false } = {}) {
  const columns = includeOperator ? 6 : 5;

  if (!readings.length) {
    return `<tr><td colspan="${columns}">Nenhuma medição lançada.</td></tr>`;
  }

  const validReadings = readings
    .filter((reading) => toChartTimestamp(reading.measured_at) !== null)
    .sort((left, right) => toChartTimestamp(left.measured_at) - toChartTimestamp(right.measured_at));
  const rowsById = new Map();

  validReadings.forEach((reading, index) => {
    const measuredAt = new Date(reading.measured_at);
    const readingsUntilPoint = validReadings.slice(0, index + 1);
    const forecast = buildPersistedForecast(reading) || calculateDischargeForecast({
      batch: batch ? { ...batch, discharge_started_at: null } : null,
      readings: readingsUntilPoint,
      now: measuredAt,
    });

    rowsById.set(String(reading.id), {
      averageMoisture: forecast.averageMoisture,
      forecastLabel: formatDischargeForecast(forecast),
    });
  });

  return readings
    .map((reading) => {
      const evolution = rowsById.get(String(reading.id)) || {};
      const measuredAt = compactTime ? formatTime(reading.measured_at) : formatDateTime(reading.measured_at);
      const averageMoisture = evolution.averageMoisture === null || evolution.averageMoisture === undefined
        ? '-'
        : `${formatMoisture(evolution.averageMoisture)}%`;
      const targetMoisture = batch?.target_moisture === null || batch?.target_moisture === undefined
        ? '-'
        : `${formatMoisture(batch.target_moisture)}%`;
      const dischargeActual = batch?.discharge_started_at ? formatDateTime(batch.discharge_started_at) : '-';
      const cells = `
          <td>${escapeHtml(measuredAt)}</td>
          <td>${escapeHtml(formatMoisture(reading.moisture_percent))}%</td>
          <td>${escapeHtml(averageMoisture)}</td>
          <td>${escapeHtml(evolution.forecastLabel || '-')}</td>
          <td>${escapeHtml(targetMoisture)}</td>
          ${includeOperator ? `<td>${escapeHtml(reading.measured_by_login)}</td>` : ''}`;

      if (!expandableOperator) {
        return `<tr>${cells}</tr>`;
      }

      const detailId = `reading-detail-${reading.id}`;
      return `
        <tr class="dryer-reading-row" tabindex="0" role="button" aria-expanded="false" data-detail-target="${escapeHtml(detailId)}">
          ${cells}
        </tr>
        <tr class="dryer-reading-detail" id="${escapeHtml(detailId)}" hidden>
          <td colspan="${columns}">Operador: ${escapeHtml(reading.measured_by_login)} · Descarga real: ${escapeHtml(dischargeActual)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderReadingsRows(readings, options = {}) {
  return buildReadingEvolutionRows(options.batch, readings, options);
}

function toChartTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();

  return Number.isFinite(timestamp) ? timestamp : null;
}

function toChartNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function formatChartTime(value) {
  return formatDateTime(value).replace(' ', '\n');
}

function buildBatchEvolutionPoints(batch, readings) {
  const batchForForecast = { ...batch, discharge_started_at: null };
  const points = [];
  const startedAt = toChartTimestamp(batch.started_at);
  const initialMoisture = toChartNumber(batch.umidade_inicial);

  if (startedAt !== null && initialMoisture !== null) {
    const initialForecast = calculateDischargeForecast({
      batch: batchForForecast,
      readings: [],
      now: new Date(startedAt),
    });

    points.push({
      label: 'Início',
      measuredAt: new Date(startedAt),
      averageMoisture: initialForecast.averageMoisture ?? initialMoisture,
      forecastAt: initialForecast.forecastAt || null,
    });
  }

  const validReadings = readings
    .filter((reading) => toChartTimestamp(reading.measured_at) !== null)
    .sort((left, right) => toChartTimestamp(left.measured_at) - toChartTimestamp(right.measured_at));

  validReadings.forEach((reading, index) => {
    const measuredAt = new Date(reading.measured_at);
    const readingsUntilPoint = validReadings.slice(0, index + 1);
    const forecast = buildPersistedForecast(reading) || calculateDischargeForecast({
      batch: batchForForecast,
      readings: readingsUntilPoint,
      now: measuredAt,
    });

    points.push({
      label: formatDateTime(measuredAt),
      measuredAt,
      averageMoisture: forecast.averageMoisture ?? toChartNumber(reading.moisture_percent),
      forecastAt: forecast.forecastAt || null,
    });
  });

  return points.filter((point) => point.averageMoisture !== null || point.forecastAt);
}

function normalizeChartValue(value, min, max, top, height) {
  if (max === min) {
    return top + height / 2;
  }

  return top + height - ((value - min) / (max - min)) * height;
}

function renderPolyline(points, valueKey, min, max, chart) {
  const validPoints = points.filter((point) => point[valueKey] !== null && point[valueKey] !== undefined);

  if (validPoints.length === 0) {
    return '';
  }

  const coordinates = validPoints
    .map((point) => `${point.x},${normalizeChartValue(point[valueKey], min, max, chart.top, chart.height)}`)
    .join(' ');
  const pointClass = valueKey === 'averageMoisture' ? 'batch-chart-point-moisture' : 'batch-chart-point-forecast';

  return `
    <polyline class="${pointClass}" points="${coordinates}" />
    ${validPoints.map((point) => `<circle class="${pointClass}" cx="${point.x}" cy="${normalizeChartValue(point[valueKey], min, max, chart.top, chart.height)}" r="4"><title>${escapeHtml(point.title)}</title></circle>`).join('')}
  `;
}

function renderBatchEvolutionChart(batch, readings) {
  const points = buildBatchEvolutionPoints(batch, readings);

  if (points.length < 2) {
    return '<p class="admin-muted">Registre pelo menos uma medição para visualizar a evolução da umidade média e da previsão de descarga.</p>';
  }

  const chart = { left: 68, right: 92, top: 28, height: 220, width: 780 };
  const usableWidth = chart.width - chart.left - chart.right;
  const forecastTimestamps = points.map((point) => point.forecastAt ? point.forecastAt.getTime() : null).filter((value) => value !== null);
  const moistureValues = points.map((point) => point.averageMoisture).filter((value) => value !== null && value !== undefined);
  const moistureMin = Math.floor(Math.min(...moistureValues, Number(batch.target_moisture || 14.5)) - 0.5);
  const moistureMax = Math.ceil(Math.max(...moistureValues, Number(batch.umidade_inicial || 0)) + 0.5);
  const forecastMin = Math.min(...forecastTimestamps);
  const forecastMax = Math.max(...forecastTimestamps);
  const denominator = Math.max(points.length - 1, 1);
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: chart.left + (usableWidth * index) / denominator,
    forecastTimestamp: point.forecastAt ? point.forecastAt.getTime() : null,
    title: `${point.label} · média ${formatMoisture(point.averageMoisture)}% · previsão ${point.forecastAt ? formatDateTime(point.forecastAt) : '-'}`,
  }));
  const targetY = normalizeChartValue(Number(batch.target_moisture || 14.5), moistureMin, moistureMax, chart.top, chart.height);
  const actualDischargeTimestamp = toChartTimestamp(batch.discharge_started_at);
  const actualY = actualDischargeTimestamp && forecastTimestamps.length
    ? normalizeChartValue(actualDischargeTimestamp, forecastMin, forecastMax, chart.top, chart.height)
    : null;

  return `
    <div class="batch-chart-scroll" role="img" aria-label="Gráfico da evolução da umidade média e do horário previsto para descarga">
      <svg class="batch-evolution-chart" viewBox="0 0 ${chart.width} 310" focusable="false" aria-hidden="true">
        <line class="batch-chart-axis" x1="${chart.left}" y1="${chart.top}" x2="${chart.left}" y2="${chart.top + chart.height}" />
        <line class="batch-chart-axis" x1="${chart.width - chart.right}" y1="${chart.top}" x2="${chart.width - chart.right}" y2="${chart.top + chart.height}" />
        <line class="batch-chart-axis" x1="${chart.left}" y1="${chart.top + chart.height}" x2="${chart.width - chart.right}" y2="${chart.top + chart.height}" />
        <line class="batch-chart-target" x1="${chart.left}" y1="${targetY}" x2="${chart.width - chart.right}" y2="${targetY}" />
        ${actualY === null ? '' : `<line class="batch-chart-actual" x1="${chart.left}" y1="${actualY}" x2="${chart.width - chart.right}" y2="${actualY}" />`}
        ${renderPolyline(chartPoints, 'averageMoisture', moistureMin, moistureMax, chart)}
        ${forecastTimestamps.length ? renderPolyline(chartPoints, 'forecastTimestamp', forecastMin, forecastMax, chart) : ''}
        <text class="batch-chart-label" x="12" y="${chart.top + 6}">${escapeHtml(formatMoisture(moistureMax))}%</text>
        <text class="batch-chart-label" x="12" y="${chart.top + chart.height}">${escapeHtml(formatMoisture(moistureMin))}%</text>
        <text class="batch-chart-label batch-chart-label-right" x="${chart.width - 12}" y="${chart.top + 6}">${escapeHtml(forecastTimestamps.length ? formatChartTime(new Date(forecastMax)) : '-')}</text>
        <text class="batch-chart-label batch-chart-label-right" x="${chart.width - 12}" y="${chart.top + chart.height}">${escapeHtml(forecastTimestamps.length ? formatChartTime(new Date(forecastMin)) : '-')}</text>
        ${chartPoints.map((point) => `<text class="batch-chart-x-label" x="${point.x}" y="286">${escapeHtml(point.label === 'Início' ? 'Início' : formatDateTime(point.measuredAt).slice(0, 5))}</text>`).join('')}
      </svg>
    </div>
    <div class="batch-chart-legend">
      <span><i class="batch-legend-moisture"></i> Umidade média</span>
      <span><i class="batch-legend-forecast"></i> Horário previsto para descarga</span>
      <span><i class="batch-legend-target"></i> Umidade alvo (${escapeHtml(formatMoisture(batch.target_moisture))}%)</span>
      ${batch.discharge_started_at ? `<span><i class="batch-legend-actual"></i> Descarga real (${escapeHtml(formatDateTime(batch.discharge_started_at))})</span>` : ''}
    </div>
  `;
}

function formatDaysOverdueLabel(daysOverdue) {
  if (daysOverdue <= 0) {
    return 'vence hoje';
  }

  return daysOverdue === 1 ? 'venceu há 1 dia' : `venceu há ${daysOverdue} dias`;
}

function buildAdminNotificationTitle(notification) {
  const contractLabel = `Contrato #${notification.contractId}`;

  if (notification.type === 'shipment_due') {
    return `${contractLabel} pronto para embarque`;
  }

  if (notification.type === 'receipt_due') {
    return `${contractLabel} ${formatDaysOverdueLabel(notification.daysOverdue)}`;
  }

  if (notification.type === 'brokerage_due') {
    const daysLabel = notification.daysOverdue === 1 ? 'venceu há 1 dia' : `venceu há ${notification.daysOverdue} dias`;
    return `${contractLabel} com corretagem pendente` + (notification.receiptDate ? ` · ${daysLabel}` : '');
  }

  return `${contractLabel} precisa de atenção`;
}

function buildAdminNotificationDetails(notification) {
  if (notification.type === 'shipment_due') {
    return `${notification.buyerName} · Saldo: ${formatKg(notification.balanceKg)}`;
  }

  if (notification.type === 'receipt_due') {
    return `${notification.buyerName} · ${formatMoney(notification.contractValue)}`;
  }

  if (notification.type === 'brokerage_due') {
    return `${notification.buyerName} · Corretagem: ${formatMoney(notification.brokerageValue)}`;
  }

  return notification.buyerName;
}

function getAdminNotificationActionLabel(type) {
  const labels = {
    shipment_due: 'Marcar como embarcado',
    receipt_due: 'Marcar como recebido',
    brokerage_due: 'Marcar corretagem como paga',
  };

  return labels[type] || 'Resolver pendência';
}

function renderAdminNotificationsPanel(notifications) {
  const notificationCount = notifications.length;
  const notificationSummary = notificationCount === 1 ? '1 ação pendente' : `${notificationCount} ações pendentes`;

  if (!notificationCount) {
    return `
        <section class="admin-section admin-notifications-panel" aria-labelledby="admin-notifications-title">
          <div class="admin-section-header admin-notifications-header">
            <h2 id="admin-notifications-title">Notificações</h2>
            <span class="admin-notifications-count">Tudo em dia</span>
          </div>
          <p class="admin-notification-empty">Nenhuma ação pendente no momento.</p>
        </section>
      `;
  }

  const notificationItems = notifications
    .map((notification) => `
          <li class="admin-notification-item admin-notification-${escapeHtml(notification.type)}">
            <div class="admin-notification-copy">
              <strong>${escapeHtml(buildAdminNotificationTitle(notification))}</strong>
              <span>${escapeHtml(buildAdminNotificationDetails(notification))}</span>
              ${notification.receiptDate ? `<span>Vencimento em ${escapeHtml(formatDate(notification.receiptDate))}</span>` : ''}
            </div>
            <form class="admin-notification-action" action="${escapeHtml(notification.actionPath)}" method="post">
                <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
              <button class="btn-primary-action admin-notification-button" type="submit">${escapeHtml(getAdminNotificationActionLabel(notification.type))}</button>
            </form>
          </li>
        `)
    .join('');

  return `
        <section class="admin-section admin-notifications-panel" aria-labelledby="admin-notifications-title">
          <div class="admin-section-header admin-notifications-header">
            <h2 id="admin-notifications-title">Notificações</h2>
            <span class="admin-notifications-count">${escapeHtml(notificationSummary)}</span>
          </div>
          <ul class="admin-notifications-list">
            ${notificationItems}
          </ul>
        </section>
      `;
}

function formatSacks(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} sc`;
}

function renderAdminMetric(label, value) {
  return renderAdminMetricHtml(label, escapeHtml(value));
}

function renderAdminMetricHtml(label, valueHtml) {
  return `
      <div class="admin-home-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${valueHtml}</strong>
      </div>
    `;
}

function renderAdminContractsPanel(summary = {}) {
  const sojaKg = Number(summary.soja_a_embarcar_kg || 0);
  const milhoKg = Number(summary.milho_a_embarcar_kg || 0);
  const nextReceipt = summary.proximo_recebimento_contrato_id
    ? `${summary.proximo_recebimento_data ? escapeHtml(formatDate(summary.proximo_recebimento_data)) : '-'} · <a class="admin-table-link" href="/balanca/contratos/${escapeHtml(summary.proximo_recebimento_contrato_id)}">Contrato #${escapeHtml(summary.proximo_recebimento_contrato_id)}</a>${summary.proximo_recebimento_comprador ? ` · ${escapeHtml(summary.proximo_recebimento_comprador)}` : ''}`
    : '-';

  return `
        <section class="admin-section admin-notifications-panel admin-home-panel" aria-labelledby="admin-contracts-title">
          <div class="admin-section-header admin-notifications-header">
            <h2 id="admin-contracts-title">Contratos</h2>
            <a class="btn-secondary-action" href="/balanca/contratos">Ver contratos</a>
            <a class="btn-secondary-action" href="/admin/contratos">Editar contratos</a>
          </div>
          <div class="admin-home-metrics-grid">
            ${renderAdminMetric('Contratos ativos', String(summary.contratos_ativos || 0))}
            ${renderAdminMetric('Soja a embarcar', `${formatKg(sojaKg)} · ${formatSacks(sojaKg / 60)}`)}
            ${renderAdminMetric('Milho a embarcar', `${formatKg(milhoKg)} · ${formatSacks(milhoKg / 60)}`)}
            ${renderAdminMetric('Valor total a receber', formatMoney(summary.valor_total_a_receber || 0))}
            ${renderAdminMetricHtml('Próximo recebimento', nextReceipt)}
          </div>
        </section>
      `;
}

function renderAdminDryerPanel(batch, readings = []) {
  const dischargeForecast = getBatchDischargeForecast(batch, readings);
  const dischargeLabel = batch?.discharge_started_at ? 'Início da descarga' : 'Previsão da próxima descarga';

  return `
        <section class="admin-section admin-notifications-panel admin-home-panel" aria-labelledby="admin-dryer-title">
          <div class="admin-section-header admin-notifications-header">
            <h2 id="admin-dryer-title">Secador</h2>
            <a class="btn-secondary-action" href="/admin/secador">Ver secador</a>
          </div>
          <div class="admin-home-metrics-grid">
            ${renderAdminMetric('Status do secador', formatBatchStatusLabel(batch))}
            ${renderAdminMetric('Início da batelada', batch ? formatDateTime(batch.started_at) : '-')}
            ${renderAdminMetric(dischargeLabel, formatDischargeForecast(dischargeForecast))}
          </div>
        </section>
      `;
}

function getStorageAmount(summary = [], product) {
  const item = summary.find((entry) => entry.produto === product);
  return Number(item?.armazenado_kg || 0);
}

function renderAdminStoragePanel(summary = []) {
  const milhoKg = getStorageAmount(summary, 'milho');
  const sojaKg = getStorageAmount(summary, 'soja');

  return `
        <section class="admin-section admin-notifications-panel admin-home-panel" aria-labelledby="admin-storage-title">
          <div class="admin-section-header admin-notifications-header">
            <h2 id="admin-storage-title">Armazenagem</h2>
            <a class="btn-secondary-action" href="/admin/armazenamento">Ver armazenagem</a>
          </div>
          <div class="admin-home-metrics-grid">
            ${renderAdminMetric('Milho armazenado', `${formatKg(milhoKg)} · ${formatSacks(milhoKg / 60)}`)}
            ${renderAdminMetric('Soja armazenada', `${formatKg(sojaKg)} · ${formatSacks(sojaKg / 60)}`)}
          </div>
        </section>
      `;
}

function renderAdminWeighbridgePanel({ inputs = [], outputs = [] } = {}) {
  return `
        <section class="admin-section admin-notifications-panel admin-home-panel" aria-labelledby="admin-weighbridge-title">
          <div class="admin-section-header admin-notifications-header">
            <h2 id="admin-weighbridge-title">Entradas e saídas</h2>
          </div>
          <section class="admin-section" aria-labelledby="admin-recent-inputs-title">
            <div class="admin-section-header">
              <h3 id="admin-recent-inputs-title">Últimas 10 entradas</h3>
              <a class="btn-secondary-action" href="/balanca/entradas">Ver lista completa</a>
            </div>
            <div class="admin-table-wrapper"><table class="admin-table weighbridge-table weighbridge-input-table"><thead><tr><th>Data/hora</th><th>Placa</th><th>Produto</th><th>Bruto</th><th>Tara</th><th>Líquido</th><th>Origem</th><th>Classificação</th></tr></thead><tbody>${buildScaleInputRows(inputs)}</tbody></table></div>
          </section>
          <section class="admin-section" aria-labelledby="admin-recent-outputs-title">
            <div class="admin-section-header">
              <h3 id="admin-recent-outputs-title">Últimas 10 saídas</h3>
              <a class="btn-secondary-action" href="/balanca/saidas">Ver lista completa</a>
            </div>
            <div class="admin-table-wrapper"><table class="admin-table weighbridge-table"><thead><tr><th>Data/hora</th><th>Placa</th><th>Produto</th><th>Bruto</th><th>Tara</th><th>Líquido</th><th>Contrato</th><th>Ação</th></tr></thead><tbody>${buildScaleOutputRows(outputs)}</tbody></table></div>
          </section>
        </section>
      `;
}

function renderAdminHomePage(res, { notifications = [], contractsSummary = {}, dryerBatch = null, dryerReadings = [], storageSummary = [], scaleInputs = [], scaleOutputs = [], message, error } = {}) {
  const adminHomeHtml = renderTemplate('admin-home.html', {
    ADMIN_HOME_MESSAGE: buildAlertHtml(message),
    ADMIN_HOME_ERROR: buildAlertHtml(error, 'error'),
    ADMIN_NOTIFICATIONS_PANEL: renderAdminNotificationsPanel(notifications),
    ADMIN_CONTRACTS_PANEL: renderAdminContractsPanel(contractsSummary),
    ADMIN_DRYER_PANEL: renderAdminDryerPanel(dryerBatch, dryerReadings),
    ADMIN_STORAGE_PANEL: renderAdminStoragePanel(storageSummary),
    ADMIN_WEIGHBRIDGE_PANEL: renderAdminWeighbridgePanel({ inputs: scaleInputs, outputs: scaleOutputs }),
  });

  res.send(adminHomeHtml);
}

function renderAdminDashboardPage(res, { batch, readings, settings, message, error }) {
  const dashboardPath = path.join(__dirname, '../../views/admin-dashboard.html');
  const statusLabel = formatBatchStatusLabel(batch);
  const currentTargetMoisture = formatMoisture(settings?.target_moisture);
  const batchTargetMoisture = batch ? formatMoisture(batch.target_moisture) : currentTargetMoisture;
  const readingsRows = renderReadingsRows(readings, { batch });
  const dischargeForecast = getBatchDischargeForecast(batch, readings);
  const dashboardHtml = fs
    .readFileSync(dashboardPath, 'utf8')
    .replace('{{ADMIN_PANEL_MESSAGE}}', buildAlertHtml(message))
    .replace('{{ADMIN_PANEL_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{CURRENT_TARGET_MOISTURE}}', escapeHtml(currentTargetMoisture))
    .replace('{{TARGET_MOISTURE_VALUE}}', escapeHtml(formatMoisture(settings?.target_moisture).replace(',', '.')))
    .replace('{{BATCH_STATUS}}', escapeHtml(statusLabel))
    .replace('{{BATCH_STARTED_AT}}', escapeHtml(batch ? formatDateTime(batch.started_at) : 'Nenhuma batelada ativa'))
    .replace('{{BATCH_DISCHARGE_STARTED_AT}}', escapeHtml(formatDischargeForecast(dischargeForecast)))
    .replace('{{BATCH_TARGET_MOISTURE}}', escapeHtml(batchTargetMoisture))
    .replace('{{BATCH_PRODUCT}}', escapeHtml(batch ? getGrainLabel(batch.grain_type) : '-'))
    .replace('{{READINGS_ROWS}}', readingsRows);

  res.send(dashboardHtml);
}


function buildNextPageHref(currentUrl, nextCursor) {
  if (!nextCursor) {
    return '';
  }

  const url = new URL(currentUrl || '/', 'http://localhost');
  url.searchParams.set('cursor', nextCursor);
  return `${url.pathname}${url.search}`;
}

function buildPaginationHtml({ hasNextPage, nextCursor, currentUrl }) {
  if (!hasNextPage || !nextCursor) {
    return '';
  }

  return `
          <nav class="pagination-nav" aria-label="Paginação">
            <a class="btn-secondary-action pagination-link" href="${escapeHtml(buildNextPageHref(currentUrl, nextCursor))}">Próxima página</a>
            <button class="btn-secondary-action pagination-link" type="button" onclick="history.back()">Voltar</button>
          </nav>`;
}

function renderAdminBatchesPage(res, { batches, nextCursor = null, hasNextPage = false, currentUrl = '/admin/bateladas' }) {
  const batchesPath = path.join(__dirname, '../../views/admin-batches.html');
  const rowsHtml = batches
    .map((batch) => `
        <tr>
          <td><a class="admin-table-link" href="/admin/bateladas/${escapeHtml(batch.id)}">${escapeHtml(formatDateTime(batch.started_at))}</a></td>
          <td>${escapeHtml(getGrainLabel(batch.grain_type))}</td>
          <td>${escapeHtml(formatBatchStatusLabel(batch))}</td>
          <td>${escapeHtml(batch.completed_at ? formatDateTime(batch.completed_at) : '-')}</td>
          <td>${escapeHtml(formatMoisture(batch.target_moisture))}%</td>
        </tr>
      `)
    .join('');
  const emptyState = '<tr><td colspan="5">Nenhuma batelada anterior encontrada.</td></tr>';
  const batchesHtml = fs
    .readFileSync(batchesPath, 'utf8')
    .replace('{{BATCHES_ROWS}}', rowsHtml || emptyState)
    .replace('{{PAGINATION_CONTROLS}}', buildPaginationHtml({ hasNextPage, nextCursor, currentUrl }));

  res.send(batchesHtml);
}

function renderAdminBatchDetailPage(res, { batch, readings }) {
  const batchPath = path.join(__dirname, '../../views/admin-batch-detail.html');
  const finalMoisture = batch.final_moisture ?? calculateBatchDischargeAverageMoisture(batch, readings);
  const detailHtml = fs
    .readFileSync(batchPath, 'utf8')
    .replace('{{BATCH_STATUS}}', escapeHtml(formatBatchStatusLabel(batch)))
    .replace('{{BATCH_STARTED_AT}}', escapeHtml(formatDateTime(batch.started_at)))
    .replace('{{BATCH_DISCHARGE_STARTED_AT}}', escapeHtml(batch.discharge_started_at ? formatDateTime(batch.discharge_started_at) : '-'))
    .replace('{{BATCH_COMPLETED_AT}}', escapeHtml(batch.completed_at ? formatDateTime(batch.completed_at) : '-'))
    .replace('{{BATCH_TARGET_MOISTURE}}', escapeHtml(formatMoisture(batch.target_moisture)))
    .replace('{{BATCH_PRODUCT}}', escapeHtml(getGrainLabel(batch.grain_type)))
    .replace('{{BATCH_DURATION}}', escapeHtml(formatDurationBetween(batch.started_at, batch.completed_at)))
    .replace('{{BATCH_DRYING_DURATION}}', escapeHtml(formatDurationBetween(batch.started_at, batch.discharge_started_at)))
    .replace('{{BATCH_DISCHARGE_DURATION}}', escapeHtml(formatDurationBetween(batch.discharge_started_at, batch.completed_at)))
    .replace('{{BATCH_INITIAL_MOISTURE}}', escapeHtml(formatOptionalMoisture(batch.umidade_inicial)))
    .replace('{{BATCH_FINAL_MOISTURE}}', escapeHtml(formatOptionalMoisture(finalMoisture)))
    .replace('{{READINGS_ROWS}}', renderReadingsRows(readings, { batch }));

  res.send(detailHtml);
}


function formatMoney(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDecimalInput(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  return String(value).replace(',', '.');
}

function formatBooleanLabel(value) {
  return value ? 'Sim' : 'Não';
}

function buildOption(value, label, selectedValue) {
  const selected = String(value) === String(selectedValue || '') ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
}

function buildContractsPageHref(params = {}) {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();

  return queryString ? `/admin/contratos?${queryString}` : '/admin/contratos';
}


function renderContractFormPage(res, { pageTitle, formTitle, formDescription, error, formHtml }) {
  const html = renderTemplate('admin-contract-form.html', {
    PAGE_TITLE: escapeHtml(pageTitle),
    FORM_TITLE: escapeHtml(formTitle),
    FORM_DESCRIPTION: escapeHtml(formDescription),
    CONTRACTS_ERROR: buildAlertHtml(error, 'error'),
    FORM_HTML: formHtml,
  });

  res.send(html);
}

function renderAdminBuyerFormPage(res, { buyer, error }) {
  const action = buyer ? `/admin/contratos/compradores/${escapeHtml(buyer.id)}` : '/admin/contratos/compradores';
  return renderContractFormPage(res, {
    pageTitle: buyer ? 'Editar comprador' : 'Novo comprador',
    formTitle: buyer ? 'Editar comprador' : 'Novo comprador',
    formDescription: 'Preencha o nome do comprador. Os demais dados cadastrais são opcionais.',
    error,
    formHtml: `<form class="contact-form contracts-form" action="${action}" method="post">
                <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
      <div class="contracts-form-grid"><label>Nome<input class="form-control" name="nome" type="text" value="${escapeHtml(buyer?.nome || '')}" required></label><label>Nome completo<input class="form-control" name="nome_completo" type="text" value="${escapeHtml(buyer?.nome_completo || '')}"></label><label>Endereço<input class="form-control" name="endereco" type="text" value="${escapeHtml(buyer?.endereco || '')}"></label><label>Número<input class="form-control" name="numero" type="text" value="${escapeHtml(buyer?.numero || '')}"></label><label>CEP<input class="form-control" name="cep" type="text" inputmode="numeric" value="${escapeHtml(buyer?.cep || '')}"></label><label>Inscrição Estadual<input class="form-control" name="inscricao_estadual" type="text" inputmode="numeric" value="${escapeHtml(buyer?.inscricao_estadual || '')}"></label><label>CPF ou CNPJ<input class="form-control" name="cpf_cnpj" type="text" inputmode="numeric" value="${escapeHtml(buyer?.cpf_cnpj || '')}"></label></div>
      <div class="contracts-form-actions"><button class="btn-primary-action" type="submit">Salvar comprador</button><a class="btn-secondary-action" href="/admin/contratos#compradores">Cancelar</a></div>
    </form>`,
  });
}

function renderAdminSellerFormPage(res, { seller, error }) {
  const action = seller ? `/admin/contratos/vendedores/${escapeHtml(seller.id)}` : '/admin/contratos/vendedores';
  return renderContractFormPage(res, {
    pageTitle: seller ? 'Editar vendedor' : 'Novo vendedor', formTitle: seller ? 'Editar vendedor' : 'Novo vendedor', formDescription: 'Preencha os dados cadastrais do vendedor.', error,
    formHtml: `<form class="contact-form contracts-form" action="${action}" method="post">
                <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}"><div class="contracts-form-grid contracts-form-grid-two"><label>Nome<input class="form-control" name="nome" type="text" value="${escapeHtml(seller?.nome || '')}" required></label><label>Nome completo<input class="form-control" name="nome_completo" type="text" value="${escapeHtml(seller?.nome_completo || '')}" required></label></div><div class="contracts-form-actions"><button class="btn-primary-action" type="submit">Salvar vendedor</button><a class="btn-secondary-action" href="/admin/contratos#vendedores">Cancelar</a></div></form>`,
  });
}

function renderAdminContractFormPage(res, { buyers, sellers, contract, contractStatusFilter = 'abertos', error }) {
  const action = contract ? `/admin/contratos/contratos/${escapeHtml(contract.id)}` : '/admin/contratos/contratos';
  const buyerOptions = buyers.map((buyer) => buildOption(buyer.id, buyer.nome, contract?.comprador_id)).join('');
  const sellerOptions = sellers.map((seller) => buildOption(seller.id, seller.nome, contract?.vendedor_id)).join('');
  const statusInput = contractStatusFilter === 'todos' ? '<input name="status" type="hidden" value="todos">' : '';
  return renderContractFormPage(res, { pageTitle: contract ? 'Editar contrato' : 'Novo contrato', formTitle: contract ? 'Editar contrato' : 'Novo contrato', formDescription: 'Preencha os dados comerciais, fiscais e logísticos do contrato.', error,
    formHtml: `<form class="contact-form contracts-form" action="${action}" method="post">
                <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">${statusInput}<div class="contracts-form-grid"><label>Data do contrato<input class="form-control" name="data_contrato" type="date" value="${escapeHtml(toDateOnlyInputValue(contract?.data_contrato))}" required></label><label>Produto<select class="form-control" name="produto" required><option value="">Selecione</option><option value="milho"${contract?.produto === 'milho' ? ' selected' : ''}>Milho</option><option value="soja"${contract?.produto === 'soja' ? ' selected' : ''}>Soja</option></select></label><label>Preço por saca<input class="form-control" name="preco_por_saca" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(formatDecimalInput(contract?.preco_por_saca))}" required></label><label>Comprador<select class="form-control" name="comprador_id" required><option value="">Selecione</option>${buyerOptions}</select></label><label>Vendedor<select class="form-control" name="vendedor_id" required><option value="">Selecione</option>${sellerOptions}</select></label><label>Quantidade em kg<input class="form-control" name="quantidade_kg" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(formatDecimalInput(contract?.quantidade_kg))}" required></label><label>Data de recebimento<input class="form-control" name="data_recebimento" type="date" value="${escapeHtml(toDateOnlyInputValue(contract?.data_recebimento))}"></label><label>Corretor<input class="form-control" name="corretor" type="text" value="${escapeHtml(contract?.corretor || '')}"></label><label>Valor da corretagem (%)<input class="form-control" name="valor_corretagem_percentual" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(formatDecimalInput(contract?.valor_corretagem_percentual))}"></label></div><div class="contracts-check-grid"><label class="contracts-checkbox"><input name="contrato_embarcado" type="checkbox"${contract?.contrato_embarcado ? ' checked' : ''}> Contrato embarcado</label><label class="contracts-checkbox"><input name="contrato_recebido" type="checkbox"${contract?.contrato_recebido ? ' checked' : ''}> Contrato recebido</label><label class="contracts-checkbox"><input name="corretagem_paga" type="checkbox"${contract?.corretagem_paga ? ' checked' : ''}> Corretagem paga</label></div><details class="contracts-advanced-fields"><summary class="btn-secondary-action contracts-advanced-toggle">avançado</summary><div class="contracts-form-grid"><label>Inscrição estadual do vendedor<input class="form-control" name="inscricao_estadual_vendedor" type="text" value="${escapeHtml(contract?.inscricao_estadual_vendedor || '')}"></label><label>Natureza da Operação<input class="form-control" name="natureza_operacao" type="text" value="${escapeHtml(contract?.natureza_operacao || '')}"></label><label>CFOP<input class="form-control" name="cfop" type="text" value="${escapeHtml(contract?.cfop || '')}"></label><label>Razão social da transportadora<input class="form-control" name="razao_social_transportadora" type="text" value="${escapeHtml(contract?.razao_social_transportadora || '')}"></label><label>CNPJ da transportadora<input class="form-control" name="cnpj_transportadora" type="text" value="${escapeHtml(contract?.cnpj_transportadora || '')}"></label><label>Inscrição Estadual da Transportadora<input class="form-control" name="inscricao_estadual_transportadora" type="text" value="${escapeHtml(contract?.inscricao_estadual_transportadora || '')}"></label><label>UF da transportadora<input class="form-control" name="uf_transportadora" type="text" maxlength="2" value="${escapeHtml(contract?.uf_transportadora || '')}"></label><label>E-mail<input class="form-control" name="email" type="email" value="${escapeHtml(contract?.email || '')}"></label></div><label>Informações de interesse do contribuinte<textarea class="form-control" name="informacoes_interesse_contribuinte" rows="3">${escapeHtml(contract?.informacoes_interesse_contribuinte || '')}</textarea></label><label>Observações<textarea class="form-control" name="observacoes" rows="3">${escapeHtml(contract?.observacoes || '')}</textarea></label><p class="form-helper-text">Campos avançados em branco serão salvos como nulos.</p></details><div class="contracts-form-actions"><button class="btn-primary-action" type="submit">Salvar contrato</button><a class="btn-secondary-action" href="/admin/contratos#contratos">Cancelar</a></div></form>` });
}

function renderAdminContractsPage(res, { buyers, sellers, contracts, selectedBuyer, selectedSeller, selectedContract, contractStatusFilter = 'abertos', message, error }) {
  if (selectedBuyer) {
    return renderAdminBuyerFormPage(res, { buyer: selectedBuyer, error });
  }

  if (selectedSeller) {
    return renderAdminSellerFormPage(res, { seller: selectedSeller, error });
  }

  if (selectedContract) {
    return renderAdminContractFormPage(res, { buyers, sellers, contract: selectedContract, contractStatusFilter, error });
  }

  const contractsPath = path.join(__dirname, '../../views/admin-contracts.html');
  const contractEditStatusParam = contractStatusFilter === 'todos' ? { status: 'todos' } : {};
  const openContractsActiveClass = contractStatusFilter === 'abertos' ? ' is-active' : '';
  const allContractsActiveClass = contractStatusFilter === 'todos' ? ' is-active' : '';
  const buyerRows = buyers
    .map((buyer) => `
        <tr>
          <td>${escapeHtml(buyer.nome)}</td>
          <td><a class="admin-table-link" href="/admin/contratos/compradores/${escapeHtml(buyer.id)}/editar">Editar</a></td>
        </tr>
      `)
    .join('') || '<tr><td colspan="2">Nenhum comprador cadastrado.</td></tr>';
  const sellerRows = sellers
    .map((seller) => `
        <tr>
          <td>${escapeHtml(seller.nome)}</td>
          <td><a class="admin-table-link" href="/admin/contratos/vendedores/${escapeHtml(seller.id)}/editar">Editar</a></td>
        </tr>
      `)
    .join('') || '<tr><td colspan="2">Nenhum vendedor cadastrado.</td></tr>';
  const contractRows = contracts
    .map((contract) => `
        <tr>
          <td>${escapeHtml(contract.id)}</td>
          <td>${escapeHtml(formatDate(contract.data_contrato))}</td>
          <td>${escapeHtml(contract.comprador_nome)}</td>
          <td>${escapeHtml(contract.produto)}</td>
          <td>${escapeHtml(formatMoney(contract.preco_por_saca))}</td>
          <td>${escapeHtml(Number(contract.quantidade_kg).toLocaleString('pt-BR'))} kg</td>
          <td><a class="admin-table-link" href="${escapeHtml(buildContractsPageHref({ ...contractEditStatusParam })).replace('/admin/contratos', `/admin/contratos/contratos/${escapeHtml(contract.id)}/editar`)}">Editar</a></td>
        </tr>
      `)
    .join('') || '<tr><td colspan="7">Nenhum contrato cadastrado.</td></tr>';
  const contractsHtml = fs
    .readFileSync(contractsPath, 'utf8')
    .replace('{{CONTRACTS_MESSAGE}}', buildAlertHtml(message))
    .replace('{{CONTRACTS_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{OPEN_CONTRACTS_ACTIVE_CLASS}}', openContractsActiveClass)
    .replace('{{ALL_CONTRACTS_ACTIVE_CLASS}}', allContractsActiveClass)
    .replace('{{BUYERS_ROWS}}', buyerRows)
    .replace('{{SELLERS_ROWS}}', sellerRows)
    .replace('{{CONTRACTS_ROWS}}', contractRows);

  res.send(contractsHtml);
}

function renderConstructionPage(res, role, options = {}) {
  const constructionPath = path.join(__dirname, '../../views/construction.html');
  const titleByRole = {
    [ROLES.ADMIN]: 'Área dos administradores',
    [ROLES.CLIENT]: 'Área do cliente',
    [ROLES.WEIGHBRIDGE_OPERATOR]: 'Área da balança',
  };
  const descriptionByRole = {
    [ROLES.ADMIN]: 'O painel dos sócios da AgroLima está em construção e ficará disponível em breve.',
    [ROLES.CLIENT]: 'Em breve você poderá consultar os volumes de soja e milho armazenados no silo.',
    [ROLES.WEIGHBRIDGE_OPERATOR]: 'Em breve os operadores de balança poderão registrar entradas e saídas de produto.',
  };
  const backLinkHtml = options.backHref
    ? `<a class="back-link construction-back-link" href="${escapeHtml(options.backHref)}">${escapeHtml(options.backLabel || '← Voltar')}</a>`
    : '';
  const constructionHtml = fs
    .readFileSync(constructionPath, 'utf8')
    .replace('{{CONSTRUCTION_EYEBROW}}', escapeHtml(options.eyebrow || getRoleLabel(role)))
    .replace('{{CONSTRUCTION_TITLE}}', escapeHtml(options.title || titleByRole[role] || 'Em construção'))
    .replace(
      '{{CONSTRUCTION_DESCRIPTION}}',
      escapeHtml(options.description || descriptionByRole[role] || 'A área interna da AgroLima estará disponível em breve.')
    )
    .replace('{{CONSTRUCTION_BACK_LINK}}', backLinkHtml);

  res.send(constructionHtml);
}

module.exports = {
  renderAdminBatchDetailPage,
  renderAdminBatchesPage,
  renderAdminContractsPage,
  renderAdminBuyerFormPage,
  renderAdminSellerFormPage,
  renderAdminContractFormPage,
  renderAdminDashboardPage,
  renderAdminHomePage,
  renderAdminStoragePage,
  renderAdminUsersPage,
  renderConstructionPage,
};
