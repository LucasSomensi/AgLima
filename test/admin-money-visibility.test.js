const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { renderAdminHomePage } = require('../routes/renderers');

test('admin masks monetary values in all three panels, without hiding other information', () => {
  let html;
  renderAdminHomePage({ send(value) { html = value; } }, {
    notifications: [
      { type: 'receipt_due', buyerName: '<Comprador>', balanceValue: 123, contractId: 1, daysOverdue: 2, actionPath: '/test' },
      { type: 'brokerage_due', buyerName: 'Comprador', brokerageValue: 456, contractId: 2, actionPath: '/test' },
      { type: 'shipment_due', buyerName: 'Comprador', balanceKg: 600, contractId: 3, actionPath: '/test' },
    ],
    contractsSummary: { valor_total_a_receber: 789, contratos_ativos: 3 },
    recentReceipts: [{ contrato_id: 1, comprador_nome: 'Comprador', valor: 321 }],
  });
  const values = [...html.matchAll(/<span data-money-value hidden>(.*?)<\/span>/g)];
  assert.equal(values.length, 4);
  for (const [index, amount] of ['123,00', '456,00', '789,00', '321,00'].entries()) {
    assert.ok(values[index][1].includes(amount));
  }
  assert.equal((html.match(/data-money-mask/g) || []).length, 4);
  assert.match(html, /&lt;Comprador&gt;/);
  assert.match(html, /600 kg/);
  assert.match(html, /aria-label="Mostrar valores monetários"/);
  assert.match(html, /data-eye-closed hidden/);
  assert.match(html, /admin-money-visibility\.js/);
});

test('eye button toggles all values and resets on page return', () => {
  const attributes = {};
  const callbacks = {};
  const values = [{ hidden: true }, { hidden: true }];
  const masks = [{ hidden: false }, { hidden: false }];
  const eye = () => ({ hidden: false, toggleAttribute(name, value) { this[name] = value; } });
  const open = eye();
  const closed = eye();
  const button = {
    querySelector(selector) { return selector === '[data-eye-open]' ? open : closed; },
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener(event, callback) { callbacks[event] = callback; },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/admin-money-visibility.js'), 'utf8'), {
    document: {
      getElementById() { return button; },
      querySelectorAll(selector) { return selector === '[data-money-value]' ? values : masks; },
    },
    window: { addEventListener(event, callback) { callbacks[event] = callback; } },
  });
  assert.ok(values.every((value) => value.hidden));
  assert.equal(open.hidden, false);
  assert.equal(closed.hidden, true);
  callbacks.click();
  assert.ok(values.every((value) => !value.hidden));
  assert.ok(masks.every((value) => value.hidden));
  assert.equal(attributes['aria-label'], 'Esconder valores monetários');
  assert.equal(attributes['aria-pressed'], 'true');
  assert.equal(open.hidden, true);
  assert.equal(closed.hidden, false);
  callbacks.click();
  assert.ok(values.every((value) => value.hidden));
  assert.equal(attributes['aria-pressed'], 'false');
  callbacks.click();
  callbacks.pageshow();
  assert.ok(values.every((value) => value.hidden));
  assert.equal(attributes['aria-label'], 'Mostrar valores monetários');
});
