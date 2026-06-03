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
  getContractById,
  getSellerById,
  listBuyers,
  listContracts,
  listSellers,
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
  renderAdminDashboardPage,
  renderAdminHomePage,
  renderAdminUsersPage,
  renderConstructionPage,
} = require('./renderers');
const {
  createManagedUser,
  deleteManagedUser,
  listManagedUsers,
  updateManagedUserPassword,
} = require('./user-service');
const { buildRedirect, parseMoisturePercent } = require('./utils');

const router = express.Router();

const canAccessAdminPanel = requireRole(ROLES.ADMIN);

function buildAdminPanelRedirect(params) {
  return buildRedirect('/admin/secador', params);
}

router.get('/admin', canAccessAdminPanel, (req, res) => {
  return renderAdminHomePage(res);
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

router.get('/admin/:module(armazenamento|entradas-e-saidas)', canAccessAdminPanel, (req, res) => {
  const moduleContent = {
    armazenamento: {
      title: 'Armazenamento',
      description: 'O módulo de armazenamento está em construção e ficará disponível em breve.',
    },
    'entradas-e-saidas': {
      title: 'Entradas e Saídas',
      description: 'O módulo de entradas e saídas está em construção e ficará disponível em breve.',
    },
  };

  return renderConstructionPage(res, ROLES.ADMIN, {
    eyebrow: 'Área administrativa',
    backHref: '/admin',
    backLabel: '← Voltar à administração',
    ...moduleContent[req.params.module],
  });
});

function buildContractsRedirect(params = {}) {
  return buildRedirect('/admin/contratos', params);
}

function normalizeContractStatusFilter(value) {
  return value === 'todos' ? 'todos' : 'abertos';
}

async function loadContractsPage(req, res, overrides = {}) {
  const contractStatusFilter = normalizeContractStatusFilter(req.query.status);
  const [buyers, sellers, contracts, selectedBuyer, selectedSeller, selectedContract] = await Promise.all([
    listBuyers(),
    listSellers(),
    listContracts({ status: contractStatusFilter }),
    req.query.comprador_id ? getBuyerById(req.query.comprador_id) : null,
    req.query.vendedor_id ? getSellerById(req.query.vendedor_id) : null,
    req.query.contrato_id ? getContractById(req.query.contrato_id) : null,
  ]);

  return renderAdminContractsPage(res, {
    buyers,
    sellers,
    contracts,
    selectedBuyer,
    selectedSeller,
    selectedContract,
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

router.post('/admin/contratos/compradores', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildBuyerPayload(req.body);

  if (error) {
    return res.redirect(buildContractsRedirect({ error }));
  }

  try {
    await createBuyer(payload);
    return res.redirect(buildContractsRedirect({ comprador_criado: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildContractsRedirect({ error: 'Já existe um comprador com esse nome.' }));
    }

    console.error('Error creating buyer:', error.message);
    return res.redirect(buildContractsRedirect({ error: 'Não foi possível adicionar o comprador agora.' }));
  }
});

router.post('/admin/contratos/compradores/:id', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildBuyerPayload(req.body);

  if (error) {
    return res.redirect(buildContractsRedirect({ comprador_id: req.params.id, error }));
  }

  try {
    await updateBuyer(req.params.id, payload);
    return res.redirect(buildContractsRedirect({ comprador_atualizado: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildContractsRedirect({ comprador_id: req.params.id, error: 'Já existe um comprador com esse nome.' }));
    }

    console.error('Error updating buyer:', error.message);
    return res.redirect(buildContractsRedirect({ comprador_id: req.params.id, error: 'Não foi possível atualizar o comprador agora.' }));
  }
});

router.post('/admin/contratos/vendedores', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildSellerPayload(req.body);

  if (error) {
    return res.redirect(buildContractsRedirect({ error }));
  }

  try {
    await createSeller(payload);
    return res.redirect(buildContractsRedirect({ vendedor_criado: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildContractsRedirect({ error: 'Já existe um vendedor com esse nome.' }));
    }

    console.error('Error creating seller:', error.message);
    return res.redirect(buildContractsRedirect({ error: 'Não foi possível adicionar o vendedor agora.' }));
  }
});

router.post('/admin/contratos/vendedores/:id', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildSellerPayload(req.body);

  if (error) {
    return res.redirect(buildContractsRedirect({ vendedor_id: req.params.id, error }));
  }

  try {
    await updateSeller(req.params.id, payload);
    return res.redirect(buildContractsRedirect({ vendedor_atualizado: '1' }));
  } catch (error) {
    if (error.code === '23505') {
      return res.redirect(buildContractsRedirect({ vendedor_id: req.params.id, error: 'Já existe um vendedor com esse nome.' }));
    }

    console.error('Error updating seller:', error.message);
    return res.redirect(buildContractsRedirect({ vendedor_id: req.params.id, error: 'Não foi possível atualizar o vendedor agora.' }));
  }
});

router.post('/admin/contratos/contratos', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildContractPayload(req.body);

  if (error) {
    return res.redirect(buildContractsRedirect({ error }));
  }

  try {
    await createContract(payload);
    return res.redirect(buildContractsRedirect({ contrato_criado: '1' }));
  } catch (error) {
    console.error('Error creating contract:', error.message);
    return res.redirect(buildContractsRedirect({ error: 'Não foi possível adicionar o contrato agora. Confira comprador e vendedor.' }));
  }
});

router.post('/admin/contratos/contratos/:id', canAccessAdminPanel, async (req, res) => {
  const { payload, error } = buildContractPayload(req.body);

  if (error) {
    return res.redirect(buildContractsRedirect({ contrato_id: req.params.id, error }));
  }

  try {
    await updateContract(req.params.id, payload);
    return res.redirect(buildContractsRedirect({ contrato_atualizado: '1' }));
  } catch (error) {
    console.error('Error updating contract:', error.message);
    return res.redirect(buildContractsRedirect({ contrato_id: req.params.id, error: 'Não foi possível atualizar o contrato agora. Confira comprador e vendedor.' }));
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
