const { Pool, types } = require('pg');

const POSTGRES_DATE_OID = 1082;

types.setTypeParser(POSTGRES_DATE_OID, (value) => value);

function handleIdleClientError(error) {
  // Uma conexão ociosa do pool pode cair (reinício do banco, falha de rede).
  // Sem este listener, o 'error' não tratado encerraria o processo inteiro.
  // O pool descarta o cliente com erro e abre outro na próxima consulta.
  console.error('Conexão ociosa com o PostgreSQL foi encerrada inesperadamente:', error.code || error.message);
}

function createPool(connectionString) {
  const createdPool = new Pool({ connectionString });
  createdPool.on('error', handleIdleClientError);
  return createdPool;
}

const pool = process.env.DATABASE_URL
  ? createPool(process.env.DATABASE_URL)
  : null;

function ensureDatabaseConfigured() {
  if (!pool) {
    throw new Error('Missing DATABASE_URL environment variable.');
  }
}

module.exports = {
  createPool,
  ensureDatabaseConfigured,
  pool,
};
