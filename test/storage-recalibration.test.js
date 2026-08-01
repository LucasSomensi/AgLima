const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgres://example.invalid/test';

const { pool } = require('../routes/database');
const { createStorageRecalibration } = require('../routes/storage-service');
const { renderAdminStoragePage } = require('../routes/renderers/admin-renderer');

test('createStorageRecalibration inserts and recalculates deltas in one transaction', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
    release() {
      calls.push({ sql: 'RELEASE' });
    },
  };
  const originalConnect = pool.connect;
  pool.connect = async () => client;

  try {
    await createStorageRecalibration({
      produto: 'milho',
      dataRecalibracao: new Date('2026-08-01T12:00:00Z'),
      quantidadeRealKg: '30000',
      observacoes: null,
    }, 'user-id');
  } finally {
    pool.connect = originalConnect;
  }

  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[2].sql, /INSERT INTO armazenamento_recalibracoes/);
  assert.match(calls[3].sql, /SET delta = d\.delta/);
  assert.match(calls[3].sql, /NULLIF\(d\.entradas_kg, 0\)/);
  assert.equal(calls[4].sql, 'COMMIT');
  assert.equal(calls[5].sql, 'RELEASE');
});

test('storage history renders delta and nullable percentage', () => {
  let html = '';
  renderAdminStoragePage({ send(value) { html = value; } }, {
    summary: [],
    ignoredInputs: [],
    message: '',
    error: '',
    recalibrations: [{
      produto: 'milho',
      data_recalibracao: '2026-08-01T12:00:00Z',
      quantidade_real_kg: '30000',
      delta: '-30000',
      delta_porcento: null,
      criado_por_login: 'admin',
      observacoes: null,
    }],
  });

  assert.match(html, /<th>Delta<\/th>/);
  assert.match(html, /<th>Delta \(%\)<\/th>/);
  assert.match(html, /-30\.000 kg/);
  assert.match(html, /<td>-30\.000 kg<\/td>\s*<td>-<\/td>/);
});
