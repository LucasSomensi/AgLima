const { ensureDatabaseConfigured, pool } = require('./database');
const { parseOptionalDateTime } = require('./utils');

const PRODUCT_VALUES = ['milho', 'soja'];
const MAX_INPUT_GROSS_WEIGHT_KG = 80000;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDecimal(value) {
  const normalizedValue = normalizeText(value).replace(',', '.');

  if (!/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return normalizedValue;
}

function normalizePlate(value) {
  return normalizeText(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function buildScaleOutputPayload(body) {
  const dataSaida = parseOptionalDateTime(body.data_saida);
  const placaCaminhao = normalizePlate(body.placa_caminhao);
  const produto = normalizeText(body.produto);
  const pesoTaraKg = normalizeDecimal(body.peso_tara_kg);

  if (!dataSaida) {
    return { error: 'Informe uma data e hora de saída válidas.' };
  }

  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaCaminhao)) {
    return { error: 'Informe uma placa válida no padrão ABC1234 ou ABC1D23.' };
  }

  if (!PRODUCT_VALUES.includes(produto)) {
    return { error: 'Selecione milho ou soja como produto.' };
  }

  if (!pesoTaraKg) {
    return { error: 'Informe um peso tara válido.' };
  }

  return {
    payload: {
      dataSaida,
      placaCaminhao,
      produto,
      pesoTaraKg,
    },
  };
}

function buildScaleOutputGrossPayload(body) {
  const pesoBrutoKg = normalizeDecimal(body.peso_bruto_kg);

  if (!pesoBrutoKg) {
    return { error: 'Informe um peso bruto válido.' };
  }

  return { payload: { pesoBrutoKg } };
}

async function createScaleOutput(payload, userId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      INSERT INTO saidas_balanca (
        data_saida,
        placa_caminhao,
        produto,
        peso_tara_kg,
        criado_por_user_id
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
    [payload.dataSaida, payload.placaCaminhao, payload.produto, payload.pesoTaraKg, userId]
  );

  return result.rows[0];
}

function buildScaleInputPayload(body) {
  const dataEntrada = parseOptionalDateTime(body.data_entrada);
  const placaCaminhao = normalizePlate(body.placa_caminhao);
  const produto = normalizeText(body.produto);
  const pesoBrutoKg = normalizeDecimal(body.peso_bruto_kg);
  const usarTaraAnterior = body.usar_tara_anterior === 'on' || body.usar_tara_anterior === 'true' || body.usar_tara_anterior === true;

  if (!dataEntrada) {
    return { error: 'Informe uma data e hora de entrada válidas.' };
  }

  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaCaminhao)) {
    return { error: 'Informe uma placa válida no padrão ABC1234 ou ABC1D23.' };
  }

  if (!PRODUCT_VALUES.includes(produto)) {
    return { error: 'Selecione milho ou soja como produto.' };
  }

  if (!pesoBrutoKg) {
    return { error: 'Informe um peso bruto válido.' };
  }

  if (Number(pesoBrutoKg) >= MAX_INPUT_GROSS_WEIGHT_KG) {
    return { error: 'O peso bruto deve estar abaixo de 80.000 kg.' };
  }

  return {
    payload: {
      dataEntrada,
      placaCaminhao,
      produto,
      pesoBrutoKg,
      usarTaraAnterior,
    },
  };
}

function buildScaleInputEditPayload(body) {
  const basePayload = buildScaleInputPayload(body);

  if (basePayload.error) {
    return basePayload;
  }

  const pesoTaraRaw = normalizeText(body.peso_tara_kg);
  const pesoTaraKg = pesoTaraRaw ? normalizeDecimal(pesoTaraRaw) : null;

  if (pesoTaraRaw && !pesoTaraKg) {
    return { error: 'Informe um peso tara válido ou deixe o campo em branco.' };
  }

  if (pesoTaraKg && Number(basePayload.payload.pesoBrutoKg) <= Number(pesoTaraKg)) {
    return { error: 'O peso bruto precisa ser maior que o peso tara.' };
  }

  const origem = normalizeText(body.origem).replace(/\s+/g, ' ');

  if (origem.length > 200) {
    return { error: 'Informe uma origem com até 200 caracteres.' };
  }

  const classificationFields = ['umidade_percent', 'impureza_percent', 'graos_avariados_percent'];
  const hasAnyClassification = classificationFields.some((field) => normalizeText(body[field]) !== '');
  let classification = {
    umidadePercent: null,
    impurezaPercent: null,
    graosAvariadosPercent: null,
  };

  if (hasAnyClassification) {
    const umidadePercent = normalizePercent(body.umidade_percent);
    const impurezaPercent = normalizePercent(body.impureza_percent);
    const graosAvariadosPercent = normalizePercent(body.graos_avariados_percent);

    if (umidadePercent === null) {
      return { error: 'Informe uma umidade entre 0 e 100%.' };
    }

    if (impurezaPercent === null) {
      return { error: 'Informe uma impureza entre 0 e 100%.' };
    }

    if (graosAvariadosPercent === null) {
      return { error: 'Informe grãos avariados entre 0 e 100%.' };
    }

    classification = {
      umidadePercent,
      impurezaPercent,
      graosAvariadosPercent,
    };
  }

  return {
    payload: {
      ...basePayload.payload,
      pesoTaraKg,
      origem: origem || null,
      ...classification,
    },
  };
}

function buildScaleInputTarePayload(body) {
  const pesoTaraKg = normalizeDecimal(body.peso_tara_kg);

  if (!pesoTaraKg) {
    return { error: 'Informe um peso tara válido.' };
  }

  return { payload: { pesoTaraKg } };
}

function normalizePercent(value) {
  const normalizedValue = normalizeText(value).replace(',', '.');

  if (!/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 100) {
    return null;
  }

  return normalizedValue;
}

function buildScaleInputClassificationPayload(body) {
  const umidadePercent = normalizePercent(body.umidade_percent);
  const impurezaPercent = normalizePercent(body.impureza_percent);
  const graosAvariadosPercent = normalizePercent(body.graos_avariados_percent);

  if (umidadePercent === null) {
    return { error: 'Informe uma umidade entre 0 e 100%.' };
  }

  if (impurezaPercent === null) {
    return { error: 'Informe uma impureza entre 0 e 100%.' };
  }

  if (graosAvariadosPercent === null) {
    return { error: 'Informe grãos avariados entre 0 e 100%.' };
  }

  return {
    payload: {
      umidadePercent,
      impurezaPercent,
      graosAvariadosPercent,
    },
  };
}

function buildScaleInputOriginPayload(body) {
  const origem = normalizeText(body.origem).replace(/\s+/g, ' ');

  if (!origem) {
    return { error: 'Informe a origem da entrada.' };
  }

  if (origem.length > 200) {
    return { error: 'Informe uma origem com até 200 caracteres.' };
  }

  return { payload: { origem } };
}

async function getPreviousTareForPlate(plate) {
  ensureDatabaseConfigured();

  const placaCaminhao = normalizePlate(plate);

  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaCaminhao)) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT id,
             peso_tara_kg
      FROM entradas_balanca
      WHERE placa_caminhao = $1
        AND peso_tara_kg IS NOT NULL
      ORDER BY data_entrada DESC, id DESC
      LIMIT 1
    `,
    [placaCaminhao]
  );

  return result.rows[0] || null;
}

async function createScaleInput(payload, userId) {
  ensureDatabaseConfigured();

  let previousTare = null;

  if (payload.usarTaraAnterior) {
    previousTare = await getPreviousTareForPlate(payload.placaCaminhao);

    if (!previousTare) {
      const error = new Error('Não há tara anterior para a placa selecionada.');
      error.code = 'NO_PREVIOUS_TARE';
      throw error;
    }

    if (Number(payload.pesoBrutoKg) <= Number(previousTare.peso_tara_kg)) {
      const error = new Error('O peso bruto precisa ser maior que a tara anterior.');
      error.code = 'INVALID_PREVIOUS_TARE';
      throw error;
    }
  }

  const result = await pool.query(
    `
      INSERT INTO entradas_balanca (
        data_entrada,
        placa_caminhao,
        produto,
        peso_bruto_kg,
        peso_tara_kg,
        tara_usada_de_entrada_id,
        criado_por_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [
      payload.dataEntrada,
      payload.placaCaminhao,
      payload.produto,
      payload.pesoBrutoKg,
      previousTare?.peso_tara_kg || null,
      previousTare?.id || null,
      userId,
    ]
  );

  return result.rows[0];
}

async function listScaleInputs(options = {}) {
  ensureDatabaseConfigured();

  const limitClause = options.limit ? 'LIMIT $1' : '';
  const values = options.limit ? [options.limit] : [];
  const orderDirection = options.order === 'asc' ? 'ASC' : 'DESC';
  const result = await pool.query(
    `
      SELECT id,
             data_entrada,
             placa_caminhao,
             produto,
             peso_bruto_kg,
             peso_tara_kg,
             peso_liquido_kg,
             tara_usada_de_entrada_id,
             origem,
             umidade_percent,
             impureza_percent,
             graos_avariados_percent,
             cliente_user_id
      FROM entradas_balanca
      ORDER BY data_entrada ${orderDirection}, id ${orderDirection}
      ${limitClause}
    `,
    values
  );

  return result.rows;
}

async function listRecentInputPlates(search = '') {
  ensureDatabaseConfigured();

  const normalizedSearch = normalizePlate(search);
  const values = normalizedSearch ? [`%${normalizedSearch}%`] : [];
  const filterClause = normalizedSearch ? 'WHERE placa_caminhao ILIKE $1' : '';

  const result = await pool.query(
    `
      WITH placas AS (
        SELECT DISTINCT ON (placa_caminhao)
               placa_caminhao,
               data_entrada,
               id
        FROM entradas_balanca
        ${filterClause}
        ORDER BY placa_caminhao, data_entrada DESC, id DESC
      )
      SELECT placas.placa_caminhao,
             tara_anterior.peso_tara_kg IS NOT NULL AS tem_tara_anterior,
             tara_anterior.peso_tara_kg
      FROM placas
      LEFT JOIN LATERAL (
        SELECT peso_tara_kg
        FROM entradas_balanca entrada_tara
        WHERE entrada_tara.placa_caminhao = placas.placa_caminhao
          AND entrada_tara.peso_tara_kg IS NOT NULL
        ORDER BY entrada_tara.data_entrada DESC, entrada_tara.id DESC
        LIMIT 1
      ) tara_anterior ON true
      ORDER BY placas.data_entrada DESC, placas.id DESC
      LIMIT 5
    `,
    values
  );

  return result.rows;
}

async function getScaleInputById(inputId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id,
             data_entrada,
             placa_caminhao,
             produto,
             peso_bruto_kg,
             peso_tara_kg,
             peso_liquido_kg,
             tara_usada_de_entrada_id,
             origem,
             umidade_percent,
             impureza_percent,
             graos_avariados_percent,
             cliente_user_id
      FROM entradas_balanca
      WHERE id = $1
      LIMIT 1
    `,
    [inputId]
  );

  return result.rows[0] || null;
}

async function updateScaleInput(inputId, payload, userId) {
  ensureDatabaseConfigured();

  const hasTare = payload.pesoTaraKg !== null && payload.pesoTaraKg !== undefined;
  const hasOrigin = Boolean(payload.origem);
  const hasClassification = payload.umidadePercent !== null
    && payload.umidadePercent !== undefined
    && payload.impurezaPercent !== null
    && payload.impurezaPercent !== undefined
    && payload.graosAvariadosPercent !== null
    && payload.graosAvariadosPercent !== undefined;

  const result = await pool.query(
    `
      UPDATE entradas_balanca
      SET data_entrada = $2,
          placa_caminhao = $3,
          produto = $4,
          peso_bruto_kg = $5,
          peso_tara_kg = $6,
          tara_usada_de_entrada_id = NULL,
          tara_adicionada_por_user_id = CASE WHEN $7::boolean THEN $11 ELSE NULL END,
          tara_adicionada_em = CASE WHEN $7::boolean THEN COALESCE(tara_adicionada_em, now()) ELSE NULL END,
          origem = $8,
          origem_definida_por_user_id = CASE WHEN $9::boolean THEN $11 ELSE NULL END,
          origem_definida_em = CASE WHEN $9::boolean THEN COALESCE(origem_definida_em, now()) ELSE NULL END,
          umidade_percent = $12,
          impureza_percent = $13,
          graos_avariados_percent = $14,
          classificado_por_user_id = CASE WHEN $10::boolean THEN $11 ELSE NULL END,
          classificado_em = CASE WHEN $10::boolean THEN COALESCE(classificado_em, now()) ELSE NULL END,
          atualizado_em = now()
      WHERE id = $1
        AND ($6::numeric IS NULL OR $5::numeric > $6::numeric)
      RETURNING id
    `,
    [
      inputId,
      payload.dataEntrada,
      payload.placaCaminhao,
      payload.produto,
      payload.pesoBrutoKg,
      payload.pesoTaraKg,
      hasTare,
      payload.origem,
      hasOrigin,
      hasClassification,
      userId,
      payload.umidadePercent,
      payload.impurezaPercent,
      payload.graosAvariadosPercent,
    ]
  );

  return result.rows[0] || null;
}

async function deleteScaleInput(inputId) {
  ensureDatabaseConfigured();

  await pool.query('DELETE FROM entradas_balanca WHERE id = $1', [inputId]);
}

async function addScaleInputTare(inputId, pesoTaraKg, userId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      UPDATE entradas_balanca
      SET peso_tara_kg = $2,
          tara_adicionada_por_user_id = $3,
          tara_adicionada_em = now(),
          atualizado_em = now()
      WHERE id = $1
        AND peso_tara_kg IS NULL
        AND peso_bruto_kg > $2
      RETURNING id
    `,
    [inputId, pesoTaraKg, userId]
  );

  return result.rows[0] || null;
}

async function addScaleOutputGross(outputId, pesoBrutoKg) {
  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE saidas_balanca
        SET peso_bruto_kg = $2,
            atualizado_em = now()
        WHERE id = $1
          AND peso_bruto_kg IS NULL
          AND $2 > peso_tara_kg
        RETURNING id, contrato_id
      `,
      [outputId, pesoBrutoKg]
    );
    const updatedOutput = result.rows[0] || null;

    if (updatedOutput) {
      await refreshContractShippedStatus(client, updatedOutput.contrato_id);
    }

    await client.query('COMMIT');
    return updatedOutput;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function addScaleInputClassification(inputId, payload, userId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      UPDATE entradas_balanca
      SET umidade_percent = $2,
          impureza_percent = $3,
          graos_avariados_percent = $4,
          classificado_por_user_id = $5,
          classificado_em = now(),
          atualizado_em = now()
      WHERE id = $1
      RETURNING id
    `,
    [inputId, payload.umidadePercent, payload.impurezaPercent, payload.graosAvariadosPercent, userId]
  );

  return result.rows[0] || null;
}

async function defineScaleInputOrigin(inputId, origem, userId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      UPDATE entradas_balanca
      SET origem = $2,
          origem_definida_por_user_id = $3,
          origem_definida_em = now(),
          atualizado_em = now()
      WHERE id = $1
        AND origem IS NULL
      RETURNING id
    `,
    [inputId, origem, userId]
  );

  return result.rows[0] || null;
}

async function listScaleOutputs(options = {}) {
  ensureDatabaseConfigured();

  const limitClause = options.limit ? 'LIMIT $1' : '';
  const values = options.limit ? [options.limit] : [];
  const orderDirection = options.order === 'asc' ? 'ASC' : 'DESC';
  const result = await pool.query(
    `
      SELECT s.id,
             s.data_saida,
             s.placa_caminhao,
             s.produto,
             s.peso_tara_kg,
             s.peso_bruto_kg,
             s.peso_liquido_kg,
             s.contrato_id,
             comp.nome AS comprador_nome,
             c.data_contrato
      FROM saidas_balanca s
      LEFT JOIN contratos c ON c.id = s.contrato_id
      LEFT JOIN compradores comp ON comp.id = c.comprador_id
      ORDER BY s.data_saida ${orderDirection}, s.id ${orderDirection}
      ${limitClause}
    `,
    values
  );

  return result.rows;
}

async function getScaleOutputById(id) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id,
             data_saida,
             placa_caminhao,
             produto,
             peso_tara_kg,
             peso_bruto_kg,
             peso_liquido_kg,
             contrato_id
      FROM saidas_balanca
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function listEligibleBuyersForOutput(outputId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      WITH saida AS (
        SELECT produto
        FROM saidas_balanca
        WHERE id = $1 AND contrato_id IS NULL
      ), saldos AS (
        SELECT c.id,
               c.comprador_id,
               c.quantidade_kg - COALESCE(SUM(s.peso_liquido_kg), 0) AS saldo_kg
        FROM contratos c
        JOIN saida sd ON sd.produto = c.produto
        LEFT JOIN saidas_balanca s ON s.contrato_id = c.id
        WHERE c.contrato_embarcado IS NOT TRUE
        GROUP BY c.id, c.comprador_id, c.quantidade_kg
      )
      SELECT DISTINCT comp.id, comp.nome
      FROM compradores comp
      JOIN saldos ON saldos.comprador_id = comp.id
      WHERE saldos.saldo_kg > 0
      ORDER BY comp.nome ASC
    `,
    [outputId]
  );

  return result.rows;
}

async function listEligibleContractsForOutput(outputId, buyerId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      WITH saida AS (
        SELECT produto
        FROM saidas_balanca
        WHERE id = $1 AND contrato_id IS NULL
      )
      SELECT c.id,
             c.data_contrato,
             c.produto,
             c.preco_por_saca,
             c.quantidade_kg,
             COALESCE(SUM(s.peso_liquido_kg), 0) AS quantidade_embarcada_kg,
             c.quantidade_kg - COALESCE(SUM(s.peso_liquido_kg), 0) AS saldo_kg
      FROM contratos c
      JOIN saida sd ON sd.produto = c.produto
      LEFT JOIN saidas_balanca s ON s.contrato_id = c.id
      WHERE c.comprador_id = $2
        AND c.contrato_embarcado IS NOT TRUE
      GROUP BY c.id, c.data_contrato, c.produto, c.preco_por_saca, c.quantidade_kg
      HAVING c.quantidade_kg - COALESCE(SUM(s.peso_liquido_kg), 0) > 0
      ORDER BY c.data_contrato ASC, c.id ASC
    `,
    [outputId, buyerId]
  );

  return result.rows;
}

async function associateScaleOutputToContract(outputId, buyerId, contractId, userId) {
  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const outputResult = await client.query(
      `
        SELECT id, produto, peso_liquido_kg, contrato_id
        FROM saidas_balanca
        WHERE id = $1
        FOR UPDATE
      `,
      [outputId]
    );
    const output = outputResult.rows[0];

    if (!output) {
      throw new Error('Saída não encontrada.');
    }

    if (output.contrato_id) {
      throw new Error('Essa saída já está associada a um contrato.');
    }

    const contractResult = await client.query(
      `
        SELECT id,
               produto,
               comprador_id,
               quantidade_kg,
               contrato_embarcado
        FROM contratos
        WHERE id = $1
        FOR UPDATE
      `,
      [contractId]
    );
    const contract = contractResult.rows[0];

    if (!contract) {
      throw new Error('Contrato não encontrado.');
    }

    if (String(contract.comprador_id) !== String(buyerId)) {
      throw new Error('O contrato selecionado não pertence ao comprador informado.');
    }

    if (contract.produto !== output.produto) {
      throw new Error('O contrato selecionado não é do mesmo produto da saída.');
    }

    const shippedResult = await client.query(
      `
        SELECT COALESCE(SUM(peso_liquido_kg), 0) AS quantidade_embarcada_kg
        FROM saidas_balanca
        WHERE contrato_id = $1
      `,
      [contractId]
    );
    const shippedKg = Number(shippedResult.rows[0].quantidade_embarcada_kg);
    const contractKg = Number(contract.quantidade_kg);
    const outputKg = Number(output.peso_liquido_kg);

    if (contract.contrato_embarcado || shippedKg >= contractKg) {
      throw new Error('Esse contrato já terminou de embarcar.');
    }

    await client.query(
      `
        UPDATE saidas_balanca
        SET contrato_id = $1,
            associado_por_user_id = $2,
            associado_em = now(),
            atualizado_em = now()
        WHERE id = $3
      `,
      [contractId, userId, outputId]
    );

    if (shippedKg + outputKg >= contractKg) {
      await client.query(
        `
          UPDATE contratos
          SET contrato_embarcado = TRUE,
              atualizado_em = now()
          WHERE id = $1
        `,
        [contractId]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}


async function unlinkScaleOutputFromContract(outputId) {
  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const outputResult = await client.query(
      `
        SELECT id, contrato_id
        FROM saidas_balanca
        WHERE id = $1
        FOR UPDATE
      `,
      [outputId]
    );
    const output = outputResult.rows[0];

    if (!output) {
      throw new Error('Saída não encontrada.');
    }

    if (!output.contrato_id) {
      throw new Error('Essa saída não está associada a um contrato.');
    }

    await client.query(
      `
        UPDATE saidas_balanca
        SET contrato_id = NULL,
            associado_por_user_id = NULL,
            associado_em = NULL,
            atualizado_em = now()
        WHERE id = $1
      `,
      [outputId]
    );

    await refreshContractShippedStatus(client, output.contrato_id);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}


async function refreshContractShippedStatus(client, contractId) {
  if (!contractId) {
    return;
  }

  await client.query(
    `
      UPDATE contratos c
      SET contrato_embarcado = shipped.quantidade_embarcada_kg >= c.quantidade_kg,
          atualizado_em = now()
      FROM (
        SELECT COALESCE(SUM(peso_liquido_kg), 0) AS quantidade_embarcada_kg
        FROM saidas_balanca
        WHERE contrato_id = $1
      ) shipped
      WHERE c.id = $1
    `,
    [contractId]
  );
}

async function deleteScaleOutput(outputId) {
  ensureDatabaseConfigured();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const outputResult = await client.query(
      `
        SELECT id, contrato_id
        FROM saidas_balanca
        WHERE id = $1
        FOR UPDATE
      `,
      [outputId]
    );
    const output = outputResult.rows[0];

    if (!output) {
      throw new Error('Saída não encontrada.');
    }

    await client.query('DELETE FROM saidas_balanca WHERE id = $1', [outputId]);
    await refreshContractShippedStatus(client, output.contrato_id);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function splitScaleOutput(outputId, firstNetWeightKg, userId) {
  ensureDatabaseConfigured();

  const normalizedFirstNetWeightKg = normalizeDecimal(firstNetWeightKg);

  if (!normalizedFirstNetWeightKg) {
    throw new Error('Informe um peso líquido válido para a primeira saída.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const outputResult = await client.query(
      `
        SELECT id,
               data_saida,
               placa_caminhao,
               produto,
               peso_tara_kg,
               peso_bruto_kg,
               peso_liquido_kg,
               contrato_id
        FROM saidas_balanca
        WHERE id = $1
        FOR UPDATE
      `,
      [outputId]
    );
    const output = outputResult.rows[0];

    if (!output) {
      throw new Error('Saída não encontrada.');
    }

    if (output.peso_liquido_kg === null || output.peso_liquido_kg === undefined) {
      throw new Error('Adicione a tara da saída antes de dividir.');
    }

    const firstNetWeight = Number(normalizedFirstNetWeightKg);
    const originalTareWeight = Number(output.peso_tara_kg);
    const originalGrossWeight = Number(output.peso_bruto_kg);
    const originalNetWeight = Number(output.peso_liquido_kg);

    if (firstNetWeight >= originalNetWeight) {
      throw new Error('O peso líquido da primeira saída precisa ser menor que o peso líquido original.');
    }

    const firstGrossWeight = originalTareWeight + firstNetWeight;

    await client.query(
      `
        UPDATE saidas_balanca
        SET peso_bruto_kg = $1,
            atualizado_em = now()
        WHERE id = $2
      `,
      [firstGrossWeight, outputId]
    );

    const newOutputResult = await client.query(
      `
        INSERT INTO saidas_balanca (
          data_saida,
          placa_caminhao,
          produto,
          peso_tara_kg,
          peso_bruto_kg,
          criado_por_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [
        output.data_saida,
        output.placa_caminhao,
        output.produto,
        firstGrossWeight,
        originalGrossWeight,
        userId,
      ]
    );

    await refreshContractShippedStatus(client, output.contrato_id);

    await client.query('COMMIT');
    return newOutputResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listOpenContractsForWeighbridge() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT c.id,
             c.data_contrato,
             c.produto,
             c.quantidade_kg,
             comp.nome AS comprador_nome,
             COALESCE(SUM(s.peso_liquido_kg), 0) AS quantidade_embarcada_kg,
             c.quantidade_kg - COALESCE(SUM(s.peso_liquido_kg), 0) AS saldo_kg
      FROM contratos c
      JOIN compradores comp ON comp.id = c.comprador_id
      LEFT JOIN saidas_balanca s ON s.contrato_id = c.id
      WHERE c.contrato_embarcado IS NOT TRUE
      GROUP BY c.id, c.data_contrato, c.produto, c.quantidade_kg, comp.nome
      HAVING c.quantidade_kg - COALESCE(SUM(s.peso_liquido_kg), 0) > 0
      ORDER BY c.data_contrato ASC, c.id ASC
    `
  );

  return result.rows;
}

async function getOpenContractDetailForWeighbridge(contractId) {
  ensureDatabaseConfigured();

  const contractResult = await pool.query(
    `
      SELECT c.id AS contrato_id,
             c.data_contrato,
             c.produto,
             c.preco_por_saca,
             round(c.preco_por_saca / 60, 10) AS preco_por_kg,
             round(c.preco_por_saca / 60 * 1000, 10) AS preco_por_ton,
             c.quantidade_kg,
             COALESCE(shipped.quantidade_embarcada_kg, 0) AS quantidade_embarcada_kg,
             c.quantidade_kg - COALESCE(shipped.quantidade_embarcada_kg, 0) AS saldo_kg,
             c.observacoes,
             vend.nome_completo AS vendedor_nome_completo,
             comp.nome AS comprador_nome,
             comp.nome_completo AS comprador_nome_completo,
             comp.cpf_cnpj AS comprador_cpf_cnpj,
             comp.inscricao_estadual AS comprador_inscricao_estadual,
             comp.endereco AS comprador_endereco,
             comp.numero AS comprador_numero,
             comp.cep AS comprador_cep
      FROM contratos c
      JOIN vendedores vend ON vend.id = c.vendedor_id
      JOIN compradores comp ON comp.id = c.comprador_id
      LEFT JOIN (
        SELECT contrato_id, COALESCE(SUM(peso_liquido_kg), 0) AS quantidade_embarcada_kg
        FROM saidas_balanca
        WHERE contrato_id = $1
        GROUP BY contrato_id
      ) shipped ON shipped.contrato_id = c.id
      WHERE c.id = $1
        AND c.contrato_embarcado IS NOT TRUE
        AND c.quantidade_kg - COALESCE(shipped.quantidade_embarcada_kg, 0) > 0
      LIMIT 1
    `,
    [contractId]
  );
  const contract = contractResult.rows[0] || null;

  if (!contract) {
    return null;
  }

  const outputsResult = await pool.query(
    `
      SELECT id,
             data_saida,
             placa_caminhao,
             produto,
             peso_tara_kg,
             peso_bruto_kg,
             peso_liquido_kg
      FROM saidas_balanca
      WHERE contrato_id = $1
      ORDER BY data_saida DESC, id DESC
    `,
    [contractId]
  );

  return {
    contract,
    outputs: outputsResult.rows,
  };
}

async function getScaleOutputDetailInfo(outputId) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT s.id AS saida_id,
             s.data_saida,
             s.placa_caminhao,
             s.produto,
             s.peso_tara_kg,
             s.peso_bruto_kg,
             s.peso_liquido_kg,
             c.id AS contrato_id,
             c.data_contrato,
             c.preco_por_saca,
             round(c.preco_por_saca / 60, 10) AS preco_por_kg,
             round(c.preco_por_saca / 60 * 1000, 10) AS preco_por_ton,
             c.quantidade_kg,
             c.quantidade_kg - COALESCE(SUM(s2.peso_liquido_kg) FILTER (WHERE s2.id IS NOT NULL), 0) AS contrato_saldo_kg,
             c.observacoes,
             c.email,
             c.inscricao_estadual_vendedor,
             c.natureza_operacao,
             c.cfop,
             c.informacoes_interesse_contribuinte,
             c.razao_social_transportadora,
             c.cnpj_transportadora,
             c.inscricao_estadual_transportadora,
             c.uf_transportadora,
             vend.nome_completo AS vendedor_nome_completo,
             comp.nome_completo AS comprador_nome_completo,
             comp.cpf_cnpj AS comprador_cpf_cnpj,
             comp.inscricao_estadual AS comprador_inscricao_estadual,
             comp.endereco AS comprador_endereco,
             comp.numero AS comprador_numero,
             comp.cep AS comprador_cep
      FROM saidas_balanca s
      LEFT JOIN contratos c ON c.id = s.contrato_id
      LEFT JOIN vendedores vend ON vend.id = c.vendedor_id
      LEFT JOIN compradores comp ON comp.id = c.comprador_id
      LEFT JOIN saidas_balanca s2 ON s2.contrato_id = c.id
      WHERE s.id = $1
      GROUP BY s.id,
               s.data_saida,
               s.placa_caminhao,
               s.produto,
               s.peso_tara_kg,
               s.peso_bruto_kg,
               s.peso_liquido_kg,
               c.id,
               vend.nome_completo,
               comp.nome_completo,
               comp.cpf_cnpj,
               comp.inscricao_estadual,
               comp.endereco,
               comp.numero,
               comp.cep
      LIMIT 1
    `,
    [outputId]
  );

  return result.rows[0] || null;
}

module.exports = {
  addScaleInputClassification,
  addScaleInputTare,
  addScaleOutputGross,
  associateScaleOutputToContract,
  buildScaleInputClassificationPayload,
  buildScaleInputEditPayload,
  buildScaleInputOriginPayload,
  buildScaleInputPayload,
  buildScaleInputTarePayload,
  buildScaleOutputPayload,
  buildScaleOutputGrossPayload,
  createScaleInput,
  createScaleOutput,
  defineScaleInputOrigin,
  deleteScaleInput,
  deleteScaleOutput,
  getOpenContractDetailForWeighbridge,
  getPreviousTareForPlate,
  getScaleInputById,
  getScaleOutputById,
  getScaleOutputDetailInfo,
  listEligibleBuyersForOutput,
  listEligibleContractsForOutput,
  listOpenContractsForWeighbridge,
  listRecentInputPlates,
  listScaleInputs,
  listScaleOutputs,
  splitScaleOutput,
  unlinkScaleOutputFromContract,
  updateScaleInput,
};
