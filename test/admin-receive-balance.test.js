const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';
const { pool } = require('../routes/database');
const router = require('../routes/admin-routes');
const route = router.stack.find((layer) => layer.route?.path === '/admin/contratos/:id/receber-saldo').route;

test('balance endpoint restricts writes to administrators', () => {
  for (const role of [undefined, 'root', 'weighbridge_operator', 'client', 'silo_operator', 'admin']) {
    const req = { sessionUser: role ? { userId: 'actor-id', role } : undefined };
    let next = false;
    let code;
    let redirect;
    route.stack[0].handle(req, {
      redirect(value) { redirect = value; },
      status(value) { code = value; return this; },
      send() {},
    }, () => { next = true; });
    assert.equal(next, role === 'admin');
    if (!role) assert.equal(redirect, '/login');
    else if (role !== 'admin') assert.equal(code, 403);
  }
});

test('balance endpoint uses authenticated actor and server balance, ignoring submitted amounts and dates', async (t) => {
  let inserted;
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, parameters) {
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 7, valor_contrato: '99.80', contrato_recebido: false }] };
      if (sql.includes('SUM(valor)')) return { rows: [{ total: '80.00' }] };
      if (sql.includes('INSERT')) inserted = parameters;
      return { rows: [], rowCount: 1 };
    },
    release() {},
  }));
  let redirect;
  await route.stack.at(-1).handle({
    params: { id: '7' }, sessionUser: { userId: 'actor-id', role: 'admin' },
    body: { valor: '999999', data_recebimento: '1900-01-01', usuario_id: 'forged' },
  }, { redirect(value) { redirect = value; } });
  assert.deepEqual(inserted, ['7', '19.80', 'Recebimento do saldo pela notificação administrativa.', 'actor-id']);
  assert.match(new URL(redirect, 'http://localhost').searchParams.get('message'), /contrato marcado como recebido/);
});

test('balance endpoint reports inactive contracts and sanitizes database failures', async (t) => {
  for (const failure of [false, true]) {
    await t.test(failure ? 'database error' : 'already received', async (t) => {
      t.mock.method(console, 'error', () => {});
      t.mock.method(pool, 'connect', async () => {
        if (failure) throw new Error('sensitive database details');
        return { query: async () => ({ rows: [{ contrato_recebido: true }] }), release() {} };
      });
      let redirect;
      await route.stack.at(-1).handle({ params: { id: '7' }, sessionUser: { userId: 'actor-id', role: 'admin' }, body: {} }, {
        redirect(value) { redirect = value; },
      });
      const error = new URL(redirect, 'http://localhost').searchParams.get('error');
      assert.match(error, failure ? /Não foi possível lançar o saldo/ : /já foi marcado como recebido/);
      assert.doesNotMatch(error, /sensitive/);
    });
  }
});
