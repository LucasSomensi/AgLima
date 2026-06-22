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

  assert.match(html, /Entradas pendentes/);
  assert.match(html, /ABC1D23/);
  assert.match(html, /DEF4G56/);
  assert.match(html, /href="\/secador\/entradas\/11\/classificacao">Classificar/);
  assert.match(html, /href="\/secador\/entradas\/12\/classificacao">Classificar/);
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
