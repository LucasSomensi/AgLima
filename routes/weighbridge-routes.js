const express = require('express');
const { requireRole } = require('./auth');
const { ROLES } = require('./constants');
const {
  addScaleInputClassification,
  addScaleInputTare,
  addScaleOutputGross,
  associateScaleOutputToContract,
  buildDeletionReasonPayload,
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
  getContractDetailForWeighbridge,
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
  updateScaleInput,
  unlinkScaleOutputFromContract,
} = require('./weighbridge-service');
const {
  renderScaleContractDetailPage,
  renderScaleContractsListPage,
  renderScaleInputClassificationFormPage,
  renderScaleInputDetailPage,
  renderScaleInputFormPage,
  renderScaleInputsListPage,
  renderScaleInputOriginFormPage,
  renderScaleInputTareFormPage,
  renderScaleOutputAssociationPage,
  renderScaleOutputDetailPage,
  renderScaleOutputFormPage,
  renderScaleOutputInvoicePage,
  renderScaleOutputGrossFormPage,
  renderScaleOutputsListPage,
  renderWeighbridgeHomePage,
} = require('./renderers/weighbridge-renderer');
const { buildRedirect } = require('./utils');
const { buildScaleInputsCsv, buildScaleOutputsCsv } = require('./weighbridge-csv');

const router = express.Router();
const canAccessWeighbridge = requireRole(ROLES.WEIGHBRIDGE_OPERATOR, ROLES.ADMIN);

function buildWeighbridgeRedirect(params = {}) {
  return buildRedirect('/balanca', params);
}

function getWeighbridgeNavigation(req) {
  if (req.sessionUser?.role === ROLES.ADMIN) {
    return {
      homeHref: '/admin',
      homeLabel: '← Voltar à administração',
    };
  }

  return {
    homeHref: '/balanca',
    homeLabel: '← Voltar à balança',
  };
}

router.get('/balanca', canAccessWeighbridge, async (req, res) => {
  if (req.sessionUser.role === ROLES.ADMIN) {
    return res.redirect('/admin');
  }

  try {
    const [inputs, outputs] = await Promise.all([
      listScaleInputs({ limit: 10 }),
      listScaleOutputs({ limit: 10 }),
    ]);

    return renderWeighbridgeHomePage(res, {
      inputs,
      outputs,
      message: req.query.entrada_criada
        ? 'Entrada adicionada com sucesso.'
        : req.query.entrada_editada
          ? 'Entrada atualizada com sucesso.'
          : req.query.entrada_deletada
            ? 'Entrada deletada com sucesso.'
            : req.query.entrada_tara_adicionada
              ? 'Tara adicionada à entrada com sucesso.'
              : req.query.entrada_classificada
                ? 'Classificação adicionada à entrada com sucesso.'
                : req.query.entrada_origem_definida
                  ? 'Origem definida para a entrada com sucesso.'
                  : req.query.saida_criada
                    ? 'Saída adicionada com sucesso.'
                    : req.query.saida_deletada
                      ? 'Saída deletada com sucesso.'
                      : req.query.saida_dividida
                        ? 'Saída dividida com sucesso.'
                        : req.query.saida_bruto_adicionado
                          ? 'Peso bruto adicionado à saída com sucesso.'
                          : req.query.saida_associada
                          ? 'Saída associada ao contrato com sucesso.'
                          : req.query.contrato_desvinculado
                            ? 'Contrato desvinculado da saída com sucesso.'
                            : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading weighbridge home:', error.message);
    return res.status(500).send('Não foi possível carregar a área da balança agora.');
  }
});

router.get('/balanca/entradas/placas', canAccessWeighbridge, async (req, res) => {
  try {
    const plates = await listRecentInputPlates(req.query.q || '');
    return res.json(plates);
  } catch (error) {
    console.error('Error listing recent input plates:', error.message);
    return res.status(500).json([]);
  }
});

router.get('/balanca/entradas/tara-anterior', canAccessWeighbridge, async (req, res) => {
  try {
    const tare = await getPreviousTareForPlate(req.query.placa || '');
    return res.json(tare || {});
  } catch (error) {
    console.error('Error loading previous tare:', error.message);
    return res.status(500).json({});
  }
});

router.get('/balanca/entradas', canAccessWeighbridge, async (req, res) => {
  try {
    const inputs = await listScaleInputs();
    return renderScaleInputsListPage(res, { inputs, navigation: getWeighbridgeNavigation(req) });
  } catch (error) {
    console.error('Error listing scale inputs:', error.message);
    return res.status(500).send('Não foi possível listar as entradas agora.');
  }
});

router.get('/balanca/entradas.csv', canAccessWeighbridge, async (req, res) => {
  try {
    const inputs = await listScaleInputs({ order: 'asc' });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="entradas-balanca.csv"');
    return res.send(buildScaleInputsCsv(inputs));
  } catch (error) {
    console.error('Error exporting scale inputs CSV:', error.message);
    return res.status(500).send('Não foi possível exportar as entradas agora.');
  }
});

router.get('/balanca/entradas/nova', canAccessWeighbridge, async (req, res) => {
  try {
    const plateSuggestions = await listRecentInputPlates();
    return renderScaleInputFormPage(res, {
      formValues: {},
      plateSuggestions,
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading input form:', error.message);
    return res.status(500).send('Não foi possível carregar o formulário de entrada agora.');
  }
});

router.post('/balanca/entradas', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildScaleInputPayload(req.body);
  const plateSuggestions = await listRecentInputPlates(req.body.placa_caminhao || '').catch(() => []);

  if (error) {
    return renderScaleInputFormPage(res, {
      formValues: req.body,
      plateSuggestions,
      error,
      navigation: getWeighbridgeNavigation(req),
    });
  }

  try {
    await createScaleInput(payload, req.sessionUser.userId);
    return res.redirect(buildWeighbridgeRedirect({ entrada_criada: '1' }));
  } catch (error) {
    console.error('Error creating scale input:', error.message);
    return renderScaleInputFormPage(res, {
      formValues: req.body,
      plateSuggestions,
      error: error.code === 'NO_PREVIOUS_TARE' || error.code === 'INVALID_PREVIOUS_TARE'
        ? error.message
        : 'Não foi possível adicionar a entrada agora.',
      navigation: getWeighbridgeNavigation(req),
    });
  }
});

router.get('/balanca/entradas/:id', canAccessWeighbridge, async (req, res) => {
  try {
    const input = await getScaleInputById(req.params.id);

    if (!input) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Entrada não encontrada.' }));
    }

    return renderScaleInputDetailPage(res, {
      input,
      message: req.query.entrada_editada ? 'Entrada atualizada com sucesso.' : '',
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading scale input detail:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar os dados da entrada agora.' }));
  }
});

router.post('/balanca/entradas/:id', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildScaleInputEditPayload(req.body);
  const input = await getScaleInputById(req.params.id).catch(() => null);

  if (!input) {
    return res.redirect(buildWeighbridgeRedirect({ error: 'Entrada não encontrada.' }));
  }

  if (error) {
    return renderScaleInputDetailPage(res, {
      input,
      formValues: req.body,
      error,
      navigation: getWeighbridgeNavigation(req),
    });
  }

  try {
    const updatedInput = await updateScaleInput(req.params.id, payload, req.sessionUser);

    if (!updatedInput) {
      return renderScaleInputDetailPage(res, {
        input,
        formValues: req.body,
        error: 'Confira se o peso bruto continua maior que o peso tara.',
        navigation: getWeighbridgeNavigation(req),
      });
    }

    return res.redirect(buildRedirect(`/balanca/entradas/${req.params.id}`, { entrada_editada: '1' }));
  } catch (error) {
    console.error('Error updating scale input:', error.message);
    return renderScaleInputDetailPage(res, {
      input,
      formValues: req.body,
      error: 'Não foi possível atualizar a entrada agora.',
      navigation: getWeighbridgeNavigation(req),
    });
  }
});

router.post('/balanca/entradas/:id/deletar', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildDeletionReasonPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect(`/balanca/entradas/${req.params.id}`, { error }));
  }

  try {
    await deleteScaleInput(req.params.id, req.sessionUser, payload.motivoDelecao);
    return res.redirect(buildWeighbridgeRedirect({ entrada_deletada: '1' }));
  } catch (error) {
    console.error('Error deleting scale input:', error.message);
    return res.redirect(buildRedirect(`/balanca/entradas/${req.params.id}`, {
      error: 'Não foi possível deletar a entrada agora. Verifique se ela não está sendo usada como tara anterior de outra entrada.',
    }));
  }
});

router.get('/balanca/entradas/:id/tara', canAccessWeighbridge, async (req, res) => {
  try {
    const input = await getScaleInputById(req.params.id);

    if (!input) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Entrada não encontrada.' }));
    }

    if (input.peso_tara_kg !== null && input.peso_tara_kg !== undefined) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Esta entrada já possui tara.' }));
    }

    return renderScaleInputTareFormPage(res, {
      input,
      formValues: {},
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading input tare form:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar a tara agora.' }));
  }
});

router.post('/balanca/entradas/:id/tara', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildScaleInputTarePayload(req.body);
  const input = await getScaleInputById(req.params.id).catch(() => null);

  if (!input) {
    return res.redirect(buildWeighbridgeRedirect({ error: 'Entrada não encontrada.' }));
  }

  if (error) {
    return renderScaleInputTareFormPage(res, {
      input,
      formValues: req.body,
      error,
      navigation: getWeighbridgeNavigation(req),
    });
  }

  try {
    const updatedInput = await addScaleInputTare(req.params.id, payload.pesoTaraKg, req.sessionUser.userId);

    if (!updatedInput) {
      return renderScaleInputTareFormPage(res, {
        input,
        formValues: req.body,
        error: 'Confira se a entrada ainda está sem tara e se o peso tara é menor que o peso bruto.',
        navigation: getWeighbridgeNavigation(req),
      });
    }

    return res.redirect(buildWeighbridgeRedirect({ entrada_tara_adicionada: '1' }));
  } catch (error) {
    console.error('Error adding input tare:', error.message);
    return renderScaleInputTareFormPage(res, {
      input,
      formValues: req.body,
      error: 'Não foi possível adicionar a tara agora.',
      navigation: getWeighbridgeNavigation(req),
    });
  }
});

router.get('/balanca/entradas/:id/classificacao', canAccessWeighbridge, async (req, res) => {
  try {
    const input = await getScaleInputById(req.params.id);

    if (!input) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Entrada não encontrada.' }));
    }

    return renderScaleInputClassificationFormPage(res, {
      input,
      formValues: {},
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading input classification form:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar a classificação agora.' }));
  }
});

router.post('/balanca/entradas/:id/classificacao', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildScaleInputClassificationPayload(req.body);
  const input = await getScaleInputById(req.params.id).catch(() => null);

  if (!input) {
    return res.redirect(buildWeighbridgeRedirect({ error: 'Entrada não encontrada.' }));
  }

  if (error) {
    return renderScaleInputClassificationFormPage(res, {
      input,
      formValues: req.body,
      error,
      navigation: getWeighbridgeNavigation(req),
    });
  }

  try {
    await addScaleInputClassification(req.params.id, payload, req.sessionUser.userId);
    return res.redirect(buildWeighbridgeRedirect({ entrada_classificada: '1' }));
  } catch (error) {
    console.error('Error adding input classification:', error.message);
    return renderScaleInputClassificationFormPage(res, {
      input,
      formValues: req.body,
      error: 'Não foi possível adicionar a classificação agora.',
      navigation: getWeighbridgeNavigation(req),
    });
  }
});

router.get('/balanca/entradas/:id/origem', canAccessWeighbridge, async (req, res) => {
  try {
    const input = await getScaleInputById(req.params.id);

    if (!input) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Entrada não encontrada.' }));
    }

    if (input.origem) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Esta entrada já possui origem definida.' }));
    }

    return renderScaleInputOriginFormPage(res, {
      input,
      formValues: {},
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading input origin form:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar a origem agora.' }));
  }
});

router.post('/balanca/entradas/:id/origem', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildScaleInputOriginPayload(req.body);
  const input = await getScaleInputById(req.params.id).catch(() => null);

  if (!input) {
    return res.redirect(buildWeighbridgeRedirect({ error: 'Entrada não encontrada.' }));
  }

  if (error) {
    return renderScaleInputOriginFormPage(res, {
      input,
      formValues: req.body,
      error,
      navigation: getWeighbridgeNavigation(req),
    });
  }

  try {
    const updatedInput = await defineScaleInputOrigin(req.params.id, payload.origem, req.sessionUser.userId);

    if (!updatedInput) {
      return renderScaleInputOriginFormPage(res, {
        input,
        formValues: req.body,
        error: 'Confira se a entrada ainda está sem origem definida.',
        navigation: getWeighbridgeNavigation(req),
      });
    }

    return res.redirect(buildWeighbridgeRedirect({ entrada_origem_definida: '1' }));
  } catch (error) {
    console.error('Error defining input origin:', error.message);
    return renderScaleInputOriginFormPage(res, {
      input,
      formValues: req.body,
      error: 'Não foi possível definir a origem agora.',
      navigation: getWeighbridgeNavigation(req),
    });
  }
});

router.get('/balanca/contratos', canAccessWeighbridge, async (req, res) => {
  try {
    const contracts = await listOpenContractsForWeighbridge();
    return renderScaleContractsListPage(res, { contracts, navigation: getWeighbridgeNavigation(req) });
  } catch (error) {
    console.error('Error listing weighbridge contracts:', error.message);
    return res.status(500).send('Não foi possível listar os contratos agora.');
  }
});

router.get('/balanca/contratos/:id', canAccessWeighbridge, async (req, res) => {
  try {
    const contractInfo = await getContractDetailForWeighbridge(req.params.id);

    if (!contractInfo) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Contrato não encontrado.' }));
    }

    return renderScaleContractDetailPage(res, contractInfo);
  } catch (error) {
    console.error('Error loading weighbridge contract:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar os dados do contrato agora.' }));
  }
});

router.get('/balanca/saidas', canAccessWeighbridge, async (req, res) => {
  try {
    const outputs = await listScaleOutputs();
    return renderScaleOutputsListPage(res, { outputs, navigation: getWeighbridgeNavigation(req) });
  } catch (error) {
    console.error('Error listing scale outputs:', error.message);
    return res.status(500).send('Não foi possível listar as saídas agora.');
  }
});

router.get('/balanca/saidas.csv', canAccessWeighbridge, async (req, res) => {
  try {
    const outputs = await listScaleOutputs({ order: 'asc' });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="saidas-balanca.csv"');
    return res.send(buildScaleOutputsCsv(outputs));
  } catch (error) {
    console.error('Error exporting scale outputs CSV:', error.message);
    return res.status(500).send('Não foi possível exportar as saídas agora.');
  }
});

router.get('/balanca/saidas/nova', canAccessWeighbridge, (req, res) => renderScaleOutputFormPage(res, {
  formValues: {},
  error: req.query.error || '',
  navigation: getWeighbridgeNavigation(req),
}));

router.post('/balanca/saidas', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildScaleOutputPayload(req.body);

  if (error) {
    return renderScaleOutputFormPage(res, {
      formValues: req.body,
      error,
      navigation: getWeighbridgeNavigation(req),
    });
  }

  try {
    await createScaleOutput(payload, req.sessionUser.userId);
    return res.redirect(buildWeighbridgeRedirect({ saida_criada: '1' }));
  } catch (error) {
    console.error('Error creating scale output:', error.message);
    return renderScaleOutputFormPage(res, {
      formValues: req.body,
      error: 'Não foi possível adicionar a saída agora.',
      navigation: getWeighbridgeNavigation(req),
    });
  }
});


router.get('/balanca/saidas/:id/bruto', canAccessWeighbridge, async (req, res) => {
  try {
    const output = await getScaleOutputById(req.params.id);

    if (!output) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Saída não encontrada.' }));
    }

    if (output.peso_bruto_kg !== null && output.peso_bruto_kg !== undefined) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Esta saída já possui peso bruto.' }));
    }

    return renderScaleOutputGrossFormPage(res, {
      output,
      formValues: {},
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading scale output tare form:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar o peso bruto da saída agora.' }));
  }
});

router.post('/balanca/saidas/:id/bruto', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildScaleOutputGrossPayload(req.body);

  try {
    const output = await getScaleOutputById(req.params.id);

    if (!output) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Saída não encontrada.' }));
    }

    if (error) {
      return renderScaleOutputGrossFormPage(res, {
        output,
        formValues: req.body,
        error,
        navigation: getWeighbridgeNavigation(req),
      });
    }

    const updatedOutput = await addScaleOutputGross(req.params.id, payload, req.sessionUser);

    if (!updatedOutput) {
      return renderScaleOutputGrossFormPage(res, {
        output,
        formValues: req.body,
        error: 'Confira se a saída ainda está sem peso bruto e se o peso bruto é maior que o peso tara.',
        navigation: getWeighbridgeNavigation(req),
      });
    }

    return res.redirect(buildWeighbridgeRedirect({ saida_bruto_adicionado: '1' }));
  } catch (error) {
    console.error('Error adding scale output gross:', error.message);
    return res.redirect(buildWeighbridgeRedirect({
      error: 'Não foi possível adicionar o peso bruto da saída agora.',
    }));
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
      navigation: getWeighbridgeNavigation(req),
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


router.post('/balanca/saidas/:id/deletar', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildDeletionReasonPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect(`/balanca/saidas/${req.params.id}`, { error }));
  }

  try {
    await deleteScaleOutput(req.params.id, req.sessionUser, payload.motivoDelecao);
    return res.redirect(buildWeighbridgeRedirect({ saida_deletada: '1' }));
  } catch (error) {
    console.error('Error deleting scale output:', error.message);
    return res.redirect(buildRedirect(`/balanca/saidas/${req.params.id}`, {
      error: error.message || 'Não foi possível deletar a saída agora.',
    }));
  }
});

router.post('/balanca/saidas/:id/dividir', canAccessWeighbridge, async (req, res) => {
  try {
    await splitScaleOutput(req.params.id, req.body.peso_liquido_primeira_kg, req.sessionUser);
    return res.redirect(buildWeighbridgeRedirect({ saida_dividida: '1' }));
  } catch (error) {
    return res.redirect(buildRedirect(`/balanca/saidas/${req.params.id}`, {
      error: error.message || 'Não foi possível dividir a saída agora.',
    }));
  }
});

router.post('/balanca/saidas/:id/desvincular-contrato', canAccessWeighbridge, async (req, res) => {
  try {
    await unlinkScaleOutputFromContract(req.params.id, req.sessionUser);
    return res.redirect(buildRedirect(`/balanca/saidas/${req.params.id}/nf`, { contrato_desvinculado: '1' }));
  } catch (error) {
    return res.redirect(buildRedirect(`/balanca/saidas/${req.params.id}/nf`, {
      error: error.message || 'Não foi possível desvincular o contrato agora.',
    }));
  }
});

router.get('/balanca/saidas/:id/nf', canAccessWeighbridge, async (req, res) => {
  try {
    const outputInfo = await getScaleOutputDetailInfo(req.params.id);

    if (!outputInfo) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Saída não encontrada.' }));
    }

    return renderScaleOutputInvoicePage(res, {
      outputInfo,
      message: req.query.contrato_desvinculado ? 'Contrato desvinculado da saída com sucesso.' : '',
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading scale output invoice info:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar as informações da NF agora.' }));
  }
});

router.get('/balanca/saidas/:id', canAccessWeighbridge, async (req, res) => {
  try {
    const outputInfo = await getScaleOutputDetailInfo(req.params.id);

    if (!outputInfo) {
      return res.redirect(buildWeighbridgeRedirect({ error: 'Saída não encontrada.' }));
    }

    return renderScaleOutputDetailPage(res, {
      outputInfo,
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading scale output detail:', error.message);
    return res.redirect(buildWeighbridgeRedirect({ error: 'Não foi possível carregar os dados da saída agora.' }));
  }
});

module.exports = router;
