const express = require('express');
const { requireRole } = require('./auth');
const { ROLES } = require('./constants');
const {
  associateScaleOutputToContract,
  buildScaleOutputPayload,
  createScaleOutput,
  getScaleOutputById,
  getScaleOutputInvoiceInfo,
  listEligibleBuyersForOutput,
  listEligibleContractsForOutput,
  listScaleOutputs,
} = require('./weighbridge-service');
const {
  renderConstructionPage,
  renderScaleOutputAssociationPage,
  renderScaleOutputDetailPage,
  renderScaleOutputFormPage,
  renderScaleOutputsListPage,
  renderWeighbridgeHomePage,
} = require('./renderers');
const { buildRedirect } = require('./utils');

const router = express.Router();
const canAccessWeighbridge = requireRole(ROLES.WEIGHBRIDGE_OPERATOR);

function buildWeighbridgeRedirect(params = {}) {
  return buildRedirect('/balanca', params);
}

router.get('/balanca', canAccessWeighbridge, async (req, res) => {
  try {
    const outputs = await listScaleOutputs({ limit: 10 });

    return renderWeighbridgeHomePage(res, {
      outputs,
      message: req.query.saida_criada
        ? 'Saída adicionada com sucesso.'
        : req.query.saida_associada
          ? 'Saída associada ao contrato com sucesso.'
          : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading weighbridge home:', error.message);
    return res.status(500).send('Não foi possível carregar a área da balança agora.');
  }
});

router.get('/balanca/entradas/nova', canAccessWeighbridge, (req, res) => renderConstructionPage(res, ROLES.WEIGHBRIDGE_OPERATOR, {
  eyebrow: 'Área da balança',
  title: 'Adicionar entrada',
  description: 'O registro de entradas está em construção e ficará disponível em breve.',
  backHref: '/balanca',
  backLabel: '← Voltar à balança',
}));

router.get('/balanca/contratos', canAccessWeighbridge, (req, res) => renderConstructionPage(res, ROLES.WEIGHBRIDGE_OPERATOR, {
  eyebrow: 'Área da balança',
  title: 'Visualizar contratos',
  description: 'A consulta de contratos pela balança está em construção e ficará disponível em breve.',
  backHref: '/balanca',
  backLabel: '← Voltar à balança',
}));

router.get('/balanca/saidas', canAccessWeighbridge, async (req, res) => {
  try {
    const outputs = await listScaleOutputs();
    return renderScaleOutputsListPage(res, { outputs });
  } catch (error) {
    console.error('Error listing scale outputs:', error.message);
    return res.status(500).send('Não foi possível listar as saídas agora.');
  }
});

router.get('/balanca/saidas/nova', canAccessWeighbridge, (req, res) => renderScaleOutputFormPage(res, {
  formValues: {},
  error: req.query.error || '',
}));

router.post('/balanca/saidas', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildScaleOutputPayload(req.body);

  if (error) {
    return renderScaleOutputFormPage(res, { formValues: req.body, error });
  }

  try {
    await createScaleOutput(payload, req.sessionUser.userId);
    return res.redirect(buildWeighbridgeRedirect({ saida_criada: '1' }));
  } catch (error) {
    console.error('Error creating scale output:', error.message);
    return renderScaleOutputFormPage(res, {
      formValues: req.body,
      error: 'Não foi possível adicionar a saída agora.',
    });
  }
});

router.get('/balanca/saidas/:id/associar', canAccessWeighbridge, async (req, res) => {
  try {
    const output = await getScaleOutputById(req.params.id);

    if (!output) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Saída não encontrada.' }));
    }

    if (output.contrato_id) {
      return res.redirect(`/balanca/saidas/${encodeURIComponent(req.params.id)}`);
    }

    const buyers = await listEligibleBuyersForOutput(req.params.id);
    const selectedBuyerId = req.query.comprador_id || '';
    const contracts = selectedBuyerId
      ? await listEligibleContractsForOutput(req.params.id, selectedBuyerId)
      : [];

    return renderScaleOutputAssociationPage(res, {
      output,
      buyers,
      contracts,
      selectedBuyerId,
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading association page:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar a associação agora.' }));
  }
});

router.post('/balanca/saidas/:id/associar', canAccessWeighbridge, async (req, res) => {
  const buyerId = String(req.body.comprador_id || '').trim();
  const contractId = String(req.body.contrato_id || '').trim();

  if (!/^\d+$/.test(buyerId) || !/^\d+$/.test(contractId)) {
    return res.redirect(buildRedirect(`/balanca/saidas/${req.params.id}/associar`, {
      comprador_id: buyerId,
      error: 'Selecione comprador e contrato válidos.',
    }));
  }

  try {
    await associateScaleOutputToContract(req.params.id, buyerId, contractId, req.sessionUser.userId);
    return res.redirect(buildWeighbridgeRedirect({ saida_associada: '1' }));
  } catch (error) {
    return res.redirect(buildRedirect(`/balanca/saidas/${req.params.id}/associar`, {
      comprador_id: buyerId,
      error: error.message || 'Não foi possível associar a saída agora.',
    }));
  }
});

router.get('/balanca/saidas/:id', canAccessWeighbridge, async (req, res) => {
  try {
    const invoiceInfo = await getScaleOutputInvoiceInfo(req.params.id);

    if (!invoiceInfo) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Associe a saída a um contrato para ver as informações da nota fiscal.' }));
    }

    return renderScaleOutputDetailPage(res, { invoiceInfo });
  } catch (error) {
    console.error('Error loading scale output detail:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar os dados da saída agora.' }));
  }
});

module.exports = router;
