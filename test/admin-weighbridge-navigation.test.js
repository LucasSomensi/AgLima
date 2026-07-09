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


test('admin home waits for trend points before showing discharge forecast', () => {
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
  assert.match(html, /<span>Previsão da próxima descarga<\/span>\s*<strong>-<\/strong>/);
});
