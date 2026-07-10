const { Client } = require('pg');
const {
  calculateAverageMoisture,
  calculateDischargeForecast,
} = require('../routes/dryer-forecast');

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function toValidTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();

  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeForecastDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

async function listBatches(client) {
  const result = await client.query(
    `
      SELECT id,
             grain_type,
             status,
             started_at,
             discharge_started_at,
             completed_at,
             target_moisture,
             umidade_inicial,
             created_at
      FROM dryer_batches
      ORDER BY started_at ASC, created_at ASC, id ASC
    `
  );

  return result.rows;
}

async function listReadings(client, batchId) {
  const result = await client.query(
    `
      SELECT id,
             measured_at,
             moisture_percent,
             measured_by_login,
             created_at
      FROM dryer_moisture_readings
      WHERE batch_id = $1
      ORDER BY measured_at ASC, created_at ASC, id ASC
    `,
    [batchId]
  );

  return result.rows;
}

async function backfillReadingDerivedValues(client, batch, readings) {
  let updatedReadings = 0;
  const batchForHistoricalForecast = {
    ...batch,
    discharge_started_at: null,
  };

  for (let index = 0; index < readings.length; index += 1) {
    const reading = readings[index];
    const readingsUntilCurrent = readings.slice(0, index + 1);
    const forecast = calculateDischargeForecast({
      batch: batchForHistoricalForecast,
      readings: readingsUntilCurrent,
      now: new Date(reading.measured_at),
    });
    const forecastAt = normalizeForecastDate(forecast.forecastAt);

    await client.query(
      `
        UPDATE dryer_moisture_readings
        SET average_moisture = $1,
            discharge_forecast_at = $2,
            discharge_forecast_status = $3
        WHERE id = $4
      `,
      [
        forecast.averageMoisture ?? null,
        forecastAt,
        forecast.status ?? null,
        reading.id,
      ]
    );

    updatedReadings += 1;
  }

  return updatedReadings;
}

async function backfillBatchFinalMoisture(client, batch, readings) {
  const dischargeStartedAt = toValidTimestamp(batch.discharge_started_at);
  const completedAt = toValidTimestamp(batch.completed_at);

  if (dischargeStartedAt === null || completedAt === null) {
    await client.query(
      `
        UPDATE dryer_batches
        SET final_moisture = NULL
        WHERE id = $1
      `,
      [batch.id]
    );

    return false;
  }

  const finalMoisture = calculateAverageMoisture({
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

  await client.query(
    `
      UPDATE dryer_batches
      SET final_moisture = $1
      WHERE id = $2
    `,
    [finalMoisture, batch.id]
  );

  return finalMoisture !== null && finalMoisture !== undefined;
}

async function backfillDryerDerivedValues() {
  const databaseUrl = getRequiredEnv('DATABASE_URL');
  const client = new Client({ connectionString: databaseUrl });

  let processedBatches = 0;
  let updatedReadings = 0;
  let updatedFinalMoistures = 0;

  try {
    await client.connect();
    const batches = await listBatches(client);

    for (const batch of batches) {
      const readings = await listReadings(client, batch.id);

      await client.query('BEGIN');
      try {
        updatedReadings += await backfillReadingDerivedValues(client, batch, readings);

        const hasFinalMoisture = await backfillBatchFinalMoisture(client, batch, readings);
        if (hasFinalMoisture) {
          updatedFinalMoistures += 1;
        }

        await client.query('COMMIT');
        processedBatches += 1;
        console.log(`Backfilled batch ${batch.id}: ${readings.length} reading(s), final moisture ${hasFinalMoisture ? 'updated' : 'not available'}.`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(`Backfill complete. Processed ${processedBatches} batch(es), updated ${updatedReadings} reading(s), updated ${updatedFinalMoistures} final moisture value(s).`);
  } finally {
    await client.end();
  }
}

backfillDryerDerivedValues().catch((error) => {
  console.error('Failed to backfill dryer derived values:', error.message);
  process.exitCode = 1;
});
