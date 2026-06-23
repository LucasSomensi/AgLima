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
