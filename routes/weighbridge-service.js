const { ensureDatabaseConfigured, pool } = require('./database');
const { parseOptionalDateTime } = require('./utils');

const PRODUCT_VALUES = ['milho', 'soja'];

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
  const pesoBrutoKg = normalizeDecimal(body.peso_bruto_kg);

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

  if (!pesoBrutoKg) {
    return { error: 'Informe um peso bruto válido.' };
  }

  if (Number(pesoBrutoKg) <= Number(pesoTaraKg)) {
    return { error: 'O peso bruto precisa ser maior que o peso tara.' };
  }

  return {
    payload: {
      dataSaida,
      placaCaminhao,
      produto,
      pesoTaraKg,
      pesoBrutoKg,
    },
  };
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
        peso_bruto_kg,
        criado_por_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [payload.dataSaida, payload.placaCaminhao, payload.produto, payload.pesoTaraKg, payload.pesoBrutoKg, userId]
  );

  return result.rows[0];
}

async function listScaleOutputs(options = {}) {
  ensureDatabaseConfigured();

  const limitClause = options.limit ? 'LIMIT $1' : '';
  const values = options.limit ? [options.limit] : [];
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
      ORDER BY s.data_saida DESC, s.id DESC
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

async function getScaleOutputInvoiceInfo(outputId) {
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
             c.preco_por_saca,
             trunc(c.preco_por_saca / 60, 8) AS preco_por_kg,
             c.observacoes,
             vend.nome_completo AS vendedor_nome_completo,
             comp.nome_completo AS comprador_nome_completo,
             comp.cpf_cnpj AS comprador_cpf_cnpj,
             comp.inscricao_estadual AS comprador_inscricao_estadual,
             comp.endereco AS comprador_endereco,
             comp.numero AS comprador_numero,
             comp.cep AS comprador_cep
      FROM saidas_balanca s
      JOIN contratos c ON c.id = s.contrato_id
      JOIN vendedores vend ON vend.id = c.vendedor_id
      JOIN compradores comp ON comp.id = c.comprador_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [outputId]
  );

  return result.rows[0] || null;
}

module.exports = {
  associateScaleOutputToContract,
  buildScaleOutputPayload,
  createScaleOutput,
  getScaleOutputById,
  getScaleOutputInvoiceInfo,
  listEligibleBuyersForOutput,
  listEligibleContractsForOutput,
  listScaleOutputs,
};
