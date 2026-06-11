const { Pool, types } = require('pg');

const POSTGRES_DATE_OID = 1082;

types.setTypeParser(POSTGRES_DATE_OID, (value) => value);

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
