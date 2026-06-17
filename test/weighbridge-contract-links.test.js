const assert = require('node:assert/strict');
const test = require('node:test');
const {
  renderScaleOutputFormPage,
  renderScaleOutputsListPage,
  renderWeighbridgeHomePage,
} = require('../routes/renderers');
const {
  buildScaleOutputPayload,
  buildScaleOutputGrossPayload,
} = require('../routes/weighbridge-service');

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

test('output payload creates output with tare and validates gross separately', () => {
  const outputPayload = buildScaleOutputPayload({
    data_saida: '2026-06-12T09:30',
    placa_caminhao: 'abc-1d23',
    produto: 'milho',
    peso_tara_kg: '12000',
  });
  const grossPayload = buildScaleOutputGrossPayload({ peso_bruto_kg: '30000' });

  assert.equal(outputPayload.error, undefined);
  assert.equal(outputPayload.payload.placaCaminhao, 'ABC1D23');
  assert.equal(outputPayload.payload.pesoTaraKg, '12000');
  assert.equal(outputPayload.payload.pesoBrutoKg, undefined);
  assert.deepEqual(grossPayload.payload, { pesoBrutoKg: '30000' });
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

test('weighbridge contracts sacks toggle formats weights with at most one decimal place', () => {
  const html = renderPage(require('../routes/renderers').renderScaleContractsListPage, {
    contracts: [],
  });

  assert.match(html, /maximumFractionDigits: unit === 'sc' \? 1 : 3/);
});
