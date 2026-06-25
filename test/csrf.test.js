const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_SECRET = 'test-session-secret';
process.env.CSRF_SECRET = 'test-csrf-secret';

const { ROLES } = require('../routes/constants');
const { csrfProtection } = require('../routes/csrf');
const { setSessionCookie } = require('../routes/auth');

function createSessionCookie() {
  const headers = {};
  setSessionCookie({ setHeader: (name, value) => { headers[name] = value; } }, {
    id: 10,
    login: 'operador',
    role: ROLES.ADMIN,
  });

  return headers['Set-Cookie'].split(';')[0];
}

function createResponse() {
  return {
    locals: {},
    statusCode: 200,
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function runMiddleware(req) {
  const res = createResponse();
  let nextCalled = false;

  csrfProtection(req, res, (error) => {
    if (error) {
      throw error;
    }
    nextCalled = true;
  });

  return { res, nextCalled };
}

test('csrfProtection accepts authenticated POST with a valid token', () => {
  const cookie = createSessionCookie();
  const getReq = {
    method: 'GET',
    headers: { cookie },
    body: {},
    sessionUser: { userId: 10, role: ROLES.ADMIN },
  };
  runMiddleware(getReq);
  const token = getReq.csrfToken();

  const postReq = {
    method: 'POST',
    headers: { cookie },
    body: { _csrf: token },
    sessionUser: { userId: 10, role: ROLES.ADMIN },
  };
  const { res, nextCalled } = runMiddleware(postReq);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('csrfProtection rejects authenticated POST without token', () => {
  const postReq = {
    method: 'POST',
    headers: { cookie: createSessionCookie() },
    body: {},
    sessionUser: { userId: 10, role: ROLES.ADMIN },
  };
  const { res, nextCalled } = runMiddleware(postReq);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /Atualize a página e tente novamente/);
});

test('csrfProtection rejects authenticated POST with invalid token', () => {
  const postReq = {
    method: 'POST',
    headers: { cookie: createSessionCookie() },
    body: { _csrf: 'invalid-token' },
    sessionUser: { userId: 10, role: ROLES.ADMIN },
  };
  const { res, nextCalled } = runMiddleware(postReq);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /segurança do formulário/);
});
