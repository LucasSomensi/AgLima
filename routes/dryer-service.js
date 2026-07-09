const { calculateAverageMoisture } = require('./dryer-forecast');
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

async function updateDryerTargetMoisture({ targetMoisture, user }) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      INSERT INTO dryer_settings (id, target_moisture, updated_at, updated_by_user_id)
      VALUES (true, $1, now(), $2)
      ON CONFLICT (id)
      DO UPDATE SET target_moisture = EXCLUDED.target_moisture,
                    updated_at = now(),
                    updated_by_user_id = EXCLUDED.updated_by_user_id
      RETURNING target_moisture
    `,
    [targetMoisture, user.userId]
  );

  return result.rows[0];
}

async function getActiveDryerBatch() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, grain_type, status, started_at, discharge_started_at, completed_at, target_moisture, umidade_inicial, created_at
      FROM dryer_batches
      WHERE status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `
  );

  return result.rows[0] || null;
}

async function getDryerBatchById(batchId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, grain_type, status, started_at, discharge_started_at, completed_at, target_moisture, umidade_inicial, created_at
      FROM dryer_batches
      WHERE id = $1
      LIMIT 1
    `,
    [batchId]
  );

  return result.rows[0] || null;
}

async function listCompletedDryerBatches() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, grain_type, status, started_at, discharge_started_at, completed_at, target_moisture, umidade_inicial, created_at
      FROM dryer_batches
      WHERE status <> 'active'
      ORDER BY started_at DESC, created_at DESC
    `
  );

  return result.rows;
}

async function getLastCompletedDryerBatchSummary() {
  ensureDatabaseConfigured();

  const batchResult = await pool.query(
    `
      SELECT id, started_at, discharge_started_at, completed_at, umidade_inicial, created_at
      FROM dryer_batches
      WHERE status <> 'active'
      ORDER BY started_at DESC, created_at DESC
      LIMIT 1
    `
  );
  const batch = batchResult.rows[0];

  if (!batch) {
    return null;
  }

  const readings = await listDryerMoistureReadings(batch.id);
  const dischargeStartedAt = new Date(batch.discharge_started_at).getTime();
  const completedAt = new Date(batch.completed_at).getTime();
  const dischargeAverageMoisture = Number.isFinite(dischargeStartedAt) && Number.isFinite(completedAt)
    ? calculateAverageMoisture({
        readings: [
          {
            measured_at: batch.started_at,
            moisture_percent: batch.umidade_inicial,
          },
          ...readings,
        ],
        periodStart: dischargeStartedAt,
        periodEnd: completedAt,
      })
    : null;

  return {
    ...batch,
    discharge_average_moisture: dischargeAverageMoisture,
  };
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

async function getDefaultInitialMoisture() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS reading_count, AVG(umidade_percent) AS average_moisture
      FROM (
        SELECT umidade_percent
        FROM entradas_balanca
        WHERE umidade_percent IS NOT NULL
        ORDER BY data_entrada DESC, criado_em DESC, id DESC
        LIMIT 5
      ) recent_entries
    `
  );

  const row = result.rows[0];

  if (row?.reading_count === 5 && row.average_moisture !== null) {
    return Number(Number(row.average_moisture).toFixed(2));
  }

  return 28;
}

async function startDryerBatch({ startedAt, grainType, initialMoisture, user }) {
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
          target_moisture,
          umidade_inicial
        )
        VALUES ($1, 'active', $2, $3, $4, $5)
        RETURNING id
      `,
      [grainType, startedAt, user.userId, targetMoisture, initialMoisture]
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

async function stopDryerBatch({ stoppedAt, user }) {
  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260530)');

    const updateResult = await client.query(
      `
        UPDATE dryer_batches
        SET status = 'completed',
            completed_at = $1,
            completed_by_user_id = $2,
            updated_at = now()
        WHERE status = 'active'
        RETURNING id
      `,
      [stoppedAt, user.userId]
    );

    if (updateResult.rowCount === 0) {
      const error = new Error('Não há batelada ativa para parar.');
      error.code = 'NO_ACTIVE_BATCH';
      throw error;
    }

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
  getDryerBatchById,
  getDefaultInitialMoisture,
  getDryerSettings,
  getLastCompletedDryerBatchSummary,
  listCompletedDryerBatches,
  listDryerMoistureReadings,
  startDryerBatch,
  startDryerBatchDischarge,
  stopDryerBatch,
  updateDryerTargetMoisture,
};
