const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';
const { pool } = require('../routes/database');
const { getScaleDaySummary } = require('../routes/weighbridge-service');
const { formatShortDateTime, renderWeighbridgeHomePage } = require('../routes/renderers/weighbridge-renderer');
const router = require('../routes/weighbridge-routes');

function renderHome(data) {
  let html;
  renderWeighbridgeHomePage({ send: (value) => { html = value; } }, data);
  return html;
}

async function getHome(t, query, rowsFor = () => []) {
  t.mock.method(pool, 'query', async (sql) => ({ rows: rowsFor(sql) }));
  const route = router.stack.find((layer) => layer.route?.path === '/balanca').route;
  let html;
  await route.stack.at(-1).handle({ sessionUser: { role: 'weighbridge_operator' }, query }, {
    send: (value) => { html = value; },
  });
  return html;
}

test('short date shows only the time today and drops the year inside the current year', () => {
  const now = new Date('2026-11-18T15:00:00Z');
  assert.equal(formatShortDateTime('2026-11-18T12:22:00Z', now), '09:22');
  assert.equal(formatShortDateTime('2026-11-17T12:22:00Z', now), '17/11 09:22');
  assert.equal(formatShortDateTime('2025-12-31T12:22:00Z', now), '31/12/25 09:22');
  assert.equal(formatShortDateTime(null, now), '-');
});

test('home merges recent entries, outputs and standalone weighings newest first', () => {
  const html = renderHome({
    inputs: [{ id: 1, data_entrada: '2026-11-18T10:00:00Z', placa_caminhao: 'AAA1111', produto: 'milho', peso_bruto_kg: 30000 }],
    outputs: [{ id: 2, data_saida: '2026-11-18T12:00:00Z', placa_caminhao: 'BBB2222', produto: 'soja', peso_tara_kg: 15000 }],
    standaloneWeighings: [{ id: 3, pesagem_1_em: '2026-11-18T11:00:00Z', placa_caminhao: 'CCC3333', pesagem_1_kg: 9000 }],
  });
  const recent = html.split('id="recent-table"')[1];
  const order = ['BBB2222', 'CCC3333', 'AAA1111'].map((plate) => recent.indexOf(plate));
  assert.ok(order.every((position) => position > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(recent, /<tr data-movement-type="saida">/);
  assert.match(html, /data-movement-filter="recent-table"/);
  assert.match(html, /data-shortcut="e"/);
  assert.match(html, /data-live-weight/);
  assert.match(html, /<script src="\/js\/weighbridge-ui\.js"><\/script>/);
});

test('home shows the day summary only when it is available', () => {
  const withSummary = renderHome({
    daySummary: { entradas_count: '6', entradas_liquido_kg: '182340', saidas_count: '3', saidas_liquido_kg: '108900' },
  });
  assert.match(withSummary, /Entradas hoje<\/span><strong>6 <small>· 182\.340 kg<\/small>/);
  assert.match(withSummary, /Saídas hoje<\/span><strong>3 <small>· 108\.900 kg<\/small>/);
  assert.doesNotMatch(renderHome({}), /Entradas hoje|{{DAY_SUMMARY}}/);
});

test('day summary counts the current day in Brasília time', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ entradas_count: '1' }] };
  });
  assert.deepEqual(await getScaleDaySummary(), { entradas_count: '1' });
  assert.deepEqual(calls[0].values, ['America/Sao_Paulo']);
  assert.match(calls[0].sql, /\(now\(\) AT TIME ZONE \$1\)::date/);
  assert.match(calls[0].sql, /e\.data_entrada AT TIME ZONE \$1/);
  assert.match(calls[0].sql, /s\.data_saida AT TIME ZONE \$1/);
});

test('after completing a weighing the home message offers the next step', async (t) => {
  t.mock.method(console, 'error', () => {});
  const tare = await getHome(t, { entrada_tara_adicionada: '1', entrada_id: '41' });
  assert.match(tare, /Tara adicionada à entrada\./);
  assert.match(tare, /href="\/balanca\/entradas\/41\/ticket\.pdf"[^>]*aria-label="Imprimir ticket" target="_blank"/);

  const avulsa = await getHome(t, { avulsa_pesagem_2_adicionada: '1', avulsa_id: '5' });
  assert.match(avulsa, /href="\/balanca\/avulsas\/5\/ticket\.pdf"/);

  const gross = await getHome(t, { saida_bruto_adicionado: '1', saida_id: '7' });
  assert.match(gross, /href="\/balanca\/saidas\/7\/associar"[^>]*aria-label="Associar contrato"/);

  const tampered = await getHome(t, { entrada_tara_adicionada: '1', entrada_id: '1/../../x' });
  assert.match(tampered, /Tara adicionada à entrada\./);
  assert.doesNotMatch(tampered, /ticket\.pdf/);
});

test('home still renders when the day summary query fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(pool, 'query', async (sql) => {
    if (/AT TIME ZONE/.test(sql)) throw new Error('boom');
    return { rows: [] };
  });
  const route = router.stack.find((layer) => layer.route?.path === '/balanca').route;
  let html;
  await route.stack.at(-1).handle({ sessionUser: { role: 'weighbridge_operator' }, query: {} }, {
    send: (value) => { html = value; },
    status: () => { throw new Error('home should not fail'); },
  });
  assert.match(html, /id="recent-title">Recentes/);
  assert.doesNotMatch(html, /Entradas hoje/);
});
