const fs = require('fs');
const path = require('path');
const { GRAIN_LABELS, ROOT_LOGIN, ROLES } = require('../constants');
const {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatMoisture,
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
    : renderEmptyRow(6, 'Nenhum usuário cadastrado.');

  const adminHtml = fs
    .readFileSync(adminPath, 'utf8')
    .replace('{{ADMIN_MESSAGE}}', buildAlertHtml(message))
    .replace('{{ADMIN_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{USERS_ROWS}}', rowsHtml || emptyState);

  res.send(adminHtml);
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

function formatDaysOverdueLabel(daysOverdue) {
  if (daysOverdue <= 0) {
    return 'vence hoje';
  }

  return daysOverdue === 1 ? 'venceu há 1 dia' : `venceu há ${daysOverdue} dias`;
}

function buildAdminNotificationMessage(notification) {
  const contractLabel = `Contrato número ${notification.contractId} do comprador ${notification.buyerName}`;

  if (notification.type === 'shipment_due') {
    return `${contractLabel} tem saldo ${formatKg(notification.balanceKg)}, clique abaixo para marcá-lo como embarcado.`;
  }

  if (notification.type === 'receipt_due') {
    return `${contractLabel} ${formatDaysOverdueLabel(notification.daysOverdue)} no valor de ${formatMoney(notification.contractValue)}, clique abaixo para marcá-lo como recebido.`;
  }

  if (notification.type === 'brokerage_due') {
    const daysLabel = notification.daysOverdue === 1 ? 'venceu há 1 dia' : `venceu há ${notification.daysOverdue} dias`;
    return `${contractLabel} ${daysLabel} e tem corretagem no valor de ${formatMoney(notification.brokerageValue)}, clique abaixo para marcar sua corretagem como paga.`;
  }

  return `${contractLabel} precisa de atenção.`;
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
              <strong>${escapeHtml(buildAdminNotificationMessage(notification))}</strong>
              ${notification.receiptDate ? `<span>Data de vencimento: ${escapeHtml(formatDate(notification.receiptDate))}</span>` : ''}
            </div>
            <form class="admin-notification-action" action="${escapeHtml(notification.actionPath)}" method="post">
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

function renderAdminDryerPanel(batch) {
  return `
        <section class="admin-section admin-notifications-panel admin-home-panel" aria-labelledby="admin-dryer-title">
          <div class="admin-section-header admin-notifications-header">
            <h2 id="admin-dryer-title">Secador</h2>
            <a class="btn-secondary-action" href="/admin/secador">Ver secador</a>
          </div>
          <div class="admin-home-metrics-grid">
            ${renderAdminMetric('Status do secador', formatBatchStatusLabel(batch))}
            ${renderAdminMetric('Início da batelada', batch ? formatDateTime(batch.started_at) : '-')}
            ${renderAdminMetric(batch?.discharge_started_at ? 'Início da descarga' : 'Previsão da próxima descarga', batch?.discharge_started_at ? formatDateTime(batch.discharge_started_at) : '-')}
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

function renderAdminHomePage(res, { notifications = [], contractsSummary = {}, dryerBatch = null, storageSummary = [], scaleInputs = [], scaleOutputs = [], message, error } = {}) {
  const adminHomeHtml = renderTemplate('admin-home.html', {
    ADMIN_HOME_MESSAGE: buildAlertHtml(message),
    ADMIN_HOME_ERROR: buildAlertHtml(error, 'error'),
    ADMIN_NOTIFICATIONS_PANEL: renderAdminNotificationsPanel(notifications),
    ADMIN_CONTRACTS_PANEL: renderAdminContractsPanel(contractsSummary),
    ADMIN_DRYER_PANEL: renderAdminDryerPanel(dryerBatch),
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
    .replace('{{BATCHES_ROWS}}', rowsHtml || emptyState);

  res.send(batchesHtml);
}

function renderAdminBatchDetailPage(res, { batch, readings }) {
  const batchPath = path.join(__dirname, '../../views/admin-batch-detail.html');
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

function renderAdminContractsPage(res, { buyers, sellers, contracts, selectedBuyer, selectedSeller, selectedContract, contractStatusFilter = 'abertos', message, error }) {
  const contractsPath = path.join(__dirname, '../../views/admin-contracts.html');
  const buyerFormAction = selectedBuyer ? `/admin/contratos/compradores/${escapeHtml(selectedBuyer.id)}` : '/admin/contratos/compradores';
  const sellerFormAction = selectedSeller ? `/admin/contratos/vendedores/${escapeHtml(selectedSeller.id)}` : '/admin/contratos/vendedores';
  const contractFormAction = selectedContract ? `/admin/contratos/contratos/${escapeHtml(selectedContract.id)}` : '/admin/contratos/contratos';
  const contractEditStatusParam = contractStatusFilter === 'todos' ? { status: 'todos' } : {};
  const openContractsActiveClass = contractStatusFilter === 'abertos' ? ' is-active' : '';
  const allContractsActiveClass = contractStatusFilter === 'todos' ? ' is-active' : '';
  const buyerRows = buyers
    .map((buyer) => `
        <tr>
          <td>${escapeHtml(buyer.nome)}</td>
          <td>${escapeHtml(buyer.nome_completo)}</td>
          <td>${escapeHtml(`${buyer.endereco}, ${buyer.numero}`)}</td>
          <td>${escapeHtml(buyer.cep)}</td>
          <td>${escapeHtml(buyer.inscricao_estadual)}</td>
          <td>${escapeHtml(buyer.cpf_cnpj)}</td>
          <td><a class="admin-table-link" href="${escapeHtml(buildContractsPageHref({ comprador_id: buyer.id }))}#compradores">Editar</a></td>
        </tr>
      `)
    .join('') || '<tr><td colspan="7">Nenhum comprador cadastrado.</td></tr>';
  const sellerRows = sellers
    .map((seller) => `
        <tr>
          <td>${escapeHtml(seller.nome)}</td>
          <td>${escapeHtml(seller.nome_completo)}</td>
          <td><a class="admin-table-link" href="${escapeHtml(buildContractsPageHref({ vendedor_id: seller.id }))}#vendedores">Editar</a></td>
        </tr>
      `)
    .join('') || '<tr><td colspan="3">Nenhum vendedor cadastrado.</td></tr>';
  const contractRows = contracts
    .map((contract) => `
        <tr>
          <td>${escapeHtml(formatDate(contract.data_contrato))}</td>
          <td>${escapeHtml(contract.produto)}</td>
          <td>${escapeHtml(formatMoney(contract.preco_por_saca))}</td>
          <td>${escapeHtml(contract.comprador_nome)}</td>
          <td>${escapeHtml(contract.vendedor_nome)}</td>
          <td>${escapeHtml(Number(contract.quantidade_kg).toLocaleString('pt-BR'))} kg</td>
          <td>${escapeHtml(formatBooleanLabel(contract.contrato_embarcado))}</td>
          <td>${escapeHtml(formatDate(contract.data_recebimento))}</td>
          <td>${escapeHtml(formatBooleanLabel(contract.contrato_recebido))}</td>
          <td>${escapeHtml(contract.corretor || '-')}</td>
          <td>${contract.valor_corretagem_percentual === null || contract.valor_corretagem_percentual === undefined ? '-' : `${escapeHtml(Number(contract.valor_corretagem_percentual).toLocaleString('pt-BR'))}%`}</td>
          <td>${escapeHtml(formatBooleanLabel(contract.corretagem_paga))}</td>
          <td>${escapeHtml(contract.observacoes || '-')}</td>
          <td><a class="admin-table-link" href="${escapeHtml(buildContractsPageHref({ ...contractEditStatusParam, contrato_id: contract.id }))}#contratos">Editar</a></td>
        </tr>
      `)
    .join('') || '<tr><td colspan="14">Nenhum contrato cadastrado.</td></tr>';
  const buyerOptions = buyers.map((buyer) => buildOption(buyer.id, buyer.nome, selectedContract?.comprador_id)).join('');
  const sellerOptions = sellers.map((seller) => buildOption(seller.id, seller.nome, selectedContract?.vendedor_id)).join('');

  const contractsHtml = fs
    .readFileSync(contractsPath, 'utf8')
    .replace('{{CONTRACTS_MESSAGE}}', buildAlertHtml(message))
    .replace('{{CONTRACTS_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{OPEN_CONTRACTS_ACTIVE_CLASS}}', openContractsActiveClass)
    .replace('{{ALL_CONTRACTS_ACTIVE_CLASS}}', allContractsActiveClass)
    .replace(/{{BUYER_FORM_ACTION}}/g, buyerFormAction)
    .replace('{{BUYER_FORM_TITLE}}', selectedBuyer ? 'Editar comprador' : 'Adicionar comprador')
    .replace('{{BUYER_FORM_BUTTON}}', selectedBuyer ? 'Salvar comprador' : 'Adicionar comprador')
    .replace('{{BUYER_CANCEL_LINK}}', selectedBuyer ? '<a class="btn-secondary-action" href="/admin/contratos#compradores">Cancelar edição</a>' : '')
    .replace(/{{BUYER_NOME}}/g, escapeHtml(selectedBuyer?.nome || ''))
    .replace(/{{BUYER_NOME_COMPLETO}}/g, escapeHtml(selectedBuyer?.nome_completo || ''))
    .replace(/{{BUYER_ENDERECO}}/g, escapeHtml(selectedBuyer?.endereco || ''))
    .replace(/{{BUYER_NUMERO}}/g, escapeHtml(selectedBuyer?.numero || ''))
    .replace(/{{BUYER_CEP}}/g, escapeHtml(selectedBuyer?.cep || ''))
    .replace(/{{BUYER_INSCRICAO_ESTADUAL}}/g, escapeHtml(selectedBuyer?.inscricao_estadual || ''))
    .replace(/{{BUYER_CPF_CNPJ}}/g, escapeHtml(selectedBuyer?.cpf_cnpj || ''))
    .replace('{{BUYERS_ROWS}}', buyerRows)
    .replace(/{{SELLER_FORM_ACTION}}/g, sellerFormAction)
    .replace('{{SELLER_FORM_TITLE}}', selectedSeller ? 'Editar vendedor' : 'Adicionar vendedor')
    .replace('{{SELLER_FORM_BUTTON}}', selectedSeller ? 'Salvar vendedor' : 'Adicionar vendedor')
    .replace('{{SELLER_CANCEL_LINK}}', selectedSeller ? '<a class="btn-secondary-action" href="/admin/contratos#vendedores">Cancelar edição</a>' : '')
    .replace(/{{SELLER_NOME}}/g, escapeHtml(selectedSeller?.nome || ''))
    .replace(/{{SELLER_NOME_COMPLETO}}/g, escapeHtml(selectedSeller?.nome_completo || ''))
    .replace('{{SELLERS_ROWS}}', sellerRows)
    .replace(/{{CONTRACT_FORM_ACTION}}/g, contractFormAction)
    .replace('{{CONTRACT_FORM_TITLE}}', selectedContract ? 'Editar contrato' : 'Adicionar contrato')
    .replace('{{CONTRACT_FORM_BUTTON}}', selectedContract ? 'Salvar contrato' : 'Adicionar contrato')
    .replace('{{CONTRACT_CANCEL_LINK}}', selectedContract ? '<a class="btn-secondary-action" href="/admin/contratos#contratos">Cancelar edição</a>' : '')
    .replace(/{{CONTRACT_DATA_CONTRATO}}/g, escapeHtml(toDateOnlyInputValue(selectedContract?.data_contrato)))
    .replace('{{PRODUCT_MILHO_SELECTED}}', selectedContract?.produto === 'milho' ? ' selected' : '')
    .replace('{{PRODUCT_SOJA_SELECTED}}', selectedContract?.produto === 'soja' ? ' selected' : '')
    .replace(/{{CONTRACT_PRECO_POR_SACA}}/g, escapeHtml(formatDecimalInput(selectedContract?.preco_por_saca)))
    .replace('{{BUYER_OPTIONS}}', buyerOptions)
    .replace('{{SELLER_OPTIONS}}', sellerOptions)
    .replace(/{{CONTRACT_QUANTIDADE_KG}}/g, escapeHtml(formatDecimalInput(selectedContract?.quantidade_kg)))
    .replace('{{CONTRACT_EMBARCADO_CHECKED}}', selectedContract?.contrato_embarcado ? ' checked' : '')
    .replace(/{{CONTRACT_DATA_RECEBIMENTO}}/g, escapeHtml(toDateOnlyInputValue(selectedContract?.data_recebimento)))
    .replace('{{CONTRACT_RECEBIDO_CHECKED}}', selectedContract?.contrato_recebido ? ' checked' : '')
    .replace(/{{CONTRACT_CORRETOR}}/g, escapeHtml(selectedContract?.corretor || ''))
    .replace(/{{CONTRACT_VALOR_CORRETAGEM}}/g, escapeHtml(formatDecimalInput(selectedContract?.valor_corretagem_percentual)))
    .replace('{{CONTRACT_CORRETAGEM_PAGA_CHECKED}}', selectedContract?.corretagem_paga ? ' checked' : '')
    .replace(/{{CONTRACT_OBSERVACOES}}/g, escapeHtml(selectedContract?.observacoes || ''))
    .replace(/{{CONTRACT_INSCRICAO_ESTADUAL_VENDEDOR}}/g, escapeHtml(selectedContract?.inscricao_estadual_vendedor || ''))
    .replace(/{{CONTRACT_NATUREZA_OPERACAO}}/g, escapeHtml(selectedContract?.natureza_operacao || ''))
    .replace(/{{CONTRACT_CFOP}}/g, escapeHtml(selectedContract?.cfop || ''))
    .replace(/{{CONTRACT_INFORMACOES_INTERESSE_CONTRIBUINTE}}/g, escapeHtml(selectedContract?.informacoes_interesse_contribuinte || ''))
    .replace(/{{CONTRACT_RAZAO_SOCIAL_TRANSPORTADORA}}/g, escapeHtml(selectedContract?.razao_social_transportadora || ''))
    .replace(/{{CONTRACT_CNPJ_TRANSPORTADORA}}/g, escapeHtml(selectedContract?.cnpj_transportadora || ''))
    .replace(/{{CONTRACT_INSCRICAO_ESTADUAL_TRANSPORTADORA}}/g, escapeHtml(selectedContract?.inscricao_estadual_transportadora || ''))
    .replace(/{{CONTRACT_UF_TRANSPORTADORA}}/g, escapeHtml(selectedContract?.uf_transportadora || ''))
    .replace(/{{CONTRACT_EMAIL}}/g, escapeHtml(selectedContract?.email || ''))
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
  renderAdminDashboardPage,
  renderAdminHomePage,
  renderAdminStoragePage,
  renderAdminUsersPage,
  renderConstructionPage,
};
