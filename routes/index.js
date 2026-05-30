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
const ROLES = {
  ROOT: 'root',
  ADMIN: 'admin',
  CLIENT: 'client',
  WEIGHBRIDGE_OPERATOR: 'weighbridge_operator',
  SILO_OPERATOR: 'silo_operator',
};
const MANAGED_ROLES = [
  ROLES.ADMIN,
  ROLES.CLIENT,
  ROLES.WEIGHBRIDGE_OPERATOR,
  ROLES.SILO_OPERATOR,
];
const ROLE_LABELS = {
  [ROLES.ROOT]: 'Root',
  [ROLES.ADMIN]: 'Administrador',
  [ROLES.CLIENT]: 'Cliente',
  [ROLES.WEIGHBRIDGE_OPERATOR]: 'Operador de balança',
  [ROLES.SILO_OPERATOR]: 'Operador de silo',
};
const GRAIN_LABELS = {
  corn: 'Milho',
  soy: 'Soja',
};
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


async function updateManagedUserPassword(userId, password) {
  ensureDatabaseConfigured();

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  await pool.query(
    `
      UPDATE users
      SET password_hash = $1,
          must_change_password = false
      WHERE id = $2
        AND login <> $3
    `,
    [passwordHash, userId, ROOT_LOGIN]
  );
}


function getRoleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function getHomePathForRole(role) {
  if (role === ROLES.ROOT) {
    return '/admin/usuarios';
  }

  if (role === ROLES.SILO_OPERATOR) {
    return '/secador';
  }

  return '/area-interna';
}

function parseOptionalDateTime(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return new Date();
  }

  const parsedDate = new Date(rawValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function toDateTimeLocalValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMoisture(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function parseMoisturePercent(rawValue) {
  const normalizedValue = String(rawValue || '').trim().replace(',', '.');

  if (!/^\d{1,2}(?:\.\d)?$|^40(?:\.0)?$/.test(normalizedValue)) {
    return null;
  }

  const value = Number(normalizedValue);

  if (!Number.isFinite(value) || value < 7 || value > 40) {
    return null;
  }

  return Number(value.toFixed(1));
}

function buildDryerRedirect(params) {
  const searchParams = new URLSearchParams(params);

  return `/secador?${searchParams.toString()}`;
}

async function getDryerSettings() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT target_moisture
      FROM dryer_settings
      WHERE id = true
      LIMIT 1
    `
  );

  return result.rows[0] || { target_moisture: '14.5' };
}

async function getActiveDryerBatch() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, grain_type, status, started_at, target_moisture, created_at
      FROM dryer_batches
      WHERE status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `
  );

  return result.rows[0] || null;
}

async function listDryerMoistureReadings(batchId) {
  ensureDatabaseConfigured();

  if (!batchId) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT id, measured_at, moisture_percent, measured_by_login, created_at
      FROM dryer_moisture_readings
      WHERE batch_id = $1
      ORDER BY measured_at ASC, created_at ASC
    `,
    [batchId]
  );

  return result.rows;
}

async function startDryerBatch({ startedAt, grainType, user }) {
  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260530)');

    await client.query(
      `
        UPDATE dryer_batches
        SET status = 'completed',
            completed_at = $1,
            completed_by_user_id = $2,
            updated_at = now()
        WHERE status = 'active'
      `,
      [startedAt, user.userId]
    );

    const settingsResult = await client.query(
      `
        SELECT target_moisture
        FROM dryer_settings
        WHERE id = true
        LIMIT 1
      `
    );
    const targetMoisture = settingsResult.rows[0]?.target_moisture || 14.5;

    const insertResult = await client.query(
      `
        INSERT INTO dryer_batches (
          grain_type,
          status,
          started_at,
          started_by_user_id,
          target_moisture
        )
        VALUES ($1, 'active', $2, $3, $4)
        RETURNING id
      `,
      [grainType, startedAt, user.userId, targetMoisture]
    );

    await client.query('COMMIT');
    return insertResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function addDryerMoistureReading({ measuredAt, moisturePercent, user }) {
  ensureDatabaseConfigured();

  const activeBatch = await getActiveDryerBatch();

  if (!activeBatch) {
    const error = new Error('Não há batelada ativa. Inicie uma nova batelada antes de lançar umidade.');
    error.code = 'NO_ACTIVE_BATCH';
    throw error;
  }

  await pool.query(
    `
      INSERT INTO dryer_moisture_readings (
        batch_id,
        measured_at,
        moisture_percent,
        measured_by_user_id,
        measured_by_login
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [activeBatch.id, measuredAt, moisturePercent, user.userId, user.login]
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
      const createdAt = formatDateTime(user.created_at);
      const canDelete = user.login !== ROOT_LOGIN;
      const actions = canDelete
        ? `
            <div class="admin-actions-stack">
              <form class="admin-password-form" action="/admin/usuarios/${escapeHtml(user.id)}/senha" method="post">
                <label class="sr-only" for="password-${escapeHtml(user.id)}">Nova senha para ${escapeHtml(user.login)}</label>
                <input class="form-control" id="password-${escapeHtml(user.id)}" name="password" type="password" placeholder="Nova senha" autocomplete="new-password" required>
                <button class="btn-secondary-action admin-small-action" type="submit">Definir senha</button>
              </form>
              <form action="/admin/usuarios/${escapeHtml(user.id)}/remover" method="post" onsubmit="return confirm('Remover este usuário do sistema?');">
                <button class="btn-danger-action" type="submit">Remover</button>
              </form>
            </div>
          `
        : '<span class="admin-muted">Protegido</span>';

      return `
        <tr>
          <td>${escapeHtml(user.login)}</td>
          <td>${escapeHtml(getRoleLabel(user.role))}</td>
          <td>${user.disabled ? 'Inativo' : 'Ativo'}</td>
          <td>${user.must_change_password ? 'Sim' : 'Não'}</td>
          <td>${escapeHtml(createdAt)}</td>
          <td>${actions}</td>
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

function renderConstructionPage(res, role) {
  const constructionPath = path.join(__dirname, '../views/construction.html');
  const titleByRole = {
    [ROLES.ADMIN]: 'Área dos administradores',
    [ROLES.CLIENT]: 'Área do cliente',
    [ROLES.WEIGHBRIDGE_OPERATOR]: 'Área da balança',
  };
  const descriptionByRole = {
    [ROLES.ADMIN]: 'O painel dos sócios da AgroLima está em construção e ficará disponível em breve.',
    [ROLES.CLIENT]: 'Em breve você poderá consultar os volumes de soja e milho armazenados no silo.',
    [ROLES.WEIGHBRIDGE_OPERATOR]: 'Em breve os operadores de balança poderão registrar entradas e saídas de produto.',
  };
  const constructionHtml = fs
    .readFileSync(constructionPath, 'utf8')
    .replace('{{CONSTRUCTION_EYEBROW}}', escapeHtml(getRoleLabel(role)))
    .replace('{{CONSTRUCTION_TITLE}}', escapeHtml(titleByRole[role] || 'Em construção'))
    .replace(
      '{{CONSTRUCTION_DESCRIPTION}}',
      escapeHtml(descriptionByRole[role] || 'A área interna da AgroLima estará disponível em breve.')
    );

  res.send(constructionHtml);
}

function renderDryerDashboardPage(res, { batch, readings, settings, message, error }) {
  const dryerPath = path.join(__dirname, '../views/dryer-dashboard.html');
  const startedAt = batch ? formatDateTime(batch.started_at) : 'Nenhuma batelada ativa';
  const grainType = batch ? GRAIN_LABELS[batch.grain_type] || batch.grain_type : '-';
  const targetMoisture = formatMoisture(batch?.target_moisture || settings.target_moisture);
  const readingsRows = readings
    .map(
      (reading) => `
        <tr>
          <td>${escapeHtml(formatDateTime(reading.measured_at))}</td>
          <td>${escapeHtml(formatMoisture(reading.moisture_percent))}%</td>
          <td>${escapeHtml(reading.measured_by_login)}</td>
        </tr>
      `
    )
    .join('');
  const emptyReadings = '<tr><td colspan="3">Nenhuma medição lançada para a batelada atual.</td></tr>';
  const nowDateTime = toDateTimeLocalValue();
  const batchStatusHtml = batch
    ? `<span class="status-pill status-active">Batelada ativa</span>`
    : `<span class="status-pill status-empty">Sem batelada ativa</span>`;
  const moistureFormDisabled = batch ? '' : 'disabled';
  const moistureHelp = batch
    ? 'Informe a umidade medida na saída do secador.'
    : 'Inicie uma batelada para liberar o lançamento de umidades.';

  const dryerHtml = fs
    .readFileSync(dryerPath, 'utf8')
    .replace('{{DRYER_MESSAGE}}', buildAlertHtml(message))
    .replace('{{DRYER_ERROR}}', buildAlertHtml(error, 'error'))
    .replace('{{BATCH_STATUS}}', batchStatusHtml)
    .replace('{{BATCH_STARTED_AT}}', escapeHtml(startedAt))
    .replace('{{BATCH_GRAIN_TYPE}}', escapeHtml(grainType))
    .replace('{{TARGET_MOISTURE}}', escapeHtml(targetMoisture))
    .replace('{{READINGS_COUNT}}', String(readings.length))
    .replace('{{READINGS_ROWS}}', readingsRows || emptyReadings)
    .replace(/{{NOW_DATETIME}}/g, escapeHtml(nowDateTime))
    .replace(/{{MOISTURE_FORM_DISABLED}}/g, moistureFormDisabled)
    .replace('{{MOISTURE_HELP}}', escapeHtml(moistureHelp));

  res.send(dryerHtml);
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
    return res.redirect(getHomePathForRole(req.sessionUser.role));
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
    return res.redirect(getHomePathForRole(user.role));
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
  if (req.sessionUser.role === ROLES.ROOT || req.sessionUser.role === ROLES.SILO_OPERATOR) {
    return res.redirect(getHomePathForRole(req.sessionUser.role));
  }

  return renderConstructionPage(res, req.sessionUser.role);
});

router.get('/secador', requireRole(ROLES.SILO_OPERATOR, ROLES.ROOT), async (req, res) => {
  try {
    const [settings, batch] = await Promise.all([getDryerSettings(), getActiveDryerBatch()]);
    const readings = await listDryerMoistureReadings(batch?.id);

    return renderDryerDashboardPage(res, {
      batch,
      readings,
      settings,
      message: req.query.started
        ? 'Nova batelada iniciada com sucesso.'
        : req.query.reading
          ? 'Medição de umidade registrada com sucesso.'
          : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading dryer dashboard:', error.message);
    return res.status(500).send('Não foi possível carregar o painel do secador agora.');
  }
});

router.post('/secador/bateladas', requireRole(ROLES.SILO_OPERATOR, ROLES.ROOT), async (req, res) => {
  const startedAt = parseOptionalDateTime(req.body.started_at);
  const grainType = ['corn', 'soy'].includes(req.body.grain_type) ? req.body.grain_type : 'corn';

  if (!startedAt) {
    return res.redirect(buildDryerRedirect({ error: 'Informe uma data e hora válidas para iniciar a batelada.' }));
  }

  try {
    await startDryerBatch({ startedAt, grainType, user: req.sessionUser });
    return res.redirect(buildDryerRedirect({ started: '1' }));
  } catch (error) {
    console.error('Error starting dryer batch:', error.message);
    return res.redirect(buildDryerRedirect({ error: 'Não foi possível iniciar a nova batelada agora.' }));
  }
});

router.post('/secador/umidades', requireRole(ROLES.SILO_OPERATOR, ROLES.ROOT), async (req, res) => {
  const measuredAt = parseOptionalDateTime(req.body.measured_at);
  const moisturePercent = parseMoisturePercent(req.body.moisture_percent);

  if (!measuredAt) {
    return res.redirect(buildDryerRedirect({ error: 'Informe uma data e hora válidas para a medição.' }));
  }

  if (moisturePercent === null) {
    return res.redirect(buildDryerRedirect({ error: 'Informe uma umidade entre 7,0% e 40,0%, com no máximo uma casa decimal.' }));
  }

  try {
    await addDryerMoistureReading({ measuredAt, moisturePercent, user: req.sessionUser });
    return res.redirect(buildDryerRedirect({ reading: '1' }));
  } catch (error) {
    if (error.code === 'NO_ACTIVE_BATCH') {
      return res.redirect(buildDryerRedirect({ error: error.message }));
    }

    console.error('Error adding dryer moisture reading:', error.message);
    return res.redirect(buildDryerRedirect({ error: 'Não foi possível registrar a umidade agora.' }));
  }
});

router.get('/admin/usuarios', requireRoot, async (req, res) => {
  try {
    const users = await listManagedUsers();
    return renderAdminUsersPage(res, {
      users,
      message: req.query.created
        ? 'Usuário criado com sucesso.'
        : req.query.deleted
          ? 'Usuário removido com sucesso.'
          : req.query.password
            ? 'Senha atualizada com sucesso.'
            : '',
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
  const role = String(req.body.role || '').trim();

  if (!login || !password) {
    return res.redirect(buildAdminRedirect({ error: 'Informe login e senha para criar o usuário.' }));
  }

  if (!MANAGED_ROLES.includes(role)) {
    return res.redirect(buildAdminRedirect({ error: 'Selecione um perfil válido para o usuário.' }));
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


router.post('/admin/usuarios/:id/senha', requireRoot, async (req, res) => {
  const password = String(req.body.password || '');

  if (!password) {
    return res.redirect(buildAdminRedirect({ error: 'Informe a nova senha do usuário.' }));
  }

  try {
    await updateManagedUserPassword(req.params.id, password);
    return res.redirect(buildAdminRedirect({ password: '1' }));
  } catch (error) {
    console.error('Error updating user password:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível atualizar a senha agora.' }));
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
