const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.SESSION_SECRET = 'test-session-secret';
process.env.MAILERSEND_API_TOKEN = 'test-token';
process.env.MAILERSEND_FROM_EMAIL = 'from@example.com';
process.env.CONTACT_TO = 'to@example.com';

const app = require('../app');
const mailer = require('../routes/mailer');
const userService = require('../routes/user-service');
const { contactRateLimiter, loginRateLimiter } = require('../routes/rate-limit');
const { normalizeContactPayload, validateContactPayload } = require('../routes/contact-validation');

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

function form(data) {
  return new URLSearchParams(data).toString();
}

function validContact(overrides = {}) {
  return form({
    name: 'Cliente Teste',
    email: 'cliente@example.com',
    subject: 'Dúvida comercial',
    message: 'Olá, gostaria de receber mais informações sobre a AgroLima.',
    ...overrides,
  });
}

test('public abuse protection integration', async (t) => {
  const originalFindUserByLogin = userService.findUserByLogin;
  const originalSendMailerSendEmail = mailer.sendMailerSendEmail;
  const originalHasEmailConfig = mailer.hasEmailConfig;

  t.after(() => {
    userService.findUserByLogin = originalFindUserByLogin;
    mailer.sendMailerSendEmail = originalSendMailerSendEmail;
    mailer.hasEmailConfig = originalHasEmailConfig;
  });

  const server = app.listen(0);
  t.after(() => server.close());

  t.beforeEach(() => {
    loginRateLimiter.reset();
    contactRateLimiter.reset();
    userService.findUserByLogin = async () => null;
    mailer.hasEmailConfig = () => true;
  });

  await t.test('login abaixo do limite retorna erro normal sem 429', async () => {
    const response = await request(server, {
      method: 'POST',
      path: '/login',
      body: form({ login: 'inexistente', password: 'senha-incorreta' }),
    });

    assert.equal(response.statusCode, 401);
    assert.match(response.body, /Login não autorizado/);
  });

  await t.test('login acima do limite retorna 429', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(server, {
        method: 'POST',
        path: '/login',
        body: form({ login: 'inexistente', password: `senha-${attempt}` }),
      });
      assert.equal(response.statusCode, 401);
    }

    const blocked = await request(server, {
      method: 'POST',
      path: '/login',
      body: form({ login: 'inexistente', password: 'senha-bloqueada' }),
    });

    assert.equal(blocked.statusCode, 429);
    assert.match(blocked.body, /Muitas tentativas de acesso/);
  });

  await t.test('contato acima do limite não chama o mailer', async () => {
    let calls = 0;
    mailer.sendMailerSendEmail = async () => { calls += 1; };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(server, { method: 'POST', path: '/contato', body: validContact({ subject: `Assunto ${attempt}` }) });
      assert.equal(response.statusCode, 200);
    }

    const blocked = await request(server, { method: 'POST', path: '/contato', body: validContact({ subject: 'Assunto bloqueado' }) });

    assert.equal(blocked.statusCode, 429);
    assert.equal(calls, 5);
  });

  await t.test('honeypot preenchido responde como recebido sem enviar e-mail', async () => {
    let calls = 0;
    mailer.sendMailerSendEmail = async () => { calls += 1; };

    const response = await request(server, { method: 'POST', path: '/contato', body: validContact({ website: 'https://bot.example' }) });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /recebemos sua mensagem/i);
    assert.equal(calls, 0);
  });

  await t.test('payload válido ainda é enviado', async () => {
    let sentPayload;
    mailer.sendMailerSendEmail = async (payload) => { sentPayload = payload; };

    const response = await request(server, { method: 'POST', path: '/contato', body: validContact() });

    assert.equal(response.statusCode, 200);
    assert.equal(sentPayload.reply_to.email, 'cliente@example.com');
  });

  await t.test('payload excessivo retorna 413', async () => {
    const response = await request(server, {
      method: 'POST',
      path: '/contato',
      body: validContact({ message: 'x'.repeat(110 * 1024) }),
    });

    assert.equal(response.statusCode, 413);
  });
});

test('validação do contato cobre limites relevantes', () => {
  const cases = [
    { field: 'name', value: 'A' },
    { field: 'name', value: 'A'.repeat(101) },
    { field: 'email', value: 'email-invalido' },
    { field: 'email', value: `${'a'.repeat(245)}@example.com` },
    { field: 'subject', value: 'Oi' },
    { field: 'subject', value: 'A'.repeat(151) },
    { field: 'message', value: 'curta' },
    { field: 'message', value: 'A'.repeat(5001) },
  ];

  for (const item of cases) {
    const payload = normalizeContactPayload({
      name: 'Cliente Teste',
      email: 'cliente@example.com',
      subject: 'Dúvida comercial',
      message: 'Mensagem com tamanho suficiente.',
      [item.field]: item.value,
    });

    assert.equal(typeof validateContactPayload(payload), 'string', `expected ${item.field} to be invalid`);
  }

  assert.equal(validateContactPayload(normalizeContactPayload({
    name: ' Cliente Teste ',
    email: ' cliente@example.com ',
    subject: ' Dúvida comercial ',
    message: ' Mensagem com tamanho suficiente. ',
  })), null);
});
