const bcrypt = require('bcrypt');
const { Client } = require('pg');

const ROOT_LOGIN = 'root';
const ROOT_ROLE = 'root';
const BCRYPT_SALT_ROUNDS = 12;

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function createRootUser() {
  const databaseUrl = getRequiredEnv('DATABASE_URL');
  const rootPassword = getRequiredEnv('ROOT_PASSWORD');
  const passwordHash = await bcrypt.hash(rootPassword, BCRYPT_SALT_ROUNDS);
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const result = await client.query(
      `
        INSERT INTO users (login, password_hash, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (login) DO NOTHING
        RETURNING login
      `,
      [ROOT_LOGIN, passwordHash, ROOT_ROLE]
    );

    if (result.rowCount === 0) {
      console.log('Root user already exists. No changes were made.');
      return;
    }

    console.log('Root user created successfully.');
  } finally {
    await client.end();
  }
}

createRootUser().catch((error) => {
  console.error('Failed to create root user:', error.message);
  process.exitCode = 1;
});
