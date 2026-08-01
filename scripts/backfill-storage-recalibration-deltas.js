const { Client } = require('pg');

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function backfillStorageRecalibrationDeltas() {
  const client = new Client({ connectionString: getRequiredEnv('DATABASE_URL') });

  try {
    await client.connect();
    await client.query('BEGIN');
    const result = await client.query(`
      WITH periodos AS (
        SELECT atual.id,
               atual.quantidade_real_kg,
               anterior.quantidade_real_kg AS base_anterior_kg,
               anterior.data_recalibracao AS data_anterior,
               COALESCE(entradas.total_kg, 0) AS entradas_kg,
               COALESCE(saidas.total_kg, 0) AS saidas_kg
        FROM armazenamento_recalibracoes atual
        LEFT JOIN LATERAL (
          SELECT r.data_recalibracao, r.quantidade_real_kg
          FROM armazenamento_recalibracoes r
          WHERE r.produto = atual.produto
            AND (r.data_recalibracao, r.id) < (atual.data_recalibracao, atual.id)
          ORDER BY r.data_recalibracao DESC, r.id DESC
          LIMIT 1
        ) anterior ON true
        LEFT JOIN LATERAL (
          SELECT SUM(e.liquido_real_kg) AS total_kg
          FROM entradas_balanca e
          WHERE e.produto = atual.produto
            AND e.liquido_real_kg IS NOT NULL
            AND (anterior.data_recalibracao IS NULL OR e.data_entrada > anterior.data_recalibracao)
            AND e.data_entrada <= atual.data_recalibracao
        ) entradas ON true
        LEFT JOIN LATERAL (
          SELECT SUM(s.peso_liquido_kg) AS total_kg
          FROM saidas_balanca s
          WHERE s.produto = atual.produto
            AND s.peso_liquido_kg IS NOT NULL
            AND (anterior.data_recalibracao IS NULL OR s.data_saida > anterior.data_recalibracao)
            AND s.data_saida <= atual.data_recalibracao
        ) saidas ON true
      ), deltas AS (
        SELECT id,
               quantidade_real_kg - (COALESCE(base_anterior_kg, 0) + entradas_kg - saidas_kg) AS delta,
               entradas_kg
        FROM periodos
      )
      UPDATE armazenamento_recalibracoes r
      SET delta = d.delta,
          delta_porcento = d.delta / NULLIF(d.entradas_kg, 0) * 100
      FROM deltas d
      WHERE r.id = d.id;
    `);
    await client.query('COMMIT');
    console.log(`Backfill complete. Updated ${result.rowCount} recalibration(s).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

backfillStorageRecalibrationDeltas().catch((error) => {
  console.error('Failed to backfill storage recalibration deltas:', error.message);
  process.exitCode = 1;
});
