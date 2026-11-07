const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.SESSION_SECRET = 'test-session-secret';

const { ROLES, SESSION_COOKIE_NAME } = require('../routes/constants');
const { getClientIp, getClientIpHeader } = require('../routes/client-ip');
const { createIpRateLimiter, loginRateLimiter } = require('../routes/rate-limit');
const { assertSecurityConfig, getCsrfSecret, getSessionSecret } = require('../routes/security-config');
const { replacePlaceholders } = require('../routes/renderers/template-utils');
const { renderScaleInputOriginFormPage } = require('../routes/renderers/weighbridge-renderer');
const { createPool } = require('../routes/database');
const { escapeHtml } = require('../routes/utils');
const { attachSession, setSessionCookie } = require('../routes/auth');
const { createCsrfToken } = require('../routes/csrf');
const userService = require('../routes/user-service');
const authLoginService = require('../routes/auth-login-service');

function createCookieForUser(user) {
  const headers = {};
  setSessionCookie({ setHeader: (name, value) => { headers[name] = value; } }, user);
  return headers['Set-Cookie'].split(';')[0];
}

function runAttachSession(cookie) {
  const headers = {};
  const req = { headers: { cookie } };
  const res = { setHeader: (name, value) => { headers[name] = value; } };

  return new Promise((resolve, reject) => {
    attachSession(req, res, (error) => (error ? reject(error) : resolve({ req, headers })));
  });
}

function withEnv(t, values) {
  const original = {};

  for (const [name, value] of Object.entries(values)) {
    original[name] = process.env[name];

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  t.after(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
}

function request(server, { method = 'GET', path = '/', body = '', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      method,
      port: server.address().port,
      path,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// --- IP do cliente atrás do proxy -------------------------------------------

test('no Railway, o IP do cliente vem de X-Real-IP e não do socket do proxy', () => {
  const env = { RAILWAY_PROJECT_ID: 'projeto' };
  const req = { ip: '100.64.0.2', headers: { 'x-real-ip': '203.0.113.7' } };

  assert.equal(getClientIpHeader(env), 'x-real-ip');
  assert.equal(getClientIp(req, env), '203.0.113.7');
});

test('fora do Railway, cabeçalhos de IP são ignorados por padrão', () => {
  const req = { ip: '198.51.100.4', headers: { 'x-real-ip': '203.0.113.7' } };

  assert.equal(getClientIpHeader({}), null);
  assert.equal(getClientIp(req, {}), '198.51.100.4');
});

test('CLIENT_IP_HEADER permite escolher ou desativar o cabeçalho', () => {
  const req = { ip: '10.0.0.1', headers: { 'x-real-ip': '203.0.113.7', 'cf-connecting-ip': '192.0.2.9' } };

  assert.equal(getClientIp(req, { CLIENT_IP_HEADER: 'CF-Connecting-IP' }), '192.0.2.9');
  assert.equal(getClientIp(req, { CLIENT_IP_HEADER: '', RAILWAY_PROJECT_ID: 'projeto' }), '10.0.0.1');
});

test('valor de cabeçalho que não é um IP válido cai para o IP da conexão', () => {
  const env = { RAILWAY_PROJECT_ID: 'projeto' };

  assert.equal(getClientIp({ ip: '10.0.0.1', headers: { 'x-real-ip': '1.2.3.4, 5.6.7.8' } }, env), '10.0.0.1');
  assert.equal(getClientIp({ ip: '10.0.0.1', headers: { 'x-real-ip': 'desconhecido' } }, env), '10.0.0.1');
  assert.equal(getClientIp({ headers: {} }, env), null);
});

test('rate limit conta clientes diferentes separadamente atrás do mesmo proxy', (t) => {
  withEnv(t, { RAILWAY_PROJECT_ID: 'projeto', CLIENT_IP_HEADER: undefined });
  const limiter = createIpRateLimiter({ windowMs: 60_000, max: 2, message: 'bloqueado' });

  function hit(clientIp) {
    let statusCode = 200;
    let passed = false;
    const req = { ip: '100.64.0.2', headers: { 'x-real-ip': clientIp } };
    const res = {
      setHeader() {},
      status(code) { statusCode = code; return this; },
      send() { return this; },
    };
    limiter(req, res, () => { passed = true; });
    return passed ? 200 : statusCode;
  }

  assert.equal(hit('203.0.113.1'), 200);
  assert.equal(hit('203.0.113.1'), 200);
  assert.equal(hit('203.0.113.1'), 429);
  // Antes, todos compartilhavam o IP do proxy e este cliente também seria bloqueado.
  assert.equal(hit('203.0.113.2'), 200);
});

test('POST /login registra o IP real do cliente no histórico', async (t) => {
  withEnv(t, { RAILWAY_PROJECT_ID: 'projeto', CLIENT_IP_HEADER: undefined });
  const app = require('../app');
  const recorded = [];
  t.mock.method(userService, 'findUserByLogin', async () => null);
  t.mock.method(authLoginService, 'recordLoginEvent', async (event) => { recorded.push(event); });
  loginRateLimiter.reset();
  t.after(() => loginRateLimiter.reset());

  const server = app.listen(0);
  t.after(() => server.close());

  const response = await request(server, {
    method: 'POST',
    path: '/login',
    body: 'login=ninguem&password=errada',
    headers: { 'X-Real-IP': '203.0.113.50' },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].ipAddress, '203.0.113.50');
});

// --- Segredos obrigatórios em produção ----------------------------------------

test('em produção, o servidor não inicia sem SESSION_SECRET', () => {
  assert.throws(() => assertSecurityConfig({ NODE_ENV: 'production' }), /SESSION_SECRET é obrigatório/);
  assert.throws(() => assertSecurityConfig({ NODE_ENV: 'production', SESSION_SECRET: '   ' }), /SESSION_SECRET é obrigatório/);
});

test('em produção, segredos de exemplo da documentação são recusados', () => {
  assert.throws(
    () => assertSecurityConfig({ NODE_ENV: 'production', SESSION_SECRET: 'troque-por-uma-string-longa-e-aleatoria' }),
    /SESSION_SECRET está com um valor de exemplo/
  );
  assert.throws(
    () => assertSecurityConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'x'.repeat(48),
      CSRF_SECRET: 'unsafe-development-csrf-secret',
    }),
    /CSRF_SECRET está com um valor de exemplo/
  );
});

test('em produção, um segredo válido é aceito', () => {
  assert.doesNotThrow(() => assertSecurityConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(48) }));
});

test('em produção, assinar sessão ou CSRF sem segredo lança erro em vez de usar fallback', () => {
  assert.throws(() => getSessionSecret({ NODE_ENV: 'production' }), /SESSION_SECRET é obrigatório/);
  assert.throws(() => getCsrfSecret({ NODE_ENV: 'production' }), /obrigatório em produção/);
  assert.equal(getCsrfSecret({ NODE_ENV: 'production', SESSION_SECRET: 'segredo' }), 'segredo');
});

test('fora de produção, o fallback de desenvolvimento continua disponível', () => {
  assert.doesNotThrow(() => assertSecurityConfig({}));
  assert.equal(getSessionSecret({}), 'unsafe-development-session-secret');
  assert.equal(getCsrfSecret({}), 'unsafe-development-csrf-secret');
});

// --- Placeholders com caracteres especiais ------------------------------------

test('replacePlaceholders insere valores com $ literalmente', () => {
  const template = '<p>Origem: {{ORIGEM}}</p><form>resto</form>';

  for (const value of ["Fazenda $' X", 'Fazenda $` X', 'Fazenda $& X', 'R$ 1.000,00 $1']) {
    assert.equal(replacePlaceholders(template, { ORIGEM: value }), `<p>Origem: ${value}</p><form>resto</form>`);
  }
});

test('replacePlaceholders não expande placeholders contidos nos valores e preserva os desconhecidos', () => {
  const html = replacePlaceholders('{{A}}|{{B}}|{{CSRF_TOKEN}}|{{A}}', { A: '{{B}}', B: 'segredo', C: null });

  assert.equal(html, '{{B}}|segredo|{{CSRF_TOKEN}}|{{B}}');
  assert.equal(replacePlaceholders('[{{C}}]', { C: null }), '[]');
  assert.equal(replacePlaceholders('[{{C}}]', { C: 0 }), '[0]');
});

test('página de origem da entrada exibe origem com $ sem duplicar o template', () => {
  let html = '';
  const origem = "Sítio $' do $` Vale $&";

  renderScaleInputOriginFormPage({ send: (body) => { html = body; } }, {
    input: {
      id: 'b7d1c1a0-0000-4000-8000-000000000001',
      data_entrada: '2026-11-07T10:00:00.000Z',
      placa_caminhao: 'ABC1D23',
      produto: 'soja',
      origem,
    },
  });

  assert.ok(html.includes(`value="${escapeHtml(origem)}"`), 'origem deve aparecer exatamente como digitada');
  assert.equal(html.split('<form').length - 1, 1, 'o formulário não pode ser duplicado');
  assert.equal(html.split('</html>').length - 1, 1, 'o documento não pode ser duplicado');
});

// --- Pool do PostgreSQL ---------------------------------------------------------

test('erro em conexão ociosa do pool é registrado sem derrubar o processo', async (t) => {
  const pool = createPool('postgresql://usuario:senha@127.0.0.1:1/banco');
  t.after(() => pool.end());
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.join(' ')); });

  assert.ok(pool.listenerCount('error') > 0);
  assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('terminating connection'), { code: '57P01' })));
  assert.equal(logged.length, 1);
  assert.match(logged[0], /57P01/);
  assert.doesNotMatch(logged[0], /senha/);
});

// --- Revogação de sessões web ----------------------------------------------------

test('cookie emitido com a versão atual do usuário continua válido', async (t) => {
  t.mock.method(userService, 'findActiveUserById', async () => ({
    id: 'u1', login: 'operador', role: ROLES.ADMIN, disabled: false, must_change_password: false, session_version: 3,
  }));

  const cookie = createCookieForUser({ id: 'u1', login: 'operador', role: ROLES.ADMIN, session_version: 3 });
  const { req, headers } = await runAttachSession(cookie);

  assert.equal(req.sessionUser.userId, 'u1');
  assert.equal(headers['Set-Cookie'], undefined);
});

test('cookie de versão anterior (após logout ou troca de senha) é recusado e apagado', async (t) => {
  t.mock.method(userService, 'findActiveUserById', async () => ({
    id: 'u1', login: 'operador', role: ROLES.ADMIN, disabled: false, must_change_password: false, session_version: 4,
  }));

  const cookie = createCookieForUser({ id: 'u1', login: 'operador', role: ROLES.ADMIN, session_version: 3 });
  const { req, headers } = await runAttachSession(cookie);

  assert.equal(req.sessionUser, null);
  assert.match(headers['Set-Cookie'], new RegExp(`${SESSION_COOKIE_NAME}=;`));
  assert.match(headers['Set-Cookie'], /Max-Age=0/);
});

test('cookie antigo sem versão é recusado depois que a migration é aplicada', async (t) => {
  t.mock.method(userService, 'findActiveUserById', async () => ({
    id: 'u1', login: 'operador', role: ROLES.ADMIN, disabled: false, must_change_password: false, session_version: 1,
  }));

  const cookie = createCookieForUser({ id: 'u1', login: 'operador', role: ROLES.ADMIN });
  const { req } = await runAttachSession(cookie);

  assert.equal(req.sessionUser, null);
});

test('sem a migration (session_version nulo), as sessões continuam funcionando', async (t) => {
  t.mock.method(userService, 'findActiveUserById', async () => ({
    id: 'u1', login: 'operador', role: ROLES.ADMIN, disabled: false, must_change_password: false, session_version: null,
  }));

  const cookie = createCookieForUser({ id: 'u1', login: 'operador', role: ROLES.ADMIN, session_version: null });
  const { req } = await runAttachSession(cookie);

  assert.equal(req.sessionUser.userId, 'u1');
});

test('POST /logout revoga as sessões do usuário no servidor', async (t) => {
  const app = require('../app');
  const user = { id: 'u9', login: 'admin1', role: ROLES.ADMIN, disabled: false, must_change_password: false, session_version: 7 };
  const revoked = [];
  t.mock.method(userService, 'findActiveUserById', async () => user);
  t.mock.method(userService, 'revokeUserSessions', async (userId) => { revoked.push(userId); return true; });

  const server = app.listen(0);
  t.after(() => server.close());

  const cookie = createCookieForUser(user);
  const csrf = createCsrfToken({ headers: { cookie } });
  const response = await request(server, {
    method: 'POST',
    path: '/logout',
    body: new URLSearchParams({ _csrf: csrf }).toString(),
    headers: { Cookie: cookie },
  });

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/login');
  assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  assert.deepEqual(revoked, ['u9']);
});

test('POST /logout conclui o logout mesmo se a revogação falhar', async (t) => {
  const app = require('../app');
  const user = { id: 'u9', login: 'admin1', role: ROLES.ADMIN, disabled: false, must_change_password: false, session_version: 7 };
  t.mock.method(userService, 'findActiveUserById', async () => user);
  t.mock.method(userService, 'revokeUserSessions', async () => { throw new Error('banco fora do ar'); });
  t.mock.method(console, 'error', () => {});

  const server = app.listen(0);
  t.after(() => server.close());

  const cookie = createCookieForUser(user);
  const csrf = createCsrfToken({ headers: { cookie } });
  const response = await request(server, {
    method: 'POST',
    path: '/logout',
    body: new URLSearchParams({ _csrf: csrf }).toString(),
    headers: { Cookie: cookie },
  });

  assert.equal(response.statusCode, 302);
  assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
});
