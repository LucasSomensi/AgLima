const assert = require('node:assert/strict');
const test = require('node:test');
const { renderDryerPanelPage } = require('../routes/renderers');

function renderPage(params) {
  let html = '';

  renderDryerPanelPage({ send: (value) => { html = value; } }, params);

  return html;
}

test('dryer panel renders the last completed batch summary in the status grid', () => {
  const html = renderPage({
    batch: null,
    readings: [],
    settings: { target_moisture: '14.5' },
    message: '',
    error: '',
    unclassifiedInputs: [],
    lastCompletedBatch: {
      id: 7,
      started_at: '2026-06-12T10:00:00.000Z',
      discharge_started_at: '2026-06-12T13:30:00.000Z',
      completed_at: '2026-06-12T15:05:00.000Z',
      umidade_inicial: '27.54',
      discharge_average_moisture: '13.46',
    },
  });

  assert.match(html, /Última batelada/);
  assert.match(
    html,
    /Umidade inicial<\/dt>\s*<dd>27,5%<\/dd>[\s\S]*Início<\/dt>\s*<dd>12\/06\/2026, 07:00<\/dd>[\s\S]*Início descarga<\/dt>\s*<dd>12\/06\/2026, 10:30<\/dd>[\s\S]*Fim descarga<\/dt>\s*<dd>12\/06\/2026, 12:05<\/dd>[\s\S]*Duração<\/dt>\s*<dd>5h 5min<\/dd>[\s\S]*Tempo secando<\/dt>\s*<dd>3h 30min<\/dd>[\s\S]*Tempo descarga<\/dt>\s*<dd>1h 35min<\/dd>[\s\S]*Umidade final<\/dt>\s*<dd>13,5%<\/dd>/
  );
});


test('dryer panel includes link to previous completed batches', () => {
  const html = renderPage({
    batch: null,
    readings: [],
    settings: { target_moisture: '14.5' },
    message: '',
    error: '',
    unclassifiedInputs: [],
    lastCompletedBatch: {
      id: 7,
      started_at: '2026-06-12T10:00:00.000Z',
      discharge_started_at: '2026-06-12T13:30:00.000Z',
      completed_at: '2026-06-12T15:05:00.000Z',
      umidade_inicial: '27.54',
      discharge_average_moisture: '13.46',
    },
  });

  assert.match(html, /href="\/secador\/bateladas\/anteriores">Ver anteriores<\/a>/);
});

test('dryer completed batch history renders batches from newest to oldest with the same summary fields', () => {
  const { renderCompletedBatchHistoryPage } = require('../routes/renderers');
  let html = '';

  renderCompletedBatchHistoryPage({ send: (value) => { html = value; } }, {
    completedBatches: [
      {
        id: 8,
        n: 42,
        started_at: '2026-06-13T10:00:00.000Z',
        discharge_started_at: '2026-06-13T12:00:00.000Z',
        completed_at: '2026-06-13T13:15:00.000Z',
        umidade_inicial: '28.1',
        discharge_average_moisture: '13.2',
      },
      {
        id: 7,
        n: 41,
        started_at: '2026-06-12T10:00:00.000Z',
        discharge_started_at: '2026-06-12T13:30:00.000Z',
        completed_at: '2026-06-12T15:05:00.000Z',
        umidade_inicial: '27.54',
        discharge_average_moisture: '13.46',
      },
    ],
  });

  assert.match(html, /Últimas 10 bateladas concluídas, da mais recente para a mais antiga\./);
  assert.match(html, /Batelada 42[\s\S]*13\/06\/2026, 07:00[\s\S]*Tempo secando<\/dt>\s*<dd>2h<\/dd>[\s\S]*Tempo descarga<\/dt>\s*<dd>1h 15min<\/dd>[\s\S]*Batelada 41[\s\S]*12\/06\/2026, 07:00/);
});

test('dryer panel omits the last batch summary when there is no completed batch', () => {
  const html = renderPage({
    batch: null,
    readings: [],
    settings: { target_moisture: '14.5' },
    message: '',
    error: '',
    unclassifiedInputs: [],
  });

  assert.doesNotMatch(html, /Última batelada/);
});

test('dryer panel opens the silo confirmation step before starting discharge', () => {
  const html = renderPage({
    batch: {
      id: 9,
      status: 'active',
      started_at: '2026-08-19T10:00:00.000Z',
      discharge_started_at: null,
      umidade_inicial: '28',
      target_moisture: '14.5',
    },
    readings: [],
    settings: { target_moisture: '14.5' },
    message: '',
    error: '',
  });

  assert.match(html, /action="\/secador\/bateladas\/descarga\/confirmar" method="get"/);
  assert.doesNotMatch(html, /Registrar início da descarga para os silos/);
});

test('discharge confirmation prioritizes confirm, choose another silo, and cancel', () => {
  const { renderDryerDischargeConfirmationPage } = require('../routes/renderers');
  let html = '';

  renderDryerDischargeConfirmationPage({ send: (value) => { html = value; } }, { lastSiloNumber: 3 });

  assert.match(html, /Deseja iniciar a descarga para o silo 3\?/);
  assert.match(html, /name="discharge_silo_number" value="3"/);
  assert.match(html, /Confirmar silo 3[\s\S]*Escolher outro silo[\s\S]*Cancelar/);
});

test('discharge confirmation requires a silo choice when there is no history', () => {
  const { renderDryerDischargeConfirmationPage } = require('../routes/renderers');
  let html = '';

  renderDryerDischargeConfirmationPage({ send: (value) => { html = value; } }, {});

  assert.match(html, /Escolha o silo para iniciar a descarga\./);
  assert.match(html, /Silo 1[\s\S]*Silo 2[\s\S]*Silo 3[\s\S]*Silo 4/);
  assert.match(html, /name="discharge_silo_number" value=""/);
});

test('discharge confirmation renders the configured number of silos', () => {
  const { renderDryerDischargeConfirmationPage } = require('../routes/renderers');
  let html = '';

  renderDryerDischargeConfirmationPage({ send: (value) => { html = value; } }, {
    lastSiloNumber: 6,
    dischargeSiloCount: 6,
  });

  assert.match(html, /Deseja iniciar a descarga para o silo 6\?/);
  assert.match(html, /Silo 4[\s\S]*Silo 5[\s\S]*Silo 6/);
  assert.doesNotMatch(html, /data-silo-number="7"/);
});

test('discharge confirmation ignores a previous silo outside the current configuration', () => {
  const { renderDryerDischargeConfirmationPage } = require('../routes/renderers');
  let html = '';

  renderDryerDischargeConfirmationPage({ send: (value) => { html = value; } }, {
    lastSiloNumber: 6,
    dischargeSiloCount: 4,
  });

  assert.match(html, /Escolha o silo para iniciar a descarga\./);
  assert.match(html, /data-silo-chooser >/);
  assert.doesNotMatch(html, /Confirmar silo 6/);
});

test('admin batch detail renders the saved batch summary in one dryer-style card', () => {
  const { renderAdminBatchDetailPage } = require('../routes/renderers');
  let html = '';

  renderAdminBatchDetailPage({ send: (value) => { html = value; } }, {
    batch: {
      id: 7,
      n: 41,
      grain_type: 'corn',
      status: 'completed',
      started_at: '2026-06-12T10:00:00.000Z',
      discharge_started_at: '2026-06-12T13:30:00.000Z',
      completed_at: '2026-06-12T15:05:00.000Z',
      target_moisture: '14.5',
      umidade_inicial: '27.54',
    },
    readings: [
      {
        id: 1,
        measured_at: '2026-06-12T12:00:00.000Z',
        moisture_percent: '20',
        measured_by_login: 'operador',
        created_at: '2026-06-12T12:00:00.000Z',
      },
      {
        id: 2,
        measured_at: '2026-06-12T14:00:00.000Z',
        moisture_percent: '13.46',
        measured_by_login: 'operador',
        created_at: '2026-06-12T14:00:00.000Z',
      },
    ],
  });

  assert.match(html, /Resumo da batelada/);
  assert.match(html, /Número<\/dt>\s*<dd>41<\/dd>/);
  assert.match(
    html,
    /Status<\/dt>\s*<dd>Concluída<\/dd>[\s\S]*Produto<\/dt>\s*<dd>Milho<\/dd>[\s\S]*Início<\/dt>\s*<dd>12\/06\/2026, 07:00<\/dd>[\s\S]*Início descarga<\/dt>\s*<dd>12\/06\/2026, 10:30<\/dd>[\s\S]*Fim descarga<\/dt>\s*<dd>12\/06\/2026, 12:05<\/dd>[\s\S]*Duração<\/dt>\s*<dd>5h 5min<\/dd>[\s\S]*Tempo secando<\/dt>\s*<dd>3h 30min<\/dd>[\s\S]*Tempo descarga<\/dt>\s*<dd>1h 35min<\/dd>[\s\S]*Umidade inicial<\/dt>\s*<dd>27,5%<\/dd>[\s\S]*Umidade final<\/dt>\s*<dd>13,7%<\/dd>[\s\S]*Umidade alvo<\/dt>\s*<dd>14,5%<\/dd>/
  );
});

test('admin batch detail prefers the persisted final moisture when available', () => {
  const { renderAdminBatchDetailPage } = require('../routes/renderers');
  let html = '';

  renderAdminBatchDetailPage({ send: (value) => { html = value; } }, {
    batch: {
      id: 7,
      n: 41,
      grain_type: 'corn',
      status: 'completed',
      started_at: '2026-06-12T10:00:00.000Z',
      discharge_started_at: '2026-06-12T13:30:00.000Z',
      completed_at: '2026-06-12T15:05:00.000Z',
      target_moisture: '14.5',
      umidade_inicial: '27.54',
      final_moisture: '12.34',
    },
    readings: [],
  });

  assert.match(html, /Umidade final<\/dt>\s*<dd>12,3%<\/dd>/);
});
