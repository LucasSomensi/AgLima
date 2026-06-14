const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_SECRET = 'test-session-secret';
const { ROLES, SESSION_COOKIE_NAME } = require('../routes/constants');
const userService = require('../routes/user-service');
const { attachSession, setSessionCookie } = require('../routes/auth');

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
    attachSession(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ req, headers });
    });
  });
}

test('attachSession reloads the current user and role from the database', async (t) => {
  const originalFindActiveUserById = userService.findActiveUserById;
  t.after(() => { userService.findActiveUserById = originalFindActiveUserById; });

  userService.findActiveUserById = async (userId) => {
    assert.equal(userId, 123);
    return {
      id: 123,
      login: 'operador',
      role: ROLES.ADMIN,
      disabled: false,
      must_change_password: true,
    };
  };

  const cookie = createCookieForUser({ id: 123, login: 'operador', role: ROLES.CLIENT });
  const { req, headers } = await runAttachSession(cookie);

  assert.equal(req.sessionUser.userId, 123);
  assert.equal(req.sessionUser.login, 'operador');
  assert.equal(req.sessionUser.role, ROLES.ADMIN);
  assert.equal(req.sessionUser.disabled, false);
  assert.equal(req.sessionUser.must_change_password, true);
  assert.equal(headers['Set-Cookie'], undefined);
});

test('attachSession clears the session and expires the cookie for a disabled user', async (t) => {
  const originalFindActiveUserById = userService.findActiveUserById;
  t.after(() => { userService.findActiveUserById = originalFindActiveUserById; });

  userService.findActiveUserById = async () => ({
    id: 456,
    login: 'desativado',
    role: ROLES.ADMIN,
    disabled: true,
    must_change_password: false,
  });

  const cookie = createCookieForUser({ id: 456, login: 'desativado', role: ROLES.ADMIN });
  const { req, headers } = await runAttachSession(cookie);

  assert.equal(req.sessionUser, null);
  assert.match(headers['Set-Cookie'], new RegExp(`${SESSION_COOKIE_NAME}=;`));
  assert.match(headers['Set-Cookie'], /Max-Age=0/);
});

test('attachSession clears the session and expires the cookie for a removed user', async (t) => {
  const originalFindActiveUserById = userService.findActiveUserById;
  t.after(() => { userService.findActiveUserById = originalFindActiveUserById; });

  userService.findActiveUserById = async () => null;

  const cookie = createCookieForUser({ id: 789, login: 'removido', role: ROLES.ADMIN });
  const { req, headers } = await runAttachSession(cookie);

  assert.equal(req.sessionUser, null);
  assert.match(headers['Set-Cookie'], new RegExp(`${SESSION_COOKIE_NAME}=;`));
  assert.match(headers['Set-Cookie'], /Max-Age=0/);
});
