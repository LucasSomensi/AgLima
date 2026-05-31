const { ensureDatabaseConfigured, pool } = require('./database');

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
      SELECT id, grain_type, status, started_at, discharge_started_at, target_moisture, created_at
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

    const activeBatchResult = await client.query(
      `
        SELECT id, discharge_started_at
        FROM dryer_batches
        WHERE status = 'active'
        ORDER BY started_at DESC
        LIMIT 1
      `
    );
    const activeBatch = activeBatchResult.rows[0];

    if (activeBatch && !activeBatch.discharge_started_at) {
      const error = new Error('Inicie a descarga da batelada atual antes de iniciar uma nova batelada.');
      error.code = 'DISCHARGE_NOT_STARTED';
      throw error;
    }

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

async function startDryerBatchDischarge({ dischargeStartedAt }) {
  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260530)');

    const activeBatchResult = await client.query(
      `
        SELECT id, discharge_started_at
        FROM dryer_batches
        WHERE status = 'active'
        ORDER BY started_at DESC
        LIMIT 1
      `
    );
    const activeBatch = activeBatchResult.rows[0];

    if (!activeBatch) {
      const error = new Error('Não há batelada ativa para iniciar descarga.');
      error.code = 'NO_ACTIVE_BATCH';
      throw error;
    }

    if (activeBatch.discharge_started_at) {
      const error = new Error('A descarga da batelada atual já foi iniciada.');
      error.code = 'DISCHARGE_ALREADY_STARTED';
      throw error;
    }

    const updateResult = await client.query(
      `
        UPDATE dryer_batches
        SET discharge_started_at = $1,
            updated_at = now()
        WHERE id = $2
        RETURNING id, discharge_started_at
      `,
      [dischargeStartedAt, activeBatch.id]
    );

    await client.query('COMMIT');
    return updateResult.rows[0];
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

module.exports = {
  addDryerMoistureReading,
  getActiveDryerBatch,
  getDryerSettings,
  listDryerMoistureReadings,
  startDryerBatch,
  startDryerBatchDischarge,
};
