const { ensureDatabaseConfigured, pool } = require('./database');
const { parseOptionalDateTime } = require('./utils');
const {
  MAX_DRIVER_NAME_LENGTH,
  normalizeDecimal,
  normalizeText,
  recordAuditAction,
  weighbridgeError,
} = require('./weighbridge-service');

// Pesagens avulsas: tudo o que passa pela balança e não é entrada nem saída de
// soja/milho. O operador tem liberdade nos campos descritivos (todos opcionais
// e em texto livre) e as duas pesagens não têm ordem fixa: o peso líquido é a
// diferença absoluta entre elas, calculada pelo banco.

const MAX_PLATE_LENGTH = 10;
const MAX_FREE_TEXT_LENGTH = 120;
const MAX_COMMENT_LENGTH = 1000;

const FREE_TEXT_FIELDS = [
  ['nome_motorista', 'nomeMotorista', 'O nome do motorista', MAX_DRIVER_NAME_LENGTH],
  ['produto', 'produto', 'O produto', MAX_FREE_TEXT_LENGTH],
  ['vendedor', 'vendedor', 'O vendedor', MAX_FREE_TEXT_LENGTH],
  ['comprador', 'comprador', 'O comprador', MAX_FREE_TEXT_LENGTH],
];

const DETAIL_COLUMNS = `
  p.id,
  p.placa_caminhao,
  p.nome_motorista,
  p.produto,
  p.vendedor,
  p.comprador,
  p.comentario,
  p.pesagem_1_kg,
  p.pesagem_1_em,
  p.pesagem_2_kg,
  p.pesagem_2_em,
  p.peso_liquido_kg
`;

function isRecordId(value) {
  return /^[1-9]\d{0,18}$/.test(String(value ?? ''));
}

// Conta caracteres como o char_length do PostgreSQL (pontos de código), para
// que o limite da aplicação e o do banco sejam o mesmo.
function textLength(value) {
  return [...value].length;
}

function normalizeOptionalLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ') || null;
}

// Preserva as quebras de linha do comentário; só remove espaços das pontas.
function normalizeComment(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim() || null;
}

function normalizeOptionalPlate(value) {
  return normalizeText(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || null;
}

function buildDescriptiveFields(body) {
  const fields = { placaCaminhao: normalizeOptionalPlate(body.placa_caminhao) };

  if (fields.placaCaminhao && fields.placaCaminhao.length > MAX_PLATE_LENGTH) {
    return { error: `A placa pode ter no máximo ${MAX_PLATE_LENGTH} letras e números.` };
  }

  for (const [bodyKey, payloadKey, label, maxLength] of FREE_TEXT_FIELDS) {
    const value = normalizeOptionalLine(body[bodyKey]);

    if (value && textLength(value) > maxLength) {
      return { error: `${label} pode ter no máximo ${maxLength} caracteres.` };
    }

    fields[payloadKey] = value;
  }

  fields.comentario = normalizeComment(body.comentario);

  if (fields.comentario && textLength(fields.comentario) > MAX_COMMENT_LENGTH) {
    return { error: `O comentário pode ter no máximo ${MAX_COMMENT_LENGTH} caracteres.` };
  }

  return { fields };
}

function buildStandaloneWeighingPayload(body = {}) {
  const pesagem1Em = parseOptionalDateTime(body.pesagem_1_em);
  const pesagem1Kg = normalizeDecimal(body.pesagem_1_kg);

  if (!pesagem1Em) {
    return { error: 'Informe data e hora válidas para a pesagem 1.' };
  }

  if (!pesagem1Kg) {
    return { error: 'Informe um peso válido para a pesagem 1.' };
  }

  const descriptive = buildDescriptiveFields(body);

  if (descriptive.error) {
    return descriptive;
  }

  return { payload: { ...descriptive.fields, pesagem1Em, pesagem1Kg } };
}

function buildStandaloneWeighingSecondPayload(body = {}) {
  const pesagem2Kg = normalizeDecimal(body.pesagem_2_kg);
  const pesagem2Em = parseOptionalDateTime(body.pesagem_2_em);

  if (!pesagem2Kg) {
    return { error: 'Informe um peso válido para a pesagem 2.' };
  }

  if (!pesagem2Em) {
    return { error: 'Informe data e hora válidas para a pesagem 2.' };
  }

  return { payload: { pesagem2Kg, pesagem2Em } };
}

// Edição completa. Pesagem 2 em branco deixa a pesagem pendente de novo; com
// peso e sem data/hora, usa o momento atual (mesmo padrão dos formulários).
function buildStandaloneWeighingEditPayload(body = {}) {
  const base = buildStandaloneWeighingPayload(body);

  if (base.error) {
    return base;
  }

  const pesagem2Raw = normalizeText(body.pesagem_2_kg);

  if (!pesagem2Raw) {
    return { payload: { ...base.payload, pesagem2Kg: null, pesagem2Em: null } };
  }

  const pesagem2Kg = normalizeDecimal(pesagem2Raw);

  if (!pesagem2Kg) {
    return { error: 'Informe um peso válido para a pesagem 2 ou deixe o campo em branco.' };
  }

  const pesagem2Em = parseOptionalDateTime(body.pesagem_2_em);

  if (!pesagem2Em) {
    return { error: 'Informe data e hora válidas para a pesagem 2.' };
  }

  return { payload: { ...base.payload, pesagem2Kg, pesagem2Em } };
}

async function createStandaloneWeighing(payload, userId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      INSERT INTO pesagens_avulsas (
        pesagem_1_em,
        pesagem_1_kg,
        placa_caminhao,
        nome_motorista,
        produto,
        vendedor,
        comprador,
        comentario,
        criado_por_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      payload.pesagem1Em,
      payload.pesagem1Kg,
      payload.placaCaminhao,
      payload.nomeMotorista,
      payload.produto,
      payload.vendedor,
      payload.comprador,
      payload.comentario,
      userId,
    ]
  );

  return result.rows[0];
}

async function listStandaloneWeighings(options = {}) {
  ensureDatabaseConfigured();

  const limitClause = options.limit ? 'LIMIT $1 OFFSET $2' : '';
  const values = options.limit ? [options.limit, options.offset || 0] : [];
  const orderDirection = options.order === 'asc' ? 'ASC' : 'DESC';
  const result = await pool.query(
    `
      SELECT ${DETAIL_COLUMNS}
      FROM pesagens_avulsas p
      ${options.pendingOnly ? 'WHERE p.pesagem_2_kg IS NULL' : ''}
      ORDER BY p.pesagem_1_em ${orderDirection}, p.id ${orderDirection}
      ${limitClause}
    `,
    values
  );

  return result.rows;
}

// Dados completos da pesagem, usados no detalhe, na API e no ticket.
async function getStandaloneWeighingById(id) {
  if (!isRecordId(id)) {
    return null;
  }

  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT ${DETAIL_COLUMNS},
             p.criado_em,
             p.atualizado_em,
             u.login AS operador_login,
             u2.login AS pesagem_2_operador_login
      FROM pesagens_avulsas p
      LEFT JOIN users u ON u.id = p.criado_por_user_id
      LEFT JOIN users u2 ON u2.id = p.pesagem_2_por_user_id
      WHERE p.id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function withTransaction(callback) {
  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function lockStandaloneWeighing(client, id) {
  const result = await client.query('SELECT * FROM pesagens_avulsas WHERE id = $1 FOR UPDATE', [id]);
  return result.rows[0] || null;
}

// Grava a pesagem 2 de uma pesagem pendente. Devolve null quando a pesagem
// não existe ou já tem a pesagem 2.
async function addStandaloneWeighingSecond(id, payload, user) {
  if (!isRecordId(id)) {
    return null;
  }

  return withTransaction(async (client) => {
    const previous = await lockStandaloneWeighing(client, id);

    if (!previous) {
      return null;
    }

    const result = await client.query(
      `
        UPDATE pesagens_avulsas
        SET pesagem_2_kg = $2,
            pesagem_2_em = $3,
            pesagem_2_por_user_id = $4,
            atualizado_em = now()
        WHERE id = $1
          AND pesagem_2_kg IS NULL
        RETURNING *
      `,
      [id, payload.pesagem2Kg, payload.pesagem2Em, user.userId]
    );
    const updated = result.rows[0] || null;

    if (updated) {
      await recordAuditAction(client, {
        tipoAcao: 'editar_pesagem_avulsa',
        entidadeTipo: 'pesagens_avulsas',
        entidadeId: id,
        user,
        dadosAnteriores: previous,
        dadosPosteriores: updated,
        detalhes: { campo_editado: 'pesagem_2_kg' },
      });
    }

    return updated ? { id: updated.id } : null;
  });
}

async function updateStandaloneWeighing(id, payload, user) {
  if (!isRecordId(id)) {
    return null;
  }

  return withTransaction(async (client) => {
    const previous = await lockStandaloneWeighing(client, id);

    if (!previous) {
      return null;
    }

    const result = await client.query(
      `
        UPDATE pesagens_avulsas
        SET pesagem_1_em = $2,
            pesagem_1_kg = $3,
            placa_caminhao = $4,
            nome_motorista = $5,
            produto = $6,
            vendedor = $7,
            comprador = $8,
            comentario = $9,
            pesagem_2_kg = $10,
            pesagem_2_em = $11,
            pesagem_2_por_user_id = CASE
              WHEN $10::numeric IS NULL THEN NULL
              WHEN pesagem_2_kg IS NULL THEN $12::uuid
              ELSE pesagem_2_por_user_id
            END,
            atualizado_em = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        payload.pesagem1Em,
        payload.pesagem1Kg,
        payload.placaCaminhao,
        payload.nomeMotorista,
        payload.produto,
        payload.vendedor,
        payload.comprador,
        payload.comentario,
        payload.pesagem2Kg,
        payload.pesagem2Em,
        user.userId,
      ]
    );
    const updated = result.rows[0];

    await recordAuditAction(client, {
      tipoAcao: 'editar_pesagem_avulsa',
      entidadeTipo: 'pesagens_avulsas',
      entidadeId: id,
      user,
      dadosAnteriores: previous,
      dadosPosteriores: updated,
    });

    return { id: updated.id };
  });
}

async function deleteStandaloneWeighing(id, user, motivoDelecao) {
  if (!isRecordId(id)) {
    throw weighbridgeError('NOT_FOUND', 'Pesagem avulsa não encontrada.');
  }

  return withTransaction(async (client) => {
    const previous = await lockStandaloneWeighing(client, id);

    if (!previous) {
      throw weighbridgeError('NOT_FOUND', 'Pesagem avulsa não encontrada.');
    }

    await client.query('DELETE FROM pesagens_avulsas WHERE id = $1', [id]);
    await recordAuditAction(client, {
      tipoAcao: 'deletar_pesagem_avulsa',
      entidadeTipo: 'pesagens_avulsas',
      entidadeId: id,
      user,
      dadosAnteriores: previous,
      detalhes: { motivo_delecao: motivoDelecao },
    });

    return { id: previous.id };
  });
}

function isStandaloneWeighingComplete(weighing) {
  return weighing?.pesagem_2_kg !== null
    && weighing?.pesagem_2_kg !== undefined
    && weighing?.peso_liquido_kg !== null
    && weighing?.peso_liquido_kg !== undefined;
}

module.exports = {
  addStandaloneWeighingSecond,
  buildStandaloneWeighingEditPayload,
  buildStandaloneWeighingPayload,
  buildStandaloneWeighingSecondPayload,
  createStandaloneWeighing,
  deleteStandaloneWeighing,
  getStandaloneWeighingById,
  isStandaloneWeighingComplete,
  listStandaloneWeighings,
  MAX_COMMENT_LENGTH,
  MAX_FREE_TEXT_LENGTH,
  MAX_PLATE_LENGTH,
  updateStandaloneWeighing,
};
