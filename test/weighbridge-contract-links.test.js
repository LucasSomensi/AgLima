const assert = require('node:assert/strict');
const test = require('node:test');
const {
  renderScaleOutputDetailPage,
  renderScaleOutputsListPage,
  renderScaleContractDetailPage,
} = require('../routes/renderers');
const {
  buildDeletionReasonPayload,
  buildScaleOutputPayload,
  buildScaleOutputEditPayload,
  buildScaleOutputGrossPayload,
} = require('../routes/weighbridge-service');
const { buildScaleOutputTicket } = require('../routes/weighbridge-ticket-pdf');

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

test('contract detail shows only requested summary fields with weights in kg and sacks', () => {
  const html = renderPage(renderScaleContractDetailPage, {
    contract: {
      contrato_id: 42,
      data_contrato: '2026-06-11',
      produto: 'milho',
      quantidade_kg: '12000',
      quantidade_embarcada_kg: '3000',
      saldo_kg: '9000',
      vendedor_nome_completo: 'Vendedor Teste',
      comprador_nome_completo: 'Comprador Teste',
      preco_por_saca: '75.50',
    },
    outputs: [outputWithContract, { ...outputWithContract, id: 8 }],
  });

  const cell = (label) => new RegExp(`<span class="wb-copy-label">${label}</span><span class="wb-copy-value">([^<]*)</span>`);
  assert.equal(html.match(cell('Quantidade'))[1], '12.000 kg · 200 sc');
  assert.equal(html.match(cell('Embarcado'))[1], '3.000 kg · 50 sc');
  assert.equal(html.match(cell('Saldo'))[1], '9.000 kg · 150 sc');
  assert.match(html.match(cell('Preço por saca'))[1], /R\$\s75,50/);
  assert.doesNotMatch(html, /CPF\/CNPJ|Preço\/kg|Obs\. do contrato/);
  assert.match(html, /<h2 id="contract-outputs-title">Saídas associadas <span class="wb-count">2<\/span><\/h2>/);
});

test('weighbridge outputs keep pending contract column as plain text', () => {
  const html = renderPage(renderScaleOutputsListPage, {
    outputs: [{ ...outputWithContract, contrato_id: null, comprador_nome: null }],
  });

  assert.match(html, /href="\/balanca\/saidas\/7\/associar"[^>]*aria-label="Associar contrato"/);
  assert.doesNotMatch(html, /href="\/balanca\/contratos\/null"/);
  assert.doesNotMatch(html, /saidas\/7\/(nf|ticket\.pdf)/);
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

  assert.match(html, /<th class="num">Bruto <small>kg<\/small><\/th>/);
  assert.match(html, /<th class="num">Tara <small>kg<\/small><\/th>/);
  assert.match(html, /href="\/balanca\/saidas\/7\/bruto"[^>]*aria-label="Adicionar bruto"/);
  assert.match(html, /href="\/balanca\/saidas\/7\/associar"[^>]*aria-label="Associar contrato"/);
  assert.doesNotMatch(html, /Aguardando tara/);
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

test('scale outputs CSV exports rows in the provided chronological order and escapes fields', () => {
  const csv = buildScaleOutputsCsv([
    {
      ...outputWithContract,
      data_saida: '2026-06-10T08:00:00.000Z',
      nome_motorista: 'João da Silva',
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

  assert.equal(rows[0], 'Data;Hora;Placa;Motorista;Produto;Bruto kg;Tara kg;Liquido kg;Contrato;Comprador');
  assert.match(rows[1], /^10\/06\/2026;05:00:00;ABC1D23;João da Silva;/);
  assert.match(rows[1], /;22\.345,678;10\.000;12\.345,678;Contrato #42;"Comprador ""Teste"", LTDA"$/);
  assert.match(rows[2], /^11\/06\/2026;05:00:00;DEF4G56;;/);
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

test('weighbridge contracts list shows admin-only contract filter toggle', () => {
  const html = renderPage(require('../routes/renderers').renderScaleContractsListPage, {
    contracts: [],
    filter: 'abertos',
    canFilterContracts: true,
  });

  assert.match(html, /<h1>Contratos<\/h1>/);
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

  assert.match(completeHtml, /href="\/balanca\/saidas\/7\/ticket\.pdf"[^>]*aria-label="Imprimir ticket"/);
  assert.match(completeHtml, /href="\/balanca\/saidas\/7\/nf"/);
  assert.doesNotMatch(completeHtml, /disabled[^>]*aria-label="Imprimir ticket"/);
  assert.match(pendingGrossHtml, /disabled title="Imprimir ticket \(falta o bruto\)"/);
  assert.match(pendingGrossHtml, /href="\/balanca\/saidas\/7\/bruto"[^>]*aria-label="Adicionar bruto"/);
  assert.doesNotMatch(pendingGrossHtml, /href="\/balanca\/saidas\/7\/ticket\.pdf"/);
  assert.match(pendingContractHtml, /disabled title="Imprimir ticket \(falta o contrato\)"/);
  assert.match(pendingContractHtml, /href="\/balanca\/saidas\/7\/associar"[^>]*aria-label="Associar contrato"/);
  assert.doesNotMatch(pendingContractHtml, /href="\/balanca\/saidas\/7\/ticket\.pdf"/);
});

test('output ticket shows the requested weighing fields', () => {
  const ticket = buildScaleOutputTicket({
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

  assert.equal(ticket.title, 'Ticket de saída');
  assert.equal(ticket.number, '7');
  assert.deepEqual(ticket.fields, [
    ['Operador', 'operador-balanca'],
    ['Placa', 'ABC1D23'],
    ['Produto', 'Milho'],
    ['Vendedor', 'Vendedor Completo'],
    ['Comprador', 'Comprador Completo LTDA'],
  ]);
  assert.deepEqual(ticket.weights.map(({ label, photoType, kg, at }) => [label, photoType, kg, at]), [
    ['Tara', 'tara', '10000', '2026-06-11T12:30:00.000Z'],
    ['Bruto', 'bruto', '42000', '2026-06-11T17:45:00.000Z'],
  ]);
  assert.equal(ticket.netKg, '32000');
  assert.deepEqual(ticket.signatures, ['Vendedor', 'Comprador']);
});

test('output ticket shows the driver name after the plate when available', () => {
  const ticket = buildScaleOutputTicket({
    saida_id: 7,
    operador_login: 'operador-balanca',
    placa_caminhao: 'ABC1D23',
    nome_motorista: 'João da Silva',
    produto: 'milho',
    vendedor_nome_completo: 'Vendedor Completo',
    comprador_nome_completo: 'Comprador Completo LTDA',
    peso_tara_kg: '10000',
    peso_bruto_kg: '42000',
    peso_liquido_kg: '32000',
  });

  assert.deepEqual(ticket.fields.slice(1, 4), [['Placa', 'ABC1D23'], ['Motorista', 'João da Silva'], ['Produto', 'Milho']]);
});

test('output ticket PDF renders with a long driver name', async () => {
  const { buildScaleOutputTicketPdf } = require('../routes/weighbridge-ticket-pdf');
  const pdf = await buildScaleOutputTicketPdf({
    saida_id: 7,
    placa_caminhao: 'ABC1D23',
    nome_motorista: 'Motorista Com Um Nome Bem Comprido Para Testar Quebra De Linha No Ticket',
    produto: 'soja',
    peso_tara_kg: '10000',
    peso_bruto_kg: '42000',
    peso_liquido_kg: '32000',
  });

  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
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
    'Vendedor',
    'IE vendedor',
    'CPF/CNPJ comprador',
    'IE comprador',
    'Comprador',
    'CEP',
    'Endereço',
    'Número',
    'Natureza da operação',
    'Inf. adicionais',
    'Produto',
    'CFOP',
    'Líquido kg',
    'Líquido t',
    'Preço/kg',
    'Preço/t',
    'CNPJ transportadora',
    'IE transportadora',
    'Transportadora',
    'UF transportadora',
    'Placa',
    'Nome da NF',
    'E-mail',
    'Obs. do contrato',
  ];
  const detailHtml = html.slice(html.indexOf('aria-label="Dados da nota fiscal"'));
  const positions = labels.map((label) => detailHtml.indexOf(`<span class="wb-copy-label">${label}</span>`));
  const copyValue = (label) => detailHtml.match(new RegExp(`data-copy="([^"]*)" aria-label="Copiar ${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`))[1];

  assert.deepEqual(positions.every((position) => position !== -1), true);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.equal(copyValue('Comprador'), 'Comprador Completo LTDA');
  assert.equal(copyValue('Líquido t'), '12,345678');
  assert.equal(copyValue('Preço/kg'), '2,0083333333');
  assert.equal(copyValue('Preço/t'), '2008,3333333333');
  assert.equal(copyValue('Nome da NF'), '2026-06-11 ABC1D23 MILHO 7');
  assert.equal(copyValue('E-mail'), 'nf@example.com');
  assert.match(html, /href="\/balanca\/saidas\/7\/ticket\.pdf"|title="Imprimir ticket/);
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

  assert.match(html, /data-copy="Venda" aria-label="Copiar Natureza da operação"/);
  assert.match(html, /data-copy="5101" aria-label="Copiar CFOP"/);
});

test('output edit payload accepts optional gross and validates tare relationship', () => {
  const completePayload = buildScaleOutputEditPayload({
    data_saida: '2026-06-11T12:30',
    placa_caminhao: 'abc-1d23',
    produto: 'milho',
    peso_tara_kg: '10000',
    peso_bruto_kg: '22345.678',
  });

  assert.equal(completePayload.error, undefined);
  assert.equal(completePayload.payload.placaCaminhao, 'ABC1D23');
  assert.equal(completePayload.payload.pesoBrutoKg, '22345.678');

  const blankGrossPayload = buildScaleOutputEditPayload({
    data_saida: '2026-06-11T12:30',
    placa_caminhao: 'ABC1D23',
    produto: 'soja',
    peso_tara_kg: '10000',
    peso_bruto_kg: '',
  });

  assert.equal(blankGrossPayload.error, undefined);
  assert.equal(blankGrossPayload.payload.pesoBrutoKg, null);

  const invalidGrossPayload = buildScaleOutputEditPayload({
    data_saida: '2026-06-11T12:30',
    placa_caminhao: 'ABC1D23',
    produto: 'milho',
    peso_tara_kg: '10000',
    peso_bruto_kg: '9999',
  });

  assert.equal(invalidGrossPayload.error, 'O peso bruto precisa ser maior que o peso tara.');
});
