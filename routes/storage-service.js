const { pool } = require('./database');
const { parseOptionalDateTime } = require('./utils');

const VALID_PRODUCTS = new Set(['milho', 'soja']);

function normalizeProduct(value) {
  const product = String(value || '').trim().toLowerCase();
  return VALID_PRODUCTS.has(product) ? product : null;
}

function parseNonNegativeDecimal(value) {
  const normalizedValue = String(value || '').trim().replace(',', '.');

  if (!/^\d+(?:\.\d{1,3})?$/.test(normalizedValue)) {
    return null;
  }

  const numericValue = Number(normalizedValue);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  return normalizedValue;
}

function normalizeOptionalText(value) {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || null;
}

async function getStorageSummary() {
  const { rows } = await pool.query(`
    WITH ultima_recalibracao AS (
      SELECT DISTINCT ON (produto)
             id,
             produto,
             data_recalibracao,
             quantidade_real_kg,
             observacoes,
             criado_em
      FROM armazenamento_recalibracoes
      ORDER BY produto, data_recalibracao DESC, id DESC
    ),
    produtos AS (
      SELECT unnest(enum_range(NULL::public.produto_contrato)) AS produto
    )
    SELECT p.produto,
           COALESCE(ur.quantidade_real_kg, 0)
             + COALESCE(entradas.total_entradas_kg, 0)
             - COALESCE(saidas.total_saidas_kg, 0) AS armazenado_kg,
           COALESCE(entradas.total_entradas_kg, 0) AS entradas_desde_recalibracao_kg,
           COALESCE(saidas.total_saidas_kg, 0) AS saidas_desde_recalibracao_kg,
           ur.id AS recalibracao_id,
           ur.data_recalibracao,
           ur.quantidade_real_kg AS quantidade_recalibrada_kg,
           ur.observacoes AS recalibracao_observacoes,
           ur.criado_em AS recalibracao_criada_em
    FROM produtos p
    LEFT JOIN ultima_recalibracao ur ON ur.produto = p.produto
    LEFT JOIN LATERAL (
      SELECT SUM(e.liquido_real_kg) AS total_entradas_kg
      FROM entradas_balanca e
      WHERE e.produto = p.produto
        AND e.liquido_real_kg IS NOT NULL
        AND (ur.data_recalibracao IS NULL OR e.data_entrada > ur.data_recalibracao)
    ) entradas ON true
    LEFT JOIN LATERAL (
      SELECT SUM(s.peso_liquido_kg) AS total_saidas_kg
      FROM saidas_balanca s
      WHERE s.produto = p.produto
        AND s.peso_liquido_kg IS NOT NULL
        AND (ur.data_recalibracao IS NULL OR s.data_saida > ur.data_recalibracao)
    ) saidas ON true
    ORDER BY p.produto;
  `);

  return rows;
}

async function listStorageRecalibrations(limit = 20) {
  const { rows } = await pool.query(`
    SELECT r.id,
           r.produto,
           r.data_recalibracao,
           r.quantidade_real_kg,
           r.delta,
           r.delta_porcento,
           r.observacoes,
           r.criado_em,
           u.login AS criado_por_login
    FROM armazenamento_recalibracoes r
    LEFT JOIN users u ON u.id = r.criado_por_user_id
    ORDER BY r.data_recalibracao DESC, r.id DESC
    LIMIT $1;
  `, [limit]);

  return rows;
}

async function countStorageIgnoredInputs() {
  const { rows } = await pool.query(`
    SELECT produto, COUNT(*)::integer AS entradas_pendentes
    FROM entradas_balanca
    WHERE liquido_real_kg IS NULL
    GROUP BY produto;
  `);

  return rows;
}

function buildStorageRecalibrationPayload(body) {
  const produto = normalizeProduct(body.produto);
  const quantidadeRealKg = parseNonNegativeDecimal(body.quantidade_real_kg);
  const dataRecalibracao = parseOptionalDateTime(body.data_recalibracao);
  const observacoes = normalizeOptionalText(body.observacoes);

  if (!produto) {
    return { error: 'Selecione soja ou milho para recalibrar o armazenamento.' };
  }

  if (!String(body.data_recalibracao || '').trim() || dataRecalibracao === null) {
    return { error: 'Informe uma data e hora de medição válida.' };
  }

  if (quantidadeRealKg === null) {
    return { error: 'Informe uma quantidade real maior ou igual a zero, com até três casas decimais.' };
  }

  return {
    payload: {
      produto,
      dataRecalibracao,
      quantidadeRealKg,
      observacoes,
    },
  };
}

async function createStorageRecalibration(payload, userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`armazenamento_recalibracoes:${payload.produto}`]);
    await client.query(`
      INSERT INTO armazenamento_recalibracoes (
        produto,
        data_recalibracao,
        quantidade_real_kg,
        observacoes,
        criado_por_user_id
      )
      VALUES ($1, $2, $3, $4, $5);
    `, [
      payload.produto,
      payload.dataRecalibracao,
      payload.quantidadeRealKg,
      payload.observacoes,
      userId,
    ]);

    // Recalcula todo o produto para manter o histórico correto até quando uma
    // medição é lançada fora da ordem cronológica.
    await client.query(`
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
        WHERE atual.produto = $1
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
    `, [payload.produto]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  buildStorageRecalibrationPayload,
  countStorageIgnoredInputs,
  createStorageRecalibration,
  getStorageSummary,
  listStorageRecalibrations,
};
