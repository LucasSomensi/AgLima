const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';
const { pool } = require('../routes/database');
const { listScaleInputs, listScaleOutputs } = require('../routes/weighbridge-service');
const { renderWeighbridgeHomePage } = require('../routes/renderers/weighbridge-renderer');
const router = require('../routes/weighbridge-routes');

const input = {
  id: 1, data_entrada: '2026-10-01T12:00:00Z', placa_caminhao: 'ABC1234',
  produto: 'milho', peso_bruto_kg: 30000, peso_tara_kg: null,
  umidade_percent: 14, impureza_percent: 0, graos_avariados_percent: null,
};
const output = {
  id: 2, data_saida: '2026-09-01T12:00:00Z', placa_caminhao: 'DEF5678',
  produto: 'soja', peso_bruto_kg: null, peso_tara_kg: 10000,
};
function renderPage(data) {
  let html;
  renderWeighbridgeHomePage({ send: (value) => { html = value; } }, data);
  return html;
}
function render(data) {
  return renderPage(data).split('aria-labelledby="yard-title"')[1]?.split('</section>')[0] || '';
}

test('yard shows pending movements independently of recent lists, oldest first', () => {
  const html = render({ yardInputs: [input], yardOutputs: [output] });
  assert.match(html, /Pátio/);
  assert.match(html, /ABC1234/);
  assert.ok(html.indexOf('DEF5678') < html.indexOf('ABC1234'));
  assert.match(html, /href="\/balanca\/entradas\/1\/tara">Adicionar tara/);
  assert.match(html, /href="\/balanca\/entradas\/1\/classificacao">Adicionar classificação/);
  assert.match(html, /href="\/balanca\/saidas\/2\/bruto">Adicionar bruto/);
  assert.match(html, /href="\/balanca\/saidas\/2\/associar">Associar contrato/);
  assert.doesNotMatch(html, /Movimentações com pesagem/);
});

test('yard excludes complete weights/classification even without origin or contract; zero is classified', () => {
  const html = render({
    yardInputs: [{ ...input, peso_tara_kg: 10000, umidade_percent: 0, graos_avariados_percent: 0 }],
    yardOutputs: [{ ...output, peso_bruto_kg: 30000 }],
  });
  assert.equal(html, '');
  assert.doesNotMatch(html, /ABC1234|DEF5678/);
});

test('yard renders only missing actions and escapes stored text', () => {
  const html = render({ yardInputs: [{ ...input, placa_caminhao: '<script>alert(1)</script>', peso_tara_kg: 10000 }] });
  assert.match(html, /Adicionar classificação/);
  assert.doesNotMatch(html, /Adicionar tara|Adicionar bruto|<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(renderPage({}), /yard-title|YARD_ROWS|YARD_START|YARD_END|Nenhum caminhão/);
});

test('yard does not offer association for an already associated output', () => {
  const html = render({ yardOutputs: [{ ...output, contrato_id: 42 }] });
  assert.match(html, /Adicionar bruto/);
  assert.doesNotMatch(html, /Associar contrato/);
});

test('complete output without contract does not keep the yard section visible', () => {
  const html = renderPage({ yardOutputs: [{ ...output, peso_bruto_kg: 30000, contrato_id: null }] });
  assert.doesNotMatch(html, /yard-title|Associar contrato|YARD_ROWS/);
  assert.match(html, /Últimas 10 entradas/);
  assert.match(html, /Últimas 10 saídas/);
});

test('yard also offers edit forms for missing input gross or output tare', () => {
  const html = render({ yardInputs: [{ ...input, peso_bruto_kg: null }], yardOutputs: [{ ...output, peso_tara_kg: null }] });
  assert.match(html, /href="\/balanca\/entradas\/1">Adicionar bruto/);
  assert.match(html, /href="\/balanca\/saidas\/2">Adicionar tara/);
});

test('pending queries filter at database level without recent limit; normal queries unchanged', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, values) => { queries.push({ sql, values }); return { rows: [] }; });
  await listScaleInputs({ pendingOnly: true, order: 'asc' });
  await listScaleOutputs({ pendingOnly: true, order: 'asc' });
  assert.match(queries[0].sql, /WHERE peso_tara_kg IS NULL OR peso_bruto_kg IS NULL OR umidade_percent IS NULL OR impureza_percent IS NULL OR graos_avariados_percent IS NULL/);
  assert.match(queries[1].sql, /WHERE s.peso_tara_kg IS NULL OR s.peso_bruto_kg IS NULL/);
  for (const { sql, values } of queries) {
    assert.match(sql, /ORDER BY .* ASC, .* ASC/);
    assert.doesNotMatch(sql, /LIMIT/);
    assert.deepEqual(values, []);
  }
  await listScaleInputs({ limit: 10 });
  await listScaleOutputs({ limit: 10 });
  for (const { sql, values } of queries.slice(2)) {
    assert.doesNotMatch(sql, /WHERE/);
    assert.deepEqual(values, [10, 0]);
  }
});

test('home route loads yard separately from the ten recent movements', async (t) => {
  t.mock.method(pool, 'query', async (sql) => ({ rows: sql.includes('WHERE peso_tara_kg') ? [input]
    : sql.includes('WHERE s.peso_tara_kg') ? [output] : [] }));
  const route = router.stack.find((layer) => layer.route?.path === '/balanca').route;
  let html;
  await route.stack.at(-1).handle({ sessionUser: { role: 'weighbridge_operator' }, query: {} }, {
    send: (value) => { html = value; },
  });
  assert.match(html, /ABC1234/);
  assert.match(html, /DEF5678/);
  assert.match(html, /Nenhuma entrada recente/);
  assert.match(html, /Nenhuma saída recente/);
  assert.doesNotMatch(html, /{{YARD_ROWS}}/);
});
