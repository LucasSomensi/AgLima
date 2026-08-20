const { DEFAULT_DISCHARGE_FORECAST_CURVE, calculateAverageMoisture, calculateDischargeForecast } = require('./dryer-forecast');
const { ensureDatabaseConfigured, pool } = require('./database');

async function getDryerSettings() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT target_moisture,
             discharge_silo_count,
             discharge_forecast_quadratic_coefficient,
             discharge_forecast_linear_coefficient,
             discharge_forecast_initial_moisture_quadratic_coefficient,
             discharge_forecast_initial_moisture_linear_coefficient,
             discharge_forecast_constant_coefficient
      FROM dryer_settings
      WHERE id = true
      LIMIT 1
    `
  );

  return result.rows[0] || {
    target_moisture: '14.5',
    discharge_silo_count: 4,
    discharge_forecast_quadratic_coefficient: DEFAULT_DISCHARGE_FORECAST_CURVE.quadraticCoefficient,
    discharge_forecast_linear_coefficient: DEFAULT_DISCHARGE_FORECAST_CURVE.linearCoefficient,
    discharge_forecast_initial_moisture_quadratic_coefficient: DEFAULT_DISCHARGE_FORECAST_CURVE.initialMoistureQuadraticCoefficient,
    discharge_forecast_initial_moisture_linear_coefficient: DEFAULT_DISCHARGE_FORECAST_CURVE.initialMoistureLinearCoefficient,
    discharge_forecast_constant_coefficient: DEFAULT_DISCHARGE_FORECAST_CURVE.constantCoefficient,
  };
}

async function updateDryerSettings({ targetMoisture, dischargeSiloCount, quadraticCoefficient, linearCoefficient, initialMoistureQuadraticCoefficient, initialMoistureLinearCoefficient, constantCoefficient, user }) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      INSERT INTO dryer_settings (
        id,
        target_moisture,
        discharge_silo_count,
        discharge_forecast_quadratic_coefficient,
        discharge_forecast_linear_coefficient,
        discharge_forecast_initial_moisture_quadratic_coefficient,
        discharge_forecast_initial_moisture_linear_coefficient,
        discharge_forecast_constant_coefficient,
        updated_at,
        updated_by_user_id
      )
      VALUES (true, $1, $2, $3, $4, $5, $6, $7, now(), $8)
      ON CONFLICT (id)
      DO UPDATE SET target_moisture = EXCLUDED.target_moisture,
                    discharge_silo_count = EXCLUDED.discharge_silo_count,
                    discharge_forecast_quadratic_coefficient = EXCLUDED.discharge_forecast_quadratic_coefficient,
                    discharge_forecast_linear_coefficient = EXCLUDED.discharge_forecast_linear_coefficient,
                    discharge_forecast_initial_moisture_quadratic_coefficient = EXCLUDED.discharge_forecast_initial_moisture_quadratic_coefficient,
                    discharge_forecast_initial_moisture_linear_coefficient = EXCLUDED.discharge_forecast_initial_moisture_linear_coefficient,
                    discharge_forecast_constant_coefficient = EXCLUDED.discharge_forecast_constant_coefficient,
                    updated_at = now(),
                    updated_by_user_id = EXCLUDED.updated_by_user_id
      RETURNING target_moisture,
                discharge_silo_count,
                discharge_forecast_quadratic_coefficient,
                discharge_forecast_linear_coefficient,
                discharge_forecast_initial_moisture_quadratic_coefficient,
                discharge_forecast_initial_moisture_linear_coefficient,
                discharge_forecast_constant_coefficient
    `,
    [targetMoisture, dischargeSiloCount, quadraticCoefficient, linearCoefficient, initialMoistureQuadraticCoefficient, initialMoistureLinearCoefficient, constantCoefficient, user.userId]
  );

  return result.rows[0];
}

async function getActiveDryerBatch() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, n, grain_type, status, started_at, discharge_started_at, discharge_silo_number, completed_at, target_moisture, umidade_inicial, final_moisture, created_at
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
      SELECT id, n, grain_type, status, started_at, discharge_started_at, discharge_silo_number, completed_at, target_moisture, umidade_inicial, final_moisture, created_at
      FROM dryer_batches
      WHERE id = $1
      LIMIT 1
    `,
    [batchId]
  );

  return result.rows[0] || null;
}

async function listAdminDryerBatches() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, n, grain_type, status, started_at, discharge_started_at, discharge_silo_number, completed_at, target_moisture, umidade_inicial, final_moisture, created_at
      FROM dryer_batches
      ORDER BY started_at DESC, created_at DESC
    `
  );

  return result.rows;
}

async function listCompletedDryerMoistureReadings() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT batches.id AS batch_id,
             batches.started_at AS batch_started_at,
             batches.umidade_inicial AS batch_initial_moisture,
             readings.measured_at,
             readings.average_moisture
      FROM dryer_batches batches
      LEFT JOIN dryer_moisture_readings readings ON readings.batch_id = batches.id
      WHERE batches.status <> 'active'
      ORDER BY batches.started_at ASC, batches.created_at ASC, readings.measured_at ASC NULLS FIRST, readings.created_at ASC NULLS FIRST
    `
  );

  return result.rows;
}

async function listRecentCompletedDryerBatchSummaries(limit = 10) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, n, started_at, discharge_started_at, discharge_silo_number, completed_at, umidade_inicial, final_moisture, created_at
      FROM dryer_batches
      WHERE status <> 'active'
      ORDER BY started_at DESC, created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((batch) => ({
    ...batch,
    discharge_average_moisture: batch.final_moisture,
  }));
}

async function getLastCompletedDryerBatchSummary() {
  ensureDatabaseConfigured();

  const batchResult = await pool.query(
    `
      SELECT id, n, started_at, discharge_started_at, discharge_silo_number, completed_at, umidade_inicial, final_moisture, created_at
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

  return {
    ...batch,
    discharge_average_moisture: batch.final_moisture,
  };
}

async function listDryerMoistureReadings(batchId) {
  ensureDatabaseConfigured();

  if (!batchId) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT id, measured_at, moisture_percent, measured_by_login, created_at, average_moisture, discharge_forecast_at, discharge_forecast_status
      FROM dryer_moisture_readings
      WHERE batch_id = $1
      ORDER BY measured_at ASC, created_at ASC
    `,
    [batchId]
  );

  return result.rows;
}

async function getLastDischargeSiloNumber() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT discharge_silo_number
      FROM dryer_batches
      WHERE discharge_silo_number IS NOT NULL
      ORDER BY discharge_started_at DESC, created_at DESC
      LIMIT 1
    `
  );

  return result.rows[0]?.discharge_silo_number ?? null;
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

async function listDryerMoistureReadingsForUpdate(client, batchId) {
  const result = await client.query(
    `
      SELECT id, measured_at, moisture_percent, measured_by_login, created_at, average_moisture, discharge_forecast_at, discharge_forecast_status
      FROM dryer_moisture_readings
      WHERE batch_id = $1
      ORDER BY measured_at ASC, created_at ASC
    `,
    [batchId]
  );

  return result.rows;
}

function calculateFinalMoistureForBatch(batch, readings = []) {
  const dischargeStartedAt = new Date(batch.discharge_started_at).getTime();
  const completedAt = new Date(batch.completed_at).getTime();

  if (!Number.isFinite(dischargeStartedAt) || !Number.isFinite(completedAt)) {
    return null;
  }

  return calculateAverageMoisture({
    readings: [
      {
        measured_at: batch.started_at,
        moisture_percent: batch.umidade_inicial,
      },
      ...readings,
    ],
    periodStart: dischargeStartedAt,
    periodEnd: completedAt,
  });
}

async function updateBatchFinalMoisture(client, batchId) {
  const batchResult = await client.query(
    `
      SELECT id, started_at, discharge_started_at, completed_at, umidade_inicial
      FROM dryer_batches
      WHERE id = $1
      LIMIT 1
    `,
    [batchId]
  );
  const batch = batchResult.rows[0];

  if (!batch) {
    return null;
  }

  const readings = await listDryerMoistureReadingsForUpdate(client, batchId);
  const finalMoisture = calculateFinalMoistureForBatch(batch, readings);

  await client.query(
    `
      UPDATE dryer_batches
      SET final_moisture = $1,
          updated_at = now()
      WHERE id = $2
    `,
    [finalMoisture, batchId]
  );

  return finalMoisture;
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

    const completedBatchResult = await client.query(
      `
        UPDATE dryer_batches
        SET status = 'completed',
            completed_at = $1,
            completed_by_user_id = $2,
            updated_at = now()
        WHERE status = 'active'
        RETURNING id
      `,
      [startedAt, user.userId]
    );

    if (completedBatchResult.rowCount > 0) {
      await updateBatchFinalMoisture(client, completedBatchResult.rows[0].id);
    }

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

async function startDryerBatchDischarge({ dischargeStartedAt, dischargeSiloNumber }) {
  if (!Number.isInteger(dischargeSiloNumber) || dischargeSiloNumber < 1) {
    const error = new Error('Escolha um silo válido para iniciar a descarga.');
    error.code = 'INVALID_DISCHARGE_SILO';
    throw error;
  }

  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260530)');

    const settingsResult = await client.query(
      'SELECT discharge_silo_count FROM dryer_settings WHERE id = true LIMIT 1'
    );
    const dischargeSiloCount = Number(settingsResult.rows[0]?.discharge_silo_count || 4);

    if (dischargeSiloNumber > dischargeSiloCount) {
      const error = new Error(`Escolha um silo de 1 a ${dischargeSiloCount} para iniciar a descarga.`);
      error.code = 'INVALID_DISCHARGE_SILO';
      throw error;
    }

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
            discharge_silo_number = $2,
            updated_at = now()
        WHERE id = $3
        RETURNING id, discharge_started_at, discharge_silo_number
      `,
      [dischargeStartedAt, dischargeSiloNumber, activeBatch.id]
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

    await updateBatchFinalMoisture(client, updateResult.rows[0].id);

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

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20260530)');

    const activeBatchResult = await client.query(
      `
        SELECT id, grain_type, status, started_at, discharge_started_at, completed_at, target_moisture, umidade_inicial, final_moisture, created_at
        FROM dryer_batches
        WHERE status = 'active'
        ORDER BY started_at DESC
        LIMIT 1
      `
    );
    const activeBatch = activeBatchResult.rows[0];

    if (!activeBatch) {
      const error = new Error('Não há batelada ativa. Inicie uma nova batelada antes de lançar umidade.');
      error.code = 'NO_ACTIVE_BATCH';
      throw error;
    }

    const existingReadings = await listDryerMoistureReadingsForUpdate(client, activeBatch.id);
    const settings = await getDryerSettings();
    const readingForForecast = {
      measured_at: measuredAt,
      moisture_percent: moisturePercent,
      measured_by_login: user.login,
    };
    const forecast = calculateDischargeForecast({
      batch: { ...activeBatch, discharge_started_at: null },
      readings: [...existingReadings, readingForForecast],
      now: measuredAt,
      curveSettings: settings,
    });
    const forecastAt = forecast.forecastAt || null;
    const forecastStatus = forecast.status || 'unavailable';
    const averageMoisture = forecast.averageMoisture ?? null;

    await client.query(
      `
        INSERT INTO dryer_moisture_readings (
          batch_id,
          measured_at,
          moisture_percent,
          measured_by_user_id,
          measured_by_login,
          average_moisture,
          discharge_forecast_at,
          discharge_forecast_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [activeBatch.id, measuredAt, moisturePercent, user.userId, user.login, averageMoisture, forecastAt, forecastStatus]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  addDryerMoistureReading,
  getActiveDryerBatch,
  getDryerBatchById,
  getLastDischargeSiloNumber,
  getDefaultInitialMoisture,
  getDryerSettings,
  getLastCompletedDryerBatchSummary,
  listRecentCompletedDryerBatchSummaries,
  listAdminDryerBatches,
  listCompletedDryerBatches: listAdminDryerBatches,
  listCompletedDryerMoistureReadings,
  listDryerMoistureReadings,
  startDryerBatch,
  startDryerBatchDischarge,
  stopDryerBatch,
  updateDryerSettings,
};
