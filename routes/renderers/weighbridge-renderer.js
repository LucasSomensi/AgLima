const {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatDigitsOnly,
  formatPlainDecimal,
  toDateTimeLocalValue,
} = require('../utils');
const { buildPaginationHtml, renderTemplate } = require('./template-utils');
const { canCopyInputReport, buildInputClipboardReport, buildScaleOutputInvoiceName } = require('../weighbridge-reports');

const CAPTURE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_WEIGHT_TYPE_LABELS = {
  bruto: 'Peso bruto',
  tara: 'Tara',
  pesagem_1: 'Pesagem 1',
  pesagem_2: 'Pesagem 2',
};

const DEFAULT_INVOICE_OPERATION_NATURE = 'Venda';
const DEFAULT_INVOICE_CFOP = '5101';
const ICON_SPRITE = '/icons/wb.svg';
// Caminhão parado no pátio há mais que isto ganha destaque.
const LONG_YARD_STAY_MINUTES = 120;

// --- Formatação ------------------------------------------------------------------

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/\r?\n/g, '&#10;');
}

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function formatMoney(value) {
  if (isBlank(value)) {
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
  if (isBlank(value)) {
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

function formatWeight(value, unit = 'kg') {
  if (isBlank(value)) {
    return '-';
  }

  const numericValue = Number(value);
  const convertedValue = unit === 'sc' ? numericValue / 60 : numericValue;

  return `${convertedValue.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: unit === 'sc' ? 1 : 0,
  })} ${unit}`;
}

function formatKg(value) {
  return formatWeight(value, 'kg');
}

function formatSacks(value) {
  return formatWeight(value, 'sc');
}

function formatKgAndSacks(value) {
  return `${formatWeight(value, 'kg')} · ${formatWeight(value, 'sc')}`;
}

// Número sem unidade, com separador de milhar (as colunas já dizem "kg").
function formatNumber(value) {
  if (isBlank(value)) {
    return '-';
  }

  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function formatRoundedKg(value) {
  if (isBlank(value)) {
    return '-';
  }

  return String(Math.round(Number(value)));
}

function formatPercent(value) {
  if (isBlank(value)) {
    return '-';
  }

  return `${formatPlainDecimal(value)}%`;
}

// "09:22" para hoje, "17/11 09:22" neste ano e "17/11/25 09:22" antes.
function formatShortDateTime(value, now = new Date()) {
  const local = value ? toDateTimeLocalValue(value) : '';

  if (!local) {
    return '-';
  }

  const today = toDateTimeLocalValue(now).slice(0, 10);
  const [datePart, time] = local.split('T');

  if (datePart === today) {
    return time;
  }

  const [year, month, day] = datePart.split('-');
  const yearSuffix = year === today.slice(0, 4) ? '' : `/${year.slice(2)}`;
  return `${day}/${month}${yearSuffix} ${time}`;
}

function getElapsedMinutes(value, now = new Date()) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now.getTime() - time) / 60000));
}

function formatElapsed(minutes) {
  if (minutes === null) {
    return '';
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
  }

  return `${Math.floor(minutes / (24 * 60))}d`;
}

function isInputClassified(input) {
  return input.umidade_percent !== null
    && input.umidade_percent !== undefined
    && input.impureza_percent !== null
    && input.impureza_percent !== undefined
    && input.graos_avariados_percent !== null
    && input.graos_avariados_percent !== undefined;
}

function formatClassificationShort(input) {
  return [input.umidade_percent, input.impureza_percent, input.graos_avariados_percent]
    .map((value) => formatPlainDecimal(value))
    .join(' · ');
}

function formatClassificationLong(input) {
  return `Umidade ${formatPercent(input.umidade_percent)} · Impureza ${formatPercent(input.impureza_percent)} · Avariados ${formatPercent(input.graos_avariados_percent)}`;
}

function getDefaultScaleInputProduct(dataEntradaValue) {
  const monthMatch = String(dataEntradaValue || '').match(/^\d{4}-(\d{2})/);

  if (monthMatch) {
    return Number(monthMatch[1]) <= 4 ? 'soja' : 'milho';
  }

  const date = new Date();
  return date.getMonth() <= 3 ? 'soja' : 'milho';
}

// --- Peças de interface ----------------------------------------------------------

function icon(name, extraClass = '') {
  return `<svg class="wb-i${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true" focusable="false"><use href="${ICON_SPRITE}#i-${name}"></use></svg>`;
}

// Botão (link) da balança: ícone sempre, texto só quando ajuda; o rótulo
// completo fica no title e no aria-label.
function wbLink(href, iconName, label, { text = '', variant = '', size = '', newTab = false, extra = '' } = {}) {
  const classes = ['wb-btn', size ? `wb-btn--${size}` : '', text ? '' : 'wb-btn--icon', variant ? `wb-btn--${variant}` : '']
    .filter(Boolean)
    .join(' ');
  const target = newTab ? ' target="_blank" rel="noopener"' : '';

  return `<a class="${classes}" href="${escapeHtml(href)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"${target}${extra}>${icon(iconName)}${text ? `<span>${escapeHtml(text)}</span>` : ''}</a>`;
}

function wbDisabledButton(iconName, label, { text = '', size = '', reason = '' } = {}) {
  const classes = ['wb-btn', size ? `wb-btn--${size}` : '', text ? '' : 'wb-btn--icon'].filter(Boolean).join(' ');
  const title = reason ? `${label} (${reason})` : label;

  return `<button class="${classes}" type="button" disabled title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}">${icon(iconName)}${text ? `<span>${escapeHtml(text)}</span>` : ''}</button>`;
}

function wbTodo(href, iconName, text, label) {
  return wbLink(href, iconName, label, { text, variant: 'todo', size: 'sm' });
}

function ticketLink(href, { text = '', size = '', variant = '' } = {}) {
  return wbLink(href, 'print', 'Imprimir ticket', { text, size, variant, newTab: true });
}

function ticketDisabled(reason, { text = '', size = '' } = {}) {
  return wbDisabledButton('print', 'Imprimir ticket', { text, size, reason });
}

function buildLiveWeightHtml() {
  return `<span class="wb-live" data-live-weight title="Balança 1" role="status" aria-label="Peso atual da balança 1"><span class="wb-live-dot" aria-hidden="true"></span><span data-live-weight-value>— kg</span><small data-live-weight-age></small></span>`;
}

function getHomeHref(navigation = {}) {
  return navigation.homeHref || '/balanca';
}

function getHomeLabel(navigation = {}) {
  return (navigation.homeLabel || 'Voltar à balança').replace(/^←\s*/, '');
}

function buildTopbar({ title, chips = '', actions = '', navigation = {}, backHref, backLabel }) {
  const href = backHref || getHomeHref(navigation);
  const label = backLabel || getHomeLabel(navigation);

  return `<header class="wb-topbar">
        <a class="wb-btn wb-btn--icon" href="${escapeHtml(href)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon('back')}</a>
        <div class="wb-title"><h1>${escapeHtml(title)}</h1>${chips}</div>
        <div class="wb-topbar-end">${actions}${actions ? '<span class="wb-sep" aria-hidden="true"></span>' : ''}${buildLiveWeightHtml()}</div>
      </header>`;
}

function plateChip(plate, href) {
  if (!plate) {
    return '';
  }

  return href
    ? `<a class="wb-plate wb-plate--lg" href="${escapeHtml(href)}">${escapeHtml(plate)}</a>`
    : `<span class="wb-plate wb-plate--lg">${escapeHtml(plate)}</span>`;
}

function chip(text, { iconName = '', variant = '', title = '' } = {}) {
  if (isBlank(text)) {
    return '';
  }

  return `<span class="wb-chip${variant ? ` wb-chip--${variant}` : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>${iconName ? icon(iconName) : ''}${escapeHtml(text)}</span>`;
}

function buildFlashHtml(message, type = 'success', action = null) {
  if (!message) {
    return '';
  }

  const isError = type === 'error';
  const actionHtml = action && action.href
    ? wbLink(action.href, action.icon || 'next', action.label, { text: action.label, variant: 'primary', size: 'sm', newTab: Boolean(action.newTab) })
    : '';

  return `<div class="wb-flash${isError ? ' wb-flash--error' : ''}" role="${isError ? 'alert' : 'status'}">${icon(isError ? 'alert' : 'check')}<span>${escapeHtml(message)}</span>${actionHtml}</div>`;
}

function buildFlashesHtml(message, error, action) {
  return `${buildFlashHtml(message, 'success', action)}${buildFlashHtml(error, 'error')}`;
}

// Peso em destaque nas telas de detalhe. Clicar no número copia o peso.
function buildWeightTile(label, value, { meta = '', net = false, todo = '', sacks = false } = {}) {
  const metaHtml = meta ? `<span class="wb-weight-meta">${meta}</span>` : '';

  if (isBlank(value)) {
    return `<div class="wb-weight wb-weight--todo"><span class="wb-weight-label">${escapeHtml(label)}</span>${todo || '<span class="wb-weight-value">-</span>'}${metaHtml}</div>`;
  }

  const sacksHtml = sacks ? ` <small>· ${escapeHtml(formatSacks(value))}</small>` : '';

  return `<div class="wb-weight${net ? ' wb-weight--net' : ''}">
            <span class="wb-weight-label">${escapeHtml(label)}</span>
            <button class="wb-weight-value" type="button" data-copy="${escapeHtml(formatRoundedKg(value))}" title="Copiar ${escapeHtml(label.toLowerCase())}">${escapeHtml(formatNumber(value))} <small>kg</small>${sacksHtml}</button>
            ${metaHtml}
          </div>`;
}

function timeMeta(value) {
  return value ? `${icon('clock')}${escapeHtml(formatDateTime(value))}` : '';
}

// Campo de detalhe que copia o valor com um clique.
function buildCopyCell(label, value, { wide = false, iconName = '' } = {}) {
  const empty = isBlank(value) || value === '-';
  const text = empty ? '-' : String(value);
  const classes = ['wb-copy', wide ? 'wb-copy--wide' : '', empty ? 'wb-copy--empty' : ''].filter(Boolean).join(' ');

  return `<button class="${classes}" type="button" data-copy="${escapeHtmlAttribute(empty ? '' : text)}" aria-label="Copiar ${escapeHtml(label)}"><span class="wb-copy-label">${iconName ? icon(iconName) : ''}${escapeHtml(label)}</span><span class="wb-copy-value">${escapeHtml(text)}</span>${icon('copy')}</button>`;
}

// Fato sem cópia (pode conter links e botões).
function buildFact(label, valueHtml, { iconName = '', wide = false } = {}) {
  return `<div class="wb-fact${wide ? ' wb-fact--wide' : ''}"><dt>${iconName ? icon(iconName) : ''}${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
}

// Mantém a captura da foto quando o formulário volta com erro de validação.
function getCaptureIdValue(formValues = {}) {
  const value = String(formValues.foto_captura_id || '');
  return CAPTURE_ID_PATTERN.test(value) ? value : '';
}

function hasFormValues(formValues = {}) {
  return Object.keys(formValues).some((key) => key !== '_csrf');
}

// Substitui todos os placeholders em uma passada, para que texto livre
// digitado pelo operador (comentário, produto...) nunca seja expandido como
// placeholder.
function renderWeighbridgeTemplate(templateName, placeholders, navigation = {}) {
  return renderTemplate(templateName, {
    WEIGHBRIDGE_HOME_HREF: escapeHtml(getHomeHref(navigation)),
    WEIGHBRIDGE_HOME_LABEL: escapeHtml(getHomeLabel(navigation)),
    ...placeholders,
  });
}

// --- Tabelas de movimentações ------------------------------------------------------

const MOVEMENT_TYPES = {
  entrada: { icon: 'in', label: 'Entrada', css: 'in' },
  saida: { icon: 'out', label: 'Saída', css: 'out' },
  avulsa: { icon: 'avulsa', label: 'Avulsa', css: 'avulsa' },
};

function typeBadge(type) {
  const info = MOVEMENT_TYPES[type];
  return `<span class="wb-type wb-type--${info.css}" title="${info.label}" aria-label="${info.label}">${icon(info.icon)}</span>`;
}

function buildMovementTableHead({ showType = false, info = 'Detalhes' } = {}) {
  return `<tr>
            ${showType ? '<th class="wb-col-type"><span class="sr-only">Tipo</span></th>' : ''}
            <th>Data</th>
            <th>Placa</th>
            <th>Produto</th>
            <th class="num">Bruto <small>kg</small></th>
            <th class="num">Tara <small>kg</small></th>
            <th class="num">Líquido <small>kg</small></th>
            <th class="wb-col-info">${escapeHtml(info)}</th>
            <th class="wb-col-actions"><span class="sr-only">Ações</span></th>
          </tr>`;
}

function dateCell(href, value) {
  return `<td><a href="${escapeHtml(href)}" title="${escapeHtml(formatDateTime(value))}">${escapeHtml(formatShortDateTime(value))}</a></td>`;
}

function plateCell(href, plate) {
  return plate
    ? `<td><a class="wb-plate" href="${escapeHtml(href)}">${escapeHtml(plate)}</a></td>`
    : `<td><a class="wb-muted" href="${escapeHtml(href)}" title="Sem placa">—</a></td>`;
}

function numCell(content, { net = false } = {}) {
  return `<td class="num${net ? ' net' : ''}">${content}</td>`;
}

function infoItem(iconName, text, title = '') {
  return `<span class="wb-info-item"${title ? ` title="${escapeHtml(title)}"` : ''}>${icon(iconName)}${escapeHtml(text)}</span>`;
}

function buildMovementRow(type, cells, { showType = false } = {}) {
  return `
        <tr data-movement-type="${type}">
          ${showType ? `<td class="wb-col-type">${typeBadge(type)}</td>` : ''}
          ${cells.join('\n          ')}
        </tr>`;
}

function buildInputCells(input) {
  const href = `/balanca/entradas/${encodeURIComponent(input.id)}`;
  const hasTare = !isBlank(input.peso_tara_kg);
  const grossContent = isBlank(input.peso_bruto_kg)
    ? wbTodo(href, 'scale', 'Bruto', 'Adicionar bruto')
    : escapeHtml(formatNumber(input.peso_bruto_kg));
  const tareContent = !hasTare
    ? wbTodo(`${href}/tara`, 'scale', 'Tara', 'Adicionar tara')
    : input.tara_usada_de_entrada_id
      ? `<span class="wb-tag" title="Tara anterior">ANT</span><span title="Tara anterior (${escapeHtml(formatKg(input.peso_tara_kg))})">${escapeHtml(formatNumber(input.peso_tara_kg))}</span>`
      : escapeHtml(formatNumber(input.peso_tara_kg));
  const origin = input.origem
    ? infoItem('pin', input.origem, `Origem: ${input.origem}`)
    : wbTodo(`${href}/origem`, 'pin', 'Origem', 'Definir origem');
  const classification = isInputClassified(input)
    ? infoItem('drop', formatClassificationShort(input), formatClassificationLong(input))
    : wbTodo(`${href}/classificacao`, 'drop', 'Class.', 'Adicionar classificação');
  const actions = [];

  if (canCopyInputReport(input)) {
    actions.push(`<button class="wb-btn wb-btn--sm wb-btn--icon" type="button" data-clipboard-report="${escapeHtmlAttribute(buildInputClipboardReport(input))}" title="Copiar relatório" aria-label="Copiar relatório da entrada ${escapeHtml(input.placa_caminhao)}">${icon('copy')}</button>`);
  }

  if (hasTare && !isBlank(input.peso_liquido_kg)) {
    actions.push(ticketLink(`${href}/ticket.pdf`, { size: 'sm' }));
  }

  return [
    dateCell(href, input.data_entrada),
    plateCell(href, input.placa_caminhao),
    `<td>${escapeHtml(formatProductLabel(input.produto))}</td>`,
    numCell(grossContent),
    numCell(tareContent),
    numCell(escapeHtml(formatNumber(input.peso_liquido_kg)), { net: true }),
    `<td class="wb-col-info"><div class="wb-info">${origin}${classification}</div></td>`,
    `<td class="wb-col-actions"><div class="wb-row-actions">${actions.join('')}</div></td>`,
  ];
}

function buildOutputCells(output) {
  const href = `/balanca/saidas/${encodeURIComponent(output.id)}`;
  const hasGross = !isBlank(output.peso_bruto_kg);
  const grossContent = hasGross
    ? escapeHtml(formatNumber(output.peso_bruto_kg))
    : wbTodo(`${href}/bruto`, 'scale', 'Bruto', 'Adicionar bruto');
  const tareContent = isBlank(output.peso_tara_kg)
    ? wbTodo(href, 'scale', 'Tara', 'Adicionar tara')
    : escapeHtml(formatNumber(output.peso_tara_kg));
  const contractLabel = output.contrato_id
    ? `#${output.contrato_id}${output.comprador_nome ? ` · ${output.comprador_nome}` : ''}`
    : '';
  const contract = output.contrato_id
    ? `<a class="wb-info-item" href="/balanca/contratos/${escapeHtml(output.contrato_id)}" title="Contrato ${escapeHtml(contractLabel)}">${icon('contract')}${escapeHtml(contractLabel)}</a>`
    : wbTodo(`${href}/associar`, 'link', 'Contrato', 'Associar contrato');
  const driver = output.nome_motorista ? infoItem('user', output.nome_motorista, `Motorista: ${output.nome_motorista}`) : '';
  const actions = [];

  if (output.contrato_id) {
    actions.push(wbLink(`${href}/nf`, 'nf', 'Informações NF', { size: 'sm' }));

    if (hasGross && !isBlank(output.peso_liquido_kg)) {
      actions.push(ticketLink(`${href}/ticket.pdf`, { size: 'sm' }));
    }
  }

  return [
    dateCell(href, output.data_saida),
    plateCell(href, output.placa_caminhao),
    `<td>${escapeHtml(formatProductLabel(output.produto))}</td>`,
    numCell(grossContent),
    numCell(tareContent),
    numCell(escapeHtml(formatNumber(output.peso_liquido_kg)), { net: true }),
    `<td class="wb-col-info"><div class="wb-info">${contract}${driver}</div></td>`,
    `<td class="wb-col-actions"><div class="wb-row-actions">${actions.join('')}</div></td>`,
  ];
}

function hasSecondWeighing(weighing) {
  return weighing.pesagem_2_kg !== null && weighing.pesagem_2_kg !== undefined;
}

function buildStandaloneCells(weighing) {
  const href = `/balanca/avulsas/${encodeURIComponent(weighing.id)}`;
  const second = hasSecondWeighing(weighing)
    ? `<span class="wb-tag">P2</span>${escapeHtml(formatNumber(weighing.pesagem_2_kg))}`
    : wbTodo(`${href}/pesagem-2`, 'scale', 'P2', 'Adicionar pesagem 2');
  const info = [
    weighing.vendedor ? infoItem('user', weighing.vendedor, `Vendedor: ${weighing.vendedor}`) : '',
    weighing.comprador ? infoItem('user', weighing.comprador, `Comprador: ${weighing.comprador}`) : '',
    weighing.comentario ? infoItem('comment', weighing.comentario, weighing.comentario) : '',
  ].join('');

  return [
    dateCell(href, weighing.pesagem_1_em),
    plateCell(href, weighing.placa_caminhao),
    `<td>${escapeHtml(weighing.produto || '-')}</td>`,
    numCell(`<span class="wb-tag">P1</span>${escapeHtml(formatNumber(weighing.pesagem_1_kg))}`),
    numCell(second),
    numCell(escapeHtml(formatNumber(weighing.peso_liquido_kg)), { net: true }),
    `<td class="wb-col-info"><div class="wb-info">${info}</div></td>`,
    `<td class="wb-col-actions"><div class="wb-row-actions">${hasSecondWeighing(weighing) ? ticketLink(`${href}/ticket.pdf`, { size: 'sm' }) : ''}</div></td>`,
  ];
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="wb-empty">${escapeHtml(message)}</td></tr>`;
}

function buildScaleInputRows(inputs, { showAllLink = false } = {}) {
  return inputs.map((input) => buildMovementRow('entrada', buildInputCells(input))).join('')
    || emptyRow(8, showAllLink ? 'Nenhuma entrada cadastrada.' : 'Nenhuma entrada recente cadastrada.');
}

function buildScaleOutputRows(outputs, { showAllLink = false } = {}) {
  return outputs.map((output) => buildMovementRow('saida', buildOutputCells(output))).join('')
    || emptyRow(8, showAllLink ? 'Nenhuma saída cadastrada.' : 'Nenhuma saída recente cadastrada.');
}

function buildStandaloneWeighingRows(weighings, { showAllLink = false } = {}) {
  return weighings.map((weighing) => buildMovementRow('avulsa', buildStandaloneCells(weighing))).join('')
    || emptyRow(8, showAllLink ? 'Nenhuma pesagem avulsa cadastrada.' : 'Nenhuma pesagem avulsa recente.');
}

// Últimas movimentações de todos os tipos numa tabela só, mais recentes primeiro.
function buildRecentMovementRows(inputs = [], outputs = [], standaloneWeighings = []) {
  const movements = [
    ...inputs.map((item) => ({ type: 'entrada', item, date: item.data_entrada })),
    ...outputs.map((item) => ({ type: 'saida', item, date: item.data_saida })),
    ...standaloneWeighings.map((item) => ({ type: 'avulsa', item, date: item.pesagem_1_em })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const builders = { entrada: buildInputCells, saida: buildOutputCells, avulsa: buildStandaloneCells };

  return movements
    .map(({ type, item }) => buildMovementRow(type, builders[type](item), { showType: true }))
    .join('') || emptyRow(9, 'Nenhuma movimentação recente.');
}

// --- Pátio ---------------------------------------------------------------------

function buildYardRow({ type, item, date, plate, product, first, second, actions }) {
  const href = `/balanca/${type === 'entrada' ? 'entradas' : type === 'saida' ? 'saidas' : 'avulsas'}/${encodeURIComponent(item.id)}`;
  const elapsed = getElapsedMinutes(date);
  const elapsedClass = elapsed !== null && elapsed >= LONG_YARD_STAY_MINUTES ? ' is-long' : '';

  return `<tr data-movement-type="${type}">
      <td class="wb-col-type">${typeBadge(type)}</td>
      <td><a class="wb-plate" href="${escapeHtml(href)}">${escapeHtml(plate || 'Sem placa')}</a></td>
      <td title="${escapeHtml(formatDateTime(date))}">${escapeHtml(formatShortDateTime(date))}<span class="wb-elapsed${elapsedClass}" title="Tempo no pátio">${escapeHtml(formatElapsed(elapsed))}</span></td>
      <td>${escapeHtml(product)}</td>
      <td class="num">${first}</td>
      <td class="num">${second}</td>
      <td class="wb-col-actions"><div class="wb-row-actions">${actions.join('')}</div></td>
    </tr>`;
}

// Pesagem avulsa no pátio: aguarda a pesagem 2. Bruto e tara não se aplicam
// (não há ordem entre as pesagens), então a pesagem 1 ocupa a primeira coluna.
function buildStandaloneYardRow(item) {
  const href = `/balanca/avulsas/${encodeURIComponent(item.id)}`;

  return buildYardRow({
    type: 'avulsa',
    item,
    date: item.pesagem_1_em,
    plate: item.placa_caminhao,
    product: item.produto || '-',
    first: `<span class="wb-tag">P1</span>${escapeHtml(formatNumber(item.pesagem_1_kg))}`,
    second: '<span class="wb-muted">-</span>',
    actions: [wbTodo(`${href}/pesagem-2`, 'scale', 'Pesagem 2', 'Adicionar pesagem 2')],
  });
}

function buildYardRows(inputs, outputs, standaloneWeighings = []) {
  const movements = [
    ...inputs.map((item) => ({ item, type: 'entradas', date: item.data_entrada })),
    ...outputs.map((item) => ({ item, type: 'saidas', date: item.data_saida })),
    ...standaloneWeighings
      .filter((item) => !hasSecondWeighing(item))
      .map((item) => ({ item, type: 'avulsas', date: item.pesagem_1_em })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  return movements.map(({ item, type, date }) => {
    if (type === 'avulsas') {
      return buildStandaloneYardRow(item);
    }

    const href = `/balanca/${type}/${encodeURIComponent(item.id)}`;
    const actions = [];
    const addAction = (suffix, iconName, text, label) => actions.push(wbTodo(href + suffix, iconName, text, label));

    if (item.peso_tara_kg == null) {
      addAction(type === 'entradas' ? '/tara' : '', 'scale', 'Tara', 'Adicionar tara');
    }
    if (item.peso_bruto_kg == null) {
      addAction(type === 'saidas' ? '/bruto' : '', 'scale', 'Bruto', 'Adicionar bruto');
    }
    if (type === 'entradas' && !isInputClassified(item)) {
      addAction('/classificacao', 'drop', 'Classificação', 'Adicionar classificação');
    }
    if (!actions.length) return '';
    if (type === 'saidas' && !item.contrato_id) {
      addAction('/associar', 'link', 'Contrato', 'Associar contrato');
    }

    const weightOrDash = (value) => (value == null ? '<span class="wb-muted">-</span>' : escapeHtml(formatNumber(value)));

    return buildYardRow({
      type: type === 'entradas' ? 'entrada' : 'saida',
      item,
      date,
      plate: item.placa_caminhao,
      product: formatProductLabel(item.produto),
      first: weightOrDash(item.peso_bruto_kg),
      second: weightOrDash(item.peso_tara_kg),
      actions,
    });
  }).join('');
}

function buildYardSectionHtml(yardRows) {
  if (!yardRows) {
    return '';
  }

  const count = (yardRows.match(/<tr /g) || []).length;

  return `<section class="wb-panel wb-panel--yard" aria-labelledby="yard-title">
        <div class="wb-panel-head">
          <h2 id="yard-title">${icon('truck')}Pátio <span class="wb-count">${count}</span></h2>
        </div>
        <div class="wb-table-wrap">
          <table class="wb-table">
            <thead>
              <tr>
                <th class="wb-col-type"><span class="sr-only">Tipo</span></th>
                <th>Placa</th>
                <th>Chegada</th>
                <th>Produto</th>
                <th class="num">Bruto <small>kg</small></th>
                <th class="num">Tara <small>kg</small></th>
                <th class="wb-col-actions">Pendente</th>
              </tr>
            </thead>
            <tbody>${yardRows}</tbody>
          </table>
        </div>
      </section>`;
}

function buildDaySummaryHtml(daySummary) {
  const stats = [];

  if (daySummary) {
    stats.push(`<div class="wb-stat wb-stat--in"><span class="wb-stat-label">${icon('in')}Entradas hoje</span><strong>${escapeHtml(formatNumber(daySummary.entradas_count || 0))} <small>· ${escapeHtml(formatKg(daySummary.entradas_liquido_kg || 0))}</small></strong></div>`);
    stats.push(`<div class="wb-stat wb-stat--out"><span class="wb-stat-label">${icon('out')}Saídas hoje</span><strong>${escapeHtml(formatNumber(daySummary.saidas_count || 0))} <small>· ${escapeHtml(formatKg(daySummary.saidas_liquido_kg || 0))}</small></strong></div>`);
  }

  if (!stats.length) {
    return '';
  }

  return `<div class="wb-stats" aria-label="Resumo do dia">${stats.join('')}</div>`;
}

// --- Fotos -----------------------------------------------------------------------

function buildScalePhotoFigureHtml(photo, { showWeightType = true } = {}) {
  const url = `/balanca/fotos/${encodeURIComponent(photo.id)}`;
  const details = [
    showWeightType && photo.tipo_peso ? PHOTO_WEIGHT_TYPE_LABELS[photo.tipo_peso] : null,
    formatKg(photo.peso_kg),
    formatDateTime(photo.capturada_em),
    photo.contingencia ? 'câmera indisponível' : null,
    photo.status === 'substituida' ? 'substituída por peso maior' : null,
  ].filter(Boolean).join(' · ');

  return `<figure class="scale-photo">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
              <img src="${escapeHtml(url)}" alt="${escapeHtml(`Foto da balança: ${details}`)}" loading="lazy">
            </a>
            <figcaption>${escapeHtml(details)}</figcaption>
          </figure>`;
}

function buildScalePhotosSectionHtml(photos = []) {
  if (!photos.length) {
    return '';
  }

  return `<section class="wb-panel" aria-label="Fotos da balança">
          <div class="wb-panel-head"><h2>${icon('photo')}Fotos da balança</h2></div>
          <div class="wb-photos">
          ${photos.map((photo) => buildScalePhotoFigureHtml(photo)).join('')}
          </div>
        </section>`;
}

function renderScalePhotosPage(res, { day, photos = [], retentionDays = 365, error, navigation }) {
  const photosHtml = photos.length
    ? `<div class="scale-photo-grid">${photos.map((photo) => buildScalePhotoFigureHtml(photo, { showWeightType: false })).join('')}</div>`
    : '<p class="wb-empty">Nenhuma foto automática nesta data.</p>';

  res.send(renderWeighbridgeTemplate('weighbridge-photos.html', {
    WB_TOPBAR: buildTopbar({
      title: 'Fotos automáticas',
      chips: chip(`${photos.length} foto${photos.length === 1 ? '' : 's'}`, { iconName: 'photo' }),
      navigation,
    }),
    SCALE_PHOTOS_ERROR: buildFlashHtml(error, 'error'),
    FOTOS_DATA: escapeHtml(day),
    FOTOS_TOTAL: escapeHtml(`${photos.length} foto${photos.length === 1 ? '' : 's'}`),
    FOTOS_RETENCAO: escapeHtml(retentionDays),
    SCALE_PHOTOS: photosHtml,
  }, navigation));
}

// --- Página inicial ------------------------------------------------------------

function renderWeighbridgeHomePage(res, {
  inputs = [],
  outputs = [],
  yardInputs = [],
  yardOutputs = [],
  standaloneWeighings = [],
  yardStandaloneWeighings = [],
  daySummary = null,
  message,
  messageAction = null,
  error,
}) {
  const yardRows = buildYardRows(yardInputs, yardOutputs, yardStandaloneWeighings);

  res.send(renderTemplate('weighbridge-home.html', {
    WEIGHBRIDGE_FLASH: buildFlashesHtml(message, error, messageAction),
    LIVE_WEIGHT: buildLiveWeightHtml(),
    DAY_SUMMARY: buildDaySummaryHtml(daySummary),
    YARD_SECTION: buildYardSectionHtml(yardRows),
    RECENT_HEAD: buildMovementTableHead({ showType: true }),
    RECENT_ROWS: buildRecentMovementRows(inputs, outputs, standaloneWeighings),
  }));
}

// --- Listas completas ------------------------------------------------------------

function renderMovementListPage(res, { type, title, rows, info, csvHref, basePath, ariaLabel, pagination, navigation }) {
  res.send(renderWeighbridgeTemplate(`weighbridge-${type}.html`, {
    WB_TOPBAR: buildTopbar({
      title,
      navigation,
      actions: csvHref ? wbLink(csvHref, 'csv', 'Baixar CSV', { text: 'CSV' }) : '',
    }),
    TABLE_HEAD: buildMovementTableHead({ info }),
    ROWS: rows,
    PAGINATION: buildPaginationHtml({ ...pagination, basePath, ariaLabel }),
  }, navigation));
}

function renderScaleInputsListPage(res, { inputs, navigation, pagination = { page: 1, totalPages: 1 } }) {
  renderMovementListPage(res, {
    type: 'inputs',
    title: 'Entradas',
    rows: buildScaleInputRows(inputs, { showAllLink: true }),
    info: 'Origem · Classificação',
    csvHref: '/balanca/entradas.csv',
    basePath: '/balanca/entradas',
    ariaLabel: 'Paginação das entradas',
    pagination,
    navigation,
  });
}

function renderScaleOutputsListPage(res, { outputs, navigation, pagination = { page: 1, totalPages: 1 } }) {
  renderMovementListPage(res, {
    type: 'outputs',
    title: 'Saídas',
    rows: buildScaleOutputRows(outputs, { showAllLink: true }),
    info: 'Contrato',
    csvHref: '/balanca/saidas.csv',
    basePath: '/balanca/saidas',
    ariaLabel: 'Paginação das saídas',
    pagination,
    navigation,
  });
}

function renderStandaloneWeighingsListPage(res, { weighings, navigation, pagination = { page: 1, totalPages: 1 } }) {
  renderMovementListPage(res, {
    type: 'standalone-list',
    title: 'Pesagens avulsas',
    rows: buildStandaloneWeighingRows(weighings, { showAllLink: true }),
    info: 'Detalhes',
    csvHref: '/balanca/avulsas.csv',
    basePath: '/balanca/avulsas',
    ariaLabel: 'Paginação das pesagens avulsas',
    pagination,
    navigation,
  });
}

// --- Contratos ---------------------------------------------------------------

const WEIGHBRIDGE_CONTRACT_FILTER_OPTIONS = [
  { value: 'nao-embarcados', label: 'Não embarcados', href: '/balanca/contratos' },
  { value: 'abertos', label: 'Em aberto', href: '/balanca/contratos?filtro=abertos' },
  { value: 'ultimos-6-meses', label: 'Últimos 6 meses', href: '/balanca/contratos?filtro=ultimos-6-meses' },
  { value: 'todos', label: 'Todos', href: '/balanca/contratos?filtro=todos' },
];

function buildScaleContractsFilterToggle({ filter, canFilterContracts }) {
  if (!canFilterContracts) {
    return '';
  }

  return `<nav class="wb-seg" aria-label="Filtro de contratos">${WEIGHBRIDGE_CONTRACT_FILTER_OPTIONS.map((option) => {
    const isActive = option.value === filter;
    return `<a href="${escapeHtml(option.href)}" aria-current="${isActive ? 'page' : 'false'}">${escapeHtml(option.label)}</a>`;
  }).join('')}</nav>`;
}

function contractWeightCell(value) {
  return `<td class="num"><span class="weighbridge-contract-weight" data-weight-kg="${escapeHtml(value)}">${escapeHtml(formatKg(value))}</span></td>`;
}

function buildScaleContractsRows(contracts) {
  return contracts
    .map((contract) => `
        <tr>
          <td><a class="wb-plate" href="/balanca/contratos/${escapeHtml(contract.id)}" title="Contrato #${escapeHtml(contract.id)}">#${escapeHtml(contract.id)}</a></td>
          <td>${escapeHtml(formatDate(contract.data_contrato))}</td>
          <td><a href="/balanca/contratos/${escapeHtml(contract.id)}">${escapeHtml(contract.comprador_nome)}</a></td>
          <td>${escapeHtml(formatProductLabel(contract.produto))}</td>
          ${contractWeightCell(contract.quantidade_kg)}
          ${contractWeightCell(contract.quantidade_embarcada_kg)}
          ${contractWeightCell(contract.saldo_kg).replace('class="num"', 'class="num net"')}
        </tr>
      `)
    .join('') || emptyRow(7, 'Nenhum contrato com embarque pendente.');
}

function renderScaleContractsListPage(res, { contracts, navigation, filter = 'nao-embarcados', canFilterContracts = false }) {
  res.send(renderWeighbridgeTemplate('weighbridge-contracts.html', {
    WB_TOPBAR: buildTopbar({ title: 'Contratos', navigation }),
    CONTRACT_FILTER_TOGGLE: buildScaleContractsFilterToggle({ filter, canFilterContracts }),
    CONTRACT_ROWS: buildScaleContractsRows(contracts),
  }, navigation));
}

function buildScaleContractOutputRows(outputs) {
  return outputs
    .map((output) => {
      const href = `/balanca/saidas/${encodeURIComponent(output.id)}`;
      const canPrint = !isBlank(output.peso_bruto_kg) && !isBlank(output.peso_liquido_kg);
      return `
        <tr>
          ${dateCell(href, output.data_saida)}
          ${plateCell(href, output.placa_caminhao)}
          <td>${escapeHtml(formatProductLabel(output.produto))}</td>
          <td class="num">${escapeHtml(formatNumber(output.peso_tara_kg))}</td>
          <td class="num">${escapeHtml(formatNumber(output.peso_bruto_kg))}</td>
          <td class="num net">${escapeHtml(formatNumber(output.peso_liquido_kg))}</td>
          <td class="wb-col-actions"><div class="wb-row-actions">${wbLink(`${href}/nf`, 'nf', 'Informações NF', { size: 'sm' })}${canPrint ? ticketLink(`${href}/ticket.pdf`, { size: 'sm' }) : ''}</div></td>
        </tr>
      `;
    })
    .join('') || emptyRow(7, 'Nenhuma saída associada a este contrato.');
}

function buildContractReceiptsSection(receiptInfo, message, error) {
  if (!receiptInfo) return '';

  const { contract, receipts } = receiptInfo;
  const rows = receipts.map((receipt) => `<tr>
    <td>${escapeHtml(formatDate(receipt.data_recebimento))}</td>
    <td class="num">${escapeHtml(formatMoney(receipt.valor))}</td>
    <td>${escapeHtml(receipt.usuario_login)}</td>
    <td class="wb-col-info">${escapeHtml(receipt.observacao || '-')}</td>
  </tr>`).join('') || emptyRow(4, 'Nenhum recebimento registrado.');

  const manualAction = contract.contrato_recebido
    ? chip('Recebido', { iconName: 'check', variant: 'ok', title: 'Contrato marcado como recebido pelo administrador.' })
    : `<form action="/admin/contratos/${escapeHtml(contract.id)}/marcar-recebido" method="post">
        <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
        <input type="hidden" name="retorno" value="balanca">
        <button class="wb-btn wb-btn--sm" type="submit" title="Marcar contrato como recebido">${icon('check')}<span>Marcar como recebido</span></button>
      </form>`;

  return `<section class="wb-panel" aria-labelledby="contract-receipts-title">
    <div class="wb-panel-head"><h2 id="contract-receipts-title">Recebimentos</h2><div class="wb-panel-tools">${manualAction}</div></div>
    ${buildFlashesHtml(message, error)}
    <dl class="wb-facts">
      ${buildFact('Valor bruto', escapeHtml(formatMoney(contract.valor_bruto)))}
      ${buildFact('SENAR', contract.desconta_senar ? escapeHtml(formatMoney(contract.desconto_senar)) : 'Não aplicado')}
      ${buildFact('Esperado', escapeHtml(formatMoney(contract.valor_contrato)))}
      ${buildFact('Recebido', escapeHtml(formatMoney(contract.valor_recebido)))}
      ${buildFact('Falta receber', escapeHtml(formatMoney(contract.saldo_receber)))}
    </dl>
    <div class="wb-table-wrap" style="margin-top:8px">
      <table class="wb-table">
        <thead><tr><th>Data</th><th class="num">Valor</th><th>Registrado por</th><th class="wb-col-info">Comentário</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderScaleContractDetailPage(res, { contract, outputs, receiptInfo = null, message = '', error = '' }) {
  res.send(renderWeighbridgeTemplate('weighbridge-contract-detail.html', {
    WB_TOPBAR: buildTopbar({
      title: `Contrato #${contract.contrato_id}`,
      chips: `${chip(formatProductLabel(contract.produto), { iconName: 'wheat' })}${chip(formatDate(contract.data_contrato), { iconName: 'calendar', title: 'Data do contrato' })}`,
      backHref: '/balanca/contratos',
      backLabel: 'Voltar aos contratos',
    }),
    CONTRATO_ID: escapeHtml(contract.contrato_id),
    CONTRACT_FIELDS: [
      buildCopyCell('Quantidade', formatKgAndSacks(contract.quantidade_kg)),
      buildCopyCell('Embarcado', formatKgAndSacks(contract.quantidade_embarcada_kg)),
      buildCopyCell('Saldo', formatKgAndSacks(contract.saldo_kg)),
      buildCopyCell('Preço por saca', formatMoney(contract.preco_por_saca)),
      buildCopyCell('Vendedor', contract.vendedor_nome_completo),
      buildCopyCell('Comprador', contract.comprador_nome_completo),
    ].join('\n          '),
    NUMERO_SAIDAS: escapeHtml(outputs.length),
    OUTPUT_ROWS: buildScaleContractOutputRows(outputs),
    RECEIPTS_SECTION: buildContractReceiptsSection(receiptInfo, message, error),
  }));
}

// --- Formulários de pesagem ------------------------------------------------------

function renderScaleOutputFormPage(res, { formValues = {}, error, navigation }) {
  res.send(renderWeighbridgeTemplate('weighbridge-output-form.html', {
    WB_TOPBAR: buildTopbar({ title: 'Nova saída', chips: chip('Tara', { iconName: 'out', variant: 'out' }), navigation }),
    SCALE_OUTPUT_ERROR: buildFlashHtml(error, 'error'),
    DATA_SAIDA: escapeHtml(formValues.data_saida || toDateTimeLocalValue()),
    PLACA_CAMINHAO: escapeHtml(formValues.placa_caminhao || ''),
    NOME_MOTORISTA: escapeHtml(formValues.nome_motorista || ''),
    PRODUCT_MILHO_SELECTED: formValues.produto === 'milho' ? ' selected' : '',
    PRODUCT_SOJA_SELECTED: formValues.produto === 'soja' ? ' selected' : '',
    PESO_TARA_KG: escapeHtml(formatDecimalInput(formValues.peso_tara_kg)),
    FOTO_CAPTURA_ID: escapeHtml(getCaptureIdValue(formValues)),
  }, navigation));
}

function renderScaleOutputGrossFormPage(res, { output, formValues = {}, error, navigation }) {
  res.send(renderWeighbridgeTemplate('weighbridge-output-gross-form.html', {
    WB_TOPBAR: buildTopbar({
      title: `Bruto · Saída #${output.id}`,
      chips: `${plateChip(output.placa_caminhao, `/balanca/saidas/${encodeURIComponent(output.id)}`)}${chip(formatProductLabel(output.produto), { iconName: 'wheat' })}${chip(`Tara ${formatKg(output.peso_tara_kg)}`, { iconName: 'scale' })}${chip(formatShortDateTime(output.data_saida), { iconName: 'clock', title: formatDateTime(output.data_saida) })}`,
      navigation,
    }),
    SCALE_OUTPUT_ERROR: buildFlashHtml(error, 'error'),
    SAIDA_ID: escapeHtml(output.id),
    PESO_BRUTO_KG: escapeHtml(formatDecimalInput(formValues.peso_bruto_kg)),
    PESO_BRUTO_ADICIONADO_EM: escapeHtml(formValues.peso_bruto_adicionado_em || toDateTimeLocalValue()),
    FOTO_CAPTURA_ID: escapeHtml(getCaptureIdValue(formValues)),
  }, navigation));
}

function buildPlateSuggestionsHtml(plateSuggestions = []) {
  return plateSuggestions
    .map((plate) => `<button class="weighbridge-plate-option" type="button" data-plate="${escapeHtml(plate.placa_caminhao)}" data-has-tare="${plate.tem_tara_anterior ? '1' : '0'}" data-tare="${escapeHtml(plate.peso_tara_kg || '')}">${escapeHtml(plate.placa_caminhao)}${plate.tem_tara_anterior ? ` · tara ${escapeHtml(formatKg(plate.peso_tara_kg))}` : ''}</button>`)
    .join('') || '<span class="weighbridge-plate-empty">Nenhuma placa recente.</span>';
}

function renderScaleInputFormPage(res, { formValues = {}, plateSuggestions = [], error, navigation }) {
  const dataEntradaValue = formValues.data_entrada || toDateTimeLocalValue();
  const selectedProduct = formValues.produto || getDefaultScaleInputProduct(dataEntradaValue);

  res.send(renderWeighbridgeTemplate('weighbridge-input-form.html', {
    WB_TOPBAR: buildTopbar({ title: 'Nova entrada', chips: chip('Bruto', { iconName: 'in', variant: 'in' }), navigation }),
    SCALE_INPUT_ERROR: buildFlashHtml(error, 'error'),
    DATA_ENTRADA: escapeHtml(dataEntradaValue),
    PLACA_CAMINHAO: escapeHtml(formValues.placa_caminhao || ''),
    PRODUCT_MILHO_SELECTED: selectedProduct === 'milho' ? ' selected' : '',
    PRODUCT_SOJA_SELECTED: selectedProduct === 'soja' ? ' selected' : '',
    PRODUCT_WAS_CHANGED: formValues.produto ? 'true' : 'false',
    PESO_BRUTO_KG: escapeHtml(formatDecimalInput(formValues.peso_bruto_kg)),
    USAR_TARA_ANTERIOR_CHECKED: formValues.usar_tara_anterior ? ' checked' : '',
    PLATE_SUGGESTIONS: buildPlateSuggestionsHtml(plateSuggestions),
    FOTO_CAPTURA_ID: escapeHtml(getCaptureIdValue(formValues)),
  }, navigation));
}

function inputContextChips(input, { showGross = false } = {}) {
  return [
    plateChip(input.placa_caminhao, `/balanca/entradas/${encodeURIComponent(input.id)}`),
    chip(formatProductLabel(input.produto), { iconName: 'wheat' }),
    showGross ? chip(`Bruto ${formatKg(input.peso_bruto_kg)}`, { iconName: 'scale' }) : '',
    chip(formatShortDateTime(input.data_entrada), { iconName: 'clock', title: formatDateTime(input.data_entrada) }),
  ].join('');
}

function renderScaleInputTareFormPage(res, { input, formValues = {}, error, navigation }) {
  res.send(renderWeighbridgeTemplate('weighbridge-input-tare-form.html', {
    WB_TOPBAR: buildTopbar({ title: `Tara · Entrada #${input.id}`, chips: inputContextChips(input, { showGross: true }), navigation }),
    SCALE_INPUT_ERROR: buildFlashHtml(error, 'error'),
    ENTRADA_ID: escapeHtml(input.id),
    TARA_ADICIONADA_EM: escapeHtml(formValues.tara_adicionada_em || toDateTimeLocalValue()),
    PESO_TARA_KG: escapeHtml(formatDecimalInput(formValues.peso_tara_kg)),
    FOTO_CAPTURA_ID: escapeHtml(getCaptureIdValue(formValues)),
  }, navigation));
}

function renderScaleInputClassificationFormPage(res, { input, formValues = {}, error, navigation }) {
  res.send(renderWeighbridgeTemplate('weighbridge-input-classification-form.html', {
    WB_TOPBAR: buildTopbar({ title: `Classificação · Entrada #${input.id}`, chips: inputContextChips(input), navigation }),
    SCALE_INPUT_ERROR: buildFlashHtml(error, 'error'),
    ENTRADA_ID: escapeHtml(input.id),
    UMIDADE_PERCENT: escapeHtml(formatDecimalInput(formValues.umidade_percent ?? input.umidade_percent ?? 14)),
    IMPUREZA_PERCENT: escapeHtml(formatDecimalInput(formValues.impureza_percent ?? input.impureza_percent ?? 1)),
    GRAOS_AVARIADOS_PERCENT: escapeHtml(formatDecimalInput(formValues.graos_avariados_percent ?? input.graos_avariados_percent ?? 0)),
  }, navigation));
}

function renderScaleInputOriginFormPage(res, { input, formValues = {}, error, navigation }) {
  res.send(renderWeighbridgeTemplate('weighbridge-input-origin-form.html', {
    WB_TOPBAR: buildTopbar({ title: `Origem · Entrada #${input.id}`, chips: inputContextChips(input), navigation }),
    SCALE_INPUT_ERROR: buildFlashHtml(error, 'error'),
    ENTRADA_ID: escapeHtml(input.id),
    ORIGEM: escapeHtml(formValues.origem ?? input.origem ?? ''),
  }, navigation));
}

// --- Detalhe da entrada ----------------------------------------------------------

function buildDeletionReasonFormHtml({ action, buttonLabel, textareaId }) {
  return `
            <form class="deletion-reason-form" action="${escapeHtml(action)}" method="post" onsubmit="return confirm('Tem certeza que quer deletar esse registro? Essa operação não pode ser desfeita.');">
              <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
              <label for="${escapeHtml(textareaId)}">Motivo (mín. 20 caracteres)
                <textarea class="form-control deletion-reason-input" id="${escapeHtml(textareaId)}" name="motivo_delecao" rows="2" minlength="20" maxlength="500" required></textarea>
              </label>
              <p class="wb-muted deletion-reason-help">Digite pelo menos 20 caracteres para habilitar o botão.</p>
              <button class="btn-danger-action deletion-reason-submit" type="submit" disabled>${escapeHtml(buttonLabel)}</button>
            </form>
  `;
}

function buildDetailsSection(id, iconName, title, body, { open = false, danger = false } = {}) {
  return `<details class="wb-details${danger ? ' wb-details--danger' : ''}" id="${escapeHtml(id)}"${open ? ' open' : ''}>
          <summary>${icon(iconName)}${escapeHtml(title)}</summary>
          <div class="wb-details-body">${body}</div>
        </details>`;
}

function openDetailsButton(target, iconName, label, { variant = '' } = {}) {
  return `<button class="wb-btn wb-btn--icon${variant ? ` wb-btn--${variant}` : ''}" type="button" data-open-details="${escapeHtml(target)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon(iconName)}</button>`;
}

function buildInputEditFormHtml(input, formValues) {
  const dataEntradaValue = formValues.data_entrada ?? toDateTimeLocalValue(input.data_entrada);
  const selectedProduct = formValues.produto || input.produto;
  const value = (key, fallback) => escapeHtml(formatDecimalInput(formValues[key] ?? fallback ?? ''));

  return `<form class="wb-form" action="/balanca/entradas/${escapeHtml(input.id)}" method="post">
            <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
            <div class="wb-form-grid">
              <label>Data/hora
                <input class="form-control" name="data_entrada" type="datetime-local" value="${escapeHtml(dataEntradaValue)}" required>
              </label>
              <label>Placa
                <input class="form-control" name="placa_caminhao" type="text" value="${escapeHtml(formValues.placa_caminhao ?? input.placa_caminhao ?? '')}" placeholder="ABC1D23" maxlength="10" required>
              </label>
              <label>Produto
                <select class="form-control" name="produto" required>
                  <option value="">Selecione</option>
                  <option value="milho"${selectedProduct === 'milho' ? ' selected' : ''}>Milho</option>
                  <option value="soja"${selectedProduct === 'soja' ? ' selected' : ''}>Soja</option>
                </select>
              </label>
              <label>Origem
                <input class="form-control" name="origem" type="text" value="${escapeHtml(formValues.origem ?? input.origem ?? '')}" maxlength="200" placeholder="Fazenda, lote...">
              </label>
              <label>Bruto (kg)
                <input class="form-control" name="peso_bruto_kg" type="number" min="0.001" max="79999.999" step="0.001" value="${value('peso_bruto_kg', input.peso_bruto_kg)}" inputmode="decimal" required>
              </label>
              <label>Tara (kg)
                <input class="form-control" name="peso_tara_kg" type="number" min="0.001" step="0.001" value="${value('peso_tara_kg', input.peso_tara_kg)}" inputmode="decimal" placeholder="Pendente">
              </label>
              <label>Umidade (%)
                <input class="form-control" name="umidade_percent" type="number" min="0" max="100" step="0.001" value="${value('umidade_percent', input.umidade_percent)}" inputmode="decimal" placeholder="14">
              </label>
              <label>Impureza (%)
                <input class="form-control" name="impureza_percent" type="number" min="0" max="100" step="0.001" value="${value('impureza_percent', input.impureza_percent)}" inputmode="decimal" placeholder="1">
              </label>
              <label>Avariados (%)
                <input class="form-control" name="graos_avariados_percent" type="number" min="0" max="100" step="0.001" value="${value('graos_avariados_percent', input.graos_avariados_percent)}" inputmode="decimal" placeholder="0">
              </label>
            </div>
            <p class="wb-hint">Campo em branco remove tara, origem ou classificação.</p>
            <div class="wb-form-actions">
              <button class="wb-btn wb-btn--primary" type="submit">${icon('check')}<span>Salvar</span></button>
            </div>
          </form>`;
}

function renderScaleInputDetailPage(res, { input, photos = [], formValues = {}, message, error, navigation }) {
  const id = encodeURIComponent(input.id);
  const href = `/balanca/entradas/${id}`;
  const hasTare = !isBlank(input.peso_tara_kg);
  const canPrint = hasTare && !isBlank(input.peso_liquido_kg);
  const actions = [
    canPrint ? ticketLink(`${href}/ticket.pdf`, { text: 'Ticket', variant: 'primary' }) : ticketDisabled('falta a tara', { text: 'Ticket' }),
    canCopyInputReport(input)
      ? `<button class="wb-btn wb-btn--icon" type="button" data-clipboard-report="${escapeHtmlAttribute(buildInputClipboardReport(input))}" title="Copiar relatório" aria-label="Copiar relatório da entrada ${escapeHtml(input.placa_caminhao)}">${icon('copy')}</button>`
      : '',
    openDetailsButton('editar', 'edit', 'Editar entrada'),
    openDetailsButton('excluir', 'trash', 'Excluir entrada', { variant: 'danger' }),
  ].join('');
  const tareMeta = input.tara_usada_de_entrada_id
    ? `${icon('link')}<a href="/balanca/entradas/${escapeHtml(input.tara_usada_de_entrada_id)}">Tara anterior #${escapeHtml(input.tara_usada_de_entrada_id)}</a>`
    : timeMeta(input.tara_adicionada_em);
  const realNet = !isBlank(input.liquido_real_kg)
    ? `<span title="Líquido real">Líquido real ${escapeHtml(formatRoundedKg(input.liquido_real_kg))} kg</span>`
    : '';
  const weights = [
    buildWeightTile('Bruto', input.peso_bruto_kg, { meta: timeMeta(input.data_entrada) }),
    buildWeightTile('Tara', input.peso_tara_kg, {
      meta: hasTare ? tareMeta : '',
      todo: wbLink(`${href}/tara`, 'scale', 'Adicionar tara', { text: 'Adicionar tara', variant: 'todo' }),
    }),
    buildWeightTile('Líquido', input.peso_liquido_kg, { net: true, sacks: true, meta: realNet }),
  ].join('');
  const facts = [
    buildFact('Origem', input.origem
      ? escapeHtml(input.origem)
      : wbTodo(`${href}/origem`, 'pin', 'Definir', 'Definir origem'), { iconName: 'pin' }),
    buildFact('Classificação', isInputClassified(input)
      ? escapeHtml(formatClassificationLong(input))
      : wbTodo(`${href}/classificacao`, 'drop', 'Classificar', 'Adicionar classificação'), { iconName: 'drop' }),
  ].join('');

  res.send(renderWeighbridgeTemplate('weighbridge-input-detail.html', {
    WB_TOPBAR: buildTopbar({
      title: `Entrada #${input.id}`,
      chips: `${plateChip(input.placa_caminhao)}${chip(formatProductLabel(input.produto), { iconName: 'wheat' })}`,
      actions,
      navigation,
    }),
    SCALE_INPUT_FLASH: buildFlashesHtml(message, error),
    WEIGHTS: weights,
    FACTS: facts,
    SCALE_PHOTOS_SECTION: buildScalePhotosSectionHtml(photos),
    EDIT_SECTION: buildDetailsSection('editar', 'edit', 'Editar', buildInputEditFormHtml(input, formValues), {
      open: hasFormValues(formValues),
    }),
    DELETE_SECTION: buildDetailsSection('excluir', 'trash', 'Excluir', buildDeletionReasonFormHtml({
      action: `/balanca/entradas/${input.id}/deletar`,
      buttonLabel: 'Deletar entrada',
      textareaId: 'motivo-delecao-entrada',
    }), { danger: true }),
  }, navigation));
}

// --- Saídas: associação, detalhe e NF ----------------------------------------

function outputContextChips(output) {
  return [
    plateChip(output.placa_caminhao, `/balanca/saidas/${encodeURIComponent(output.id ?? output.saida_id)}`),
    chip(formatProductLabel(output.produto), { iconName: 'wheat' }),
    !isBlank(output.peso_liquido_kg) ? chip(`Líquido ${formatKg(output.peso_liquido_kg)}`, { iconName: 'scale' }) : '',
    chip(formatShortDateTime(output.data_saida), { iconName: 'clock', title: formatDateTime(output.data_saida) }),
  ].join('');
}

function renderScaleOutputAssociationPage(res, { output, buyers, contracts, selectedBuyerId, error, navigation }) {
  const buyerOptions = buyers.map((buyer) => buildOption(buyer.id, buyer.nome, selectedBuyerId)).join('');
  const contractOptions = contracts.map((contract) => {
    const label = `#${contract.id} · ${formatDate(contract.data_contrato)} · saldo ${formatKg(contract.saldo_kg)} · ${formatMoney(contract.preco_por_saca)}/sc`;
    return buildOption(contract.id, label, contracts.length === 1 ? contract.id : '');
  }).join('');
  const contractHelp = !selectedBuyerId
    ? 'Escolha o comprador.'
    : contracts.length === 0
      ? 'Sem contrato com saldo para este comprador e produto.'
      : contracts.length === 1
        ? 'Único contrato disponível, já selecionado.'
        : `${contracts.length} contratos disponíveis.`;
  const submitDisabled = contracts.length === 0 ? 'disabled' : '';

  res.send(renderWeighbridgeTemplate('weighbridge-associate-output.html', {
    WB_TOPBAR: buildTopbar({ title: `Contrato · Saída #${output.id}`, chips: outputContextChips(output), navigation }),
    ASSOCIATION_ERROR: buildFlashHtml(error, 'error'),
    OUTPUT_ID: escapeHtml(output.id),
    BUYER_OPTIONS: buyerOptions,
    CONTRACT_OPTIONS: contractOptions,
    CONTRACT_HELP: escapeHtml(contractHelp),
    SELECTED_BUYER_ID: escapeHtml(selectedBuyerId || ''),
    ASSOCIATE_DISABLED: submitDisabled,
  }, navigation));
}

function canPrintOutputTicket(outputInfo) {
  return Boolean(outputInfo.contrato_id)
    && !isBlank(outputInfo.peso_bruto_kg)
    && !isBlank(outputInfo.peso_liquido_kg);
}

function outputTicketAction(outputInfo, options = {}) {
  if (canPrintOutputTicket(outputInfo)) {
    return ticketLink(`/balanca/saidas/${encodeURIComponent(outputInfo.saida_id)}/ticket.pdf`, options);
  }

  const reason = !outputInfo.contrato_id ? 'falta o contrato' : 'falta o bruto';
  return ticketDisabled(reason, options);
}

function buildScaleOutputEditFormHtml(outputInfo, formValues = {}) {
  const dataSaidaValue = formValues.data_saida ?? toDateTimeLocalValue(outputInfo.data_saida);
  const selectedProduct = formValues.produto || outputInfo.produto;

  return `<form class="wb-form" action="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}" method="post">
            <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
            <div class="wb-form-grid">
              <label>Data/hora
                <input class="form-control" name="data_saida" type="datetime-local" value="${escapeHtml(dataSaidaValue)}" required>
              </label>
              <label>Placa
                <input class="form-control" name="placa_caminhao" type="text" value="${escapeHtml(formValues.placa_caminhao ?? outputInfo.placa_caminhao ?? '')}" placeholder="ABC1D23" maxlength="10" required>
              </label>
              <label>Produto
                <select class="form-control" name="produto" required>
                  <option value="">Selecione</option>
                  <option value="milho"${selectedProduct === 'milho' ? ' selected' : ''}>Milho</option>
                  <option value="soja"${selectedProduct === 'soja' ? ' selected' : ''}>Soja</option>
                </select>
              </label>
              <label>Motorista
                <input class="form-control" name="nome_motorista" type="text" value="${escapeHtml(formValues.nome_motorista ?? outputInfo.nome_motorista ?? '')}" maxlength="120" autocomplete="off">
              </label>
              <label>Tara (kg)
                <input class="form-control" name="peso_tara_kg" type="number" min="0.001" step="0.001" value="${escapeHtml(formatDecimalInput(formValues.peso_tara_kg ?? outputInfo.peso_tara_kg))}" inputmode="decimal" required>
              </label>
              <label>Bruto (kg)
                <input class="form-control" name="peso_bruto_kg" type="number" min="0.001" step="0.001" value="${escapeHtml(formatDecimalInput(formValues.peso_bruto_kg ?? outputInfo.peso_bruto_kg))}" inputmode="decimal" placeholder="Pendente">
              </label>
            </div>
            <p class="wb-hint">Bruto em branco deixa a saída pendente.</p>
            <div class="wb-form-actions">
              <button class="wb-btn wb-btn--primary" type="submit">${icon('check')}<span>Salvar</span></button>
            </div>
          </form>`;
}

function getSplitFirstNetWeightSuggestion(outputInfo) {
  if (!outputInfo || outputInfo.contrato_id === null || outputInfo.contrato_id === undefined) {
    return '';
  }

  const netWeight = Number(outputInfo.peso_liquido_kg);
  const contractBalance = Number(outputInfo.contrato_saldo_kg);

  if (!Number.isFinite(netWeight) || !Number.isFinite(contractBalance) || contractBalance >= 0) {
    return '';
  }

  const suggestedWeight = netWeight + contractBalance;

  if (suggestedWeight <= 0 || suggestedWeight >= netWeight) {
    return '';
  }

  return formatDecimalInput(suggestedWeight);
}

function buildScaleOutputSplitFormHtml(outputInfo) {
  const suggestedFirstNetWeight = getSplitFirstNetWeightSuggestion(outputInfo);
  const suggestedFirstNetWeightAttribute = suggestedFirstNetWeight ? ` value="${escapeHtml(suggestedFirstNetWeight)}"` : '';

  return `<form class="wb-form weighbridge-split-form" action="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/dividir" method="post">
            <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
            <div class="wb-form-grid">
              <label for="peso-liquido-primeira">1ª saída · líquido (kg)
                <input class="form-control" id="peso-liquido-primeira" name="peso_liquido_primeira_kg" type="number" min="0.001" max="${escapeHtml(formatDecimalInput(outputInfo.peso_liquido_kg))}" step="0.001" data-total-net="${escapeHtml(formatDecimalInput(outputInfo.peso_liquido_kg))}"${suggestedFirstNetWeightAttribute} required>
              </label>
              <label for="peso-liquido-segunda">2ª saída · líquido (kg)
                <input class="form-control" id="peso-liquido-segunda" type="text" readonly value="-">
              </label>
            </div>
            ${suggestedFirstNetWeight ? '<p class="wb-hint">Sugestão: o que cabe no saldo do contrato.</p>' : ''}
            <div class="wb-form-actions">
              <button class="wb-btn wb-btn--primary" type="submit">${icon('split')}<span>Dividir</span></button>
            </div>
          </form>`;
}

function buildOutputContractFact(outputInfo) {
  if (!outputInfo.contrato_id) {
    return buildFact('Contrato', wbTodo(`/balanca/saidas/${encodeURIComponent(outputInfo.saida_id)}/associar`, 'link', 'Associar', 'Associar contrato'), { iconName: 'contract' });
  }

  const label = `#${outputInfo.contrato_id}${outputInfo.comprador_nome_completo ? ` · ${outputInfo.comprador_nome_completo}` : ''}`;
  const unlinkForm = `<form action="/balanca/saidas/${escapeHtml(outputInfo.saida_id)}/desvincular-contrato" method="post" onsubmit="return confirm('Desvincular esta saída do contrato?');" style="display:inline">
                <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
                <button class="wb-btn wb-btn--sm wb-btn--icon wb-btn--danger" type="submit" title="Desvincular contrato" aria-label="Desvincular contrato">${icon('unlink')}</button>
              </form>`;

  return buildFact('Contrato', `<a href="/balanca/contratos/${escapeHtml(outputInfo.contrato_id)}">${escapeHtml(label)}</a>${unlinkForm}`, { iconName: 'contract' });
}

function renderScaleOutputDetailPage(res, { outputInfo, photos = [], formValues = {}, message, error, navigation }) {
  const id = encodeURIComponent(outputInfo.saida_id);
  const href = `/balanca/saidas/${id}`;
  const hasGross = !isBlank(outputInfo.peso_bruto_kg);
  const actions = [
    outputTicketAction(outputInfo, { text: 'Ticket', variant: canPrintOutputTicket(outputInfo) ? 'primary' : '' }),
    outputInfo.contrato_id
      ? wbLink(`${href}/nf`, 'nf', 'Informações NF', { text: 'NF' })
      : wbLink(`${href}/associar`, 'link', 'Associar contrato', { text: 'Contrato', variant: 'todo' }),
    hasGross ? openDetailsButton('dividir', 'split', 'Dividir saída') : '',
    openDetailsButton('editar', 'edit', 'Editar saída'),
    openDetailsButton('excluir', 'trash', 'Excluir saída', { variant: 'danger' }),
  ].join('');
  const weights = [
    buildWeightTile('Tara', outputInfo.peso_tara_kg, { meta: timeMeta(outputInfo.data_saida) }),
    buildWeightTile('Bruto', outputInfo.peso_bruto_kg, {
      meta: hasGross ? timeMeta(outputInfo.peso_bruto_adicionado_em) : '',
      todo: wbLink(`${href}/bruto`, 'scale', 'Adicionar bruto', { text: 'Adicionar bruto', variant: 'todo' }),
    }),
    buildWeightTile('Líquido', outputInfo.peso_liquido_kg, { net: true, sacks: true }),
  ].join('');
  const facts = [
    buildOutputContractFact(outputInfo),
    outputInfo.contrato_id && !isBlank(outputInfo.contrato_saldo_kg)
      ? buildFact('Saldo do contrato', escapeHtml(formatKgAndSacks(outputInfo.contrato_saldo_kg)), { iconName: 'scale' })
      : '',
  ].join('');
  const copyCells = [
    buildCopyCell('Data/hora', formatDateTime(outputInfo.data_saida)),
    buildCopyCell('Placa', outputInfo.placa_caminhao),
    buildCopyCell('Motorista', outputInfo.nome_motorista || '-'),
    buildCopyCell('Produto', formatProductLabel(outputInfo.produto)),
  ].join('');

  res.send(renderWeighbridgeTemplate('weighbridge-output-detail.html', {
    WB_TOPBAR: buildTopbar({
      title: `Saída #${outputInfo.saida_id}`,
      chips: `${plateChip(outputInfo.placa_caminhao)}${chip(formatProductLabel(outputInfo.produto), { iconName: 'wheat' })}${outputInfo.nome_motorista ? chip(outputInfo.nome_motorista, { iconName: 'user', title: 'Motorista' }) : ''}`,
      actions,
      navigation,
    }),
    SCALE_OUTPUT_FLASH: buildFlashesHtml(message, error),
    WEIGHTS: weights,
    FACTS: facts,
    COPY_FIELDS: copyCells,
    SCALE_PHOTOS_SECTION: buildScalePhotosSectionHtml(photos),
    SPLIT_SECTION: hasGross
      ? buildDetailsSection('dividir', 'split', 'Dividir', buildScaleOutputSplitFormHtml(outputInfo))
      : '',
    EDIT_SECTION: buildDetailsSection('editar', 'edit', 'Editar', buildScaleOutputEditFormHtml(outputInfo, formValues), {
      open: hasFormValues(formValues),
    }),
    DELETE_SECTION: buildDetailsSection('excluir', 'trash', 'Excluir', buildDeletionReasonFormHtml({
      action: `/balanca/saidas/${outputInfo.saida_id}/deletar`,
      buttonLabel: 'Deletar saída',
      textareaId: `motivo-delecao-saida-${outputInfo.saida_id}`,
    }), { danger: true }),
  }, navigation));
}

// Na ordem em que o operador preenche a nota.
function getInvoiceFields(outputInfo) {
  return [
    ['Vendedor', outputInfo.vendedor_nome_completo],
    ['IE vendedor', outputInfo.inscricao_estadual_vendedor],
    ['CPF/CNPJ comprador', outputInfo.comprador_cpf_cnpj],
    ['IE comprador', outputInfo.comprador_inscricao_estadual],
    ['Comprador', outputInfo.comprador_nome_completo],
    ['CEP', formatDigitsOnly(outputInfo.comprador_cep)],
    ['Endereço', outputInfo.comprador_endereco],
    ['Número', outputInfo.comprador_numero],
    ['Natureza da operação', outputInfo.natureza_operacao ?? DEFAULT_INVOICE_OPERATION_NATURE],
    ['Inf. adicionais', outputInfo.informacoes_interesse_contribuinte, { wide: true }],
    ['Produto', formatProductLabel(outputInfo.produto)],
    ['CFOP', outputInfo.cfop ?? DEFAULT_INVOICE_CFOP],
    ['Líquido kg', formatRoundedKg(outputInfo.peso_liquido_kg)],
    ['Líquido t', formatPlainDecimal(Number(outputInfo.peso_liquido_kg) / 1000)],
    ['Preço/kg', formatPlainDecimal(outputInfo.preco_por_kg)],
    ['Preço/t', formatPlainDecimal(outputInfo.preco_por_ton)],
    ['CNPJ transportadora', outputInfo.cnpj_transportadora],
    ['IE transportadora', outputInfo.inscricao_estadual_transportadora],
    ['Transportadora', outputInfo.razao_social_transportadora],
    ['UF transportadora', outputInfo.uf_transportadora],
    ['Placa', outputInfo.placa_caminhao],
    ['Nome da NF', buildScaleOutputInvoiceName(outputInfo)],
    ['E-mail', outputInfo.email],
    ['Obs. do contrato', outputInfo.observacoes, { wide: true }],
  ];
}

function buildScaleOutputInvoiceDetailHtml(outputInfo) {
  if (!outputInfo.contrato_id) {
    return `<section class="wb-panel">
          <p class="wb-empty">Sem contrato associado.</p>
          ${wbLink(`/balanca/saidas/${encodeURIComponent(outputInfo.saida_id)}/associar`, 'link', 'Associar contrato', { text: 'Associar contrato', variant: 'todo' })}
        </section>`;
  }

  return `<section class="wb-panel" aria-label="Dados da nota fiscal">
          <div class="wb-copy-grid">
            ${getInvoiceFields(outputInfo).map(([label, value, options]) => buildCopyCell(label, value, options)).join('\n            ')}
          </div>
        </section>`;
}

function renderScaleOutputInvoicePage(res, { outputInfo, message, error, navigation }) {
  const href = `/balanca/saidas/${encodeURIComponent(outputInfo.saida_id)}`;
  const actions = [
    outputTicketAction(outputInfo, { text: 'Ticket', variant: canPrintOutputTicket(outputInfo) ? 'primary' : '' }),
    wbLink(href, 'edit', 'Detalhes da saída'),
  ].join('');

  res.send(renderWeighbridgeTemplate('weighbridge-output-invoice.html', {
    WB_TOPBAR: buildTopbar({
      title: `NF · Saída #${outputInfo.saida_id}`,
      chips: outputContextChips(outputInfo),
      actions,
      navigation,
    }),
    SCALE_OUTPUT_FLASH: buildFlashesHtml(message, error),
    SAIDA_ID: escapeHtml(outputInfo.saida_id),
    INVOICE_DETAIL_SECTION: buildScaleOutputInvoiceDetailHtml(outputInfo),
  }, navigation));
}

// --- Pesagens avulsas ---------------------------------------------------------------

function renderStandaloneWeighingFormPage(res, { formValues = {}, error, navigation }) {
  res.send(renderWeighbridgeTemplate('weighbridge-standalone-form.html', {
    WB_TOPBAR: buildTopbar({ title: 'Nova avulsa', chips: chip('Pesagem 1', { iconName: 'avulsa', variant: 'avulsa' }), navigation }),
    STANDALONE_ERROR: buildFlashHtml(error, 'error'),
    PESAGEM_1_EM: escapeHtml(formValues.pesagem_1_em || toDateTimeLocalValue()),
    PESAGEM_1_KG: escapeHtml(formatDecimalInput(formValues.pesagem_1_kg)),
    PLACA_CAMINHAO: escapeHtml(formValues.placa_caminhao || ''),
    NOME_MOTORISTA: escapeHtml(formValues.nome_motorista || ''),
    PRODUTO: escapeHtml(formValues.produto || ''),
    VENDEDOR: escapeHtml(formValues.vendedor || ''),
    COMPRADOR: escapeHtml(formValues.comprador || ''),
    COMENTARIO: escapeHtml(formValues.comentario || ''),
    FOTO_CAPTURA_ID: escapeHtml(getCaptureIdValue(formValues)),
  }, navigation));
}

function buildStandaloneCommentHtml(weighing) {
  if (!weighing.comentario) {
    return '';
  }

  return `<p class="wb-flash" style="color:inherit;background:transparent;border-style:dashed">${icon('comment')}<span class="weighbridge-comment">${escapeHtml(weighing.comentario)}</span></p>`;
}

function standaloneContextChips(weighing) {
  return [
    plateChip(weighing.placa_caminhao, `/balanca/avulsas/${encodeURIComponent(weighing.id)}`),
    chip(weighing.produto, { iconName: 'wheat' }),
    chip(`P1 ${formatKg(weighing.pesagem_1_kg)}`, { iconName: 'scale' }),
    chip(formatShortDateTime(weighing.pesagem_1_em), { iconName: 'clock', title: formatDateTime(weighing.pesagem_1_em) }),
  ].join('');
}

function renderStandaloneWeighingSecondFormPage(res, { weighing, formValues = {}, error, navigation }) {
  res.send(renderWeighbridgeTemplate('weighbridge-standalone-second-form.html', {
    WB_TOPBAR: buildTopbar({ title: `Pesagem 2 · Avulsa #${weighing.id}`, chips: standaloneContextChips(weighing), navigation }),
    STANDALONE_ERROR: buildFlashHtml(error, 'error'),
    STANDALONE_COMMENT: buildStandaloneCommentHtml(weighing),
    AVULSA_ID: escapeHtml(weighing.id),
    PESAGEM_2_EM: escapeHtml(formValues.pesagem_2_em || toDateTimeLocalValue()),
    PESAGEM_2_KG: escapeHtml(formatDecimalInput(formValues.pesagem_2_kg)),
    FOTO_CAPTURA_ID: escapeHtml(getCaptureIdValue(formValues)),
  }, navigation));
}

function buildStandaloneEditFormHtml(weighing, formValues = {}) {
  const value = (key, fallback) => escapeHtml(formValues[key] ?? fallback ?? '');
  const pesagem2Em = formValues.pesagem_2_em ?? (weighing.pesagem_2_em ? toDateTimeLocalValue(weighing.pesagem_2_em) : '');

  return `<form class="wb-form" action="/balanca/avulsas/${escapeHtml(weighing.id)}" method="post">
            <input type="hidden" name="_csrf" value="{{CSRF_TOKEN}}">
            <div class="wb-form-grid">
              <label>Data/hora P1
                <input class="form-control" name="pesagem_1_em" type="datetime-local" value="${value('pesagem_1_em', toDateTimeLocalValue(weighing.pesagem_1_em))}" required>
              </label>
              <label>Pesagem 1 (kg)
                <input class="form-control" name="pesagem_1_kg" type="number" min="0.001" step="0.001" value="${escapeHtml(formatDecimalInput(formValues.pesagem_1_kg ?? weighing.pesagem_1_kg))}" inputmode="decimal" required>
              </label>
              <label>Data/hora P2
                <input class="form-control" name="pesagem_2_em" type="datetime-local" value="${escapeHtml(pesagem2Em)}">
              </label>
              <label>Pesagem 2 (kg)
                <input class="form-control" name="pesagem_2_kg" type="number" min="0.001" step="0.001" value="${escapeHtml(formatDecimalInput(formValues.pesagem_2_kg ?? weighing.pesagem_2_kg))}" inputmode="decimal" placeholder="Pendente">
              </label>
              <label>Placa
                <input class="form-control" name="placa_caminhao" type="text" value="${value('placa_caminhao', weighing.placa_caminhao)}" maxlength="12" autocomplete="off">
              </label>
              <label>Motorista
                <input class="form-control" name="nome_motorista" type="text" value="${value('nome_motorista', weighing.nome_motorista)}" maxlength="120" autocomplete="off">
              </label>
              <label>Produto
                <input class="form-control" name="produto" type="text" value="${value('produto', weighing.produto)}" maxlength="120" autocomplete="off">
              </label>
              <label>Vendedor
                <input class="form-control" name="vendedor" type="text" value="${value('vendedor', weighing.vendedor)}" maxlength="120" autocomplete="off">
              </label>
              <label>Comprador
                <input class="form-control" name="comprador" type="text" value="${value('comprador', weighing.comprador)}" maxlength="120" autocomplete="off">
              </label>
              <label class="wb-field-full">Comentário
                <textarea class="form-control" name="comentario" rows="3" maxlength="1000">${value('comentario', weighing.comentario)}</textarea>
              </label>
            </div>
            <p class="wb-hint">Pesagem 2 em branco devolve a pesagem para o pátio.</p>
            <div class="wb-form-actions">
              <button class="wb-btn wb-btn--primary" type="submit">${icon('check')}<span>Salvar</span></button>
            </div>
          </form>`;
}

function renderStandaloneWeighingDetailPage(res, { weighing, photos = [], formValues = {}, message, error, navigation }) {
  const href = `/balanca/avulsas/${encodeURIComponent(weighing.id)}`;
  const complete = hasSecondWeighing(weighing);
  const actions = [
    complete ? ticketLink(`${href}/ticket.pdf`, { text: 'Ticket', variant: 'primary' }) : ticketDisabled('falta a pesagem 2', { text: 'Ticket' }),
    openDetailsButton('editar', 'edit', 'Editar pesagem avulsa'),
    openDetailsButton('excluir', 'trash', 'Excluir pesagem avulsa', { variant: 'danger' }),
  ].join('');
  const weights = [
    buildWeightTile('Pesagem 1', weighing.pesagem_1_kg, { meta: timeMeta(weighing.pesagem_1_em) }),
    buildWeightTile('Pesagem 2', complete ? weighing.pesagem_2_kg : null, {
      meta: complete ? timeMeta(weighing.pesagem_2_em) : '',
      todo: wbLink(`${href}/pesagem-2`, 'scale', 'Adicionar pesagem 2', { text: 'Adicionar pesagem 2', variant: 'todo' }),
    }),
    buildWeightTile('Líquido', weighing.peso_liquido_kg, { net: true }),
  ].join('');
  const fields = [
    buildCopyCell('Placa', weighing.placa_caminhao),
    buildCopyCell('Motorista', weighing.nome_motorista),
    buildCopyCell('Produto', weighing.produto),
    buildCopyCell('Vendedor', weighing.vendedor),
    buildCopyCell('Comprador', weighing.comprador),
    buildCopyCell('Operador', weighing.operador_login),
    buildCopyCell('Comentário', weighing.comentario, { wide: true }),
  ].join('\n            ');

  res.send(renderWeighbridgeTemplate('weighbridge-standalone-detail.html', {
    WB_TOPBAR: buildTopbar({
      title: `Avulsa #${weighing.id}`,
      chips: `${plateChip(weighing.placa_caminhao)}${chip(weighing.produto, { iconName: 'wheat' })}`,
      actions,
      navigation,
    }),
    STANDALONE_FLASH: buildFlashesHtml(message, error),
    AVULSA_ID: escapeHtml(weighing.id),
    WEIGHTS: weights,
    STANDALONE_FIELDS: fields,
    SCALE_PHOTOS_SECTION: buildScalePhotosSectionHtml(photos),
    EDIT_SECTION: buildDetailsSection('editar', 'edit', 'Editar', buildStandaloneEditFormHtml(weighing, formValues), {
      open: hasFormValues(formValues),
    }),
    DELETE_SECTION: buildDetailsSection('excluir', 'trash', 'Excluir', buildDeletionReasonFormHtml({
      action: `/balanca/avulsas/${weighing.id}/deletar`,
      buttonLabel: 'Deletar pesagem avulsa',
      textareaId: `motivo-delecao-avulsa-${weighing.id}`,
    }), { danger: true }),
  }, navigation));
}

module.exports = {
  buildMovementTableHead,
  buildScaleInputRows,
  buildScaleOutputRows,
  buildStandaloneWeighingRows,
  formatShortDateTime,
  renderStandaloneWeighingDetailPage,
  renderStandaloneWeighingFormPage,
  renderStandaloneWeighingSecondFormPage,
  renderStandaloneWeighingsListPage,
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
  renderScalePhotosPage,
  renderWeighbridgeHomePage,
};
