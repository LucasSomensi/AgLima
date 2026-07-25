const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';

const { pool } = require('../routes/database');
const {
  LOGIN_EVENT_RESULTS,
  LOGIN_EVENTS_PAGE_SIZE,
  listLoginEvents,
  recordLoginEvent,
} = require('../routes/auth-login-service');
const { renderAdminLoginEventsPage } = require('../routes/renderers/admin-renderer');

test('recordLoginEvent stores only the expected authentication metadata', async (t) => {
  const originalQuery = pool.query;
  let queryParameters;
  t.after(() => { pool.query = originalQuery; });

  pool.query = async (sql, parameters) => {
    assert.match(sql, /INSERT INTO auth_login_events/);
    assert.doesNotMatch(sql, /password|cookie|token/i);
    queryParameters = parameters;
    return { rows: [] };
  };

  await recordLoginEvent({
    login: 'operador',
    userId: 'user-id',
    result: LOGIN_EVENT_RESULTS.INVALID_PASSWORD,
    ipAddress: '192.0.2.10',
    userAgent: 'Test Browser',
  });

  assert.deepEqual(queryParameters, [
    'operador',
    'user-id',
    'senha_invalida',
    '192.0.2.10',
    'Test Browser',
  ]);
});

test('listLoginEvents returns a newest-first paginated event list', async (t) => {
  const originalQuery = pool.query;
  const queries = [];
  t.after(() => { pool.query = originalQuery; });

  pool.query = async (sql, parameters) => {
    queries.push({ sql, parameters });

    if (/COUNT/.test(sql)) {
      return { rows: [{ total: 205 }] };
    }

    return { rows: [{ id: 105, resultado: 'sucesso' }] };
  };

  const result = await listLoginEvents({ page: 2 });

  assert.deepEqual(result, {
    events: [{ id: 105, resultado: 'sucesso' }],
    page: 2,
    pageSize: LOGIN_EVENTS_PAGE_SIZE,
    total: 205,
    totalPages: 3,
  });
  const listQuery = queries.find(({ sql }) => /FROM auth_login_events AS event/.test(sql));
  assert.match(listQuery.sql, /LEFT JOIN users/);
  assert.match(listQuery.sql, /ORDER BY event\.criado_em DESC, event\.id DESC/);
  assert.deepEqual(listQuery.parameters, [100, 100]);
});

test('root login events renderer escapes details and exposes pagination', () => {
  let html = '';

  renderAdminLoginEventsPage({ send: (value) => { html = value; } }, {
    events: [{
      id: 1,
      login_informado: '<root>',
      usuario_id: 'abc-123',
      usuario_login: 'root',
      resultado: 'senha_invalida',
      ip_origem: '192.0.2.1',
      user_agent: '<script>alert(1)</script>',
      criado_em: '2026-07-25T12:00:00.000Z',
    }],
    page: 2,
    total: 205,
    totalPages: 3,
  });

  assert.match(html, /Tentativas de login/);
  assert.match(html, /&lt;root&gt;/);
  assert.match(html, /Senha inválida/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /pagina=1/);
  assert.match(html, /pagina=3/);
});
