const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

function ensureDatabaseConfigured() {
  if (!pool) {
    throw new Error('Missing DATABASE_URL environment variable.');
  }
}

module.exports = {
  ensureDatabaseConfigured,
  pool,
};
