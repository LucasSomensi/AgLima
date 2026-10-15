const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { pool, ensureDatabaseConfigured } = require('./database');
const users = require('./user-service');
const loginEvents = require('./auth-login-service');
const { ROLES } = require('./constants');

const TOKEN_TTL_SECONDS = 16 * 60 * 60;
const ALLOWED_ROLES = [ROLES.WEIGHBRIDGE_OPERATOR, ROLES.ADMIN];
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
// Valid bcrypt hash for equal-cost comparison when the login does not exist.
const DUMMY_HASH = '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

async function login(req, res) {
  ensureDatabaseConfigured();
  const { login: name, password } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.length > 100
      || typeof password !== 'string' || !password || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ code: 'INVALID_BODY', error: 'Informe login (até 100 caracteres) e password (até 72 bytes).' });
  }
  const user = await users.findUserByLogin(name.trim());
  const matches = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  const result = !user ? 'usuario_inexistente' : user.disabled ? 'usuario_desativado' : !matches ? 'senha_invalida' : 'sucesso';
  await loginEvents.recordLoginEvent({
    login: name.trim(), userId: user?.id || null, result,
    ipAddress: req.ip || null, userAgent: `API balança: ${req.get('user-agent') || ''}`.slice(0, 500),
  });
  if (!user || user.disabled || !matches) {
    return res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Login não autorizado.' });
  }
  if (!ALLOWED_ROLES.includes(user.role)) {
    return res.status(403).json({ code: 'FORBIDDEN', error: 'Perfil sem acesso à API da balança.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  // Lock the user while issuing the token so a concurrent password change cannot
  // revoke the old sessions and then leave a newly issued old-credential session.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT password_hash, role, disabled FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    const row = current.rows[0];
    if (!row || row.disabled || row.password_hash !== user.password_hash || !ALLOWED_ROLES.includes(row.role)) {
      await client.query('ROLLBACK');
      return res.status(401).json({ code: 'INVALID_CREDENTIALS', error: 'Login não autorizado.' });
    }
    await client.query('DELETE FROM public.balanca_api_sessoes WHERE usuario_id = $1 AND expira_em <= now()', [user.id]);
    const session = await client.query(`INSERT INTO public.balanca_api_sessoes (token_hash, usuario_id, expira_em)
      VALUES ($1, $2, now() + $3 * interval '1 second') RETURNING expira_em`, [hashToken(token), user.id, TOKEN_TTL_SECONDS]);
    await client.query('COMMIT');
    return res.json({ access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS,
      expires_at: session.rows[0].expira_em, user: { id: user.id, login: user.login, role: row.role } });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function requireOperatorToken(req, res, next) {
  const match = (req.get('authorization') || '').match(/^Bearer ([a-f0-9]{64})$/);
  const unauthorized = () => {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ code: 'INVALID_TOKEN', error: 'Token ausente, inválido, revogado ou expirado.' });
  };
  if (!match) return unauthorized();
  ensureDatabaseConfigured();
  const digest = hashToken(match[1]);
  const { rows } = await pool.query(`SELECT u.id, u.login, u.role, u.disabled
    FROM public.balanca_api_sessoes s JOIN public.users u ON u.id = s.usuario_id
    WHERE s.token_hash = $1 AND s.expira_em > now()`, [digest]);
  const user = rows[0];
  if (!user || user.disabled) return unauthorized();
  if (!ALLOWED_ROLES.includes(user.role)) {
    return res.status(403).json({ code: 'FORBIDDEN', error: 'Perfil sem acesso à API da balança.' });
  }
  req.apiUser = { userId: user.id, login: user.login, role: user.role };
  req.apiTokenHash = digest;
  return next();
}

async function logout(req, res) {
  await pool.query('DELETE FROM public.balanca_api_sessoes WHERE token_hash = $1', [req.apiTokenHash]);
  return res.status(204).end();
}

module.exports = { login, logout, requireOperatorToken, hashToken };
