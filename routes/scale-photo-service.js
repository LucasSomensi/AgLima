const { ensureDatabaseConfigured, pool } = require('./database');
const { APP_TIME_ZONE } = require('./constants');
const storage = require('./scale-photo-storage');

const CAPTURE_TTL_MINUTES = 60;
const DEFAULT_AUTOMATIC_RETENTION_DAYS = 365;
const CLEANUP_BATCH_SIZE = 500;
const MAX_POSTGRES_INTEGER = 2147483647;
const MAX_CAPTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_KEY_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;
const PHOTO_COLUMNS = `
  id, origem, status, arquivo, tamanho_bytes, peso_kg, capturada_em, recebida_em,
  contingencia, chave_cliente, entrada_id, saida_id, tipo_peso, criada_por_user_id,
  expira_em, vinculada_em
`;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function getAutomaticRetentionDays() {
  const days = Number.parseInt(process.env.FOTOS_RETENCAO_AUTOMATICAS_DIAS || '', 10);
  return Number.isInteger(days) && days > 0 ? days : DEFAULT_AUTOMATIC_RETENTION_DAYS;
}

function parseWeightHeader(value) {
  const text = String(value ?? '').trim();

  if (!/^\d{1,10}$/.test(text)) {
    return null;
  }

  const weight = Number(text);
  return weight <= MAX_POSTGRES_INTEGER ? weight : null;
}

// Exige data/hora ISO 8601 com fuso (Z ou ±hh:mm) para não depender do
// relógio local do computador da balança. Rejeita horários no futuro.
function parseCapturedAtHeader(value, now = new Date()) {
  const text = String(value ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return null;
  }

  const date = new Date(text.replace(/(\.\d{3})\d+/, '$1'));

  if (Number.isNaN(date.getTime()) || date.getTime() > now.getTime() + MAX_CAPTURE_CLOCK_SKEW_MS) {
    return null;
  }

  return date;
}

function buildAutomaticPhotoPayload({ key, headers, body }) {
  if (!CLIENT_KEY_PATTERN.test(String(key || ''))) {
    return { error: 'A chave da foto deve ter de 1 a 120 caracteres entre A-Z, a-z, 0-9, ponto, hífen e sublinhado.' };
  }

  const pesoKg = parseWeightHeader(headers['x-peso-kg']);

  if (pesoKg === null) {
    return { error: 'X-Peso-Kg deve ser um número inteiro entre 0 e 2147483647.' };
  }

  const capturadaEm = parseCapturedAtHeader(headers['x-capturada-em']);

  if (!capturadaEm) {
    return { error: 'X-Capturada-Em deve ser uma data/hora ISO 8601 com fuso horário e não pode estar no futuro.' };
  }

  const substitui = headers['x-substitui'] === undefined ? null : String(headers['x-substitui']).trim();

  if (substitui !== null && !CLIENT_KEY_PATTERN.test(substitui)) {
    return { error: 'X-Substitui deve seguir o mesmo formato da chave da foto.' };
  }

  const photoError = storage.validatePhotoBuffer(body);

  if (photoError) {
    return { error: photoError };
  }

  return { payload: { chave: key, pesoKg, capturadaEm, substitui, buffer: body } };
}

function buildWeightWithPhotoPayload({ headers, body }) {
  const pesoKg = parseWeightHeader(headers['x-peso-kg']);

  if (pesoKg === null) {
    return { error: 'X-Peso-Kg deve ser um número inteiro entre 0 e 2147483647.' };
  }

  const photoError = storage.validatePhotoBuffer(body);

  if (photoError) {
    return { error: photoError };
  }

  return { payload: { pesoKg, buffer: body } };
}

// Salva o peso atual e a foto que o acompanha. A foto vale para o peso
// enquanto foto_atualizado_em = atualizado_em; um peso posterior enviado sem
// foto (POST /peso) a invalida sem precisar apagá-la.
async function saveCurrentWeightWithPhoto(scaleId, { pesoKg, buffer }) {
  ensureDatabaseConfigured();

  const relativePath = storage.buildCurrentPhotoPath();
  await storage.writePhotoAtomically(relativePath, buffer);

  let reading;

  try {
    const result = await pool.query(
      `
        WITH anterior AS (
          SELECT foto_arquivo
          FROM balancas_pesos_atuais
          WHERE balanca_id = $1
          FOR UPDATE
        )
        INSERT INTO balancas_pesos_atuais (balanca_id, peso_kg, atualizado_em, foto_arquivo, foto_atualizado_em)
        VALUES ($1, $2, now(), $3, now())
        ON CONFLICT (balanca_id) DO UPDATE
        SET peso_kg = EXCLUDED.peso_kg,
            atualizado_em = EXCLUDED.atualizado_em,
            foto_arquivo = EXCLUDED.foto_arquivo,
            foto_atualizado_em = EXCLUDED.foto_atualizado_em
        RETURNING balanca_id, peso_kg, atualizado_em, (SELECT foto_arquivo FROM anterior) AS foto_anterior
      `,
      [scaleId, pesoKg, relativePath]
    );
    reading = result.rows[0];
  } catch (error) {
    await storage.deletePhotoFile(relativePath);
    throw error;
  }

  if (reading.foto_anterior && reading.foto_anterior !== relativePath) {
    await storage.deletePhotoFile(reading.foto_anterior);
  }

  return {
    balanca_id: reading.balanca_id,
    peso_kg: reading.peso_kg,
    atualizado_em: reading.atualizado_em,
  };
}

async function getPhotoByClientKey(key) {
  const result = await pool.query(
    `SELECT ${PHOTO_COLUMNS} FROM balanca_fotos WHERE chave_cliente = $1`,
    [key]
  );
  return result.rows[0] || null;
}

// Grava uma foto automática do AutoWeight. A chave do cliente torna o envio
// idempotente: reenviar a mesma chave devolve a foto já gravada.
async function saveAutomaticPhoto(scaleId, { chave, pesoKg, capturadaEm, substitui, buffer }) {
  ensureDatabaseConfigured();

  const existing = await getPhotoByClientKey(chave);

  if (existing) {
    return { created: false, photo: existing };
  }

  const relativePath = storage.buildStoredPhotoPath('automaticas', capturadaEm);
  await storage.writePhotoAtomically(relativePath, buffer);

  let photo;

  try {
    const result = await pool.query(
      `
        INSERT INTO balanca_fotos (
          balanca_id, origem, status, arquivo, tamanho_bytes, sha256, peso_kg,
          capturada_em, contingencia, chave_cliente
        )
        VALUES ($1, 'automatica', 'recebida', $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (chave_cliente) DO NOTHING
        RETURNING ${PHOTO_COLUMNS}
      `,
      [
        scaleId,
        relativePath,
        buffer.length,
        storage.sha256(buffer),
        pesoKg,
        capturadaEm,
        storage.isContingencyPhoto(buffer),
        chave,
      ]
    );
    photo = result.rows[0] || null;
  } catch (error) {
    await storage.deletePhotoFile(relativePath);
    throw error;
  }

  if (!photo) {
    // Outra requisição com a mesma chave venceu a corrida.
    await storage.deletePhotoFile(relativePath);
    return { created: false, photo: await getPhotoByClientKey(chave) };
  }

  if (substitui && substitui !== chave) {
    await pool.query(
      `
        UPDATE balanca_fotos
        SET status = 'substituida'
        WHERE chave_cliente = $1
          AND origem = 'automatica'
          AND status = 'recebida'
      `,
      [substitui]
    );
  }

  return { created: true, photo };
}

async function readCurrentReadingWithPhoto(scaleId) {
  const result = await pool.query(
    `
      SELECT balanca_id,
             peso_kg,
             atualizado_em,
             CASE WHEN foto_atualizado_em = atualizado_em THEN foto_arquivo END AS foto_arquivo
      FROM balancas_pesos_atuais
      WHERE balanca_id = $1
    `,
    [scaleId]
  );
  return result.rows[0] || null;
}

// Usado pelo botão "usar peso da balança": devolve o peso atual e, quando a
// foto que veio com esse peso existe, cria uma cópia temporária ligada ao
// operador. Ela só passa a valer quando o lançamento for salvo com o mesmo peso.
async function createWeightCapture(scaleId, userId) {
  ensureDatabaseConfigured();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reading = await readCurrentReadingWithPhoto(scaleId);

    if (!reading) {
      return { reading: null, capture: null };
    }

    const { foto_arquivo: currentPhoto, ...weight } = reading;

    if (!currentPhoto) {
      return { reading: weight, capture: null };
    }

    const relativePath = storage.buildStoredPhotoPath('capturas', new Date());
    let buffer;

    try {
      buffer = await storage.copyPhoto(currentPhoto, relativePath);
    } catch (error) {
      // O AutoWeight trocou a foto atual entre a consulta e a cópia: lê de novo.
      if (error.code === 'ENOENT' && attempt === 0) continue;
      throw error;
    }

    try {
      const result = await pool.query(
        `
          INSERT INTO balanca_fotos (
            balanca_id, origem, status, arquivo, tamanho_bytes, sha256, peso_kg,
            capturada_em, contingencia, criada_por_user_id, expira_em
          )
          VALUES ($1, 'lancamento', 'temporaria', $2, $3, $4, $5, $6, $7, $8,
                  now() + make_interval(mins => $9))
          RETURNING ${PHOTO_COLUMNS}
        `,
        [
          scaleId,
          relativePath,
          buffer.length,
          storage.sha256(buffer),
          weight.peso_kg,
          weight.atualizado_em,
          storage.isContingencyPhoto(buffer),
          userId,
          CAPTURE_TTL_MINUTES,
        ]
      );
      return { reading: weight, capture: result.rows[0] };
    } catch (error) {
      await storage.deletePhotoFile(relativePath);
      throw error;
    }
  }

  return { reading: null, capture: null };
}

// Confirma a foto temporária quando o lançamento é salvo. Só vincula se a
// captura é do mesmo operador, ainda não venceu e o peso salvo é exatamente o
// peso que veio da balança: peso digitado ou alterado fica sem foto.
async function linkCaptureToRecord({ captureId, userId, entradaId = null, saidaId = null, tipoPeso, pesoKg }) {
  if (!isUuid(captureId) || (!entradaId && !saidaId) || !['bruto', 'tara'].includes(tipoPeso)) {
    return null;
  }

  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      UPDATE balanca_fotos
      SET status = 'vinculada',
          entrada_id = $3,
          saida_id = $4,
          tipo_peso = $5,
          vinculada_em = now(),
          expira_em = NULL
      WHERE id = $1
        AND origem = 'lancamento'
        AND status = 'temporaria'
        AND criada_por_user_id = $2
        AND expira_em > now()
        AND peso_kg = $6::numeric
      RETURNING id
    `,
    [captureId, userId, entradaId, saidaId, tipoPeso, String(pesoKg)]
  );

  return result.rows[0] || null;
}

async function getPhotoById(photoId) {
  if (!isUuid(photoId)) {
    return null;
  }

  ensureDatabaseConfigured();

  const result = await pool.query(`SELECT ${PHOTO_COLUMNS} FROM balanca_fotos WHERE id = $1`, [photoId]);
  return result.rows[0] || null;
}

async function listLinkedPhotos({ entradaId = null, saidaId = null }) {
  ensureDatabaseConfigured();

  const column = entradaId ? 'entrada_id' : 'saida_id';
  const id = entradaId || saidaId;

  if (!id) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT ${PHOTO_COLUMNS}
      FROM balanca_fotos
      WHERE ${column} = $1
        AND status = 'vinculada'
      ORDER BY vinculada_em ASC
    `,
    [id]
  );
  return result.rows;
}

// Fotos automáticas de um dia no fuso da aplicação (data no formato AAAA-MM-DD).
async function listAutomaticPhotosByDay(day) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT ${PHOTO_COLUMNS}
      FROM balanca_fotos
      WHERE origem = 'automatica'
        AND capturada_em >= ($1::date::timestamp AT TIME ZONE $2)
        AND capturada_em < (($1::date + 1)::timestamp AT TIME ZONE $2)
      ORDER BY capturada_em DESC
    `,
    [day, APP_TIME_ZONE]
  );
  return result.rows;
}

async function deleteRowsAndFiles(sql, params) {
  const result = await pool.query(sql, params);

  for (const row of result.rows) {
    await storage.deletePhotoFile(row.arquivo);
  }

  return result.rows.length;
}

// Limpeza periódica: descarta capturas temporárias vencidas (lançamentos
// cancelados ou abandonados), apaga fotos automáticas além do prazo de
// retenção e remove sobras da pasta da foto atual. Fotos vinculadas a
// lançamentos nunca são apagadas aqui, mesmo depois de excluir o lançamento.
async function cleanupScalePhotos() {
  ensureDatabaseConfigured();

  const expiredCaptures = await deleteRowsAndFiles(
    `
      DELETE FROM balanca_fotos
      WHERE id IN (
        SELECT id FROM balanca_fotos
        WHERE status = 'temporaria' AND expira_em <= now()
        LIMIT $1
      )
      RETURNING arquivo
    `,
    [CLEANUP_BATCH_SIZE]
  );
  const expiredAutomatic = await deleteRowsAndFiles(
    `
      DELETE FROM balanca_fotos
      WHERE id IN (
        SELECT id FROM balanca_fotos
        WHERE origem = 'automatica'
          AND capturada_em < now() - make_interval(days => $2)
        LIMIT $1
      )
      RETURNING arquivo
    `,
    [CLEANUP_BATCH_SIZE, getAutomaticRetentionDays()]
  );

  const current = await pool.query('SELECT foto_arquivo FROM balancas_pesos_atuais WHERE balanca_id = 1');
  const prunedCurrent = await storage.pruneCurrentPhotos(current.rows[0]?.foto_arquivo || null);

  return { expiredCaptures, expiredAutomatic, prunedCurrent };
}

module.exports = {
  buildAutomaticPhotoPayload,
  buildWeightWithPhotoPayload,
  CAPTURE_TTL_MINUTES,
  cleanupScalePhotos,
  createWeightCapture,
  getAutomaticRetentionDays,
  getPhotoById,
  isUuid,
  linkCaptureToRecord,
  listAutomaticPhotosByDay,
  listLinkedPhotos,
  parseCapturedAtHeader,
  parseWeightHeader,
  saveAutomaticPhoto,
  saveCurrentWeightWithPhoto,
};
