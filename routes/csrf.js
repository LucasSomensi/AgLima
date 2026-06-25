const crypto = require('crypto');
const { SESSION_COOKIE_NAME } = require('./constants');
const { parseCookies } = require('./auth');

const CSRF_TOKEN_FIELD = '_csrf';
const CSRF_TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function getCsrfSecret() {
  if (process.env.CSRF_SECRET) {
    return process.env.CSRF_SECRET;
  }

  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  console.error('Missing CSRF_SECRET/SESSION_SECRET environment variable. Using an unsafe development fallback.');
  return 'unsafe-development-csrf-secret';
}

function sign(value) {
  return crypto.createHmac('sha256', getCsrfSecret()).update(value).digest('base64url');
}

function safeCompare(value, expectedValue) {
  const valueBuffer = Buffer.from(String(value || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expectedValue || ''), 'utf8');

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function getSessionCookie(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] || '';
}

function hashSessionCookie(sessionCookie) {
  return crypto.createHash('sha256').update(sessionCookie).digest('base64url');
}

function createCsrfToken(req) {
  const sessionCookie = getSessionCookie(req);
  const payload = Buffer.from(
    JSON.stringify({
      sessionHash: hashSessionCookie(sessionCookie),
      nonce: crypto.randomBytes(16).toString('base64url'),
      issuedAt: Date.now(),
    }),
    'utf8'
  ).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function validateCsrfToken(req, token) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature || !safeCompare(signature, sign(payload))) {
    return false;
  }

  try {
    const parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const issuedAt = Number(parsedPayload.issuedAt);

    if (!issuedAt || Date.now() - issuedAt > CSRF_TOKEN_MAX_AGE_MS) {
      return false;
    }

    return safeCompare(parsedPayload.sessionHash, hashSessionCookie(getSessionCookie(req)));
  } catch (error) {
    return false;
  }
}

function csrfProtection(req, res, next) {
  req.csrfToken = () => createCsrfToken(req);
  res.locals.csrfToken = req.csrfToken;

  const originalSend = res.send.bind(res);
  res.send = (body) => {
    if (typeof body === 'string') {
      body = body.replace(/{{CSRF_TOKEN}}/g, req.sessionUser ? req.csrfToken() : '');
    }

    return originalSend(body);
  };

  if (req.method === 'POST' && req.sessionUser && !validateCsrfToken(req, req.body?.[CSRF_TOKEN_FIELD])) {
    return res
      .status(403)
      .send('Não foi possível validar a segurança do formulário. Atualize a página e tente novamente.');
  }

  return next();
}

module.exports = {
  CSRF_TOKEN_FIELD,
  createCsrfToken,
  csrfProtection,
  validateCsrfToken,
};
