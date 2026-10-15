const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const bcrypt = require('bcrypt');

process.env.DATABASE_URL = 'postgres://example.invalid/agrolima';
process.env.api_key = 'test-scale-device-key';
const app = require('../app');
const { pool } = require('../routes/database');
const service = require('../routes/weighbridge-service');
const users = require('../routes/user-service');
const events = require('../routes/auth-login-service');
const scale = require('../routes/scale-reading-service');
const auth = require('../routes/weighbridge-api-auth');
const { loginLimiter } = require('../routes/weighbridge-api-routes');
const validation = require('../routes/weighbridge-api-validation');
const TOKEN = 'a'.repeat(64);
const actor = { id: '11111111-1111-4111-8111-111111111111', login: 'operador', role: 'weighbridge_operator', disabled: false };

function request(server, method, path, data, options = {}) {
  const content = options.raw ?? (data === undefined ? '' : JSON.stringify(data));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method,
      path: options.legacy ? path : `/api/v1/balanca${path}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(content),
        Authorization: `Bearer ${TOKEN}`, ...options.headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString();
        resolve({ status: res.statusCode, headers: res.headers, text, buffer,
          data: res.headers['content-type']?.includes('application/json') && text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    req.end(content);
  });
}

test('weighbridge API HTTP contract', async (t) => {
  let user = { ...actor };
  t.mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('JOIN public.users')) {
      assert.equal(values[0], auth.hashToken(TOKEN));
      assert.match(sql, /s.expira_em > now\(\)/);
      return { rows: user ? [user] : [] };
    }
    if (sql.includes('DELETE FROM public.balanca_api_sessoes')) { user = null; return { rows: [] }; }
    assert.fail(`unexpected query: ${sql}`);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.beforeEach(() => { user = { ...actor }; loginLimiter.reset(); });

  await t.test('missing/invalid/expired tokens, disabled accounts and unsupported roles', async () => {
    for (const token of ['', 'Bearer test-scale-device-key', 'Basic user:pass']) {
      const res = await request(server, 'GET', '/', undefined, { headers: { Authorization: token, Cookie: 'agrolima_session=invalid' } });
      assert.equal(res.status, 401);
      assert.equal(res.headers['www-authenticate'], 'Bearer');
    }
    user = null;
    assert.equal((await request(server, 'GET', '/')).status, 401);
    user = { ...actor, disabled: true };
    assert.equal((await request(server, 'GET', '/')).status, 401);
    for (const role of ['root', 'client', 'silo_operator']) {
      user = { ...actor, role };
      assert.equal((await request(server, 'GET', '/')).status, 403);
    }
  });

  await t.test('cookie and CSRF are not used by Bearer API; me and logout', async () => {
    const me = await request(server, 'GET', '/sessao', undefined, { headers: { Cookie: 'broken=%GG' } });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.userId, actor.id);
    assert.equal(me.headers['cache-control'], 'no-store');
    assert.equal(me.headers['set-cookie'], undefined);
    assert.equal((await request(server, 'DELETE', '/sessao')).status, 204);
    assert.equal((await request(server, 'GET', '/sessao')).status, 401);
  });

  await t.test('JSON, content type, oversized payloads, invalid paths and numeric IDs', async () => {
    assert.equal((await request(server, 'POST', '/entradas', undefined, { raw: '{' })).status, 400);
    assert.equal((await request(server, 'POST', '/entradas', undefined, { raw: 'x'.repeat(103000) })).status, 413);
    assert.equal((await request(server, 'POST', '/entradas', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    for (const value of ['abc', '0', '-1', '1.2', '9223372036854775808']) {
      assert.equal((await request(server, 'GET', `/entradas/${value}`)).status, 400);
    }
    const res = await request(server, 'GET', '/nao-existe');
    assert.equal(res.status, 404);
    assert.equal(res.data.code, 'NOT_FOUND');
  });

  await t.test('home, current weight, paging, suggestions, tare and contract reads', async (st) => {
    st.mock.method(service, 'listScaleInputs', async (options) => { assert.ok(options.limit <= 101); return [{ id: '1' }, { id: '2' }]; });
    st.mock.method(service, 'listScaleOutputs', async () => []);
    st.mock.method(service, 'listRecentInputPlates', async (q) => { assert.equal(q, 'ABC'); return [{ placa_caminhao: 'ABC1D23' }]; });
    st.mock.method(service, 'getPreviousTareForPlate', async () => ({ id: '3', peso_tara_kg: '10000.000' }));
    st.mock.method(scale, 'getCurrentScaleWeight', async () => ({ balanca_id: 1, peso_kg: 30000 }));
    st.mock.method(service, 'listOpenContractsForWeighbridge', async (filter, options) => {
      assert.equal(filter, 'nao-embarcados'); assert.equal(options.offset, 2); return [{ id: '7' }];
    });
    st.mock.method(service, 'getContractDetailForWeighbridge', async () => ({ contract: { contrato_id: '7' }, outputs: [] }));
    assert.equal((await request(server, 'GET', '/')).data.entradas.length, 2);
    assert.equal((await request(server, 'GET', '/peso-atual')).data.peso_kg, 30000);
    const page = await request(server, 'GET', '/entradas?pagina=2&limite=1');
    assert.deepEqual(page.data, { items: [{ id: '1' }], pagina: 2, limite: 1, tem_proxima: true });
    assert.equal((await request(server, 'GET', '/saidas')).status, 200);
    for (const query of ['limite=101', 'pagina=0', 'pagina[]=2']) assert.equal((await request(server, 'GET', `/entradas?${query}`)).status, 400);
    assert.equal((await request(server, 'GET', '/entradas/placas?q=ABC')).status, 200);
    assert.equal((await request(server, 'GET', '/entradas/tara-anterior?placa=ABC1D23')).status, 200);
    assert.equal((await request(server, 'GET', '/entradas/tara-anterior')).status, 400);
    assert.equal((await request(server, 'GET', '/contratos?pagina=3&limite=1')).status, 200);
    assert.equal((await request(server, 'GET', '/contratos?filtro=todos')).status, 400);
    assert.equal((await request(server, 'GET', '/contratos/7')).data.contract.contrato_id, '7');
  });

  const input = { data_entrada: '2026-10-14T10:00', placa_caminhao: 'ABC1D23', produto: 'milho', peso_bruto_kg: 30000 };
  const output = { data_saida: '2026-10-14T10:00', placa_caminhao: 'ABC1D23', produto: 'soja', peso_tara_kg: 10000 };

  await t.test('create and edit inputs, zero classification, tare, origin and deletion actor', async (st) => {
    st.mock.method(service, 'createScaleInput', async (data, userId) => {
      assert.equal(data.pesoBrutoKg, '30000'); assert.equal(data.usarTaraAnterior, true);
      assert.equal(userId, actor.id); return { id: '10' };
    });
    st.mock.method(service, 'getScaleInputById', async () => ({ id: '10', ...input }));
    st.mock.method(service, 'updateScaleInput', async (id, data, user) => {
      assert.equal(id, '10'); assert.equal(data.pesoTaraKg, null); assert.equal(data.origem, null);
      assert.equal(user.login, actor.login); return { id };
    });
    st.mock.method(service, 'addScaleInputTare', async (id, weight, userId) => {
      assert.equal(weight, '10000'); assert.equal(userId, actor.id); return { id };
    });
    st.mock.method(service, 'addScaleInputClassification', async (id, data, userId) => {
      assert.deepEqual(data, { umidadePercent: '0', impurezaPercent: '0', graosAvariadosPercent: '0' });
      assert.equal(userId, actor.id); return { id };
    });
    st.mock.method(service, 'defineScaleInputOrigin', async (id, origin, userId) => {
      assert.equal(origin, 'Fazenda X'); assert.equal(userId, actor.id); return { id };
    });
    st.mock.method(service, 'deleteScaleInput', async (id, user, reason) => {
      assert.equal(user.userId, actor.id); assert.ok(reason.length >= 20); return true;
    });
    const created = await request(server, 'POST', '/entradas', { ...input, usar_tara_anterior: true });
    assert.equal(created.status, 201);
    assert.equal(created.headers.location, '/api/v1/balanca/entradas/10');
    assert.equal((await request(server, 'GET', '/entradas/10')).status, 200);
    const edit = { ...input, peso_tara_kg: null, origem: null, umidade_percent: null, impureza_percent: null, graos_avariados_percent: null };
    assert.equal((await request(server, 'PUT', '/entradas/10', edit)).status, 200);
    assert.equal((await request(server, 'PUT', '/entradas/10', input)).status, 400);
    assert.equal((await request(server, 'POST', '/entradas/10/tara', { peso_tara_kg: 10000 })).status, 200);
    assert.equal((await request(server, 'POST', '/entradas/10/classificacao', { umidade_percent: 0, impureza_percent: 0, graos_avariados_percent: 0 })).status, 200);
    assert.equal((await request(server, 'POST', '/entradas/10/origem', { origem: 'Fazenda X' })).status, 200);
    assert.equal((await request(server, 'POST', '/entradas/10/deletar', { motivo_delecao: 'Registro duplicado por erro de digitação.' })).status, 204);
    assert.equal((await request(server, 'POST', '/entradas/10/deletar', { motivo_delecao: 'curto' })).status, 400);
  });

  await t.test('output create/edit/gross, association choices, link, unlink, split and delete', async (st) => {
    st.mock.method(service, 'createScaleOutput', async (data, userId) => { assert.equal(userId, actor.id); return { id: '20' }; });
    st.mock.method(service, 'getScaleOutputById', async () => ({ id: '20' }));
    st.mock.method(service, 'getScaleOutputDetailInfo', async () => ({ saida_id: '20' }));
    st.mock.method(service, 'updateScaleOutput', async (id, data, user) => { assert.equal(user.userId, actor.id); return { id }; });
    st.mock.method(service, 'addScaleOutputGross', async (id, data, user) => {
      assert.equal(data.pesoBrutoKg, '30000'); assert.ok(data.pesoBrutoAdicionadoEm instanceof Date); assert.equal(user.userId, actor.id); return { id };
    });
    st.mock.method(service, 'listEligibleBuyersForOutput', async () => [{ id: '4', nome: 'Comprador' }]);
    st.mock.method(service, 'listEligibleContractsForOutput', async (id, buyer) => { assert.equal(buyer, '4'); return [{ id: '7' }]; });
    st.mock.method(service, 'associateScaleOutputToContract', async (id, buyer, contract, userId) => { assert.deepEqual([id, buyer, contract, userId], ['20', '4', '7', actor.id]); });
    st.mock.method(service, 'unlinkScaleOutputFromContract', async (id, user) => { assert.equal(user.userId, actor.id); });
    st.mock.method(service, 'splitScaleOutput', async (id, weight, user) => { assert.equal(weight, '12000'); assert.equal(user.userId, actor.id); return { id: '21' }; });
    st.mock.method(service, 'deleteScaleOutput', async (id, user) => { assert.equal(user.login, actor.login); });
    assert.equal((await request(server, 'POST', '/saidas', output)).status, 201);
    assert.equal((await request(server, 'GET', '/saidas/20')).data.saida_id, '20');
    assert.equal((await request(server, 'PUT', '/saidas/20', { ...output, peso_bruto_kg: null })).status, 200);
    assert.equal((await request(server, 'POST', '/saidas/20/bruto', { peso_bruto_kg: 30000 })).status, 200);
    assert.equal((await request(server, 'GET', '/saidas/20/compradores')).data.items[0].id, '4');
    assert.equal((await request(server, 'GET', '/saidas/20/contratos?comprador_id=4')).status, 200);
    assert.equal((await request(server, 'POST', '/saidas/20/associar', { comprador_id: 4, contrato_id: 7 })).status, 200);
    assert.equal((await request(server, 'POST', '/saidas/20/desvincular-contrato', {})).status, 200);
    assert.deepEqual((await request(server, 'POST', '/saidas/20/dividir', { peso_liquido_primeira_kg: 12000 })).data, { saida_original_id: '20', nova_saida_id: '21' });
    assert.equal((await request(server, 'POST', '/saidas/20/deletar', { motivo_delecao: 'Registro duplicado por erro de digitação.' })).status, 204);
  });

  await t.test('validation rejects coercion, spoofed actor, bad dates, weights and percentages before writes', async (st) => {
    st.mock.method(service, 'createScaleInput', () => assert.fail('must not write'));
    for (const change of [{ criado_por_user_id: 'someone' }, { placa_caminhao: {} }, { usar_tara_anterior: 'true' },
      { data_entrada: '2026-02-30T12:00' }, { data_entrada: '2026-10-14T12:00Z' }, { peso_bruto_kg: 80000 },
      { peso_bruto_kg: true }, { peso_bruto_kg: '30.000,000' }, { peso_bruto_kg: -1 }, { produto: 'arroz' }]) {
      assert.equal((await request(server, 'POST', '/entradas', { ...input, ...change })).status, 400);
    }
    assert.equal((await request(server, 'POST', '/entradas/10/classificacao', { umidade_percent: 101, impureza_percent: 1, graos_avariados_percent: 1 })).status, 400);
  });

  await t.test('not found, state conflicts and internal errors are distinct and sanitized', async (st) => {
    st.mock.method(service, 'getScaleInputById', async () => null);
    assert.equal((await request(server, 'GET', '/entradas/10')).status, 404);
    st.mock.method(service, 'associateScaleOutputToContract', async () => { throw Object.assign(new Error('Produto diferente.'), { code: 'STATE_CONFLICT' }); });
    assert.equal((await request(server, 'POST', '/saidas/20/associar', { comprador_id: 4, contrato_id: 7 })).status, 409);
    st.mock.method(service, 'deleteScaleInput', async () => { throw Object.assign(new Error('SQL private details'), { code: '23503' }); });
    const conflict = await request(server, 'POST', '/entradas/10/deletar', { motivo_delecao: 'Registro duplicado por erro de digitação.' });
    assert.equal(conflict.status, 409); assert.doesNotMatch(conflict.text, /SQL private/);
    st.mock.method(console, 'error', () => {});
    st.mock.method(service, 'getScaleInputById', async () => { throw new Error('password=supersecret'); });
    const fail = await request(server, 'GET', '/entradas/10');
    assert.equal(fail.status, 500); assert.doesNotMatch(fail.text, /supersecret|password/);
  });

  await t.test('report matches copy action and guards incomplete entries', async (st) => {
    let complete = false;
    st.mock.method(service, 'getScaleInputById', async () => ({ ...input, data_entrada: '2026-10-14T13:00:00Z',
      peso_tara_kg: 10000, peso_liquido_kg: 20000, origem: complete ? 'Fazenda X' : null,
      umidade_percent: '14', impureza_percent: '1', graos_avariados_percent: '0' }));
    assert.equal((await request(server, 'GET', '/entradas/10/relatorio')).status, 409);
    complete = true;
    assert.equal((await request(server, 'GET', '/entradas/10/relatorio')).data.texto,
      '14/10/2026 10:00\nABC1D23\nFazenda X\n20000kg\nUmidade: 14,0%');
  });

  await t.test('CSV, real PDF generation and NF data parity', async (st) => {
    st.mock.method(service, 'listScaleInputs', async () => [{ id: '10', ...input }]);
    st.mock.method(service, 'listScaleOutputs', async () => [{ id: '20', ...output }]);
    let complete = false;
    st.mock.method(service, 'getScaleInputDetailInfo', async () => ({ entrada_id: '10', ...input, peso_tara_kg: complete ? '10000' : null, peso_liquido_kg: complete ? '20000' : null }));
    st.mock.method(service, 'getScaleOutputDetailInfo', async () => ({ saida_id: '20', ...output, contrato_id: complete ? '7' : null, peso_bruto_kg: '30000', peso_liquido_kg: '20000' }));
    assert.equal((await request(server, 'GET', '/entradas/10/ticket.pdf')).status, 409);
    assert.equal((await request(server, 'GET', '/saidas/20/ticket.pdf')).status, 409);
    assert.equal((await request(server, 'GET', '/saidas/20/nf')).status, 409);
    complete = true;
    for (const path of ['/entradas/10/ticket.pdf', '/saidas/20/ticket.pdf']) {
      const res = await request(server, 'GET', path);
      assert.equal(res.status, 200); assert.match(res.headers['content-type'], /application\/pdf/);
      assert.equal(res.buffer.subarray(0, 4).toString(), '%PDF');
    }
    for (const path of ['/entradas.csv', '/saidas.csv']) {
      const res = await request(server, 'GET', path);
      assert.equal(res.status, 200); assert.match(res.headers['content-type'], /text\/csv/);
      assert.match(res.text, /ABC1D23/);
    }
    const invoice = await request(server, 'GET', '/saidas/20/nf');
    assert.equal(invoice.data.cfop, '5101');
    assert.equal(invoice.data.natureza_operacao, 'Venda');
    assert.equal(invoice.data.peso_liquido_ton, '20');
    assert.match(invoice.data.nome_nf, /ABC1D23 SOJA 20$/);
  });

  await t.test('legacy device endpoint remains isolated and ignores browser cookies', async (st) => {
    st.mock.method(pool, 'query', async (sql, values) => { assert.match(sql, /INSERT INTO balancas_pesos_atuais/); return { rows: [{ balanca_id: 1, peso_kg: values[1] }] }; });
    const res = await request(server, 'POST', '/api/balancas/1/peso', { peso_kg: 1234 }, {
      legacy: true, headers: { Authorization: `Bearer ${process.env.api_key}`, Cookie: 'broken=%GG' },
    });
    assert.equal(res.status, 200); assert.equal(res.data.peso_kg, 1234);
    assert.equal((await request(server, 'POST', '/api/balancas/1/peso', { peso_kg: 1234 }, { legacy: true })).status, 401);
  });
});

test('API login stores only a token digest, records login and rate-limits attempts', async (t) => {
  const passwordHash = await bcrypt.hash('test-only-password', 4);
  let account = { ...actor, password_hash: passwordHash };
  const recorded = [];
  const writes = [];
  t.mock.method(users, 'findUserByLogin', async () => account);
  t.mock.method(events, 'recordLoginEvent', async (data) => recorded.push(data));
  t.mock.method(pool, 'connect', async () => ({ release() {}, async query(sql, values) {
    writes.push({ sql, values });
    if (sql.includes('FOR UPDATE')) return { rows: [account] };
    if (sql.includes('RETURNING expira_em')) return { rows: [{ expira_em: '2026-10-14T20:00:00Z' }] };
    return { rows: [] };
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  loginLimiter.reset();
  const result = await request(server, 'POST', '/sessao', { login: 'operador', password: 'test-only-password' });
  assert.equal(result.status, 200);
  assert.match(result.data.access_token, /^[a-f0-9]{64}$/);
  assert.equal(result.data.expires_in, 57600);
  assert.equal(result.headers['cache-control'], 'no-store');
  const insert = writes.find(({ sql }) => sql.includes('INSERT INTO'));
  assert.equal(insert.values[2], 57600);
  assert.match(insert.sql, /now\(\) \+ \$3 \* interval '1 second'/);
  assert.equal(insert.values[0], auth.hashToken(result.data.access_token));
  assert.notEqual(insert.values[0], result.data.access_token);
  assert.doesNotMatch(JSON.stringify(recorded), /password_hash|test-only-password|access_token/);
  assert.equal((await request(server, 'POST', '/sessao', { login: 'operador', password: 'wrong' })).status, 401);
  account = { ...account, disabled: true };
  assert.equal((await request(server, 'POST', '/sessao', { login: 'operador', password: 'test-only-password' })).status, 401);
  account = { ...account, disabled: false, role: 'client' };
  assert.equal((await request(server, 'POST', '/sessao', { login: 'operador', password: 'test-only-password' })).status, 403);
  for (let i = 0; i < 6; i++) await request(server, 'POST', '/sessao', {});
  const limited = await request(server, 'POST', '/sessao', {});
  assert.equal(limited.status, 429); assert.ok(limited.headers['retry-after']);
  loginLimiter.reset();
});

test('ID and numeric boundaries preserve precision and reject invalid values', () => {
  assert.equal(validation.id('9223372036854775807'), '9223372036854775807');
  assert.throws(() => validation.id(9007199254740992));
  assert.throws(() => validation.id('9223372036854775808'));
  assert.throws(() => validation.fields({ body: { peso_tara_kg: '0.0001' } }, ['peso_tara_kg'], ['peso_tara_kg']));
});

test('database pagination uses SQL limit and offset', async (t) => {
  t.mock.method(pool, 'query', async (sql, values) => {
    assert.match(sql, /LIMIT \$1 OFFSET \$2/); assert.deepEqual(values, [51, 100]); return { rows: [] };
  });
  await service.listScaleInputs({ limit: 51, offset: 100 });
  await service.listScaleOutputs({ limit: 51, offset: 100 });
  await service.listOpenContractsForWeighbridge('nao-embarcados', { limit: 51, offset: 100 });
});
