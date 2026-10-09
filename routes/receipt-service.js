const { ensureDatabaseConfigured, pool } = require('./database');
const { contractNetValueSql, grossValueSql, senarDiscountSql } = require('./contract-finance');

function parseMoneyCents(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n && cents <= 99999999999999n ? cents : null;
}

function numericCents(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function buildReceiptPayload(body) {
  const cents = parseMoneyCents(body.valor);
  const date = String(body.data_recebimento || '').trim();
  if (!cents) return { error: 'Informe um valor positivo com até duas casas decimais.' };
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return { error: 'Informe uma data de recebimento válida.' };
  }
  const observation = String(body.observacao || '').trim();
  if (observation.length > 500) return { error: 'A observação deve ter no máximo 500 caracteres.' };
  return { payload: { value: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`, date, observation: observation || null } };
}

async function getContractReceipts(contractId) {
  ensureDatabaseConfigured();
  const contractResult = await pool.query(`
    SELECT c.id, c.data_contrato, c.data_recebimento, c.quantidade_kg, c.preco_por_saca, c.desconta_senar,
           comp.nome AS comprador_nome, c.produto,
           ${grossValueSql('c.quantidade_kg', 'c.preco_por_saca')} AS valor_bruto,
           ${senarDiscountSql('c.quantidade_kg', 'c.preco_por_saca', 'c.desconta_senar')} AS desconto_senar,
           ${contractNetValueSql('c')} AS valor_contrato,
           COALESCE(r.total, 0) AS valor_recebido,
           GREATEST(${contractNetValueSql('c')} - COALESCE(r.total, 0), 0) AS saldo_receber
    FROM contratos c
    JOIN compradores comp ON comp.id = c.comprador_id
    LEFT JOIN (
      SELECT contrato_id, SUM(valor) AS total FROM contrato_recebimentos GROUP BY contrato_id
    ) r ON r.contrato_id = c.id
    WHERE c.id = $1`, [contractId]);
  if (!contractResult.rows[0]) return null;
  const receipts = await pool.query(`
    SELECT r.id, r.data_recebimento, r.valor, r.observacao, r.criado_em,
           COALESCE(u.login, 'Registro anterior') AS usuario_login
    FROM contrato_recebimentos r
    LEFT JOIN users u ON u.id = r.usuario_id
    WHERE r.contrato_id = $1
    ORDER BY r.data_recebimento DESC, r.id DESC`, [contractId]);
  return { contract: contractResult.rows[0], receipts: receipts.rows };
}

async function createContractReceipt(contractId, payload, userId) {
  ensureDatabaseConfigured();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contractResult = await client.query(`
      SELECT c.id, ${contractNetValueSql('c')} AS valor_contrato
      FROM contratos c WHERE c.id = $1 FOR UPDATE`, [contractId]);
    if (!contractResult.rows[0]) throw new Error('Contrato não encontrado.');
    const receivedResult = await client.query(`
      SELECT COALESCE(SUM(valor), 0) AS total FROM contrato_recebimentos WHERE contrato_id = $1`, [contractId]);
    const remaining = numericCents(contractResult.rows[0].valor_contrato) - numericCents(receivedResult.rows[0].total);
    if (numericCents(payload.value) > remaining) throw new Error('O valor informado excede o saldo a receber.');
    await client.query(`
      INSERT INTO contrato_recebimentos (contrato_id, data_recebimento, valor, observacao, usuario_id)
      VALUES ($1, $2::date, $3, $4, $5)`, [contractId, payload.date, payload.value, payload.observation, userId]);
    await client.query(`
      UPDATE contratos SET contrato_recebido = $2, atualizado_em = now() WHERE id = $1`,
    [contractId, numericCents(payload.value) === remaining]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { buildReceiptPayload, createContractReceipt, getContractReceipts, numericCents };
