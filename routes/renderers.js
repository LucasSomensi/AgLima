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

function formatDryerStatus(batch, dischargeForecast) {
  if (!batch) {
    return `<span class="status-pill status-empty">Sem batelada ativa</span>`;
  }

  if (dischargeForecast?.status === 'started') {
    return `<span class="status-pill status-active">Descarga iniciada</span>`;
  }

  if (dischargeForecast?.status === 'immediate') {
    return `<span class="status-pill status-warning">Descarga imediata</span>`;
  }

  return `<span class="status-pill status-active">Batelada ativa</span>`;
}

function renderDryerPanelPage(res, { batch, readings, settings, message, error }) {
  const dryerPath = path.join(__dirname, '../views/dryer-panel.html');
  const dischargeForecast = calculateDischargeForecast({ batch, readings });
  const startedAt = batch ? formatDateTime(batch.started_at) : 'Nenhuma batelada ativa';
  const grainType = batch ? GRAIN_LABELS[batch.grain_type] || batch.grain_type : '-';
  const dischargeStartedAt = formatDischargeForecast(dischargeForecast);
  const targetMoisture = formatMoisture(batch?.target_moisture || settings.target_moisture);
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
  const batchStatusHtml = formatDryerStatus(batch, dischargeForecast);
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

  const dryerHtml = fs
    .readFileSync(dryerPath, 'utf8')
    .replace('{{DRYER_MESSAGE}}', buildAlertHtml(message))
    .replace('{{DRYER_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{BATCH_STATUS}}', batchStatusHtml)
    .replace('{{BATCH_STARTED_AT}}', escapeHtml(startedAt))
    .replace('{{BATCH_GRAIN_TYPE}}', escapeHtml(grainType))
    .replace('{{DISCHARGE_STARTED_AT}}', escapeHtml(dischargeStartedAt))
    .replace('{{BATCH_ACTION_URL}}', escapeHtml(batchAction.action))
    .replace('{{BATCH_ACTION_CONFIRM}}', escapeHtml(batchAction.confirm))
    .replace('{{BATCH_ACTION_CLASS}}', escapeHtml(batchAction.cssClass))
    .replace('{{BATCH_ACTION_LABEL}}', escapeHtml(batchAction.label))
    .replace('{{TARGET_MOISTURE}}', escapeHtml(targetMoisture))
    .replace('{{READINGS_COUNT}}', String(readings.length))
    .replace('{{READINGS_ROWS}}', readingsRows || emptyReadings)
    .replace(/{{MOISTURE_FORM_DISABLED}}/g, moistureFormDisabled);

  res.send(dryerHtml);
}

module.exports = {
  renderAdminUsersPage,
  renderConstructionPage,
  renderDryerPanelPage,
  renderLoginPage,
};
