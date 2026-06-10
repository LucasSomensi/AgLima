const fs = require('fs');
const path = require('path');
const { GRAIN_LABELS, ROOT_LOGIN, ROLES } = require('./constants');
const { calculateDischargeForecast } = require('./dryer-forecast');
const {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatMoisture,
  formatTime,
  getRoleLabel,
  toDateInputValue,
  toDateTimeLocalValue,
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

function renderAdminHomePage(res) {
  const adminHomePath = path.join(__dirname, '../views/admin-home.html');
  res.send(fs.readFileSync(adminHomePath, 'utf8'));
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
  const contractsPath = path.join(__dirname, '../views/admin-contracts.html');
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
    .replace(/{{CONTRACT_DATA_CONTRATO}}/g, escapeHtml(toDateInputValue(selectedContract?.data_contrato)))
    .replace('{{PRODUCT_MILHO_SELECTED}}', selectedContract?.produto === 'milho' ? ' selected' : '')
    .replace('{{PRODUCT_SOJA_SELECTED}}', selectedContract?.produto === 'soja' ? ' selected' : '')
    .replace(/{{CONTRACT_PRECO_POR_SACA}}/g, escapeHtml(formatDecimalInput(selectedContract?.preco_por_saca)))
    .replace('{{BUYER_OPTIONS}}', buyerOptions)
    .replace('{{SELLER_OPTIONS}}', sellerOptions)
    .replace(/{{CONTRACT_QUANTIDADE_KG}}/g, escapeHtml(formatDecimalInput(selectedContract?.quantidade_kg)))
    .replace('{{CONTRACT_EMBARCADO_CHECKED}}', selectedContract?.contrato_embarcado ? ' checked' : '')
    .replace(/{{CONTRACT_DATA_RECEBIMENTO}}/g, escapeHtml(toDateInputValue(selectedContract?.data_recebimento)))
    .replace('{{CONTRACT_RECEBIDO_CHECKED}}', selectedContract?.contrato_recebido ? ' checked' : '')
    .replace(/{{CONTRACT_CORRETOR}}/g, escapeHtml(selectedContract?.corretor || ''))
    .replace(/{{CONTRACT_VALOR_CORRETAGEM}}/g, escapeHtml(formatDecimalInput(selectedContract?.valor_corretagem_percentual)))
    .replace('{{CONTRACT_CORRETAGEM_PAGA_CHECKED}}', selectedContract?.corretagem_paga ? ' checked' : '')
    .replace(/{{CONTRACT_OBSERVACOES}}/g, escapeHtml(selectedContract?.observacoes || ''))
    .replace('{{CONTRACTS_ROWS}}', contractRows);

  res.send(contractsHtml);
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

function buildScaleOutputRows(outputs, { showAllLink = false } = {}) {
  return outputs
    .map((output) => {
      const action = output.contrato_id
        ? `<a class="admin-table-link" href="/balanca/saidas/${escapeHtml(output.id)}">Ver nota fiscal</a>`
        : `<a class="admin-table-link" href="/balanca/saidas/${escapeHtml(output.id)}/associar">Associar contrato</a>`;
      const contractLabel = output.contrato_id
        ? `Contrato #${output.contrato_id}${output.comprador_nome ? ` · ${output.comprador_nome}` : ''}`
        : 'Pendente';

      return `
        <tr>
          <td>${escapeHtml(formatDateTime(output.data_saida))}</td>
          <td>${escapeHtml(output.placa_caminhao)}</td>
          <td>${escapeHtml(formatProductLabel(output.produto))}</td>
          <td>${escapeHtml(formatKg(output.peso_tara_kg))}</td>
          <td>${escapeHtml(formatKg(output.peso_bruto_kg))}</td>
          <td>${escapeHtml(formatKg(output.peso_liquido_kg))}</td>
          <td>${escapeHtml(contractLabel)}</td>
          <td>${action}</td>
        </tr>
      `;
    })
    .join('') || `<tr><td colspan="8">${showAllLink ? 'Nenhuma saída cadastrada.' : 'Nenhuma saída recente cadastrada.'}</td></tr>`;
}

function renderWeighbridgeHomePage(res, { outputs, message, error }) {
  const pagePath = path.join(__dirname, '../views/weighbridge-home.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{WEIGHBRIDGE_MESSAGE}}', buildAlertHtml(message))
    .replace('{{WEIGHBRIDGE_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{SCALE_OUTPUT_ROWS}}', buildScaleOutputRows(outputs));

  res.send(html);
}

function renderScaleOutputsListPage(res, { outputs }) {
  const pagePath = path.join(__dirname, '../views/weighbridge-outputs.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_OUTPUT_ROWS}}', buildScaleOutputRows(outputs, { showAllLink: true }));

  res.send(html);
}

function renderScaleOutputFormPage(res, { formValues = {}, error }) {
  const pagePath = path.join(__dirname, '../views/weighbridge-output-form.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_OUTPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{DATA_SAIDA}}/g, escapeHtml(formValues.data_saida || toDateTimeLocalValue()))
    .replace(/{{PLACA_CAMINHAO}}/g, escapeHtml(formValues.placa_caminhao || ''))
    .replace('{{PRODUCT_MILHO_SELECTED}}', formValues.produto === 'milho' ? ' selected' : '')
    .replace('{{PRODUCT_SOJA_SELECTED}}', formValues.produto === 'soja' ? ' selected' : '')
    .replace(/{{PESO_TARA_KG}}/g, escapeHtml(formatDecimalInput(formValues.peso_tara_kg)))
    .replace(/{{PESO_BRUTO_KG}}/g, escapeHtml(formatDecimalInput(formValues.peso_bruto_kg)));

  res.send(html);
}

function renderScaleOutputAssociationPage(res, { output, buyers, contracts, selectedBuyerId, error }) {
  const pagePath = path.join(__dirname, '../views/weighbridge-associate-output.html');
  const buyerOptions = buyers.map((buyer) => buildOption(buyer.id, buyer.nome, selectedBuyerId)).join('');
  const contractOptions = contracts.map((contract) => {
    const label = `Contrato #${contract.id} · ${formatDate(contract.data_contrato)} · saldo ${formatKg(contract.saldo_kg)} · ${formatMoney(contract.preco_por_saca)}/saca`;
    return buildOption(contract.id, label, contracts.length === 1 ? contract.id : '');
  }).join('');
  const contractHelp = !selectedBuyerId
    ? 'Escolha primeiro o comprador para carregar os contratos disponíveis deste produto.'
    : contracts.length === 0
      ? 'Não há contratos com embarque pendente para este comprador e produto.'
      : contracts.length === 1
        ? 'Há apenas um contrato disponível; ele foi selecionado automaticamente.'
        : 'Escolha qual contrato deve receber esta saída.';
  const submitDisabled = contracts.length === 0 ? 'disabled' : '';

  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{ASSOCIATION_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{OUTPUT_ID}}/g, escapeHtml(output.id))
    .replace('{{OUTPUT_SUMMARY}}', escapeHtml(`${formatDateTime(output.data_saida)} · ${output.placa_caminhao} · ${formatProductLabel(output.produto)} · líquido ${formatKg(output.peso_liquido_kg)}`))
    .replace('{{BUYER_OPTIONS}}', buyerOptions)
    .replace('{{CONTRACT_OPTIONS}}', contractOptions)
    .replace('{{CONTRACT_HELP}}', escapeHtml(contractHelp))
    .replace(/{{SELECTED_BUYER_ID}}/g, escapeHtml(selectedBuyerId || ''))
    .replace(/{{ASSOCIATE_DISABLED}}/g, submitDisabled);

  res.send(html);
}

function renderScaleOutputDetailPage(res, { invoiceInfo }) {
  const pagePath = path.join(__dirname, '../views/weighbridge-output-detail.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace(/{{SAIDA_ID}}/g, escapeHtml(invoiceInfo.saida_id))
    .replace('{{DATA_SAIDA}}', escapeHtml(formatDateTime(invoiceInfo.data_saida)))
    .replace('{{PLACA_CAMINHAO}}', escapeHtml(invoiceInfo.placa_caminhao))
    .replace('{{PRODUTO}}', escapeHtml(formatProductLabel(invoiceInfo.produto)))
    .replace('{{PESO_TARA_KG}}', escapeHtml(formatKg(invoiceInfo.peso_tara_kg)))
    .replace('{{PESO_BRUTO_KG}}', escapeHtml(formatKg(invoiceInfo.peso_bruto_kg)))
    .replace('{{PESO_LIQUIDO_KG}}', escapeHtml(formatKg(invoiceInfo.peso_liquido_kg)))
    .replace('{{CONTRATO_ID}}', escapeHtml(invoiceInfo.contrato_id))
    .replace('{{VENDEDOR_NOME_COMPLETO}}', escapeHtml(invoiceInfo.vendedor_nome_completo))
    .replace('{{COMPRADOR_NOME_COMPLETO}}', escapeHtml(invoiceInfo.comprador_nome_completo))
    .replace('{{COMPRADOR_CPF_CNPJ}}', escapeHtml(invoiceInfo.comprador_cpf_cnpj))
    .replace('{{COMPRADOR_INSCRICAO_ESTADUAL}}', escapeHtml(invoiceInfo.comprador_inscricao_estadual))
    .replace('{{PRECO_POR_SACA}}', escapeHtml(formatMoney(invoiceInfo.preco_por_saca)))
    .replace('{{PRECO_POR_KG}}', escapeHtml(`R$ ${Number(invoiceInfo.preco_por_kg).toLocaleString('pt-BR', { minimumFractionDigits: 8, maximumFractionDigits: 8 })}`))
    .replace('{{OBSERVACOES}}', escapeHtml(invoiceInfo.observacoes || '-'));

  res.send(html);
}

function renderConstructionPage(res, role, options = {}) {
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
  renderAdminContractsPage,
  renderAdminDashboardPage,
  renderAdminHomePage,
  renderAdminUsersPage,
  renderConstructionPage,
  renderDryerPanelPage,
  renderLoginPage,
  renderScaleOutputAssociationPage,
  renderScaleOutputDetailPage,
  renderScaleOutputFormPage,
  renderScaleOutputsListPage,
  renderWeighbridgeHomePage,
};
