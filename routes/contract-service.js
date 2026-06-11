const { ensureDatabaseConfigured, pool } = require('./database');

const PRODUCT_VALUES = ['milho', 'soja'];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDigits(value) {
  return normalizeText(value).replace(/\D/g, '');
}

function normalizeDecimal(value) {
  const normalizedValue = normalizeText(value).replace(',', '.');

  if (!/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return normalizedValue;
}

function normalizeBoolean(value) {
  return value === 'on' || value === 'true' || value === true;
}

function normalizeDate(value) {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function buildBuyerPayload(body) {
  const payload = {
    nome: normalizeText(body.nome),
    nomeCompleto: normalizeText(body.nome_completo),
    endereco: normalizeText(body.endereco),
    numero: normalizeText(body.numero),
    cep: normalizeDigits(body.cep),
    inscricaoEstadual: normalizeDigits(body.inscricao_estadual),
    cpfCnpj: normalizeDigits(body.cpf_cnpj),
  };

  if (!payload.nome || !payload.nomeCompleto || !payload.endereco || !payload.numero) {
    return { error: 'Preencha nome, nome completo, endereço e número do comprador.' };
  }

  if (!/^\d{8}$/.test(payload.cep)) {
    return { error: 'Informe um CEP do comprador com 8 dígitos.' };
  }

  if (!/^\d{10,}$/.test(payload.inscricaoEstadual)) {
    return { error: 'Informe uma inscrição estadual com 10 dígitos ou mais.' };
  }

  if (!/^(\d{11}|\d{14})$/.test(payload.cpfCnpj)) {
    return { error: 'Informe CPF com 11 dígitos ou CNPJ com 14 dígitos.' };
  }

  return { payload };
}

function buildSellerPayload(body) {
  const payload = {
    nome: normalizeText(body.nome),
    nomeCompleto: normalizeText(body.nome_completo),
  };

  if (!payload.nome || !payload.nomeCompleto) {
    return { error: 'Preencha nome e nome completo do vendedor.' };
  }

  return { payload };
}

function buildContractPayload(body) {
  const dataContrato = normalizeDate(body.data_contrato);
  const dataRecebimento = normalizeDate(body.data_recebimento);
  const precoPorSaca = normalizeDecimal(body.preco_por_saca);
  const quantidadeKg = normalizeDecimal(body.quantidade_kg);
  const valorCorretagemPercentual = normalizeText(body.valor_corretagem_percentual)
    ? normalizeDecimal(body.valor_corretagem_percentual)
    : null;
  const produto = normalizeText(body.produto);
  const compradorId = normalizeText(body.comprador_id);
  const vendedorId = normalizeText(body.vendedor_id);

  if (!dataContrato) {
    return { error: 'Informe uma data do contrato válida.' };
  }

  if (!PRODUCT_VALUES.includes(produto)) {
    return { error: 'Selecione milho ou soja como produto do contrato.' };
  }

  if (!precoPorSaca) {
    return { error: 'Informe um preço por saca válido.' };
  }

  if (!compradorId || !/^\d+$/.test(compradorId)) {
    return { error: 'Selecione um comprador válido para o contrato.' };
  }

  if (!vendedorId || !/^\d+$/.test(vendedorId)) {
    return { error: 'Selecione um vendedor válido para o contrato.' };
  }

  if (!quantidadeKg) {
    return { error: 'Informe uma quantidade em kg válida.' };
  }

  if (normalizeText(body.data_recebimento) && !dataRecebimento) {
    return { error: 'Informe uma data de recebimento válida.' };
  }

  if (normalizeText(body.valor_corretagem_percentual) && !valorCorretagemPercentual) {
    return { error: 'Informe um valor de corretagem válido.' };
  }

  return {
    payload: {
      dataContrato,
      produto,
      precoPorSaca,
      compradorId,
      vendedorId,
      quantidadeKg,
      contratoEmbarcado: normalizeBoolean(body.contrato_embarcado),
      dataRecebimento,
      contratoRecebido: normalizeBoolean(body.contrato_recebido),
      corretor: normalizeText(body.corretor) || null,
      valorCorretagemPercentual,
      corretagemPaga: normalizeBoolean(body.corretagem_paga),
      observacoes: normalizeText(body.observacoes) || null,
    },
  };
}

async function listBuyers() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, nome, nome_completo, endereco, numero, cep, inscricao_estadual, cpf_cnpj, criado_em, atualizado_em
      FROM compradores
      ORDER BY nome ASC
    `
  );

  return result.rows;
}

async function getBuyerById(id) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, nome, nome_completo, endereco, numero, cep, inscricao_estadual, cpf_cnpj
      FROM compradores
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function createBuyer(payload) {
  ensureDatabaseConfigured();

  await pool.query(
    `
      INSERT INTO compradores (nome, nome_completo, endereco, numero, cep, inscricao_estadual, cpf_cnpj)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [payload.nome, payload.nomeCompleto, payload.endereco, payload.numero, payload.cep, payload.inscricaoEstadual, payload.cpfCnpj]
  );
}

async function updateBuyer(id, payload) {
  ensureDatabaseConfigured();

  await pool.query(
    `
      UPDATE compradores
      SET nome = $1,
          nome_completo = $2,
          endereco = $3,
          numero = $4,
          cep = $5,
          inscricao_estadual = $6,
          cpf_cnpj = $7,
          atualizado_em = now()
      WHERE id = $8
    `,
    [payload.nome, payload.nomeCompleto, payload.endereco, payload.numero, payload.cep, payload.inscricaoEstadual, payload.cpfCnpj, id]
  );
}

async function listSellers() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, nome, nome_completo, criado_em, atualizado_em
      FROM vendedores
      ORDER BY nome ASC
    `
  );

  return result.rows;
}

async function getSellerById(id) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id, nome, nome_completo
      FROM vendedores
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function createSeller(payload) {
  ensureDatabaseConfigured();

  await pool.query(
    `
      INSERT INTO vendedores (nome, nome_completo)
      VALUES ($1, $2)
    `,
    [payload.nome, payload.nomeCompleto]
  );
}

async function updateSeller(id, payload) {
  ensureDatabaseConfigured();

  await pool.query(
    `
      UPDATE vendedores
      SET nome = $1,
          nome_completo = $2,
          atualizado_em = now()
      WHERE id = $3
    `,
    [payload.nome, payload.nomeCompleto, id]
  );
}

async function listContracts(options = {}) {
  ensureDatabaseConfigured();

  const listOnlyOpen = options.status !== 'todos';
  const openContractsWhereClause = listOnlyOpen
    ? 'WHERE (c.contrato_embarcado IS NOT TRUE OR c.contrato_recebido IS NOT TRUE OR c.corretagem_paga IS NOT TRUE)'
    : '';

  const result = await pool.query(
    `
      SELECT c.id,
             c.data_contrato,
             c.produto,
             c.preco_por_saca,
             c.comprador_id,
             c.vendedor_id,
             c.quantidade_kg,
             c.contrato_embarcado,
             c.data_recebimento,
             c.contrato_recebido,
             c.corretor,
             c.valor_corretagem_percentual,
             c.corretagem_paga,
             c.observacoes,
             comp.nome AS comprador_nome,
             vend.nome AS vendedor_nome
      FROM contratos c
      JOIN compradores comp ON comp.id = c.comprador_id
      JOIN vendedores vend ON vend.id = c.vendedor_id
      ${openContractsWhereClause}
      ORDER BY c.data_contrato DESC, c.id DESC
    `
  );

  return result.rows;
}


function buildContractNotification(type, contract) {
  const actionPathByType = {
    shipment_due: `/admin/contratos/${contract.id}/marcar-embarcado`,
    receipt_due: `/admin/contratos/${contract.id}/marcar-recebido`,
    brokerage_due: `/admin/contratos/${contract.id}/marcar-corretagem-paga`,
  };

  return {
    type,
    contractId: contract.id,
    buyerName: contract.comprador_nome,
    balanceKg: contract.saldo_kg,
    contractValue: contract.valor_contrato,
    brokerageValue: contract.valor_corretagem,
    receiptDate: contract.data_recebimento,
    daysOverdue: Number(contract.dias_desde_vencimento || 0),
    actionPath: actionPathByType[type],
  };
}

async function listAdminContractNotifications() {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      WITH hoje AS (
        SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS data_atual
      ), saldos AS (
        SELECT c.id,
               c.data_recebimento,
               c.quantidade_kg,
               c.contrato_embarcado,
               c.contrato_recebido,
               c.corretagem_paga,
               comp.nome AS comprador_nome,
               c.quantidade_kg * c.preco_por_saca / 60 AS valor_contrato,
               CASE
                 WHEN c.valor_corretagem_percentual IS NULL THEN NULL
                 ELSE c.quantidade_kg * c.preco_por_saca / 60 * c.valor_corretagem_percentual / 100
               END AS valor_corretagem,
               c.quantidade_kg - COALESCE(SUM(s.peso_liquido_kg), 0) AS saldo_kg,
               CASE
                 WHEN c.data_recebimento IS NULL THEN NULL
                 ELSE hoje.data_atual - c.data_recebimento
               END AS dias_desde_vencimento
        FROM contratos c
        JOIN compradores comp ON comp.id = c.comprador_id
        CROSS JOIN hoje
        LEFT JOIN saidas_balanca s ON s.contrato_id = c.id
        GROUP BY c.id, c.data_recebimento, c.quantidade_kg, c.preco_por_saca, c.valor_corretagem_percentual, c.contrato_embarcado, c.contrato_recebido, c.corretagem_paga, comp.nome, hoje.data_atual
      )
      SELECT id,
             data_recebimento,
             comprador_nome,
             saldo_kg,
             valor_contrato,
             valor_corretagem,
             dias_desde_vencimento,
             contrato_embarcado,
             contrato_recebido,
             corretagem_paga
      FROM saldos
      WHERE (contrato_embarcado IS NOT TRUE AND saldo_kg <= 0)
         OR (contrato_recebido IS NOT TRUE AND data_recebimento IS NOT NULL AND dias_desde_vencimento >= 0)
         OR (corretagem_paga IS NOT TRUE AND data_recebimento IS NOT NULL AND dias_desde_vencimento >= 7)
      ORDER BY data_recebimento ASC NULLS LAST, id ASC
    `
  );

  const notifications = [];

  result.rows.forEach((contract) => {
    const daysSinceDueDate = Number(contract.dias_desde_vencimento || 0);

    if (!contract.contrato_embarcado && Number(contract.saldo_kg) <= 0) {
      notifications.push(buildContractNotification('shipment_due', contract));
    }

    if (!contract.contrato_recebido && contract.data_recebimento && daysSinceDueDate >= 0) {
      notifications.push(buildContractNotification('receipt_due', contract));
    }

    if (!contract.corretagem_paga && contract.data_recebimento && daysSinceDueDate >= 7) {
      notifications.push(buildContractNotification('brokerage_due', contract));
    }
  });

  const priorityByType = {
    shipment_due: 1,
    receipt_due: 2,
    brokerage_due: 3,
  };

  return notifications.sort((left, right) => {
    const priorityDiff = priorityByType[left.type] - priorityByType[right.type];

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return right.daysOverdue - left.daysOverdue;
  });
}

async function getContractById(id) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      SELECT id,
             data_contrato,
             produto,
             preco_por_saca,
             comprador_id,
             vendedor_id,
             quantidade_kg,
             contrato_embarcado,
             data_recebimento,
             contrato_recebido,
             corretor,
             valor_corretagem_percentual,
             corretagem_paga,
             observacoes
      FROM contratos
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function createContract(payload) {
  ensureDatabaseConfigured();

  await pool.query(
    `
      INSERT INTO contratos (
        data_contrato,
        produto,
        preco_por_saca,
        comprador_id,
        vendedor_id,
        quantidade_kg,
        contrato_embarcado,
        data_recebimento,
        contrato_recebido,
        corretor,
        valor_corretagem_percentual,
        corretagem_paga,
        observacoes
      )
      VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13)
    `,
    [
      payload.dataContrato,
      payload.produto,
      payload.precoPorSaca,
      payload.compradorId,
      payload.vendedorId,
      payload.quantidadeKg,
      payload.contratoEmbarcado,
      payload.dataRecebimento,
      payload.contratoRecebido,
      payload.corretor,
      payload.valorCorretagemPercentual,
      payload.corretagemPaga,
      payload.observacoes,
    ]
  );
}


async function markContractAsShipped(id) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      UPDATE contratos c
      SET contrato_embarcado = TRUE,
          quantidade_kg = embarque.quantidade_embarcada_kg,
          atualizado_em = now()
      FROM (
        SELECT c2.id,
               COALESCE(SUM(s.peso_liquido_kg), 0) AS quantidade_embarcada_kg,
               c2.quantidade_kg - COALESCE(SUM(s.peso_liquido_kg), 0) AS saldo_kg
        FROM contratos c2
        LEFT JOIN saidas_balanca s ON s.contrato_id = c2.id
        WHERE c2.id = $1
        GROUP BY c2.id, c2.quantidade_kg
      ) embarque
      WHERE c.id = embarque.id
        AND c.contrato_embarcado IS NOT TRUE
        AND embarque.saldo_kg <= 0
    `,
    [id]
  );

  return result.rowCount;
}

async function markContractAsReceived(id) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      UPDATE contratos
      SET contrato_recebido = TRUE,
          atualizado_em = now()
      WHERE id = $1
        AND contrato_recebido IS NOT TRUE
        AND data_recebimento IS NOT NULL
        AND data_recebimento <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
    `,
    [id]
  );

  return result.rowCount;
}

async function markContractBrokerageAsPaid(id) {
  ensureDatabaseConfigured();

  const result = await pool.query(
    `
      UPDATE contratos
      SET corretagem_paga = TRUE,
          atualizado_em = now()
      WHERE id = $1
        AND corretagem_paga IS NOT TRUE
        AND data_recebimento IS NOT NULL
        AND (now() AT TIME ZONE 'America/Sao_Paulo')::date - data_recebimento >= 7
    `,
    [id]
  );

  return result.rowCount;
}

async function updateContract(id, payload) {
  ensureDatabaseConfigured();

  await pool.query(
    `
      UPDATE contratos
      SET data_contrato = $1::date,
          produto = $2,
          preco_por_saca = $3,
          comprador_id = $4,
          vendedor_id = $5,
          quantidade_kg = $6,
          contrato_embarcado = $7,
          data_recebimento = $8::date,
          contrato_recebido = $9,
          corretor = $10,
          valor_corretagem_percentual = $11,
          corretagem_paga = $12,
          observacoes = $13,
          atualizado_em = now()
      WHERE id = $14
    `,
    [
      payload.dataContrato,
      payload.produto,
      payload.precoPorSaca,
      payload.compradorId,
      payload.vendedorId,
      payload.quantidadeKg,
      payload.contratoEmbarcado,
      payload.dataRecebimento,
      payload.contratoRecebido,
      payload.corretor,
      payload.valorCorretagemPercentual,
      payload.corretagemPaga,
      payload.observacoes,
      id,
    ]
  );
}

module.exports = {
  buildBuyerPayload,
  buildContractPayload,
  buildSellerPayload,
  createBuyer,
  createContract,
  createSeller,
  getBuyerById,
  getContractById,
  getSellerById,
  listAdminContractNotifications,
  listBuyers,
  listContracts,
  listSellers,
  markContractAsReceived,
  markContractAsShipped,
  markContractBrokerageAsPaid,
  updateBuyer,
  updateContract,
  updateSeller,
};
