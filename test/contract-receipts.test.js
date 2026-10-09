const assert = require('node:assert/strict');
const test = require('node:test');
process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';
const { buildReceiptPayload, createContractReceipt } = require('../routes/receipt-service');
const { netValueSql } = require('../routes/contract-finance');
const { createContract, updateContract } = require('../routes/contract-service');
const { pool } = require('../routes/database');

test('receipt payload validates money, date and notes', () => {
  assert.deepEqual(buildReceiptPayload({ valor: '42,5', data_recebimento: '2026-10-09' }).payload,
    { value: '42.50', date: '2026-10-09', observation: null });
  assert.match(buildReceiptPayload({ valor: '0', data_recebimento: '2026-10-09' }).error, /valor positivo/);
  assert.match(buildReceiptPayload({ valor: '1.001', data_recebimento: '2026-10-09' }).error, /duas casas/);
  assert.match(buildReceiptPayload({ valor: '1', data_recebimento: '2026-02-30' }).error, /data/);
});

test('expected value SQL applies 0.2% discount only when selected', () => {
  const sql = netValueSql('quantity', 'price', 'deducts_senar');
  assert.match(sql, /CASE WHEN deducts_senar THEN ROUND\(ROUND\(\(quantity\) \* \(price\) \/ 60, 2\) \* 0\.002, 2\) ELSE 0 END/);
});

test('contract persistence stores and checks the SENAR choice', async (t) => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  let inserted;
  let updated;
  pool.query = async (sql, parameters) => { inserted = { sql, parameters }; return { rowCount: 1 }; };
  pool.connect = async () => ({
    query: async (sql, parameters) => {
      if (sql.includes('UPDATE contratos')) updated = { sql, parameters };
      return { rowCount: 1, rows: [{ id: 7 }] };
    }, release() {},
  });
  t.after(() => { pool.query = originalQuery; pool.connect = originalConnect; });
  const payload = { dataContrato: '2026-10-09', produto: 'soja', precoPorSaca: '60', compradorId: '1', vendedorId: '2', quantidadeKg: '600', descontaSenar: false };
  await createContract(payload);
  await updateContract(7, payload);
  assert.match(inserted.sql, /desconta_senar/);
  assert.equal(inserted.parameters.at(-1), false);
  assert.match(updated.sql, /desconta_senar = \$24/);
  assert.match(updated.sql, /CASE WHEN \$24::boolean THEN/);
  assert.equal(updated.parameters.at(-1), false);
});

test('receipt service rejects overpayment and rolls back', async (t) => {
  const originalConnect = pool.connect;
  const statements = [];
  pool.connect = async () => ({
    query: async (sql) => {
      statements.push(sql.trim());
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 7, valor_contrato: '100.00' }] };
      if (sql.includes('SUM(valor)')) return { rows: [{ total: '80.00' }] };
      return { rows: [] };
    }, release() {},
  });
  t.after(() => { pool.connect = originalConnect; });
  await assert.rejects(createContractReceipt(7, { value: '20.01', date: '2026-10-09', observation: null }, 'user-id'), /excede/);
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO contrato_recebimentos')), false);
});

test('final receipt updates contract status in the same transaction', async (t) => {
  const originalConnect = pool.connect;
  const statements = [];
  pool.connect = async () => ({
    query: async (sql, parameters) => {
      statements.push({ sql: sql.trim(), parameters });
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 7, valor_contrato: '100.00' }] };
      if (sql.includes('SUM(valor)')) return { rows: [{ total: '80.00' }] };
      return { rows: [] };
    }, release() {},
  });
  t.after(() => { pool.connect = originalConnect; });
  await createContractReceipt(7, { value: '20.00', date: '2026-10-09', observation: null }, 'user-id');
  assert.deepEqual(statements.find((item) => item.sql.startsWith('UPDATE contratos')).parameters, [7, true]);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});
