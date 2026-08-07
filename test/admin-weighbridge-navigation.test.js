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

test('admin home uses configured forecast curve before the first moisture reading', () => {
  const html = renderPage(renderAdminHomePage, {
    notifications: [],
    contractsSummary: {},
    dryerBatch: {
      started_at: '2099-07-10T12:00:00.000Z',
      target_moisture: '14',
      umidade_inicial: '20',
    },
    dryerReadings: [],
    dryerSettings: {
      target_moisture: '14',
      discharge_forecast_quadratic_coefficient: 0,
      discharge_forecast_linear_coefficient: 10,
      discharge_forecast_initial_moisture_quadratic_coefficient: 0,
      discharge_forecast_initial_moisture_linear_coefficient: 0,
      discharge_forecast_constant_coefficient: -100,
    },
    storageSummary: [],
    scaleInputs: [],
    scaleOutputs: [],
    message: '',
    error: '',
  });

  assert.match(html, /<span>Previsão da próxima descarga<\/span>\s*<strong>10\/07\/2099, 10:40<\/strong>/);
});

const { renderAdminBatchesPage } = require('../routes/renderers');
const { buildDryerMoistureReadingsCsv } = require('../routes/dryer-csv');

test('admin batches page includes completed moisture readings CSV download action', () => {
  const html = renderPage(renderAdminBatchesPage, { batches: [] });

  assert.match(html, /href="\/admin\/bateladas\/umidades\.csv">Baixar CSV de umidades<\/a>/);
});

test('dryer moisture readings CSV uses batch id, decimal hours since batch start, and average moisture', () => {
  const csv = buildDryerMoistureReadingsCsv([
    {
      batch_id: 7,
      batch_started_at: '2026-07-12T10:00:00.000Z',
      measured_at: '2026-07-12T10:15:00.000Z',
      batch_initial_moisture: '22.75',
      moisture_percent: '18.5',
      average_moisture: '21.375',
    },
    {
      batch_id: 8,
      batch_started_at: '2026-07-12T11:00:00.000Z',
      measured_at: '2026-07-12T13:30:00.000Z',
      batch_initial_moisture: '20',
      moisture_percent: '17.125',
      average_moisture: '18.25',
    },
  ]);

  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');

  assert.equal(rows[0], 'batelada;hora;umidade_media');
  assert.equal(rows[1], '7;0;22,75');
  assert.equal(rows[2], '7;0,25;21,375');
  assert.equal(rows[3], '8;0;20');
  assert.equal(rows[4], '8;2,5;18,25');
});

test('admin batches page renders active batch with requested timeline columns', () => {
  const html = renderPage(renderAdminBatchesPage, {
    now: new Date('2026-07-15T15:30:00.000Z'),
    batches: [
      {
        id: 12,
        status: 'active',
        started_at: '2026-07-15T13:00:00.000Z',
        discharge_started_at: '2026-07-15T14:15:00.000Z',
        completed_at: null,
        target_moisture: '14.0',
        umidade_inicial: '27.5',
        final_moisture: null,
      },
    ],
  });

  assert.match(html, /<th>Status<\/th>\s*<th>Umidade inicial<\/th>\s*<th>Início<\/th>\s*<th>Descarga<\/th>\s*<th>Conclusão<\/th>\s*<th>Duração secagem<\/th>\s*<th>Duração descarga<\/th>\s*<th>Duração total<\/th>\s*<th>Umidade final<\/th>\s*<th>Umidade alvo<\/th>/);
  assert.match(html, /<td>Descarregando<\/td>\s*<td>27,5%<\/td>\s*<td><a class="admin-table-link" href="\/admin\/bateladas\/12">15\/07\/2026, 10:00<\/a><\/td>\s*<td>15\/07\/2026, 11:15<\/td>\s*<td>-<\/td>\s*<td>1h 15min<\/td>\s*<td>1h 15min<\/td>\s*<td>2h 30min<\/td>\s*<td>-<\/td>\s*<td>14,0%<\/td>/);
});

test('admin dryer dashboard links to dedicated dryer configuration page', () => {
  const { renderAdminDashboardPage } = require('../routes/renderers');
  const html = renderPage(renderAdminDashboardPage, {
    batch: null,
    readings: [],
    settings: { target_moisture: 14 },
    message: '',
    error: '',
  });

  assert.match(html, /href="\/admin\/secador\/config">Alterar configurações do secador<\/a>/);
  assert.doesNotMatch(html, /<form class="dryer-moisture-form admin-target-form"/);
  assert.doesNotMatch(html, /Previsão por umidade/);
});

test('admin dryer dashboard uses configured forecast curve before the first moisture reading', () => {
  const { renderAdminDashboardPage } = require('../routes/renderers');
  const html = renderPage(renderAdminDashboardPage, {
    batch: {
      started_at: '2099-07-10T12:00:00.000Z',
      target_moisture: '14',
      umidade_inicial: '20',
      grain_type: 'milho',
    },
    readings: [],
    settings: {
      target_moisture: '14',
      discharge_forecast_quadratic_coefficient: 0,
      discharge_forecast_linear_coefficient: 10,
      discharge_forecast_initial_moisture_quadratic_coefficient: 0,
      discharge_forecast_initial_moisture_linear_coefficient: 0,
      discharge_forecast_constant_coefficient: -100,
    },
    message: '',
    error: '',
  });

  assert.match(html, /Descarga<\/span>\s*<strong>Prevista para 10\/07\/2099, 10:40<\/strong>/);
});

test('admin dryer config page shows forecast preview table for configured moisture examples', () => {
  const { renderAdminDryerConfigPage } = require('../routes/renderers');
  const html = renderPage(renderAdminDryerConfigPage, {
    settings: {
      target_moisture: 14,
      discharge_forecast_quadratic_coefficient: 0,
      discharge_forecast_linear_coefficient: 10,
      discharge_forecast_initial_moisture_quadratic_coefficient: 0,
      discharge_forecast_initial_moisture_linear_coefficient: 0,
      discharge_forecast_constant_coefficient: -100,
    },
    message: '',
    error: '',
  });

  assert.match(html, /action="\/admin\/umidade-alvo"/);
  assert.match(html, /Previsão por umidade/);
  assert.match(html, /Previsão \(inicial 28%\)/);
  assert.match(html, /Previsão \(inicial 20%\)/);
  assert.match(html, /name="discharge_forecast_initial_moisture_quadratic_coefficient"/);
  assert.match(html, /name="discharge_forecast_initial_moisture_linear_coefficient"/);
  assert.match(html, /<td>16,0%<\/td>\s*<td>1h 0m<\/td>\s*<td>1h 0m<\/td>/);
  assert.match(html, /<td>30,0%<\/td>\s*<td>3h 20m<\/td>\s*<td>3h 20m<\/td>/);
});
