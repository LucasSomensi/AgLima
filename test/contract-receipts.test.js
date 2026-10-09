const assert = require('node:assert/strict');
const test = require('node:test');
process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';
const { buildReceiptPayload, createContractReceipt, listContractReceipts, listRecentContractReceipts } = require('../routes/receipt-service');
const { netValueSql } = require('../routes/contract-finance');
const { createContract, updateContract } = require('../routes/contract-service');
const { pool } = require('../routes/database');
const { renderAdminHomePage, renderAdminReceiptsPage, renderAdminContractsPage } = require('../routes/renderers/admin-renderer');
const { renderScaleContractDetailPage } = require('../routes/renderers/weighbridge-renderer');
const { paginateItems } = require('../routes/utils');

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
  assert.doesNotMatch(updated.sql, /contrato_recebido\s*=/);
  assert.equal(updated.parameters.at(-1), false);
});

test('recent receipts are ordered by registration time and capped at ten', async (t) => {
  const originalQuery = pool.query;
  t.after(() => { pool.query = originalQuery; });
  pool.query = async (sql, parameters) => {
    assert.match(sql, /ORDER BY r\.criado_em DESC, r\.id DESC\s+LIMIT \$1/);
    assert.deepEqual(parameters, [10]);
    return { rows: [{ id: 1 }] };
  };
  assert.deepEqual(await listRecentContractReceipts(), [{ id: 1 }]);
});

test('complete receipts history keeps registration order and comments', async (t) => {
  const originalQuery = pool.query;
  t.after(() => { pool.query = originalQuery; });
  pool.query = async (sql) => {
    assert.match(sql, /r\.observacao/);
    assert.match(sql, /ORDER BY r\.criado_em DESC, r\.id DESC/);
    assert.doesNotMatch(sql, /LIMIT/);
    return { rows: [{ id: 1, observacao: 'Parcela' }] };
  };
  assert.deepEqual(await listContractReceipts(), [{ id: 1, observacao: 'Parcela' }]);
});

test('admin home links its last ten receipts to the complete list', () => {
  let html = '';
  renderAdminHomePage({ send: (value) => { html = value; } }, {});
  assert.match(html, /Últimos 10 recebimentos/);
  assert.match(html, /href="\/admin\/recebimentos">Ver todos os recebimentos/);
  assert.doesNotMatch(html, /\/admin\/recebimentos\/novo/);
});

test('admin contracts list has no receipts action', () => {
  let html = '';
  renderAdminContractsPage({ send: (value) => { html = value; } }, {
    buyers: [], sellers: [], contracts: [{ id: 7, data_contrato: '2026-10-09', comprador_nome: 'Comprador', produto: 'soja', preco_por_saca: '60', quantidade_kg: '600', saldo_receber: '10' }],
  });
  assert.match(html, /Editar<\/a>/);
  assert.doesNotMatch(html, /Recebimentos<\/a>/);
});

test('receipts page combines entry form and paginated history', () => {
  let html = '';
  const receipts = Array.from({ length: 31 }, (_, index) => ({
    id: index + 1, contrato_id: 7, data_recebimento: '2026-10-09', valor: '1.00',
    observacao: `Comentário ${index + 1}`, comprador_nome: 'Comprador', usuario_login: 'admin', criado_em: '2026-10-09T12:00:00Z',
  }));
  renderAdminReceiptsPage({ send: (value) => { html = value; } }, {
    contracts: [{ id: 7, data_contrato: '2026-10-09', comprador_nome: 'Comprador', saldo_receber: '0.02' }],
    receipts: paginateItems(receipts, '2'),
  });
  assert.match(html, /action="\/admin\/recebimentos" method="post"/);
  assert.match(html, /name="contrato_id"/);
  assert.match(html, /saldo R\$\s*0,02/);
  assert.match(html, /Comentário 31/);
  assert.doesNotMatch(html, /Comentário 1<\/td>/);
  assert.match(html, /Página 2 de 2/);
  assert.match(html, /\/admin\/recebimentos\?pagina=1/);
  assert.match(html, /\/balanca\/contratos\/7/);
});

test('contract receipts appear in weighbridge detail only with admin data', () => {
  const contract = {
    contrato_id: 7, data_contrato: '2026-10-09', produto: 'soja', quantidade_kg: '600',
    quantidade_embarcada_kg: '300', saldo_kg: '300', vendedor_nome_completo: 'Vendedor',
    comprador_nome_completo: 'Comprador', preco_por_saca: '60',
  };
  const receiptInfo = {
    contract: { id: 7, valor_bruto: '100.00', desconto_senar: '0.20', desconta_senar: true, valor_contrato: '99.80', valor_recebido: '99.78', saldo_receber: '0.02', contrato_recebido: false },
    receipts: [{ data_recebimento: '2026-10-09', valor: '99.78', usuario_login: 'admin', observacao: 'Parcela inicial' }],
  };
  let operatorHtml = '';
  let adminHtml = '';
  renderScaleContractDetailPage({ send: (value) => { operatorHtml = value; } }, { contract, outputs: [] });
  renderScaleContractDetailPage({ send: (value) => { adminHtml = value; } }, { contract, outputs: [], receiptInfo });
  assert.doesNotMatch(operatorHtml, /Recebimentos|Parcela inicial|Marcar contrato como recebido/);
  assert.match(adminHtml, /Recebimentos/);
  assert.match(adminHtml, /Parcela inicial/);
  assert.match(adminHtml, /Marcar contrato como recebido/);
  assert.match(adminHtml, /name="retorno" value="balanca"/);
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

test('final receipt commits without changing the manual received status', async (t) => {
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
  assert.equal(statements.some((item) => item.sql.startsWith('UPDATE contratos')), false);
  assert.equal(statements.some((item) => item.sql.startsWith('INSERT INTO contrato_recebimentos')), true);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});
