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
