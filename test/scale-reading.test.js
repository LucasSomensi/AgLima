const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';

const { pool } = require('../routes/database');
const {
  buildScaleWeightPayload,
  getCurrentScaleWeight,
  saveCurrentScaleWeight,
} = require('../routes/scale-reading-service');
const { requireScaleApiKey } = require('../routes/scale-api-routes');

test('scale API payload accepts non-negative integers only', () => {
  assert.deepEqual(buildScaleWeightPayload({ peso_kg: 0 }), { payload: { pesoKg: 0 } });
  assert.deepEqual(buildScaleWeightPayload({ peso_kg: 28740 }), { payload: { pesoKg: 28740 } });

  for (const peso_kg of [-1, 1.5, '28740', null, undefined, 2147483648]) {
    assert.match(buildScaleWeightPayload({ peso_kg }).error, /número inteiro/);
  }
});

test('scale API key middleware accepts only the configured bearer token', (t) => {
  const previousKey = process.env.api_key;
  process.env.api_key = 'test-secret';
  t.after(() => {
    if (previousKey === undefined) delete process.env.api_key;
    else process.env.api_key = previousKey;
  });

  let nextCalled = false;
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  requireScaleApiKey({ get: () => 'Bearer wrong' }, response, () => { nextCalled = true; });
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);

  requireScaleApiKey({ get: () => 'Bearer test-secret' }, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('current scale weight is upserted and queried with parameterized SQL', async (t) => {
  const originalQuery = pool.query;
  const calls = [];
  t.after(() => { pool.query = originalQuery; });
  pool.query = async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rows: [{ balanca_id: 1, peso_kg: 28740, atualizado_em: new Date() }] };
  };

  const saved = await saveCurrentScaleWeight(1, 28740);
  const loaded = await getCurrentScaleWeight(1);

  assert.equal(saved.peso_kg, 28740);
  assert.equal(loaded.balanca_id, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(balanca_id\) DO UPDATE/);
  assert.deepEqual(calls[0].parameters, [1, 28740]);
  assert.deepEqual(calls[1].parameters, [1]);
});
