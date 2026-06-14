const fs = require('fs');
const path = require('path');
const {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatDigitsOnly,
  formatPlainDecimal,
  toDateTimeLocalValue,
} = require('../utils');
const { buildAlertHtml } = require('./template-utils');

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

function buildOption(value, label, selectedValue) {
  const selected = String(value) === String(selectedValue || '') ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
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

function formatPercent(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${formatPlainDecimal(value)}%`;
}

function isInputClassified(input) {
  return input.umidade_percent !== null
    && input.umidade_percent !== undefined
    && input.impureza_percent !== null
    && input.impureza_percent !== undefined
    && input.graos_avariados_percent !== null
    && input.graos_avariados_percent !== undefined;
}

function getDefaultScaleInputProduct(dataEntradaValue) {
  const monthMatch = String(dataEntradaValue || '').match(/^\d{4}-(\d{2})/);

  if (monthMatch) {
    return Number(monthMatch[1]) <= 4 ? 'soja' : 'milho';
  }

  const date = new Date();
  return date.getMonth() <= 3 ? 'soja' : 'milho';
}

function buildScaleInputRows(inputs, { showAllLink = false } = {}) {
  return inputs
    .map((input) => {
      const tareContent = input.peso_tara_kg === null || input.peso_tara_kg === undefined
        ? `<a class="admin-table-link" href="/balanca/entradas/${escapeHtml(input.id)}/tara">Adicionar tara</a>`
        : input.tara_usada_de_entrada_id
          ? `Tara anterior (${escapeHtml(formatKg(input.peso_tara_kg))})`
          : escapeHtml(formatKg(input.peso_tara_kg));
      const classificationAction = isInputClassified(input)
        ? `Classificada (${escapeHtml(formatPercent(input.umidade_percent))} umid., ${escapeHtml(formatPercent(input.impureza_percent))} imp., ${escapeHtml(formatPercent(input.graos_avariados_percent))} avar.)`
        : `<a class="admin-table-link" href="/balanca/entradas/${escapeHtml(input.id)}/classificacao">Adicionar classificação</a>`;
      const originAction = input.origem
        ? escapeHtml(input.origem)
        : `<a class="admin-table-link" href="/balanca/entradas/${escapeHtml(input.id)}/origem">Definir origem</a>`;

      return `
        <tr>
          <td><a class="admin-table-link" href="/balanca/entradas/${escapeHtml(input.id)}">${escapeHtml(formatDateTime(input.data_entrada))}</a></td>
          <td>${escapeHtml(input.placa_caminhao)}</td>
          <td>${escapeHtml(formatProductLabel(input.produto))}</td>
          <td>${escapeHtml(formatKg(input.peso_bruto_kg))}</td>
          <td>${tareContent}</td>
          <td>${escapeHtml(formatKg(input.peso_liquido_kg))}</td>
          <td>${originAction}</td>
          <td>${classificationAction}</td>
        </tr>
      `;
    })
    .join('') || `<tr><td colspan="8">${showAllLink ? 'Nenhuma entrada cadastrada.' : 'Nenhuma entrada recente cadastrada.'}</td></tr>`;
}

function buildScaleOutputRows(outputs, { showAllLink = false } = {}) {
  return outputs
    .map((output) => {
      const hasGross = output.peso_bruto_kg !== null && output.peso_bruto_kg !== undefined;
      const grossContent = hasGross
        ? escapeHtml(formatKg(output.peso_bruto_kg))
        : `<a class="admin-table-link" href="/balanca/saidas/${escapeHtml(output.id)}/bruto">Adicionar bruto</a>`;
      const tareContent = escapeHtml(formatKg(output.peso_tara_kg));
      const action = output.contrato_id
        ? `<a class="admin-table-link" href="/balanca/saidas/${escapeHtml(output.id)}/nf">Informações NF</a>`
        : `<a class="admin-table-link" href="/balanca/saidas/${escapeHtml(output.id)}/associar">Associar contrato</a>`;
      const contractContent = output.contrato_id
        ? `<a class="admin-table-link" href="/balanca/contratos/${escapeHtml(output.contrato_id)}">Contrato #${escapeHtml(output.contrato_id)}${
          output.comprador_nome ? ` · ${escapeHtml(output.comprador_nome)}` : ''
        }</a>`
        : 'Pendente';
      const netWeightContent = output.peso_liquido_kg === null || output.peso_liquido_kg === undefined
        ? '-'
        : escapeHtml(formatKg(output.peso_liquido_kg));

      return `
        <tr>
          <td><a class="admin-table-link" href="/balanca/saidas/${escapeHtml(output.id)}">${escapeHtml(formatDateTime(output.data_saida))}</a></td>
          <td>${escapeHtml(output.placa_caminhao)}</td>
          <td>${escapeHtml(formatProductLabel(output.produto))}</td>
          <td>${grossContent}</td>
          <td>${tareContent}</td>
          <td>${netWeightContent}</td>
          <td>${contractContent}</td>
          <td>${action}</td>
        </tr>
      `;
    })
    .join('') || `<tr><td colspan="8">${showAllLink ? 'Nenhuma saída cadastrada.' : 'Nenhuma saída recente cadastrada.'}</td></tr>`;
}

function renderWeighbridgeHomePage(res, { inputs = [], outputs = [], message, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-home.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{WEIGHBRIDGE_MESSAGE}}', buildAlertHtml(message))
    .replace('{{WEIGHBRIDGE_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{SCALE_INPUT_ROWS}}', buildScaleInputRows(inputs))
    .replace('{{SCALE_OUTPUT_ROWS}}', buildScaleOutputRows(outputs));

  res.send(html);
}

function renderScaleInputsListPage(res, { inputs }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-inputs.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_INPUT_ROWS}}', buildScaleInputRows(inputs, { showAllLink: true }));

  res.send(html);
}

function renderScaleOutputsListPage(res, { outputs }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-outputs.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_OUTPUT_ROWS}}', buildScaleOutputRows(outputs, { showAllLink: true }));

  res.send(html);
}


function buildScaleContractsRows(contracts) {
  return contracts
    .map((contract) => `
        <tr>
          <td><a class="admin-table-link" href="/balanca/contratos/${escapeHtml(contract.id)}">Contrato #${escapeHtml(contract.id)}</a></td>
          <td>${escapeHtml(formatDate(contract.data_contrato))}</td>
          <td>${escapeHtml(contract.comprador_nome)}</td>
          <td>${escapeHtml(formatProductLabel(contract.produto))}</td>
          <td>${escapeHtml(formatKg(contract.quantidade_kg))}</td>
          <td>${escapeHtml(formatKg(contract.quantidade_embarcada_kg))}</td>
          <td>${escapeHtml(formatKg(contract.saldo_kg))}</td>
        </tr>
      `)
    .join('') || '<tr><td colspan="7">Nenhum contrato com embarque pendente.</td></tr>';
}

function renderScaleContractsListPage(res, { contracts }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-contracts.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{CONTRACT_ROWS}}', buildScaleContractsRows(contracts));

  res.send(html);
}

function buildScaleContractOutputRows(outputs) {
  return outputs
    .map((output) => `
        <tr>
          <td><a class="admin-table-link" href="/balanca/saidas/${escapeHtml(output.id)}">${escapeHtml(formatDateTime(output.data_saida))}</a></td>
          <td>${escapeHtml(output.placa_caminhao)}</td>
          <td>${escapeHtml(formatProductLabel(output.produto))}</td>
          <td>${escapeHtml(formatPlainDecimal(output.peso_tara_kg))}</td>
          <td>${escapeHtml(formatPlainDecimal(output.peso_bruto_kg))}</td>
          <td>${escapeHtml(formatPlainDecimal(output.peso_liquido_kg))}</td>
          <td><a class="admin-table-link" href="/balanca/saidas/${escapeHtml(output.id)}/nf">Informações NF</a></td>
        </tr>
      `)
    .join('') || '<tr><td colspan="7">Nenhuma saída associada a este contrato.</td></tr>';
}

function renderScaleContractDetailPage(res, { contract, outputs }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-contract-detail.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace(/{{CONTRATO_ID}}/g, escapeHtml(contract.contrato_id))
    .replace('{{DATA_CONTRATO}}', escapeHtml(formatDate(contract.data_contrato)))
    .replace('{{PRODUTO}}', escapeHtml(formatProductLabel(contract.produto)))
    .replace('{{QUANTIDADE_KG}}', escapeHtml(formatPlainDecimal(contract.quantidade_kg)))
    .replace('{{QUANTIDADE_EMBARCADA_KG}}', escapeHtml(formatPlainDecimal(contract.quantidade_embarcada_kg)))
    .replace('{{SALDO_KG}}', escapeHtml(formatPlainDecimal(contract.saldo_kg)))
    .replace('{{VENDEDOR_NOME_COMPLETO}}', escapeHtml(contract.vendedor_nome_completo))
    .replace('{{COMPRADOR_NOME_COMPLETO}}', escapeHtml(contract.comprador_nome_completo))
    .replace('{{COMPRADOR_CPF_CNPJ}}', escapeHtml(contract.comprador_cpf_cnpj))
    .replace('{{COMPRADOR_INSCRICAO_ESTADUAL}}', escapeHtml(contract.comprador_inscricao_estadual))
    .replace('{{COMPRADOR_ENDERECO}}', escapeHtml(contract.comprador_endereco))
    .replace('{{COMPRADOR_NUMERO}}', escapeHtml(contract.comprador_numero))
    .replace('{{COMPRADOR_CEP}}', escapeHtml(formatDigitsOnly(contract.comprador_cep)))
    .replace('{{PRECO_POR_SACA}}', escapeHtml(formatPlainDecimal(contract.preco_por_saca)))
    .replace('{{PRECO_POR_KG}}', escapeHtml(formatPlainDecimal(contract.preco_por_kg)))
    .replace('{{OBSERVACOES}}', escapeHtml(contract.observacoes || '-'))
    .replace('{{OUTPUT_ROWS}}', buildScaleContractOutputRows(outputs));

  res.send(html);
}

function renderScaleOutputFormPage(res, { formValues = {}, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-output-form.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_OUTPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{DATA_SAIDA}}/g, escapeHtml(formValues.data_saida || toDateTimeLocalValue()))
    .replace(/{{PLACA_CAMINHAO}}/g, escapeHtml(formValues.placa_caminhao || ''))
    .replace('{{PRODUCT_MILHO_SELECTED}}', formValues.produto === 'milho' ? ' selected' : '')
    .replace('{{PRODUCT_SOJA_SELECTED}}', formValues.produto === 'soja' ? ' selected' : '')
    .replace(/{{PESO_TARA_KG}}/g, escapeHtml(formatDecimalInput(formValues.peso_tara_kg)));

  res.send(html);
}


function renderScaleOutputGrossFormPage(res, { output, formValues = {}, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-output-gross-form.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_OUTPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{SAIDA_ID}}/g, escapeHtml(output.id))
    .replace('{{OUTPUT_SUMMARY}}', escapeHtml(`${formatDateTime(output.data_saida)} · ${output.placa_caminhao} · ${formatProductLabel(output.produto)} · tara ${formatKg(output.peso_tara_kg)}`))
    .replace(/{{PESO_BRUTO_KG}}/g, escapeHtml(formatDecimalInput(formValues.peso_bruto_kg)));

  res.send(html);
}

function renderScaleInputFormPage(res, { formValues = {}, plateSuggestions = [], error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-input-form.html');
  const suggestions = plateSuggestions
    .map((plate) => `
          <button class="weighbridge-plate-option" type="button" data-plate="${escapeHtml(plate.placa_caminhao)}" data-has-tare="${plate.tem_tara_anterior ? '1' : '0'}" data-tare="${escapeHtml(plate.peso_tara_kg || '')}">
            ${escapeHtml(plate.placa_caminhao)}${plate.tem_tara_anterior ? ` · tara ${escapeHtml(formatKg(plate.peso_tara_kg))}` : ''}
          </button>
        `)
    .join('') || '<p class="weighbridge-plate-empty">Nenhuma placa recente encontrada.</p>';
  const dataEntradaValue = formValues.data_entrada || toDateTimeLocalValue();
  const selectedProduct = formValues.produto || getDefaultScaleInputProduct(dataEntradaValue);
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_INPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{DATA_ENTRADA}}/g, escapeHtml(dataEntradaValue))
    .replace(/{{PLACA_CAMINHAO}}/g, escapeHtml(formValues.placa_caminhao || ''))
    .replace('{{PRODUCT_MILHO_SELECTED}}', selectedProduct === 'milho' ? ' selected' : '')
    .replace('{{PRODUCT_SOJA_SELECTED}}', selectedProduct === 'soja' ? ' selected' : '')
    .replace('{{PRODUCT_WAS_CHANGED}}', formValues.produto ? 'true' : 'false')
    .replace(/{{PESO_BRUTO_KG}}/g, escapeHtml(formatDecimalInput(formValues.peso_bruto_kg)))
    .replace('{{USAR_TARA_ANTERIOR_CHECKED}}', formValues.usar_tara_anterior ? ' checked' : '')
    .replace('{{PLATE_SUGGESTIONS}}', suggestions);

  res.send(html);
}

function renderScaleInputTareFormPage(res, { input, formValues = {}, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-input-tare-form.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_INPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{ENTRADA_ID}}/g, escapeHtml(input.id))
    .replace('{{INPUT_SUMMARY}}', escapeHtml(`${formatDateTime(input.data_entrada)} · ${input.placa_caminhao} · bruto ${formatKg(input.peso_bruto_kg)}`))
    .replace(/{{PESO_TARA_KG}}/g, escapeHtml(formatDecimalInput(formValues.peso_tara_kg)));

  res.send(html);
}

function renderScaleInputClassificationFormPage(res, { input, formValues = {}, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-input-classification-form.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_INPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{ENTRADA_ID}}/g, escapeHtml(input.id))
    .replace('{{INPUT_SUMMARY}}', escapeHtml(`${formatDateTime(input.data_entrada)} · ${input.placa_caminhao} · ${formatProductLabel(input.produto)}`))
    .replace(/{{UMIDADE_PERCENT}}/g, escapeHtml(formatDecimalInput(formValues.umidade_percent ?? input.umidade_percent ?? 14)))
    .replace(/{{IMPUREZA_PERCENT}}/g, escapeHtml(formatDecimalInput(formValues.impureza_percent ?? input.impureza_percent ?? 1)))
    .replace(/{{GRAOS_AVARIADOS_PERCENT}}/g, escapeHtml(formatDecimalInput(formValues.graos_avariados_percent ?? input.graos_avariados_percent ?? 0)));

  res.send(html);
}

function renderScaleInputOriginFormPage(res, { input, formValues = {}, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-input-origin-form.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_INPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{ENTRADA_ID}}/g, escapeHtml(input.id))
    .replace('{{INPUT_SUMMARY}}', escapeHtml(`${formatDateTime(input.data_entrada)} · ${input.placa_caminhao} · ${formatProductLabel(input.produto)}`))
    .replace(/{{ORIGEM}}/g, escapeHtml(formValues.origem ?? input.origem ?? ''));

  res.send(html);
}

function renderScaleInputDetailPage(res, { input, formValues = {}, message, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-input-detail.html');
  const dataEntradaValue = formValues.data_entrada ?? toDateTimeLocalValue(input.data_entrada);
  const selectedProduct = formValues.produto || input.produto;
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_INPUT_MESSAGE}}', buildAlertHtml(message))
    .replace('{{SCALE_INPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{ENTRADA_ID}}/g, escapeHtml(input.id))
    .replace('{{DATA_ENTRADA_FORMATTED}}', escapeHtml(formatDateTime(input.data_entrada)))
    .replace('{{PRODUTO}}', escapeHtml(formatProductLabel(input.produto)))
    .replace('{{PESO_BRUTO_FORMATTED}}', escapeHtml(formatPlainDecimal(input.peso_bruto_kg)))
    .replace(/{{DATA_ENTRADA}}/g, escapeHtml(dataEntradaValue))
    .replace(/{{PLACA_CAMINHAO}}/g, escapeHtml(formValues.placa_caminhao ?? input.placa_caminhao ?? ''))
    .replace('{{PRODUCT_MILHO_SELECTED}}', selectedProduct === 'milho' ? ' selected' : '')
    .replace('{{PRODUCT_SOJA_SELECTED}}', selectedProduct === 'soja' ? ' selected' : '')
    .replace('{{PRODUCT_WAS_CHANGED}}', formValues.produto ? 'true' : 'false')
    .replace(/{{PESO_BRUTO_KG}}/g, escapeHtml(formatDecimalInput(formValues.peso_bruto_kg ?? input.peso_bruto_kg)))
    .replace(/{{PESO_TARA_INPUT}}/g, escapeHtml(formatDecimalInput(formValues.peso_tara_kg ?? input.peso_tara_kg)))
    .replace(/{{ORIGEM_INPUT}}/g, escapeHtml(formValues.origem ?? input.origem ?? ''))
    .replace(/{{UMIDADE_PERCENT}}/g, escapeHtml(formatDecimalInput(formValues.umidade_percent ?? input.umidade_percent ?? '')))
    .replace(/{{IMPUREZA_PERCENT}}/g, escapeHtml(formatDecimalInput(formValues.impureza_percent ?? input.impureza_percent ?? '')))
    .replace(/{{GRAOS_AVARIADOS_PERCENT}}/g, escapeHtml(formatDecimalInput(formValues.graos_avariados_percent ?? input.graos_avariados_percent ?? '')))
    .replace('{{PESO_TARA_KG}}', escapeHtml(input.peso_tara_kg === null || input.peso_tara_kg === undefined ? 'Pendente' : formatPlainDecimal(input.peso_tara_kg)))
    .replace('{{PESO_LIQUIDO_KG}}', escapeHtml(input.peso_liquido_kg === null || input.peso_liquido_kg === undefined ? '-' : formatPlainDecimal(input.peso_liquido_kg)))
    .replace('{{ORIGEM}}', input.origem ? escapeHtml(input.origem) : 'Pendente')
    .replace('{{CLASSIFICACAO}}', isInputClassified(input)
      ? escapeHtml(`${formatPercent(input.umidade_percent)} umidade · ${formatPercent(input.impureza_percent)} impureza · ${formatPercent(input.graos_avariados_percent)} avariados`)
      : 'Pendente');

  res.send(html);
}

function renderScaleOutputAssociationPage(res, { output, buyers, contracts, selectedBuyerId, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-associate-output.html');
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

function buildScaleOutputInvoiceLinkHtml(outputInfo) {
  if (outputInfo.contrato_id) {
    return `<p><a class="btn-secondary-action" href="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/nf">Ver informações NF</a></p>`;
  }

  return `<p><a class="btn-secondary-action" href="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/associar">Associar contrato</a></p>`;
}

function buildScaleOutputInvoiceDetailHtml(outputInfo) {
  if (!outputInfo.contrato_id) {
    return `
        <section class="admin-section">
          <h2>Contrato</h2>
          <p class="admin-muted">Saída ainda não associada a contrato. Associe um contrato para exibir as informações da nota fiscal.</p>
          <a class="btn-secondary-action" href="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/associar">Associar contrato</a>
        </section>
    `;
  }

  return `
        <section class="admin-section">
          <h2>Contrato #${escapeHtml(outputInfo.contrato_id)}</h2>
          <dl class="weighbridge-detail-grid">
            <div><dt>Data do contrato</dt><dd><span class="copy-field-value">${escapeHtml(formatDate(outputInfo.data_contrato))}</span><button class="copy-field-button" type="button" aria-label="Copiar Data do contrato">Copiar</button></dd></div>
            <div><dt>Quantidade do contrato</dt><dd><span class="copy-field-value">${escapeHtml(formatPlainDecimal(outputInfo.quantidade_kg))}</span><button class="copy-field-button" type="button" aria-label="Copiar Quantidade do contrato">Copiar</button></dd></div>
            <div><dt>Nome completo do vendedor</dt><dd><span class="copy-field-value">${escapeHtml(outputInfo.vendedor_nome_completo)}</span><button class="copy-field-button" type="button" aria-label="Copiar Nome completo do vendedor">Copiar</button></dd></div>
            <div><dt>Nome completo do comprador</dt><dd><span class="copy-field-value">${escapeHtml(outputInfo.comprador_nome_completo)}</span><button class="copy-field-button" type="button" aria-label="Copiar Nome completo do comprador">Copiar</button></dd></div>
            <div><dt>CPF/CNPJ do comprador</dt><dd><span class="copy-field-value">${escapeHtml(outputInfo.comprador_cpf_cnpj)}</span><button class="copy-field-button" type="button" aria-label="Copiar CPF/CNPJ do comprador">Copiar</button></dd></div>
            <div><dt>Inscrição Estadual do comprador</dt><dd><span class="copy-field-value">${escapeHtml(outputInfo.comprador_inscricao_estadual)}</span><button class="copy-field-button" type="button" aria-label="Copiar Inscrição Estadual do comprador">Copiar</button></dd></div>
            <div><dt>Endereço do comprador</dt><dd><span class="copy-field-value">${escapeHtml(outputInfo.comprador_endereco)}</span><button class="copy-field-button" type="button" aria-label="Copiar Endereço do comprador">Copiar</button></dd></div>
            <div><dt>Número do comprador</dt><dd><span class="copy-field-value">${escapeHtml(outputInfo.comprador_numero)}</span><button class="copy-field-button" type="button" aria-label="Copiar Número do comprador">Copiar</button></dd></div>
            <div><dt>CEP do comprador</dt><dd><span class="copy-field-value">${escapeHtml(formatDigitsOnly(outputInfo.comprador_cep))}</span><button class="copy-field-button" type="button" aria-label="Copiar CEP do comprador">Copiar</button></dd></div>
            <div><dt>Preço por saca</dt><dd><span class="copy-field-value">${escapeHtml(formatPlainDecimal(outputInfo.preco_por_saca))}</span><button class="copy-field-button" type="button" aria-label="Copiar Preço por saca">Copiar</button></dd></div>
            <div><dt>Preço por kg</dt><dd><span class="copy-field-value">${escapeHtml(formatPlainDecimal(outputInfo.preco_por_kg))}</span><button class="copy-field-button" type="button" aria-label="Copiar Preço por kg">Copiar</button></dd></div>
            <div class="weighbridge-detail-full"><dt>Observações do contrato</dt><dd><span class="copy-field-value">${escapeHtml(outputInfo.observacoes || '-')}</span><button class="copy-field-button" type="button" aria-label="Copiar Observações do contrato">Copiar</button></dd></div>
          </dl>
          <div class="weighbridge-output-actions">
            <form action="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/desvincular-contrato" method="post" onsubmit="return confirm('Desvincular esta saída do contrato?');">
              <button class="btn-danger-action" type="submit">Desvincular contrato</button>
            </form>
          </div>
        </section>
  `;
}

function buildScaleOutputActionsHtml(outputInfo) {
  if (outputInfo.peso_bruto_kg === null || outputInfo.peso_bruto_kg === undefined) {
    return `
        <section class="admin-section">
          <h2>Ações da saída</h2>
          <p class="admin-muted">Adicione o peso bruto para calcular o peso líquido antes de dividir a saída ou associar contrato.</p>
          <div class="weighbridge-output-actions">
            <a class="btn-secondary-action" href="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/bruto">Adicionar bruto</a>
            <form action="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/deletar" method="post" onsubmit="return confirm('Tem certeza que quer deletar essa saída? Essa operação não pode ser desfeita.');">
              <button class="btn-danger-action" type="submit">Deletar saída</button>
            </form>
          </div>
        </section>
    `;
  }

  return `
        <section class="admin-section">
          <h2>Ações da saída</h2>
          <form class="weighbridge-split-form" action="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/dividir" method="post">
            <h3>Dividir saída</h3>
            <div class="form-row">
              <div class="form-group col-md-6">
                <label for="peso-liquido-primeira">Peso líquido da primeira saída (kg)</label>
                <input class="form-control" id="peso-liquido-primeira" name="peso_liquido_primeira_kg" type="number" min="0.001" max="${escapeHtml(formatDecimalInput(outputInfo.peso_liquido_kg))}" step="0.001" data-total-net="${escapeHtml(formatDecimalInput(outputInfo.peso_liquido_kg))}" required>
              </div>
              <div class="form-group col-md-6">
                <label for="peso-liquido-segunda">Peso líquido da segunda saída (kg)</label>
                <input class="form-control" id="peso-liquido-segunda" type="text" readonly value="-">
              </div>
            </div>
            <button class="btn-secondary-action" type="submit">Dividir saída</button>
          </form>

          <div class="weighbridge-output-actions">
            <form action="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/deletar" method="post" onsubmit="return confirm('Tem certeza que quer deletar essa saída? Essa operação não pode ser desfeita.');">
              <button class="btn-danger-action" type="submit">Deletar saída</button>
            </form>
          </div>
        </section>
  `;
}

function renderScaleOutputDetailPage(res, { outputInfo, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-output-detail.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_OUTPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{SAIDA_ID}}/g, escapeHtml(outputInfo.saida_id))
    .replace('{{DATA_SAIDA}}', escapeHtml(formatDateTime(outputInfo.data_saida)))
    .replace('{{PLACA_CAMINHAO}}', escapeHtml(outputInfo.placa_caminhao))
    .replace('{{PRODUTO}}', escapeHtml(formatProductLabel(outputInfo.produto)))
    .replace('{{PESO_TARA_KG}}', escapeHtml(formatPlainDecimal(outputInfo.peso_tara_kg)))
    .replace('{{PESO_BRUTO_KG}}', escapeHtml(formatPlainDecimal(outputInfo.peso_bruto_kg)))
    .replace(/{{PESO_LIQUIDO_KG}}/g, escapeHtml(formatPlainDecimal(outputInfo.peso_liquido_kg)))
    .replace('{{INVOICE_INFO_LINK}}', buildScaleOutputInvoiceLinkHtml(outputInfo))
    .replace('{{OUTPUT_ACTIONS_SECTION}}', buildScaleOutputActionsHtml(outputInfo));

  res.send(html);
}

function renderScaleOutputInvoicePage(res, { outputInfo, message, error }) {
  const pagePath = path.join(__dirname, '../../views/weighbridge-output-invoice.html');
  const html = fs
    .readFileSync(pagePath, 'utf8')
    .replace('{{SCALE_OUTPUT_MESSAGE}}', buildAlertHtml(message))
    .replace('{{SCALE_OUTPUT_ERROR}}', buildAlertHtml(error, 'error'))
    .replace(/{{SAIDA_ID}}/g, escapeHtml(outputInfo.saida_id))
    .replace('{{DATA_SAIDA}}', escapeHtml(formatDateTime(outputInfo.data_saida)))
    .replace('{{PLACA_CAMINHAO}}', escapeHtml(outputInfo.placa_caminhao))
    .replace('{{PRODUTO}}', escapeHtml(formatProductLabel(outputInfo.produto)))
    .replace(/{{PESO_LIQUIDO_KG}}/g, escapeHtml(formatPlainDecimal(outputInfo.peso_liquido_kg)))
    .replace('{{INVOICE_DETAIL_SECTION}}', buildScaleOutputInvoiceDetailHtml(outputInfo));

  res.send(html);
}

module.exports = {
  renderScaleContractDetailPage,
  renderScaleContractsListPage,
  renderScaleInputClassificationFormPage,
  renderScaleInputDetailPage,
  renderScaleInputFormPage,
  renderScaleInputsListPage,
  renderScaleInputOriginFormPage,
  renderScaleInputTareFormPage,
  renderScaleOutputAssociationPage,
  renderScaleOutputDetailPage,
  renderScaleOutputFormPage,
  renderScaleOutputGrossFormPage,
  renderScaleOutputInvoicePage,
  renderScaleOutputsListPage,
  renderWeighbridgeHomePage,
};
