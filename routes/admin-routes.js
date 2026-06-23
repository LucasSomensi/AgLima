const express = require('express');
const { requireRole, requireRoot } = require('./auth');
const { MANAGED_ROLES, ROOT_LOGIN, ROLES } = require('./constants');
const {
  buildBuyerPayload,
  buildContractPayload,
  buildSellerPayload,
  createBuyer,
  createContract,
  createSeller,
  getBuyerById,
  getAdminContractsSummary,
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
} = require('./contract-service');
const {
  getActiveDryerBatch,
  getDryerBatchById,
  getDryerSettings,
  listCompletedDryerBatches,
  listDryerMoistureReadings,
  updateDryerTargetMoisture,
} = require('./dryer-service');
const {
  renderAdminBatchDetailPage,
  renderAdminBatchesPage,
  renderAdminContractsPage,
  renderAdminBuyerFormPage,
  renderAdminContractFormPage,
  renderAdminSellerFormPage,
  renderAdminDashboardPage,
  renderAdminHomePage,
  renderAdminStoragePage,
  renderAdminUsersPage,
} = require('./renderers/admin-renderer');
const {
  createManagedUser,
  deleteManagedUser,
  listManagedUsers,
  updateManagedUserPassword,
} = require('./user-service');
const { buildRedirect, parseMoisturePercent } = require('./utils');
const {
  buildStorageRecalibrationPayload,
  countStorageIgnoredInputs,
  createStorageRecalibration,
  getStorageSummary,
  listStorageRecalibrations,
} = require('./storage-service');
const { listScaleInputs, listScaleOutputs } = require('./weighbridge-service');

const router = express.Router();

const canAccessAdminPanel = requireRole(ROLES.ADMIN);

function buildAdminPanelRedirect(params) {
  return buildRedirect('/admin/secador', params);
}

function buildStorageRedirect(params = {}) {
  return buildRedirect('/admin/armazenamento', params);
}

function buildAdminHomeRedirect(params = {}) {
  return buildRedirect('/admin', params);
}

router.get('/admin', canAccessAdminPanel, async (req, res) => {
  try {
    const [notifications, contractsSummary, dryerBatch, storageSummary, scaleInputs, scaleOutputs] = await Promise.all([
      listAdminContractNotifications(),
      getAdminContractsSummary(),
      getActiveDryerBatch(),
      getStorageSummary(),
      listScaleInputs({ limit: 10 }),
      listScaleOutputs({ limit: 10 }),
    ]);

    return renderAdminHomePage(res, {
      notifications,
      contractsSummary,
      dryerBatch,
      storageSummary,
      scaleInputs,
      scaleOutputs,
      message: req.query.message || '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading admin notifications:', error.message);
    return res.status(500).send('Não foi possível carregar as notificações administrativas agora.');
  }
});

router.get('/admin/secador', canAccessAdminPanel, async (req, res) => {
  try {
    const [settings, batch] = await Promise.all([getDryerSettings(), getActiveDryerBatch()]);
    const readings = await listDryerMoistureReadings(batch?.id);

    return renderAdminDashboardPage(res, {
      batch,
      readings,
      settings,
      message: req.query.target ? 'Umidade alvo atualizada com sucesso.' : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading admin dryer dashboard:', error.message);
    return res.status(500).send('Não foi possível carregar o painel do secador agora.');
  }
});

router.get('/admin/armazenamento', canAccessAdminPanel, async (req, res) => {
  try {
    const [summary, recalibrations, ignoredInputs] = await Promise.all([
      getStorageSummary(),
      listStorageRecalibrations(),
      countStorageIgnoredInputs(),
    ]);

    return renderAdminStoragePage(res, {
      summary,
      recalibrations,
      ignoredInputs,
      message: req.query.recalibrado ? 'Recalibração registrada com sucesso.' : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading storage admin panel:', error.message);
    return res.status(500).send('Não foi possível carregar o painel de armazenamento agora.');
  }
});

router.post('/admin/armazenamento/recalibracoes', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildStorageRecalibrationPayload(req.body);

  if (error) {
    return res.redirect(buildStorageRedirect({ error }));
  }

  try {
    await createStorageRecalibration(payload, req.sessionUser.userId);
    return res.redirect(buildStorageRedirect({ recalibrado: '1' }));
  } catch (error) {
    console.error('Error creating storage recalibration:', error.message);
    return res.redirect(buildStorageRedirect({ error: 'Não foi possível salvar a recalibração agora.' }));
  }
});

function buildContractsRedirect(params = {}) {
  return buildRedirect('/admin/contratos', params);
}

function normalizeContractStatusFilter(value) {
  return value === 'todos' ? 'todos' : 'abertos';
}

async function loadContractsPage(req, res, overrides = {}) {
  const contractStatusFilter = normalizeContractStatusFilter(req.query.status);
  const [buyers, sellers, contracts] = await Promise.all([
    listBuyers(),
    listSellers(),
    listContracts({ status: contractStatusFilter }),
  ]);

  return renderAdminContractsPage(res, {
    buyers,
    sellers,
    contracts,
    contractStatusFilter,
    message: overrides.message || req.query.message || '',
    error: overrides.error || req.query.error || '',
  });
}

router.get('/admin/contratos', canAccessAdminPanel, async (req, res) => {
  try {
    return await loadContractsPage(req, res, {
      message: req.query.comprador_criado
        ? 'Comprador adicionado com sucesso.'
        : req.query.comprador_atualizado
          ? 'Comprador atualizado com sucesso.'
          : req.query.vendedor_criado
            ? 'Vendedor adicionado com sucesso.'
            : req.query.vendedor_atualizado
              ? 'Vendedor atualizado com sucesso.'
              : req.query.contrato_criado
                ? 'Contrato adicionado com sucesso.'
                : req.query.contrato_atualizado
                  ? 'Contrato atualizado com sucesso.'
                  : '',
    });
  } catch (error) {
    console.error('Error loading contracts admin panel:', error.message);
    return res.status(500).send('Não foi possível carregar o painel de contratos agora.');
  }
});


router.get('/admin/contratos/compradores/novo', canAccessAdminPanel, (req, res) => {
  return renderAdminBuyerFormPage(res, { buyer: null, error: req.query.error || '' });
});

router.get('/admin/contratos/compradores/:id/editar', canAccessAdminPanel, async (req, res) => {
  try {
    const buyer = await getBuyerById(req.params.id);
    if (!buyer) return res.status(404).send('Comprador não encontrado.');
    return renderAdminBuyerFormPage(res, { buyer, error: req.query.error || '' });
  } catch (error) {
    console.error('Error loading buyer form:', error.message);
    return res.status(500).send('Não foi possível carregar o comprador agora.');
  }
});

router.get('/admin/contratos/vendedores/novo', canAccessAdminPanel, (req, res) => {
  return renderAdminSellerFormPage(res, { seller: null, error: req.query.error || '' });
});

router.get('/admin/contratos/vendedores/:id/editar', canAccessAdminPanel, async (req, res) => {
  try {
    const seller = await getSellerById(req.params.id);
    if (!seller) return res.status(404).send('Vendedor não encontrado.');
    return renderAdminSellerFormPage(res, { seller, error: req.query.error || '' });
  } catch (error) {
    console.error('Error loading seller form:', error.message);
    return res.status(500).send('Não foi possível carregar o vendedor agora.');
  }
});

async function loadContractForm(req, res, contract = null) {
  const contractStatusFilter = normalizeContractStatusFilter(req.query.status);
  const [buyers, sellers] = await Promise.all([listBuyers(), listSellers()]);
  return renderAdminContractFormPage(res, { buyers, sellers, contract, contractStatusFilter, error: req.query.error || '' });
}

router.get('/admin/contratos/contratos/novo', canAccessAdminPanel, async (req, res) => {
  try {
    return await loadContractForm(req, res);
  } catch (error) {
    console.error('Error loading contract form:', error.message);
    return res.status(500).send('Não foi possível carregar o formulário de contrato agora.');
  }
});

router.get('/admin/contratos/contratos/:id/editar', canAccessAdminPanel, async (req, res) => {
  try {
    const contract = await getContractById(req.params.id);
    if (!contract) return res.status(404).send('Contrato não encontrado.');
    return await loadContractForm(req, res, contract);
  } catch (error) {
    console.error('Error loading contract form:', error.message);
    return res.status(500).send('Não foi possível carregar o contrato agora.');
  }
});

router.post('/admin/contratos/compradores', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildBuyerPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect('/admin/contratos/compradores/novo', { error }));
  }

  try {
    await createBuyer(payload);
    return res.redirect(buildContractsRedirect({ comprador_criado: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildRedirect('/admin/contratos/compradores/novo', { error: 'Já existe um comprador com esse nome.' }));
    }

    console.error('Error creating buyer:', error.message);
    return res.redirect(buildRedirect('/admin/contratos/compradores/novo', { error: 'Não foi possível adicionar o comprador agora.' }));
  }
});

router.post('/admin/contratos/compradores/:id', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildBuyerPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect(`/admin/contratos/compradores/${req.params.id}/editar`, { error }));
  }

  try {
    await updateBuyer(req.params.id, payload);
    return res.redirect(buildContractsRedirect({ comprador_atualizado: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildRedirect(`/admin/contratos/compradores/${req.params.id}/editar`, { error: 'Já existe um comprador com esse nome.' }));
    }

    console.error('Error updating buyer:', error.message);
    return res.redirect(buildRedirect(`/admin/contratos/compradores/${req.params.id}/editar`, { error: 'Não foi possível atualizar o comprador agora.' }));
  }
});

router.post('/admin/contratos/vendedores', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildSellerPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect('/admin/contratos/vendedores/novo', { error }));
  }

  try {
    await createSeller(payload);
    return res.redirect(buildContractsRedirect({ vendedor_criado: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildRedirect('/admin/contratos/vendedores/novo', { error: 'Já existe um vendedor com esse nome.' }));
    }

    console.error('Error creating seller:', error.message);
    return res.redirect(buildRedirect('/admin/contratos/vendedores/novo', { error: 'Não foi possível adicionar o vendedor agora.' }));
  }
});

router.post('/admin/contratos/vendedores/:id', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildSellerPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect(`/admin/contratos/vendedores/${req.params.id}/editar`, { error }));
  }

  try {
    await updateSeller(req.params.id, payload);
    return res.redirect(buildContractsRedirect({ vendedor_atualizado: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildRedirect(`/admin/contratos/vendedores/${req.params.id}/editar`, { error: 'Já existe um vendedor com esse nome.' }));
    }

    console.error('Error updating seller:', error.message);
    return res.redirect(buildRedirect(`/admin/contratos/vendedores/${req.params.id}/editar`, { error: 'Não foi possível atualizar o vendedor agora.' }));
  }
});


async function runContractQuickAction(req, res, action, successMessage, inactiveMessage, errorLogMessage) {
  try {
    const updatedRows = await action(req.params.id);

    if (!updatedRows) {
      return res.redirect(buildAdminHomeRedirect({ error: inactiveMessage }));
    }

    return res.redirect(buildAdminHomeRedirect({ message: successMessage }));
  } catch (error) {
    console.error(errorLogMessage, error.message);
    return res.redirect(buildAdminHomeRedirect({ error: 'Não foi possível atualizar o contrato agora.' }));
  }
}

router.post('/admin/contratos/:id/marcar-embarcado', canAccessAdminPanel, async (req, res) => {
  return runContractQuickAction(
    req,
    res,
    markContractAsShipped,
    'Contrato marcado como embarcado com sucesso.',
    'Esse contrato já foi marcado como embarcado ou não existe.',
    'Error marking contract as shipped:'
  );
});

router.post('/admin/contratos/:id/marcar-recebido', canAccessAdminPanel, async (req, res) => {
  return runContractQuickAction(
    req,
    res,
    markContractAsReceived,
    'Contrato marcado como recebido com sucesso.',
    'Esse contrato já foi marcado como recebido ou não existe.',
    'Error marking contract as received:'
  );
});

router.post('/admin/contratos/:id/marcar-corretagem-paga', canAccessAdminPanel, async (req, res) => {
  return runContractQuickAction(
    req,
    res,
    markContractBrokerageAsPaid,
    'Corretagem marcada como paga com sucesso.',
    'Essa corretagem já foi marcada como paga ou o contrato não existe.',
    'Error marking contract brokerage as paid:'
  );
});

router.post('/admin/contratos/contratos', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildContractPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect('/admin/contratos/contratos/novo', { error }));
  }

  try {
    await createContract(payload);
    return res.redirect(buildContractsRedirect({ contrato_criado: '1' }));
  } catch (error) {
    console.error('Error creating contract:', error.message);
    return res.redirect(buildRedirect('/admin/contratos/contratos/novo', { error: 'Não foi possível adicionar o contrato agora. Confira comprador e vendedor.' }));
  }
});

router.post('/admin/contratos/contratos/:id', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildContractPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect(`/admin/contratos/contratos/${req.params.id}/editar`, { error }));
  }

  try {
    await updateContract(req.params.id, payload);
    return res.redirect(buildContractsRedirect({ contrato_atualizado: '1' }));
  } catch (error) {
    console.error('Error updating contract:', error.message);
    return res.redirect(buildRedirect(`/admin/contratos/contratos/${req.params.id}/editar`, { error: 'Não foi possível atualizar o contrato agora. Confira comprador e vendedor.' }));
  }
});

router.post('/admin/umidade-alvo', canAccessAdminPanel, async (req, res) => {
  const targetMoisture = parseMoisturePercent(req.body.target_moisture);

  if (targetMoisture === null) {
    return res.redirect(buildAdminPanelRedirect({ error: 'Informe uma umidade alvo entre 7,0% e 40,0%, com no máximo uma casa decimal.' }));
  }

  try {
    await updateDryerTargetMoisture({ targetMoisture, user: req.sessionUser });
    return res.redirect(buildAdminPanelRedirect({ target: '1' }));
  } catch (error) {
    console.error('Error updating dryer target moisture:', error.message);
    return res.redirect(buildAdminPanelRedirect({ error: 'Não foi possível atualizar a umidade alvo agora.' }));
  }
});

router.get('/admin/bateladas', canAccessAdminPanel, async (req, res) => {
  try {
    const batches = await listCompletedDryerBatches();
    return renderAdminBatchesPage(res, { batches });
  } catch (error) {
    console.error('Error listing dryer batches:', error.message);
    return res.status(500).send('Não foi possível carregar as bateladas anteriores agora.');
  }
});

router.get('/admin/bateladas/:id', canAccessAdminPanel, async (req, res) => {
  try {
    const batch = await getDryerBatchById(req.params.id);

    if (!batch || batch.status === 'active') {
      return res.status(404).send('Batelada não encontrada.');
    }

    const readings = await listDryerMoistureReadings(batch.id);
    return renderAdminBatchDetailPage(res, { batch, readings });
  } catch (error) {
    console.error('Error loading dryer batch detail:', error.message);
    return res.status(500).send('Não foi possível carregar a batelada agora.');
  }
});

function buildAdminRedirect(params) {
  return buildRedirect('/admin/usuarios', params);
}

router.get('/admin/usuarios', requireRoot, async (req, res) => {
  try {
    const users = await listManagedUsers();
    return renderAdminUsersPage(res, {
      users,
      message: req.query.created
        ? 'Usuário criado com sucesso.'
        : req.query.deleted
          ? 'Usuário removido com sucesso.'
          : req.query.password
            ? 'Senha atualizada com sucesso.'
            : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error listing users:', error.message);
    return res.status(500).send('Não foi possível carregar os usuários agora.');
  }
});

router.post('/admin/usuarios', requireRoot, async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '').trim();

  if (!login || !password) {
    return res.redirect(buildAdminRedirect({ error: 'Informe login e senha para criar o usuário.' }));
  }

  if (!MANAGED_ROLES.includes(role)) {
    return res.redirect(buildAdminRedirect({ error: 'Selecione um perfil válido para o usuário.' }));
  }

  if (login === ROOT_LOGIN) {
    return res.redirect(buildAdminRedirect({ error: 'O login root já é reservado pelo sistema.' }));
  }

  try {
    await createManagedUser({ login, password, role });
    return res.redirect(buildAdminRedirect({ created: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildAdminRedirect({ error: 'Já existe um usuário com esse login.' }));
    }

    console.error('Error creating user:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível criar o usuário agora.' }));
  }
});

router.post('/admin/usuarios/:id/senha', requireRoot, async (req, res) => {
  const password = String(req.body.password || '');

  if (!password) {
    return res.redirect(buildAdminRedirect({ error: 'Informe a nova senha do usuário.' }));
  }

  try {
    await updateManagedUserPassword(req.params.id, password);
    return res.redirect(buildAdminRedirect({ password: '1' }));
  } catch (error) {
    console.error('Error updating user password:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível atualizar a senha agora.' }));
  }
});

router.post('/admin/usuarios/:id/remover', requireRoot, async (req, res) => {
  try {
    await deleteManagedUser(req.params.id, req.sessionUser.userId);
    return res.redirect(buildAdminRedirect({ deleted: '1' }));
  } catch (error) {
    console.error('Error deleting user:', error.message);
    return res.redirect(buildAdminRedirect({ error: 'Não foi possível remover o usuário agora.' }));
  }
});

module.exports = router;
