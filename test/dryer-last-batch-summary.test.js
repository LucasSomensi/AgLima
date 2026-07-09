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
      discharge_average_moisture: '13.46',
    },
  });

  assert.match(html, /Última batelada/);
  assert.match(html, /Início<\/dt>\s*<dd>12\/06\/2026, 07:00<\/dd>/);
  assert.match(html, /Início descarga<\/dt>\s*<dd>12\/06\/2026, 10:30<\/dd>/);
  assert.match(html, /Fim descarga<\/dt>\s*<dd>12\/06\/2026, 12:05<\/dd>/);
  assert.match(html, /Duração<\/dt>\s*<dd>1h 35min<\/dd>/);
  assert.match(html, /Umidade<\/dt>\s*<dd>13,5%<\/dd>/);
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
