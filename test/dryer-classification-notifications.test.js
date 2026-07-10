const assert = require('node:assert/strict');
const test = require('node:test');
const {
  renderDryerInputClassificationPage,
  renderDryerPanelPage,
} = require('../routes/renderers');

function renderPage(renderFn, params) {
  let html = '';

  renderFn({ send: (value) => { html = value; } }, params);

  return html;
}

const pendingInput = {
  id: 11,
  data_entrada: '2026-06-12T12:30:00.000Z',
  placa_caminhao: 'ABC1D23',
  produto: 'milho',
  peso_bruto_kg: '30000',
  umidade_percent: null,
  impureza_percent: null,
  graos_avariados_percent: null,
};

test('dryer panel hides classification notifications when there are no pending inputs', () => {
  const html = renderPage(renderDryerPanelPage, {
    batch: null,
    readings: [],
    settings: { target_moisture: '14.5' },
    message: '',
    error: '',
    unclassifiedInputs: [],
  });

  assert.doesNotMatch(html, /Entradas pendentes/);
  assert.doesNotMatch(html, /dryer-notifications/);
});

test('dryer panel renders one classification notification per pending input', () => {
  const html = renderPage(renderDryerPanelPage, {
    batch: null,
    readings: [],
    settings: { target_moisture: '14.5' },
    message: '',
    error: '',
    unclassifiedInputs: [pendingInput, { ...pendingInput, id: 12, placa_caminhao: 'DEF4G56' }],
  });

  assert.doesNotMatch(html, /Entradas pendentes/);
  assert.doesNotMatch(html, /Entrada sem classificação/);
  assert.doesNotMatch(html, /Milho/);
  assert.doesNotMatch(html, /12\/06\/2026/);
  assert.match(html, /href="\/secador\/entradas\/11\/classificacao">Classificar ABC1D23 09:30<\/a>/);
  assert.match(html, /href="\/secador\/entradas\/12\/classificacao">Classificar DEF4G56 09:30<\/a>/);
});

test('dryer classification form posts to the dryer mobile classification route', () => {
  const html = renderPage(renderDryerInputClassificationPage, {
    input: pendingInput,
    formValues: {},
    error: '',
  });

  assert.match(html, /Classificar entrada/);
  assert.match(html, /action="\/secador\/entradas\/11\/classificacao"/);
  assert.match(html, /name="umidade_percent"[^>]+value="14"/);
  assert.match(html, /name="impureza_percent"[^>]+value="1"/);
  assert.match(html, /name="graos_avariados_percent"[^>]+value="0"/);
  assert.match(html, /href="\/secador">Cancelar/);
});

test('dryer panel keeps moisture table compact and exposes extra reading data on row expansion', () => {
  const html = renderPage(renderDryerPanelPage, {
    batch: {
      id: 5,
      started_at: '2026-07-10T12:00:00.000Z',
      discharge_started_at: null,
      umidade_inicial: '28',
      target_moisture: '14',
    },
    readings: [{
      id: 22,
      measured_at: '2026-07-10T14:20:00.000Z',
      moisture_percent: '26.6',
      measured_by_login: 'operador',
    }],
    settings: { target_moisture: '14' },
    message: '',
    error: '',
    unclassifiedInputs: [],
  });

  assert.match(html, /<th>Horário<\/th>\s*<th>Umidade medida<\/th>\s*<\/tr>/);
  assert.doesNotMatch(html, /<th>Umidade média<\/th>/);
  assert.doesNotMatch(html, /<th>Previsão de descarga<\/th>/);
  assert.doesNotMatch(html, /<th>Umidade alvo<\/th>/);
  assert.match(html, /class="dryer-reading-row"[\s\S]*<td>11:20<\/td>\s*<td>26,6%<\/td>\s*<\/tr>/);
  assert.match(html, /class="dryer-reading-detail"[\s\S]*Umidade média[\s\S]*Previsão de descarga[\s\S]*Umidade alvo[\s\S]*Operador[\s\S]*operador/);
});

test('dryer panel uses persisted moisture evolution values when available', () => {
  const html = renderPage(renderDryerPanelPage, {
    batch: {
      id: 5,
      started_at: '2026-07-10T12:00:00.000Z',
      discharge_started_at: null,
      umidade_inicial: '28',
      target_moisture: '14',
    },
    readings: [{
      id: 22,
      measured_at: '2026-07-10T14:20:00.000Z',
      moisture_percent: '26.6',
      average_moisture: '18.75',
      discharge_forecast_at: '2026-07-10T15:30:00.000Z',
      discharge_forecast_status: 'forecast',
      measured_by_login: 'operador',
    }],
    settings: { target_moisture: '14' },
    message: '',
    error: '',
    unclassifiedInputs: [],
  });

  assert.match(html, /Previsão \/ início da descarga<\/span>\s*<strong>10\/07\/2026, 12:30<\/strong>/);
  assert.match(html, /Umidade média<\/dt><dd>18,8%<\/dd>/);
  assert.match(html, /Previsão de descarga<\/dt><dd>10\/07\/2026, 12:30<\/dd>/);
});
