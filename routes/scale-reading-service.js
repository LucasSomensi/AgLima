const { ensureDatabaseConfigured, pool } = require('./database');

const SCALE_ONE_ID = 1;
const MAX_POSTGRES_INTEGER = 2147483647;
const TRUCK_ON_SCALE_MIN_WEIGHT_KG = 1000;

function isTruckOnScale(reading) {
  const weight = Number(reading?.peso_kg);

  return Number.isFinite(weight) && weight > TRUCK_ON_SCALE_MIN_WEIGHT_KG;
}

function buildScaleWeightPayload(body) {
  const weight = body?.peso_kg;

  if (!Number.isInteger(weight) || weight < 0 || weight > MAX_POSTGRES_INTEGER) {
    return { error: 'peso_kg deve ser um número inteiro entre 0 e 2147483647.' };
  }

  return { payload: { pesoKg: weight } };
}

async function saveCurrentScaleWeight(scaleId, weightKg) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      INSERT INTO balancas_pesos_atuais (balanca_id, peso_kg)
      VALUES ($1, $2)
      ON CONFLICT (balanca_id) DO UPDATE
      SET peso_kg = EXCLUDED.peso_kg,
          atualizado_em = now()
      RETURNING balanca_id, peso_kg, atualizado_em
    `,
    [scaleId, weightKg]
  );

  return result.rows[0];
}

async function getCurrentScaleWeight(scaleId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT balanca_id, peso_kg, atualizado_em
      FROM balancas_pesos_atuais
      WHERE balanca_id = $1
    `,
    [scaleId]
  );

  return result.rows[0] || null;
}

module.exports = {
  buildScaleWeightPayload,
  getCurrentScaleWeight,
  isTruckOnScale,
  saveCurrentScaleWeight,
  SCALE_ONE_ID,
  TRUCK_ON_SCALE_MIN_WEIGHT_KG,
};
