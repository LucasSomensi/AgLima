const { ensureDatabaseConfigured, pool } = require('./database');

const LOGIN_EVENT_RESULTS = Object.freeze({
  SUCCESS: 'sucesso',
  INVALID_PASSWORD: 'senha_invalida',
  UNKNOWN_USER: 'usuario_inexistente',
  DISABLED_USER: 'usuario_desativado',
  SYSTEM_ERROR: 'erro_sistema',
});

const LOGIN_EVENTS_PAGE_SIZE = 100;

async function recordLoginEvent({ login, userId = null, result, ipAddress = null, userAgent = null }) {
  ensureDatabaseConfigured();

  await pool.query(
    `
      INSERT INTO auth_login_events (
        login_informado,
        usuario_id,
        resultado,
        ip_origem,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [login, userId, result, ipAddress, userAgent]
  );
}

async function listLoginEvents({ page = 1 } = {}) {
  ensureDatabaseConfigured();

  const normalizedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const offset = (normalizedPage - 1) * LOGIN_EVENTS_PAGE_SIZE;
  const [eventsResult, countResult] = await Promise.all([
    pool.query(
      `
        SELECT
          event.id,
          event.login_informado,
          event.usuario_id,
          event.resultado,
          event.ip_origem,
          event.user_agent,
          event.criado_em,
          users.login AS usuario_login
        FROM auth_login_events AS event
        LEFT JOIN users ON users.id = event.usuario_id
        ORDER BY event.criado_em DESC, event.id DESC
        LIMIT $1 OFFSET $2
      `,
      [LOGIN_EVENTS_PAGE_SIZE, offset]
    ),
    pool.query('SELECT COUNT(*)::integer AS total FROM auth_login_events'),
  ]);

  const total = countResult.rows[0]?.total || 0;

  return {
    events: eventsResult.rows,
    page: normalizedPage,
    pageSize: LOGIN_EVENTS_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / LOGIN_EVENTS_PAGE_SIZE)),
  };
}

module.exports = {
  LOGIN_EVENT_RESULTS,
  LOGIN_EVENTS_PAGE_SIZE,
  listLoginEvents,
  recordLoginEvent,
};
