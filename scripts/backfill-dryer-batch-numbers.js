const { Client } = require('pg');

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function backfillDryerBatchNumbers() {
  const client = new Client({ connectionString: getRequiredEnv('DATABASE_URL') });

  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE dryer_batches IN ACCESS EXCLUSIVE MODE');
    await client.query('SET CONSTRAINTS dryer_batches_n_key DEFERRED');

    const result = await client.query(`
      WITH numbered_batches AS (
        SELECT id,
               row_number() OVER (ORDER BY started_at, created_at, id) AS n
        FROM dryer_batches
      )
      UPDATE dryer_batches batches
      SET n = numbered_batches.n
      FROM numbered_batches
      WHERE batches.id = numbered_batches.id
        AND batches.n IS DISTINCT FROM numbered_batches.n;
    `);

    await client.query(`
      SELECT setval(
        'dryer_batches_n_seq',
        GREATEST(COALESCE((SELECT MAX(n) FROM dryer_batches), 0), 1),
        EXISTS (SELECT 1 FROM dryer_batches)
      );
    `);

    await client.query('COMMIT');
    console.log(`Backfill complete. Updated ${result.rowCount} dryer batch number(s).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

backfillDryerBatchNumbers().catch((error) => {
  console.error('Failed to backfill dryer batch numbers:', error.message);
  process.exitCode = 1;
});
