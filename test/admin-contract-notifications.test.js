const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';
const { pool } = require('../routes/database');
const { listAdminContractNotifications, markContractBrokerageAsPaid } = require('../routes/contract-service');
const { renderAdminHomePage } = require('../routes/renderers');

test('brokerage notifications depend on receipt status, including before the due date or without a date', async (t) => {
  const originalQuery = pool.query;
  t.after(() => { pool.query = originalQuery; });
  const contract = {
    contrato_embarcado: true,
    contrato_recebido: true,
    corretagem_paga: false,
    comprador_nome: 'Comprador',
    saldo_kg: 0,
    saldo_receber: 0,
    valor_corretagem: 100,
  };
  pool.query = async (sql) => {
    assert.match(sql, /OR \(corretagem_paga IS NOT TRUE AND contrato_recebido IS TRUE\)/);
    return { rows: [
      { ...contract, id: 1, data_recebimento: '2026-10-06', dias_desde_vencimento: 0 },
      { ...contract, id: 2, data_recebimento: '2026-10-07', dias_desde_vencimento: -1 },
      { ...contract, id: 3, data_recebimento: null },
      { ...contract, id: 4, contrato_recebido: false, saldo_receber: 50, data_recebimento: '2026-09-01', dias_desde_vencimento: 35 },
      { ...contract, id: 5, corretagem_paga: true },
    ] };
  };
  const notifications = await listAdminContractNotifications();
  assert.deepEqual(notifications.filter((item) => item.type === 'brokerage_due').map((item) => item.contractId).sort(), [1, 2, 3]);
  assert.equal(notifications.find((item) => item.contractId === 4).type, 'receipt_due');
  assert.equal(notifications.some((item) => item.contractId === 5), false);
});

test('brokerage payment action uses the same receipt condition as its notification', async (t) => {
  const originalQuery = pool.query;
  t.after(() => { pool.query = originalQuery; });
  pool.query = async (sql, parameters) => {
    assert.match(sql, /AND corretagem_paga IS NOT TRUE\s+AND contrato_recebido IS TRUE/);
    assert.doesNotMatch(sql, /data_recebimento/);
    assert.deepEqual(parameters, [42]);
    return { rowCount: 1 };
  };
  assert.equal(await markContractBrokerageAsPaid(42), 1);
});

test('admin notifications describe completed shipment and pending brokerage without an overdue claim', () => {
  let html;
  renderAdminHomePage({ send: (value) => { html = value; } }, {
    notifications: [
      { type: 'shipment_due', contractId: 1, buyerName: 'Comprador', balanceKg: 0, actionPath: '/admin/contratos/1/marcar-embarcado' },
      { type: 'brokerage_due', contractId: 2, buyerName: 'Comprador', brokerageValue: 100, daysOverdue: -1, receiptDate: '2026-10-07', actionPath: '/admin/contratos/2/marcar-corretagem-paga' },
    ],
    contractsSummary: {}, dryerBatch: null, storageSummary: [], scaleInputs: [], scaleOutputs: [],
  });
  assert.match(html, /Contrato #1 com embarque concluído/);
  assert.match(html, /Marcar como embarcado/);
  assert.match(html, /Contrato #2 com corretagem pendente/);
  assert.match(html, /Marcar corretagem como paga/);
  assert.doesNotMatch(html, /pronto para embarque|venceu há|Vencimento em/);
});
