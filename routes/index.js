const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { Pool } = require('pg');
const router = express.Router();

const MAILERSEND_API_URL = 'https://api.mailersend.com/v1/email';
const ROOT_LOGIN = 'root';
const BCRYPT_SALT_ROUNDS = 12;
const SESSION_COOKIE_NAME = 'agrolima_session';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 8;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

function getSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  console.error('Missing SESSION_SECRET environment variable. Using an unsafe development fallback.');
  return 'unsafe-development-session-secret';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function createSessionToken(user) {
  const payload = base64UrlEncode(
    JSON.stringify({
      userId: user.id,
      login: user.login,
      role: user.role,
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

function attachSession(req, res, next) {
  req.sessionUser = readSession(req);
  next();
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

  if (req.sessionUser.role !== 'root') {
    return res.status(403).send('Acesso permitido apenas para o usuário root.');
  }

  return next();
}

function ensureDatabaseConfigured() {
  if (!pool) {
    throw new Error('Missing DATABASE_URL environment variable.');
  }
}

async function findUserByLogin(login) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, login, password_hash, role, disabled, must_change_password
      FROM users
      WHERE login = $1
      LIMIT 1
    `,
    [login]
  );

  return result.rows[0] || null;
}

async function listManagedUsers() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, login, role, disabled, must_change_password, created_at
      FROM users
      ORDER BY CASE WHEN login = $1 THEN 0 ELSE 1 END, login ASC
    `,
    [ROOT_LOGIN]
  );

  return result.rows;
}

async function createManagedUser({ login, password, role }) {
  ensureDatabaseConfigured();

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  await pool.query(
    `
      INSERT INTO users (login, password_hash, role)
      VALUES ($1, $2, $3)
    `,
    [login, passwordHash, role]
  );
}

async function deleteManagedUser(userId, currentUserId) {
  ensureDatabaseConfigured();

  await pool.query(
    `
      DELETE FROM users
      WHERE id = $1
        AND id <> $2
        AND login <> $3
    `,
    [userId, currentUserId, ROOT_LOGIN]
  );
}

function buildAdminRedirect(params) {
  const searchParams = new URLSearchParams(params);

  return `/admin/usuarios?${searchParams.toString()}`;
}

function buildAlertHtml(message, type = 'success') {
  if (!message) {
    return '';
  }

  const cssClass = type === 'error' ? 'login-error' : 'admin-success';
  return `<p class="${cssClass}" role="alert">${escapeHtml(message)}</p>`;
}

function renderLoginPage(res, { unauthorized = false, systemError = false } = {}) {
  const loginPath = path.join(__dirname, '../views/login.html');
  const errorMessage = unauthorized
    ? '<p class="login-error" role="alert">Login não autorizado. Confira o login e a senha e tente novamente.</p>'
    : systemError
      ? '<p class="login-error" role="alert">Não foi possível acessar o sistema agora. Tente novamente mais tarde.</p>'
      : '';
  const loginHtml = fs.readFileSync(loginPath, 'utf8').replace('{{LOGIN_ERROR}}', errorMessage);

  res.status(unauthorized ? 401 : systemError ? 500 : 200).send(loginHtml);
}

function renderAdminUsersPage(res, { users, message, error }) {
  const adminPath = path.join(__dirname, '../views/admin-users.html');
  const rowsHtml = users
    .map((user) => {
      const createdAt = user.created_at
        ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
            new Date(user.created_at)
          )
        : '-';
      const canDelete = user.login !== ROOT_LOGIN;
      const deleteAction = canDelete
        ? `
            <form action="/admin/usuarios/${escapeHtml(user.id)}/remover" method="post" onsubmit="return confirm('Remover este usuário do sistema?');">
              <button class="btn-danger-action" type="submit">Remover</button>
            </form>
          `
        : '<span class="admin-muted">Protegido</span>';

      return `
        <tr>
          <td>${escapeHtml(user.login)}</td>
          <td>${escapeHtml(user.role)}</td>
          <td>${user.disabled ? 'Inativo' : 'Ativo'}</td>
          <td>${user.must_change_password ? 'Sim' : 'Não'}</td>
          <td>${escapeHtml(createdAt)}</td>
          <td>${deleteAction}</td>
        </tr>
      `;
    })
    .join('');
  const emptyState = users.length
    ? ''
    : '<tr><td colspan="6">Nenhum usuário cadastrado.</td></tr>';

  const adminHtml = fs
    .readFileSync(adminPath, 'utf8')
    .replace('{{ADMIN_MESSAGE}}', buildAlertHtml(message))
    .replace('{{ADMIN_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{USERS_ROWS}}', rowsHtml || emptyState);

  res.send(adminHtml);
}

function hasEmailConfig() {
  return Boolean(
    process.env.MAILERSEND_API_TOKEN &&
      process.env.MAILERSEND_FROM_EMAIL &&
      process.env.CONTACT_TO
  );
}

function sendMailerSendEmail(payload) {
  const requestBody = JSON.stringify(payload);
  const url = new URL(MAILERSEND_API_URL);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.MAILERSEND_API_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }

          const error = new Error(`MailerSend request failed with status ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.responseBody = responseBody;
          reject(error);
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(new Error('MailerSend request timed out'));
    });

    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });
}

function buildContactEmail({ name, email, subject, message }) {
  const fromName = process.env.MAILERSEND_FROM_NAME || 'AgroLima';
  const toName = process.env.CONTACT_TO_NAME || 'AgroLima';

  return {
    from: {
      email: process.env.MAILERSEND_FROM_EMAIL,
      name: fromName,
    },
    to: [
      {
        email: process.env.CONTACT_TO,
        name: toName,
      },
    ],
    reply_to: {
      email,
      name,
    },
    subject: `[Contato AgroLima] ${subject}`,
    text: `Nome: ${name}\nE-mail: ${email}\nAssunto: ${subject}\n\nMensagem:\n${message}`,
    html: `
      <h2>Nova mensagem do site AgroLima</h2>
      <p><strong>Nome:</strong> ${escapeHtml(name)}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(email)}</p>
      <p><strong>Assunto:</strong> ${escapeHtml(subject)}</p>
      <p><strong>Mensagem:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    `,
  };
}

router.use(attachSession);

// Serve the index.html file for the root route
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

router.get('/contato', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/contact.html'));
});

router.post('/contato', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).send('Por favor, preencha todos os campos do formulário.');
  }

  if (!hasEmailConfig()) {
    console.error('Missing MailerSend configuration for contact form.');
    return res
      .status(500)
      .send('Não foi possível enviar sua mensagem agora. Tente novamente mais tarde.');
  }

  try {
    await sendMailerSendEmail(buildContactEmail({ name, email, subject, message }));

    return res.sendFile(path.join(__dirname, '../views/contact-received.html'));
  } catch (error) {
    console.error('Error sending contact email with MailerSend:', {
      message: error.message,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
    return res
      .status(500)
      .send('Não foi possível enviar sua mensagem agora. Tente novamente mais tarde.');
  }
});

router.get('/login', (req, res) => {
  if (req.sessionUser) {
    return res.redirect(req.sessionUser.role === 'root' ? '/admin/usuarios' : '/area-interna');
  }

  return renderLoginPage(res);
});

router.post('/login', async (req, res) => {
  const { login, password } = req.body;

  try {
    const user = await findUserByLogin(login);
    const isAuthorized =
      user &&
      !user.disabled &&
      (await bcrypt.compare(String(password || ''), user.password_hash));

    if (!isAuthorized) {
      return renderLoginPage(res, { unauthorized: true });
    }

    setSessionCookie(res, user);
    return res.redirect(user.role === 'root' ? '/admin/usuarios' : '/area-interna');
  } catch (error) {
    console.error('Error authenticating user:', error.message);
    return renderLoginPage(res, { systemError: true });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return res.redirect('/login');
});

router.get('/area-interna', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/construction.html'));
});

router.get('/admin/usuarios', requireRoot, async (req, res) => {
  try {
    const users = await listManagedUsers();
    return renderAdminUsersPage(res, {
      users,
      message: req.query.created ? 'Usuário criado com sucesso.' : req.query.deleted ? 'Usuário removido com sucesso.' : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error listing users:', error.message);
    return res.status(500).send('Não foi possível carregar os usuários agora.');
  }
});

router.post('/admin/usuarios', requireRoot, async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const role = ['admin', 'user'].includes(req.body.role) ? req.body.role : 'user';

  if (!login || !password) {
    return res.redirect(buildAdminRedirect({ error: 'Informe login e senha para criar o usuário.' }));
  }

  if (login === ROOT_LOGIN) {
    return res.redirect(buildAdminRedirect({ error: 'O login root já é reservado pelo sistema.' }));
  }

  try {
    await createManagedUser({ login, password, role });
    return res.redirect(buildAdminRedirect({ created: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildAdminRedirect({ error: 'Já existe um usuário com esse login.' }));
    }

    console.error('Error creating user:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível criar o usuário agora.' }));
  }
});

router.post('/admin/usuarios/:id/remover', requireRoot, async (req, res) => {
  try {
    await deleteManagedUser(req.params.id, req.sessionUser.userId);
    return res.redirect(buildAdminRedirect({ deleted: '1' }));
  } catch (error) {
    console.error('Error deleting user:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível remover o usuário agora.' }));
  }
});

module.exports = router;
