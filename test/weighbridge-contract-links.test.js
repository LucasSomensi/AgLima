const assert = require('node:assert/strict');
const test = require('node:test');
const {
  renderScaleOutputDetailPage,
  renderScaleOutputFormPage,
  renderScaleOutputGrossFormPage,
  renderScaleOutputsListPage,
  renderWeighbridgeHomePage,
} = require('../routes/renderers');
const {
  buildDeletionReasonPayload,
  buildScaleOutputPayload,
  buildScaleOutputGrossPayload,
} = require('../routes/weighbridge-service');
const { buildTicketLines } = require('../routes/weighbridge-ticket-pdf');

const outputWithContract = {
  id: 7,
  data_saida: '2026-06-11T12:30:00.000Z',
  placa_caminhao: 'ABC1D23',
  produto: 'milho',
  peso_bruto_kg: '22345.678',
  peso_tara_kg: '10000',
  peso_liquido_kg: '12345.678',
  contrato_id: 42,
  comprador_nome: 'Comprador Teste',
};

function renderPage(renderFn, params) {
  let html = '';

  renderFn({ send: (value) => { html = value; } }, params);

  return html;
}

test('weighbridge home links contract column content to contract detail page', () => {
  const html = renderPage(renderWeighbridgeHomePage, {
    outputs: [outputWithContract],
    message: '',
    error: '',
  });

  assert.match(
    html,
    /<td><a class="admin-table-link" href="\/balanca\/contratos\/42">Contrato #42 · Comprador Teste<\/a><\/td>/
  );
});

test('weighbridge outputs list links contract column content to contract detail page', () => {
  const html = renderPage(renderScaleOutputsListPage, {
    outputs: [outputWithContract],
  });

  assert.match(
    html,
    /<td><a class="admin-table-link" href="\/balanca\/contratos\/42">Contrato #42 · Comprador Teste<\/a><\/td>/
  );
});

test('weighbridge outputs list can return admins to administration', () => {
  const html = renderPage(renderScaleOutputsListPage, {
    outputs: [outputWithContract],
    navigation: {
      homeHref: '/admin',
      homeLabel: '← Voltar à administração',
    },
  });

  assert.match(html, /href="\/admin">← Voltar à administração<\/a>/);
  assert.doesNotMatch(html, /href="\/balanca">← Voltar à balança<\/a>/);
});

test('weighbridge outputs keep pending contract column as plain text', () => {
  const html = renderPage(renderScaleOutputsListPage, {
    outputs: [{ ...outputWithContract, contrato_id: null, comprador_nome: null }],
  });

  assert.match(html, /<td>Pendente<\/td>/);
  assert.doesNotMatch(html, /href="\/balanca\/contratos\/null"/);
});


test('weighbridge output tables include gross and tare columns with pending tare and association actions', () => {
  const html = renderPage(renderScaleOutputsListPage, {
    outputs: [{
      ...outputWithContract,
      contrato_id: null,
      comprador_nome: null,
      peso_bruto_kg: null,
      peso_liquido_kg: null,
    }],
  });

  assert.match(html, /<th>Bruto<\/th>/);
  assert.match(html, /<th>Tara<\/th>/);
  assert.match(html, /href="\/balanca\/saidas\/7\/bruto">Adicionar bruto/);
  assert.match(html, /href="\/balanca\/saidas\/7\/associar">Associar contrato/);
  assert.doesNotMatch(html, /Aguardando tara/);
});

test('output form collects tare before gross weight', () => {
  const html = renderPage(renderScaleOutputFormPage, {
    formValues: {},
    error: '',
  });

  assert.match(html, /name="peso_tara_kg"/);
  assert.doesNotMatch(html, /name="peso_bruto_kg"/);
});


test('output gross form collects gross timestamp and weight', () => {
  const html = renderPage(renderScaleOutputGrossFormPage, {
    output: { ...outputWithContract, peso_bruto_kg: null, peso_liquido_kg: null, peso_tara_kg: '12000' },
    formValues: { peso_bruto_adicionado_em: '2026-06-12T11:45', peso_bruto_kg: '30000' },
    error: '',
  });

  assert.match(html, /name="peso_bruto_adicionado_em"[^>]+type="datetime-local"[^>]+value="2026-06-12T11:45"/);
  assert.match(html, /name="peso_bruto_kg"[^>]+value="30000"/);
});

test('output payload creates output with tare and validates gross separately', () => {
  const outputPayload = buildScaleOutputPayload({
    data_saida: '2026-06-12T09:30',
    placa_caminhao: 'abc-1d23',
    produto: 'milho',
    peso_tara_kg: '12000',
  });
  const grossPayload = buildScaleOutputGrossPayload({
    peso_bruto_kg: '30000',
    peso_bruto_adicionado_em: '2026-06-12T11:45',
  });

  assert.equal(outputPayload.error, undefined);
  assert.equal(outputPayload.payload.placaCaminhao, 'ABC1D23');
  assert.equal(outputPayload.payload.pesoTaraKg, '12000');
  assert.equal(outputPayload.payload.pesoBrutoKg, undefined);
  assert.equal(grossPayload.payload.pesoBrutoKg, '30000');
  assert.ok(grossPayload.payload.pesoBrutoAdicionadoEm instanceof Date);
});

const { buildScaleInputsCsv, buildScaleOutputsCsv } = require('../routes/weighbridge-csv');

test('weighbridge outputs list includes CSV download action', () => {
  const html = renderPage(renderScaleOutputsListPage, {
    outputs: [outputWithContract],
  });

  assert.match(html, /href="\/balanca\/saidas\.csv">Baixar CSV<\/a>/);
});

test('scale outputs CSV exports rows in the provided chronological order and escapes fields', () => {
  const csv = buildScaleOutputsCsv([
    {
      ...outputWithContract,
      data_saida: '2026-06-10T08:00:00.000Z',
      comprador_nome: 'Comprador "Teste", LTDA',
    },
    {
      ...outputWithContract,
      id: 8,
      data_saida: '2026-06-11T08:00:00.000Z',
      placa_caminhao: 'DEF4G56',
      contrato_id: null,
      comprador_nome: null,
    },
  ]);

  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');

  assert.equal(rows[0], 'Data;Hora;Placa;Produto;Bruto kg;Tara kg;Liquido kg;Contrato;Comprador');
  assert.match(rows[1], /^10\/06\/2026;05:00:00;ABC1D23/);
  assert.match(rows[1], /;22\.345,678;10\.000;12\.345,678;Contrato #42;"Comprador ""Teste"", LTDA"$/);
  assert.match(rows[2], /^11\/06\/2026;05:00:00;DEF4G56/);
  assert.match(rows[2], /;Pendente;$/);
});


test('scale outputs CSV formats decimal weights from database with Brazilian separators', () => {
  const csv = buildScaleOutputsCsv([
    {
      ...outputWithContract,
      peso_bruto_kg: '30000.000',
      peso_tara_kg: '7654.321',
      peso_liquido_kg: '22345.678',
    },
  ]);

  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');

  assert.match(rows[1], /;30\.000;7\.654,321;22\.345,678;Contrato #42;Comprador Teste$/);
});

test('scale inputs CSV formats weights and percentage decimals from database', () => {
  const csv = buildScaleInputsCsv([
    {
      data_entrada: '2026-06-10T08:00:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_bruto_kg: '30000.000',
      peso_tara_kg: '7654.321',
      peso_liquido_kg: '22345.678',
      origem: 'Fazenda Teste',
      umidade_percent: '14.000',
      impureza_percent: '1.250',
      graos_avariados_percent: '0.125',
    },
  ]);

  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');

  assert.equal(rows[0], 'Data;Hora;Placa;Produto;Bruto kg;Tara kg;Liquido kg;Origem;Umidade %;Impureza %;Graos avariados %');
  assert.match(rows[1], /^10\/06\/2026;05:00:00;ABC1D23;milho;30\.000;7\.654,321;22\.345,678;Fazenda Teste;14;1,25;0,125$/);
});

test('weighbridge contracts list defaults weights to kg and includes sacks toggle', () => {
  const html = renderPage(require('../routes/renderers').renderScaleContractsListPage, {
    contracts: [{
      id: 42,
      data_contrato: '2026-06-10T00:00:00.000Z',
      comprador_nome: 'Comprador Teste',
      produto: 'milho',
      quantidade_kg: '60000',
      quantidade_embarcada_kg: '30000',
      saldo_kg: '30000',
    }],
  });

  assert.match(html, /data-weight-unit="kg" aria-pressed="true">kg/);
  assert.match(html, /data-weight-unit="sc" aria-pressed="false">sc/);
  assert.match(html, /data-weight-kg="60000">60\.000 kg/);
  assert.match(html, /data-weight-kg="30000">30\.000 kg/);
  assert.match(html, /weightKg \/ 60/);
});

test('weighbridge contracts list shows admin-only contract filter toggle', () => {
  const html = renderPage(require('../routes/renderers').renderScaleContractsListPage, {
    contracts: [],
    filter: 'abertos',
    canFilterContracts: true,
  });

  assert.match(html, /<h1 id="contracts-title" class="page-title">Contratos<\/h1>/);
  assert.match(html, /aria-label="Filtro de contratos"/);
  assert.match(html, /href="\/balanca\/contratos"[^>]*>Não embarcados<\/a>/);
  assert.match(html, /href="\/balanca\/contratos\?filtro=abertos" aria-current="page">Em aberto<\/a>/);
  assert.match(html, /href="\/balanca\/contratos\?filtro=ultimos-6-meses"[^>]*>Últimos 6 meses<\/a>/);
  assert.match(html, /href="\/balanca\/contratos\?filtro=todos"[^>]*>Todos<\/a>/);
});

test('weighbridge contracts list hides contract filter toggle for non-admin users', () => {
  const html = renderPage(require('../routes/renderers').renderScaleContractsListPage, {
    contracts: [],
    filter: 'todos',
    canFilterContracts: false,
  });

  assert.doesNotMatch(html, /aria-label="Filtro de contratos"/);
  assert.doesNotMatch(html, /filtro=todos/);
});

test('weighbridge contracts sacks toggle formats weights with at most one decimal place', () => {
  const html = renderPage(require('../routes/renderers').renderScaleContractsListPage, {
    contracts: [],
  });

  assert.match(html, /maximumFractionDigits: unit === 'sc' \? 1 : 3/);
});


test('output detail pre-fills split weight when associated contract has negative balance', () => {
  const html = renderPage(renderScaleOutputDetailPage, {
    outputInfo: {
      saida_id: 7,
      data_saida: '2026-06-11T12:30:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_tara_kg: '10000',
      peso_bruto_kg: '42000',
      peso_liquido_kg: '32000',
      contrato_id: 42,
      comprador_nome_completo: 'Comprador Teste',
      contrato_saldo_kg: '-12500',
    },
    error: '',
  });

  assert.match(html, /id="peso-liquido-primeira"[^>]+data-total-net="32000" value="19500" required/);
  assert.match(html, /updateSecondNetWeight\(\);/);
});

test('output detail requires a deletion reason before enabling delete', () => {
  const html = renderPage(renderScaleOutputDetailPage, {
    outputInfo: {
      saida_id: 7,
      data_saida: '2026-06-11T12:30:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_tara_kg: '10000',
      peso_bruto_kg: null,
      peso_liquido_kg: null,
      contrato_id: null,
    },
    error: '',
  });

  assert.match(html, /name="motivo_delecao"[^>]+minlength="20"/);
  assert.match(html, /class="btn-danger-action deletion-reason-submit" type="submit" disabled>Deletar saída/);
  assert.match(html, /src="\/js\/deletion-reason.js"/);
});

test('output detail enables ticket printing only after gross weight and contract association', () => {
  const completeHtml = renderPage(renderScaleOutputDetailPage, {
    outputInfo: {
      saida_id: 7,
      data_saida: '2026-06-11T12:30:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_tara_kg: '10000',
      peso_bruto_kg: '42000',
      peso_liquido_kg: '32000',
      contrato_id: 42,
      contrato_saldo_kg: '5000',
    },
    error: '',
  });
  const pendingGrossHtml = renderPage(renderScaleOutputDetailPage, {
    outputInfo: {
      saida_id: 7,
      data_saida: '2026-06-11T12:30:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_tara_kg: '10000',
      peso_bruto_kg: null,
      peso_liquido_kg: null,
      contrato_id: 42,
    },
    error: '',
  });
  const pendingContractHtml = renderPage(renderScaleOutputDetailPage, {
    outputInfo: {
      saida_id: 7,
      data_saida: '2026-06-11T12:30:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_tara_kg: '10000',
      peso_bruto_kg: '42000',
      peso_liquido_kg: '32000',
      contrato_id: null,
    },
    error: '',
  });

  assert.match(completeHtml, /href="\/balanca\/saidas\/7\/ticket\.pdf"[^>]*>Imprimir ticket/);
  assert.doesNotMatch(completeHtml, /type="button" disabled>Imprimir ticket/);
  assert.match(pendingGrossHtml, /<button class="btn-secondary-action" type="button" disabled>Imprimir ticket<\/button>/);
  assert.doesNotMatch(pendingGrossHtml, /href="\/balanca\/saidas\/7\/ticket\.pdf"/);
  assert.match(pendingContractHtml, /<button class="btn-secondary-action" type="button" disabled>Imprimir ticket<\/button>/);
  assert.doesNotMatch(pendingContractHtml, /href="\/balanca\/saidas\/7\/ticket\.pdf"/);
});

test('ticket lines render requested output weighing fields', () => {
  const lines = buildTicketLines({
    saida_id: 7,
    operador_login: 'operador-balanca',
    placa_caminhao: 'ABC1D23',
    produto: 'milho',
    vendedor_nome_completo: 'Vendedor Completo',
    comprador_nome_completo: 'Comprador Completo LTDA',
    data_saida: '2026-06-11T12:30:00.000Z',
    peso_bruto_adicionado_em: '2026-06-11T17:45:00.000Z',
    peso_tara_kg: '10000',
    peso_bruto_kg: '42000',
    peso_liquido_kg: '32000',
  });

  assert.deepEqual(lines.slice(0, 9), [
    '------------------------------',
    'Fazenda São José',
    ' ',
    'Ticket: 7',
    'Operador: operador-balanca',
    'Placa: ABC1D23',
    'Produto: Milho',
    'Vendedor: Vendedor Completo',
    'Comprador: Comprador Completo LTDA',
  ]);
  assert.deepEqual(lines.slice(9, 12), [' ', ' ', ' ']);
  assert.match(lines[12], /^Tara: 10000 kg /);
  assert.match(lines[13], /^Bruto: 42000 kg /);
  assert.equal(lines[14], 'PLiq: 32000 kg');
  assert.deepEqual(lines.slice(15, 18), [' ', ' ', ' ']);
  assert.equal(lines[18], 'Ass Vendedor: ____________________');
  assert.deepEqual(lines.slice(19, 21), [' ', ' ']);
  assert.equal(lines[21], 'Ass Comprador: ____________________');
});

test('deletion reason payload normalizes and validates minimum length', () => {
  const invalidPayload = buildDeletionReasonPayload({ motivo_delecao: 'curto' });
  const validPayload = buildDeletionReasonPayload({ motivo_delecao: '  Correção   operacional necessária  ' });

  assert.match(invalidPayload.error, /pelo menos 20 caracteres/);
  assert.deepEqual(validPayload.payload, {
    motivoDelecao: 'Correção operacional necessária',
  });
});

test('output detail does not pre-fill split weight without a negative contract balance', () => {
  const html = renderPage(renderScaleOutputDetailPage, {
    outputInfo: {
      saida_id: 7,
      data_saida: '2026-06-11T12:30:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_tara_kg: '10000',
      peso_bruto_kg: '42000',
      peso_liquido_kg: '32000',
      contrato_id: 42,
      comprador_nome_completo: 'Comprador Teste',
      contrato_saldo_kg: '5000',
    },
    error: '',
  });

  assert.doesNotMatch(html, /id="peso-liquido-primeira"[^>]+ value="/);
});

test('output invoice renders NF fields in requested order with calculated ton values', () => {
  const { renderScaleOutputInvoicePage } = require('../routes/renderers');
  const html = renderPage(renderScaleOutputInvoicePage, {
    outputInfo: {
      saida_id: 7,
      data_saida: '2026-06-11T12:30:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_liquido_kg: '12345.678',
      contrato_id: 42,
      vendedor_nome_completo: 'Vendedor Completo',
      inscricao_estadual_vendedor: '1234567890',
      comprador_cpf_cnpj: '12345678901234',
      comprador_inscricao_estadual: '9876543210',
      comprador_nome_completo: 'Comprador Completo LTDA',
      comprador_cep: '85.800-000',
      comprador_endereco: 'Rua do Comprador',
      comprador_numero: '100',
      natureza_operacao: 'Venda de produção do estabelecimento',
      informacoes_interesse_contribuinte: 'Informação complementar',
      cfop: '5101',
      preco_por_kg: '2.0083333333',
      preco_por_ton: '2008.3333333333',
      cnpj_transportadora: '00.000.000/0001-00',
      inscricao_estadual_transportadora: 'ISENTO',
      razao_social_transportadora: 'Transportadora Exemplo LTDA',
      uf_transportadora: 'PR',
      email: 'nf@example.com',
      observacoes: 'Observação do contrato',
    },
    message: '',
    error: '',
  });

  const labels = [
    'Nome completo do vendedor',
    'Inscrição estadual do vendedor',
    'CPF/CNPJ do comprador',
    'Inscrição estadual do comprador',
    'Nome completo do comprador',
    'CEP do comprador',
    'Endereço do comprador',
    'Número do comprador',
    'Natureza da operação',
    'Informações adicionais de interesse do contribuinte',
    'Produto',
    'CFOP',
    'Peso Líquido em kg',
    'Peso Líquido em ton',
    'Preço por kg',
    'Preço por ton',
    'CNPJ da transportadora',
    'Inscrição Estadual da transportadora',
    'Razão Social da transportadora',
    'UF da transportadora',
    'Placa',
    'Nome da NF',
    'E-mail',
    'Observações do contrato',
  ];
  const detailHtml = html.slice(html.indexOf('<h2>Dados da Nota Fiscal</h2>'));
  const positions = labels.map((label) => detailHtml.indexOf(`<dt>${label}</dt>`));

  assert.deepEqual(positions.every((position) => position !== -1), true);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(html, /<dt>Nome completo do comprador<\/dt><dd><span class="copy-field-value">Comprador Completo LTDA<\/span>/);
  assert.match(html, /<dt>Peso Líquido em ton<\/dt><dd><span class="copy-field-value">12,345678<\/span>/);
  assert.match(html, /<dt>Preço por kg<\/dt><dd><span class="copy-field-value">2,0083333333<\/span>/);
  assert.match(html, /<dt>Preço por ton<\/dt><dd><span class="copy-field-value">2008,3333333333<\/span>/);
  assert.match(html, /<dt>Nome da NF<\/dt><dd><span class="copy-field-value">2026-06-11 ABC1D23 MILHO 7<\/span>/);
  assert.match(html, /<dt>E-mail<\/dt><dd><span class="copy-field-value">nf@example\.com<\/span>/);
});

test('output invoice uses default NF values when optional contract fields are null', () => {
  const { renderScaleOutputInvoicePage } = require('../routes/renderers');
  const html = renderPage(renderScaleOutputInvoicePage, {
    outputInfo: {
      saida_id: 7,
      data_saida: '2026-06-11T12:30:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'milho',
      peso_liquido_kg: '12345.678',
      contrato_id: 42,
      vendedor_nome_completo: 'Vendedor Completo',
      inscricao_estadual_vendedor: '1234567890',
      comprador_cpf_cnpj: '12345678901234',
      comprador_inscricao_estadual: '9876543210',
      comprador_nome_completo: 'Comprador Completo LTDA',
      comprador_cep: '85800000',
      comprador_endereco: 'Rua do Comprador',
      comprador_numero: '100',
      natureza_operacao: null,
      informacoes_interesse_contribuinte: 'Informação complementar',
      cfop: null,
      preco_por_kg: '2.0083333333',
      preco_por_ton: '2008.3333333333',
      cnpj_transportadora: '00.000.000/0001-00',
      inscricao_estadual_transportadora: 'ISENTO',
      razao_social_transportadora: 'Transportadora Exemplo LTDA',
      uf_transportadora: 'PR',
      email: 'nf@example.com',
      observacoes: 'Observação do contrato',
    },
    message: '',
    error: '',
  });

  assert.match(html, /<dt>Natureza da operação<\/dt><dd><span class="copy-field-value">Venda<\/span>/);
  assert.match(html, /<dt>CFOP<\/dt><dd><span class="copy-field-value">5101<\/span>/);
});
