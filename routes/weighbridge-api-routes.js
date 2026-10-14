const express = require('express');
const service = require('./weighbridge-service');
const auth = require('./weighbridge-api-auth');
const scale = require('./scale-reading-service');
const csv = require('./weighbridge-csv');
const pdf = require('./weighbridge-ticket-pdf');
const reports = require('./weighbridge-reports');
const { createIpRateLimiter } = require('./rate-limit');
const { ApiError, body, fields, id, payload, pagination, paged } = require('./weighbridge-api-validation');

const router = express.Router();
const wrap = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
const missing = (value) => {
  if (!value) throw new ApiError(404, 'NOT_FOUND', 'Registro não encontrado.');
  return value;
};
const conflict = (value) => {
  if (!value) throw new ApiError(409, 'STATE_CONFLICT', 'A operação não é válida no estado atual do registro. Consulte-o novamente.');
  return value;
};
const inputFields = ['data_entrada', 'placa_caminhao', 'produto', 'peso_bruto_kg'];
const inputEditFields = [...inputFields, 'peso_tara_kg', 'origem', 'umidade_percent', 'impureza_percent', 'graos_avariados_percent'];
const outputFields = ['data_saida', 'placa_caminhao', 'produto', 'peso_tara_kg'];
const classificationFields = ['umidade_percent', 'impureza_percent', 'graos_avariados_percent'];
const loginLimiter = createIpRateLimiter({ windowMs: 15 * 60 * 1000, max: 10,
  message: { code: 'RATE_LIMITED', error: 'Muitas tentativas de acesso. Aguarde antes de tentar novamente.' } });

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ code: 'UNSUPPORTED_MEDIA_TYPE', error: 'Use Content-Type: application/json.' });
  }
  next();
});
router.post('/sessao', loginLimiter, wrap(async (req, res) => {
  body(req, ['login', 'password'], ['login', 'password']);
  return auth.login(req, res);
}));
router.use(wrap(auth.requireOperatorToken));
router.get('/sessao', (req, res) => res.json({ user: req.apiUser }));
router.delete('/sessao', wrap(auth.logout));

router.param('id', (req, res, next, value) => {
  try { req.params.id = id(value); next(); } catch (error) { next(error); }
});

router.get('/', wrap(async (req, res) => {
  const [entradas, saidas] = await Promise.all([service.listScaleInputs({ limit: 10 }), service.listScaleOutputs({ limit: 10 })]);
  res.json({ entradas, saidas });
}));
router.get('/peso-atual', wrap(async (req, res) => res.json(missing(await scale.getCurrentScaleWeight(scale.SCALE_ONE_ID)))));

router.get('/entradas/placas', wrap(async (req, res) => {
  if (req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.length > 20)) throw new ApiError(400, 'INVALID_QUERY', 'q deve ser um texto de até 20 caracteres.');
  res.json({ items: await service.listRecentInputPlates(req.query.q || '') });
}));
router.get('/entradas/tara-anterior', wrap(async (req, res) => {
  if (typeof req.query.placa !== 'string' || !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(req.query.placa.toUpperCase())) throw new ApiError(400, 'INVALID_QUERY', 'Informe placa no padrão ABC1234 ou ABC1D23.');
  res.json(missing(await service.getPreviousTareForPlate(req.query.placa)));
}));

for (const [resource, list, builder] of [
  ['entradas', 'listScaleInputs', 'buildScaleInputsCsv'], ['saidas', 'listScaleOutputs', 'buildScaleOutputsCsv'],
]) {
  router.get(`/${resource}.csv`, wrap(async (req, res) => {
    const rows = await service[list]({ order: 'asc' });
    res.type('text/csv').attachment(`${resource}-balanca.csv`).send(csv[builder](rows));
  }));
  router.get(`/${resource}`, wrap(async (req, res) => {
    const page = pagination(req.query);
    res.json(paged(await service[list](page.options), page));
  }));
}

router.post('/entradas', wrap(async (req, res) => {
  const data = fields(req, [...inputFields, 'usar_tara_anterior'], inputFields.slice(1));
  const result = await service.createScaleInput(payload(service.buildScaleInputPayload, data), req.apiUser.userId);
  res.location(`/api/v1/balanca/entradas/${result.id}`).status(201).json(result);
}));
router.get('/entradas/:id', wrap(async (req, res) => res.json(missing(await service.getScaleInputById(req.params.id)))));
router.get('/entradas/:id/relatorio', wrap(async (req, res) => {
  const input = missing(await service.getScaleInputById(req.params.id));
  if (!reports.canCopyInputReport(input)) throw new ApiError(409, 'STATE_CONFLICT', 'Conclua tara, origem e classificação antes de copiar o relatório.');
  res.json({ texto: reports.buildInputClipboardReport(input) });
}));
router.put('/entradas/:id', wrap(async (req, res) => {
  const data = fields(req, inputEditFields, inputFields);
  // Explicit nulls clear optional fields; missing ones are rejected to prevent
  // accidental data loss when a client mistakenly treats this PUT as PATCH.
  for (const key of inputEditFields) if (!(key in data)) throw new ApiError(400, 'INVALID_BODY', `PUT exige o campo ${key}; use null para limpar.`);
  const update = payload(service.buildScaleInputEditPayload, data);
  missing(await service.getScaleInputById(req.params.id));
  res.json(conflict(await service.updateScaleInput(req.params.id, update, req.apiUser)));
}));
router.post('/entradas/:id/tara', wrap(async (req, res) => {
  const data = payload(service.buildScaleInputTarePayload, fields(req, ['peso_tara_kg'], ['peso_tara_kg']));
  missing(await service.getScaleInputById(req.params.id));
  res.json(conflict(await service.addScaleInputTare(req.params.id, data.pesoTaraKg, req.apiUser.userId)));
}));
router.post('/entradas/:id/classificacao', wrap(async (req, res) => {
  const data = payload(service.buildScaleInputClassificationPayload, fields(req, classificationFields, classificationFields));
  res.json(missing(await service.addScaleInputClassification(req.params.id, data, req.apiUser.userId)));
}));
router.post('/entradas/:id/origem', wrap(async (req, res) => {
  const data = payload(service.buildScaleInputOriginPayload, fields(req, ['origem'], ['origem']));
  missing(await service.getScaleInputById(req.params.id));
  res.json(conflict(await service.defineScaleInputOrigin(req.params.id, data.origem, req.apiUser.userId)));
}));
router.post('/entradas/:id/deletar', wrap(async (req, res) => {
  const data = payload(service.buildDeletionReasonPayload, fields(req, ['motivo_delecao'], ['motivo_delecao']));
  missing(await service.deleteScaleInput(req.params.id, req.apiUser, data.motivoDelecao));
  res.status(204).end();
}));

router.post('/saidas', wrap(async (req, res) => {
  const data = payload(service.buildScaleOutputPayload, fields(req, outputFields, outputFields.slice(1)));
  const result = await service.createScaleOutput(data, req.apiUser.userId);
  res.location(`/api/v1/balanca/saidas/${result.id}`).status(201).json(result);
}));
router.get('/saidas/:id', wrap(async (req, res) => res.json(missing(await service.getScaleOutputDetailInfo(req.params.id)))));
router.put('/saidas/:id', wrap(async (req, res) => {
  const data = fields(req, [...outputFields, 'peso_bruto_kg'], outputFields);
  if (!('peso_bruto_kg' in data)) throw new ApiError(400, 'INVALID_BODY', 'PUT exige peso_bruto_kg; use null se pendente.');
  const update = payload(service.buildScaleOutputEditPayload, data);
  missing(await service.getScaleOutputById(req.params.id));
  res.json(conflict(await service.updateScaleOutput(req.params.id, update, req.apiUser)));
}));
router.post('/saidas/:id/bruto', wrap(async (req, res) => {
  const data = payload(service.buildScaleOutputGrossPayload, fields(req, ['peso_bruto_kg', 'peso_bruto_adicionado_em'], ['peso_bruto_kg']));
  missing(await service.getScaleOutputById(req.params.id));
  res.json(conflict(await service.addScaleOutputGross(req.params.id, data, req.apiUser)));
}));
router.get('/saidas/:id/compradores', wrap(async (req, res) => {
  missing(await service.getScaleOutputById(req.params.id));
  res.json({ items: await service.listEligibleBuyersForOutput(req.params.id) });
}));
router.get('/saidas/:id/contratos', wrap(async (req, res) => {
  const buyerId = id(req.query.comprador_id);
  missing(await service.getScaleOutputById(req.params.id));
  res.json({ items: await service.listEligibleContractsForOutput(req.params.id, buyerId) });
}));
router.post('/saidas/:id/associar', wrap(async (req, res) => {
  const data = fields(req, ['comprador_id', 'contrato_id'], ['comprador_id', 'contrato_id']);
  await service.associateScaleOutputToContract(req.params.id, data.comprador_id, data.contrato_id, req.apiUser.userId);
  res.json({ id: req.params.id, contrato_id: data.contrato_id });
}));
router.post('/saidas/:id/desvincular-contrato', wrap(async (req, res) => {
  body(req, []);
  await service.unlinkScaleOutputFromContract(req.params.id, req.apiUser);
  res.json({ id: req.params.id, contrato_id: null });
}));
router.post('/saidas/:id/dividir', wrap(async (req, res) => {
  const data = fields(req, ['peso_liquido_primeira_kg'], ['peso_liquido_primeira_kg']);
  const result = await service.splitScaleOutput(req.params.id, data.peso_liquido_primeira_kg, req.apiUser);
  res.status(201).location(`/api/v1/balanca/saidas/${result.id}`).json({ saida_original_id: req.params.id, nova_saida_id: result.id });
}));
router.post('/saidas/:id/deletar', wrap(async (req, res) => {
  const data = payload(service.buildDeletionReasonPayload, fields(req, ['motivo_delecao'], ['motivo_delecao']));
  await service.deleteScaleOutput(req.params.id, req.apiUser, data.motivoDelecao);
  res.status(204).end();
}));
router.get('/saidas/:id/nf', wrap(async (req, res) => {
  const info = missing(await service.getScaleOutputDetailInfo(req.params.id));
  if (!info.contrato_id) throw new ApiError(409, 'STATE_CONFLICT', 'Associe um contrato para consultar os dados da NF.');
  res.json({ ...info, nome_nf: reports.buildScaleOutputInvoiceName(info), natureza_operacao: info.natureza_operacao ?? 'Venda', cfop: info.cfop ?? '5101',
    peso_liquido_ton: info.peso_liquido_kg == null ? null : String(Number(info.peso_liquido_kg) / 1000) });
}));

for (const input of [true, false]) {
  const resource = input ? 'entradas' : 'saidas';
  router.get(`/${resource}/:id/ticket.pdf`, wrap(async (req, res) => {
    const info = missing(await (input ? service.getScaleInputDetailInfo : service.getScaleOutputDetailInfo)(req.params.id));
    if (info.peso_liquido_kg == null || (input ? info.peso_tara_kg == null : info.peso_bruto_kg == null || !info.contrato_id)) {
      throw new ApiError(409, 'STATE_CONFLICT', 'Conclua a pesagem e, para saídas, associe o contrato antes de gerar o ticket.');
    }
    const content = await (input ? pdf.buildScaleInputTicketPdf : pdf.buildScaleOutputTicketPdf)(info);
    res.type('application/pdf').attachment(`ticket-${input ? 'entrada' : 'saida'}-${req.params.id}.pdf`).send(content);
  }));
}
router.get('/contratos', wrap(async (req, res) => {
  if (req.query.filtro !== undefined && req.query.filtro !== 'nao-embarcados') throw new ApiError(400, 'INVALID_QUERY', 'A API operacional lista somente contratos não embarcados com saldo positivo.');
  const page = pagination(req.query);
  res.json(paged(await service.listOpenContractsForWeighbridge('nao-embarcados', page.options), page));
}));
router.get('/contratos/:id', wrap(async (req, res) => res.json(missing(await service.getContractDetailForWeighbridge(req.params.id)))));

router.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', error: 'Endpoint não encontrado.' }));
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ApiError) return res.status(error.status).json({ code: error.code, error: error.message });
  const statuses = { NOT_FOUND: 404, INVALID_BODY: 400, STATE_CONFLICT: 409, NO_PREVIOUS_TARE: 409, INVALID_PREVIOUS_TARE: 409 };
  if (statuses[error.code]) return res.status(statuses[error.code]).json({ code: error.code, error: error.message });
  if (['23503', '23505', '23514', '22003', '40001', '40P01'].includes(error.code)) {
    return res.status(409).json({ code: 'DATA_CONFLICT', error: 'A operação conflita com dados ou vínculos existentes. Consulte os registros antes de tentar novamente.' });
  }
  // Never return SQL, credentials, bodies or tokens to clients or logs.
  console.error('Weighbridge API request failed.');
  const unavailable = !process.env.DATABASE_URL || ['42P01', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code);
  res.status(unavailable ? 503 : 500).json({ code: unavailable ? 'UNAVAILABLE' : 'INTERNAL_ERROR', error: 'Não foi possível concluir a operação agora.' });
});
module.exports = { router, loginLimiter };
