const bcrypt = require('bcrypt');
const { BCRYPT_SALT_ROUNDS, ROOT_LOGIN } = require('./constants');
const { ensureDatabaseConfigured, pool } = require('./database');

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

async function findActiveUserById(userId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, login, role, disabled, must_change_password
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
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

module.exports = {
  createManagedUser,
  deleteManagedUser,
  findActiveUserById,
  findUserByLogin,
  listManagedUsers,
  updateManagedUserPassword,
};
