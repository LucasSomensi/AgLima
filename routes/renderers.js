const fs = require('fs');
const path = require('path');
const { GRAIN_LABELS, ROOT_LOGIN, ROLES } = require('./constants');
const { calculateDischargeForecast } = require('./dryer-forecast');
const {
  escapeHtml,
  formatDateTime,
  formatMoisture,
  formatTime,
  getRoleLabel,
} = require('./utils');

function buildAlertHtml(message, type = 'success') {
  if (!message) {
    return '';
  }

  const cssClass = type === 'error' ? 'login-error' : 'admin-success';
  return `<p class="${cssClass}" role="alert">${escapeHtml(message)}</p>`;
}

function renderLoginPage(res, { unauthorized = false, systemError = false } = {}) {
  const loginPath = path.join(__dirname, '../views/login.html');
  const errorMessage = unauthorized
    ? '<p class="login-error" role="alert">Login não autorizado. Confira o login e a senha e tente novamente.</p>'
    : systemError
      ? '<p class="login-error" role="alert">Não foi possível acessar o sistema agora. Tente novamente mais tarde.</p>'
      : '';
  const loginHtml = fs.readFileSync(loginPath, 'utf8').replace('{{LOGIN_ERROR}}', errorMessage);

  res.status(unauthorized ? 401 : systemError ? 500 : 200).send(loginHtml);
}

function renderAdminUsersPage(res, { users, message, error }) {
  const adminPath = path.join(__dirname, '../views/admin-users.html');
  const rowsHtml = users
    .map((user) => {
      const createdAt = formatDateTime(user.created_at);
      const canDelete = user.login !== ROOT_LOGIN;
      const actions = canDelete
        ? `
            <div class="admin-actions-stack">
              <form class="admin-password-form" action="/admin/usuarios/${escapeHtml(user.id)}/senha" method="post">
                <label class="sr-only" for="password-${escapeHtml(user.id)}">Nova senha para ${escapeHtml(user.login)}</label>
                <input class="form-control" id="password-${escapeHtml(user.id)}" name="password" type="password" placeholder="Nova senha" autocomplete="new-password" required>
                <button class="btn-secondary-action admin-small-action" type="submit">Definir senha</button>
              </form>
              <form action="/admin/usuarios/${escapeHtml(user.id)}/remover" method="post" onsubmit="return confirm('Remover este usuário do sistema?');">
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
    : '<tr><td colspan="6">Nenhum usuário cadastrado.</td></tr>';

  const adminHtml = fs
    .readFileSync(adminPath, 'utf8')
    .replace('{{ADMIN_MESSAGE}}', buildAlertHtml(message))
    .replace('{{ADMIN_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{USERS_ROWS}}', rowsHtml || emptyState);

  res.send(adminHtml);
}

function getGrainLabel(grainType) {
  return GRAIN_LABELS[grainType] || grainType || '-';
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

function renderReadingsRows(readings, { includeOperator = true } = {}) {
  const colSpan = includeOperator ? 3 : 2;
  const emptyReadings = `<tr><td colspan="${colSpan}">Nenhuma medição lançada.</td></tr>`;

  return readings
    .map((reading) => `
        <tr>
          <td>${escapeHtml(formatDateTime(reading.measured_at))}</td>
          <td>${escapeHtml(formatMoisture(reading.moisture_percent))}%</td>
          ${includeOperator ? `<td>${escapeHtml(reading.measured_by_login)}</td>` : ''}
        </tr>
      `)
    .join('') || emptyReadings;
}

function renderAdminDashboardPage(res, { batch, readings, settings, message, error }) {
  const dashboardPath = path.join(__dirname, '../views/admin-dashboard.html');
  const statusLabel = formatBatchStatusLabel(batch);
  const currentTargetMoisture = formatMoisture(settings?.target_moisture);
  const batchTargetMoisture = batch ? formatMoisture(batch.target_moisture) : currentTargetMoisture;
  const readingsRows = renderReadingsRows(readings);
  const dashboardHtml = fs
    .readFileSync(dashboardPath, 'utf8')
    .replace('{{ADMIN_PANEL_MESSAGE}}', buildAlertHtml(message))
    .replace('{{ADMIN_PANEL_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{CURRENT_TARGET_MOISTURE}}', escapeHtml(currentTargetMoisture))
    .replace('{{TARGET_MOISTURE_VALUE}}', escapeHtml(formatMoisture(settings?.target_moisture).replace(',', '.')))
    .replace('{{BATCH_STATUS}}', escapeHtml(statusLabel))
    .replace('{{BATCH_STARTED_AT}}', escapeHtml(batch ? formatDateTime(batch.started_at) : 'Nenhuma batelada ativa'))
    .replace('{{BATCH_DISCHARGE_STARTED_AT}}', escapeHtml(batch?.discharge_started_at ? formatDateTime(batch.discharge_started_at) : '-'))
    .replace('{{BATCH_TARGET_MOISTURE}}', escapeHtml(batchTargetMoisture))
    .replace('{{BATCH_PRODUCT}}', escapeHtml(batch ? getGrainLabel(batch.grain_type) : '-'))
    .replace('{{READINGS_ROWS}}', readingsRows);

  res.send(dashboardHtml);
}

function renderAdminBatchesPage(res, { batches }) {
  const batchesPath = path.join(__dirname, '../views/admin-batches.html');
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
    .replace('{{BATCHES_ROWS}}', rowsHtml || emptyState);

  res.send(batchesHtml);
}

function renderAdminBatchDetailPage(res, { batch, readings }) {
  const batchPath = path.join(__dirname, '../views/admin-batch-detail.html');
  const detailHtml = fs
    .readFileSync(batchPath, 'utf8')
    .replace('{{BATCH_STATUS}}', escapeHtml(formatBatchStatusLabel(batch)))
    .replace('{{BATCH_STARTED_AT}}', escapeHtml(formatDateTime(batch.started_at)))
    .replace('{{BATCH_DISCHARGE_STARTED_AT}}', escapeHtml(batch.discharge_started_at ? formatDateTime(batch.discharge_started_at) : '-'))
    .replace('{{BATCH_COMPLETED_AT}}', escapeHtml(batch.completed_at ? formatDateTime(batch.completed_at) : '-'))
    .replace('{{BATCH_TARGET_MOISTURE}}', escapeHtml(formatMoisture(batch.target_moisture)))
    .replace('{{BATCH_PRODUCT}}', escapeHtml(getGrainLabel(batch.grain_type)))
    .replace('{{READINGS_ROWS}}', renderReadingsRows(readings));

  res.send(detailHtml);
}

function renderConstructionPage(res, role) {
  const constructionPath = path.join(__dirname, '../views/construction.html');
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
  const constructionHtml = fs
    .readFileSync(constructionPath, 'utf8')
    .replace('{{CONSTRUCTION_EYEBROW}}', escapeHtml(getRoleLabel(role)))
    .replace('{{CONSTRUCTION_TITLE}}', escapeHtml(titleByRole[role] || 'Em construção'))
    .replace(
      '{{CONSTRUCTION_DESCRIPTION}}',
      escapeHtml(descriptionByRole[role] || 'A área interna da AgroLima estará disponível em breve.')
    );

  res.send(constructionHtml);
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

function renderDryerPanelPage(res, { batch, readings, settings, message, error }) {
  const dryerPath = path.join(__dirname, '../views/dryer-panel.html');
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
          <form class="dryer-stop-action" action="/secador/bateladas/parar" method="post" onsubmit="return confirm('Parar o secador e concluir a batelada atual?');">
            <button class="btn-danger-action" type="submit">Parar secador</button>
          </form>`
    : '';

  const dryerHtml = fs
    .readFileSync(dryerPath, 'utf8')
    .replace('{{DRYER_MESSAGE}}', buildAlertHtml(message))
    .replace('{{DRYER_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{BATCH_STATUS}}', batchStatusHtml)
    .replace('{{BATCH_STARTED_AT}}', escapeHtml(startedAt))
    .replace('{{DISCHARGE_STARTED_AT}}', escapeHtml(dischargeStartedAt))
    .replace('{{BATCH_ACTION_URL}}', escapeHtml(batchAction.action))
    .replace('{{BATCH_ACTION_CONFIRM}}', escapeHtml(batchAction.confirm))
    .replace('{{BATCH_ACTION_CLASS}}', escapeHtml(batchAction.cssClass))
    .replace('{{BATCH_ACTION_LABEL}}', escapeHtml(batchAction.label))
    .replace('{{READINGS_ROWS}}', readingsRows || emptyReadings)
    .replace('{{STOP_DRYER_ACTION}}', stopDryerAction)
    .replace(/{{MOISTURE_FORM_DISABLED}}/g, moistureFormDisabled);

  res.send(dryerHtml);
}

module.exports = {
  renderAdminBatchDetailPage,
  renderAdminBatchesPage,
  renderAdminDashboardPage,
  renderAdminUsersPage,
  renderConstructionPage,
  renderDryerPanelPage,
  renderLoginPage,
};
