const assert = require('node:assert/strict');
const test = require('node:test');
const { renderAdminHomePage } = require('../routes/renderers');

function renderPage(renderFn, params) {
  let html = '';

  renderFn({ send: (value) => { html = value; } }, params);

  return html;
}

test('admin home links full weighbridge lists directly to weighbridge routes', () => {
  const html = renderPage(renderAdminHomePage, {
    notifications: [],
    contractsSummary: {},
    dryerBatch: null,
    storageSummary: [],
    scaleInputs: [],
    scaleOutputs: [],
    message: '',
    error: '',
  });

  assert.match(html, /href="\/balanca\/entradas">Ver lista completa/);
  assert.match(html, /href="\/balanca\/saidas">Ver lista completa/);
  assert.doesNotMatch(html, /\/admin\/entradas-e-saidas/);
});


test('admin home combines next receipt date and contract link in one metric', () => {
  const html = renderPage(renderAdminHomePage, {
    notifications: [],
    contractsSummary: {
      proximo_recebimento_data: '2026-07-15',
      proximo_recebimento_contrato_id: 42,
      proximo_recebimento_comprador: 'Comprador <Teste>',
    },
    dryerBatch: null,
    storageSummary: [],
    scaleInputs: [],
    scaleOutputs: [],
    message: '',
    error: '',
  });

  assert.match(html, /<span>Próximo recebimento<\/span>/);
  assert.match(html, /15\/07\/2026 · <a class="admin-table-link" href="\/balanca\/contratos\/42">Contrato #42<\/a> · Comprador &lt;Teste&gt;/);
  assert.doesNotMatch(html, /Próximo contrato a receber/);
});


test('admin home shows initial forecast before the first moisture reading', () => {
  const html = renderPage(renderAdminHomePage, {
    notifications: [],
    contractsSummary: {},
    dryerBatch: {
      started_at: new Date('2026-06-21T13:00:00.000Z'),
      target_moisture: 14.5,
      umidade_inicial: 28,
    },
    dryerReadings: [],
    storageSummary: [],
    scaleInputs: [],
    scaleOutputs: [],
    message: '',
    error: '',
  });

  assert.match(html, /<span>Previsão da próxima descarga<\/span>/);
  assert.match(html, /<span>Previsão da próxima descarga<\/span>\s*<strong>Descarga imediata<\/strong>/);
});

const { renderAdminBatchesPage } = require('../routes/renderers');
const { buildDryerMoistureReadingsCsv } = require('../routes/dryer-csv');

test('admin batches page includes completed moisture readings CSV download action', () => {
  const html = renderPage(renderAdminBatchesPage, { batches: [] });

  assert.match(html, /href="\/admin\/bateladas\/umidades\.csv">Baixar CSV de umidades<\/a>/);
});

test('dryer moisture readings CSV uses batch id and decimal hours since batch start', () => {
  const csv = buildDryerMoistureReadingsCsv([
    {
      batch_id: 7,
      batch_started_at: '2026-07-12T10:00:00.000Z',
      measured_at: '2026-07-12T10:15:00.000Z',
      moisture_percent: '18.5',
    },
    {
      batch_id: 8,
      batch_started_at: '2026-07-12T11:00:00.000Z',
      measured_at: '2026-07-12T13:30:00.000Z',
      moisture_percent: '17.125',
    },
  ]);

  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');

  assert.equal(rows[0], 'batelada;hora;umidade');
  assert.equal(rows[1], '7;0,25;18,5');
  assert.equal(rows[2], '8;2,5;17,125');
});
