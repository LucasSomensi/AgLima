const crypto = require('crypto');
const { ROLES, SESSION_COOKIE_NAME, SESSION_DURATION_MS } = require('./constants');
const userService = require('./user-service');
const { getSessionSecret } = require('./security-config');

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signSessionPayload(payload) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

function safeCompare(value, expectedValue) {
  const valueBuffer = Buffer.from(String(value || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expectedValue || ''), 'utf8');

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce((cookies, cookie) => {
    const [rawName, ...rawValue] = cookie.trim().split('=');

    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValue.join('='));
    return cookies;
  }, {});
}

function normalizeSessionVersion(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

// Uma sessão só vale enquanto a versão gravada no cookie for a versão atual do
// usuário no banco. Logout, troca de senha, de perfil ou desativação incrementam
// essa versão. Se a coluna ainda não existir (migration pendente), o banco
// devolve null e a verificação é ignorada.
function isSessionVersionCurrent(session, user) {
  const currentVersion = normalizeSessionVersion(user.session_version);

  if (currentVersion === null) {
    return true;
  }

  return session.sessionVersion === currentVersion;
}

function createSessionToken(user) {
  const payload = base64UrlEncode(
    JSON.stringify({
      userId: user.id,
      login: user.login,
      role: user.role,
      sessionVersion: normalizeSessionVersion(user.session_version),
      expiresAt: Date.now() + SESSION_DURATION_MS,
    })
  );
  const signature = signSessionPayload(payload);

  return `${payload}.${signature}`;
}

function readSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature || !safeCompare(signature, signSessionPayload(payload))) {
    return null;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload));

    if (!session.expiresAt || session.expiresAt < Date.now()) {
      return null;
    }

    return session;
  } catch (error) {
    return null;
  }
}

function setSessionCookie(res, user) {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken(user))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`,
  ];

  if (isProduction) {
    cookieParts.push('Secure');
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

async function attachSession(req, res, next) {
  const session = readSession(req);

  if (!session) {
    req.sessionUser = null;
    return next();
  }

  try {
    const user = await userService.findActiveUserById(session.userId);

    if (!user || user.disabled || !isSessionVersionCurrent(session, user)) {
      req.sessionUser = null;
      clearSessionCookie(res);
      return next();
    }

    req.sessionUser = {
      userId: user.id,
      login: user.login,
      role: user.role,
      disabled: user.disabled,
      must_change_password: user.must_change_password,
      expiresAt: session.expiresAt,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.sessionUser) {
    return res.redirect('/login');
  }

  return next();
}

function requireRoot(req, res, next) {
  if (!req.sessionUser) {
    return res.redirect('/login');
  }

  if (req.sessionUser.role !== ROLES.ROOT) {
    return res.status(403).send('Acesso permitido apenas para o usuário root.');
  }

  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.sessionUser) {
      return res.redirect('/login');
    }

    if (!roles.includes(req.sessionUser.role)) {
      return res.status(403).send('Você não tem permissão para acessar esta área.');
    }

    return next();
  };
}

module.exports = {
  attachSession,
  clearSessionCookie,
  parseCookies,
  requireAuth,
  requireRole,
  requireRoot,
  setSessionCookie,
};
