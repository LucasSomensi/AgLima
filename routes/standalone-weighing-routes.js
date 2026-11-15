const express = require('express');
const { requireRole } = require('./auth');
const { ROLES } = require('./constants');
const { buildDeletionReasonPayload } = require('./weighbridge-service');
const {
  addStandaloneWeighingSecond,
  buildStandaloneWeighingEditPayload,
  buildStandaloneWeighingPayload,
  buildStandaloneWeighingSecondPayload,
  createStandaloneWeighing,
  deleteStandaloneWeighing,
  getStandaloneWeighingById,
  isStandaloneWeighingComplete,
  listStandaloneWeighings,
  updateStandaloneWeighing,
} = require('./standalone-weighing-service');
const {
  renderStandaloneWeighingDetailPage,
  renderStandaloneWeighingFormPage,
  renderStandaloneWeighingSecondFormPage,
  renderStandaloneWeighingsListPage,
} = require('./renderers/weighbridge-renderer');
const { buildStandaloneWeighingsCsv } = require('./weighbridge-csv');
const { buildStandaloneWeighingTicketPdf } = require('./weighbridge-ticket-pdf');
const { getWeighbridgeNavigation, linkWeightPhoto, loadLinkedPhotos } = require('./weighbridge-route-helpers');
const { buildRedirect, paginateItems } = require('./utils');

// Pesagens avulsas da balança (/balanca/avulsas). O fluxo segue o das saídas:
// a pesagem 1 cria o registro, a pesagem 2 completa e libera o ticket. Não há
// contrato, classificação nem divisão.

const router = express.Router();
const canAccessWeighbridge = requireRole(ROLES.WEIGHBRIDGE_OPERATOR, ROLES.ADMIN);
const NOT_FOUND_MESSAGE = 'Pesagem avulsa não encontrada.';

function homeRedirect(params = {}) {
  return buildRedirect('/balanca', params);
}

function detailPath(id) {
  return `/balanca/avulsas/${encodeURIComponent(id)}`;
}

router.get('/balanca/avulsas', canAccessWeighbridge, async (req, res) => {
  try {
    const allWeighings = await listStandaloneWeighings();
    const pagination = paginateItems(allWeighings, req.query.pagina);
    return renderStandaloneWeighingsListPage(res, {
      weighings: pagination.items,
      pagination,
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error listing standalone weighings:', error.code || error.message);
    return res.status(500).send('Não foi possível listar as pesagens avulsas agora.');
  }
});

router.get('/balanca/avulsas.csv', canAccessWeighbridge, async (req, res) => {
  try {
    const weighings = await listStandaloneWeighings({ order: 'asc' });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pesagens-avulsas-balanca.csv"');
    return res.send(buildStandaloneWeighingsCsv(weighings));
  } catch (error) {
    console.error('Error exporting standalone weighings CSV:', error.code || error.message);
    return res.status(500).send('Não foi possível exportar as pesagens avulsas agora.');
  }
});

router.get('/balanca/avulsas/nova', canAccessWeighbridge, (req, res) => renderStandaloneWeighingFormPage(res, {
  formValues: {},
  error: req.query.error || '',
  navigation: getWeighbridgeNavigation(req),
}));

router.post('/balanca/avulsas', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildStandaloneWeighingPayload(req.body);

  if (error) {
    return renderStandaloneWeighingFormPage(res, {
      formValues: req.body,
      error,
      navigation: getWeighbridgeNavigation(req),
    });
  }

  try {
    const created = await createStandaloneWeighing(payload, req.sessionUser.userId);
    await linkWeightPhoto(req, { pesagemAvulsaId: created.id, tipoPeso: 'pesagem_1', pesoKg: payload.pesagem1Kg });
    return res.redirect(homeRedirect({ avulsa_criada: '1' }));
  } catch (error) {
    console.error('Error creating standalone weighing:', error.code || error.message);
    return renderStandaloneWeighingFormPage(res, {
      formValues: req.body,
      error: 'Não foi possível adicionar a pesagem avulsa agora.',
      navigation: getWeighbridgeNavigation(req),
    });
  }
});

router.get('/balanca/avulsas/:id/pesagem-2', canAccessWeighbridge, async (req, res) => {
  try {
    const weighing = await getStandaloneWeighingById(req.params.id);

    if (!weighing) {
      return res.redirect(homeRedirect({ error: NOT_FOUND_MESSAGE }));
    }

    if (weighing.pesagem_2_kg !== null && weighing.pesagem_2_kg !== undefined) {
      return res.redirect(buildRedirect(detailPath(weighing.id), { error: 'Esta pesagem avulsa já possui a pesagem 2.' }));
    }

    return renderStandaloneWeighingSecondFormPage(res, {
      weighing,
      formValues: {},
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading standalone weighing second form:', error.code || error.message);
    return res.redirect(homeRedirect({ error: 'Não foi possível carregar a pesagem 2 agora.' }));
  }
});

router.post('/balanca/avulsas/:id/pesagem-2', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildStandaloneWeighingSecondPayload(req.body);

  try {
    const weighing = await getStandaloneWeighingById(req.params.id);

    if (!weighing) {
      return res.redirect(homeRedirect({ error: NOT_FOUND_MESSAGE }));
    }

    if (error) {
      return renderStandaloneWeighingSecondFormPage(res, {
        weighing,
        formValues: req.body,
        error,
        navigation: getWeighbridgeNavigation(req),
      });
    }

    const updated = await addStandaloneWeighingSecond(req.params.id, payload, req.sessionUser);

    if (!updated) {
      return res.redirect(buildRedirect(detailPath(weighing.id), { error: 'Esta pesagem avulsa já possui a pesagem 2.' }));
    }

    await linkWeightPhoto(req, { pesagemAvulsaId: updated.id, tipoPeso: 'pesagem_2', pesoKg: payload.pesagem2Kg });
    // Volta para a página inicial, como as demais pesagens; o ticket fica na
    // lista de últimas pesagens avulsas e no detalhe.
    return res.redirect(homeRedirect({ avulsa_pesagem_2_adicionada: '1' }));
  } catch (error) {
    console.error('Error adding standalone weighing second weight:', error.code || error.message);
    return res.redirect(homeRedirect({ error: 'Não foi possível adicionar a pesagem 2 agora.' }));
  }
});

router.get('/balanca/avulsas/:id/ticket.pdf', canAccessWeighbridge, async (req, res) => {
  try {
    const weighing = await getStandaloneWeighingById(req.params.id);

    if (!weighing) {
      return res.redirect(homeRedirect({ error: NOT_FOUND_MESSAGE }));
    }

    if (!isStandaloneWeighingComplete(weighing)) {
      return res.redirect(buildRedirect(detailPath(weighing.id), {
        error: 'O ticket só fica disponível depois da pesagem 2.',
      }));
    }

    const pdfBuffer = await buildStandaloneWeighingTicketPdf(weighing);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ticket-pesagem-avulsa-${weighing.id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating standalone weighing ticket PDF:', error.code || error.message);
    return res.redirect(buildRedirect(detailPath(req.params.id), {
      error: 'Não foi possível gerar o ticket de pesagem agora.',
    }));
  }
});

router.post('/balanca/avulsas/:id/deletar', canAccessWeighbridge, async (req, res) => {
  const { payload, error } = buildDeletionReasonPayload(req.body);

  if (error) {
    return res.redirect(buildRedirect(detailPath(req.params.id), { error }));
  }

  try {
    await deleteStandaloneWeighing(req.params.id, req.sessionUser, payload.motivoDelecao);
    return res.redirect(homeRedirect({ avulsa_deletada: '1' }));
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      return res.redirect(homeRedirect({ error: NOT_FOUND_MESSAGE }));
    }

    console.error('Error deleting standalone weighing:', error.code || error.message);
    return res.redirect(buildRedirect(detailPath(req.params.id), {
      error: 'Não foi possível deletar a pesagem avulsa agora.',
    }));
  }
});

router.post('/balanca/avulsas/:id', canAccessWeighbridge, async (req, res) => {
  const weighing = await getStandaloneWeighingById(req.params.id).catch(() => null);

  if (!weighing) {
    return res.redirect(homeRedirect({ error: NOT_FOUND_MESSAGE }));
  }

  const { payload, error } = buildStandaloneWeighingEditPayload(req.body);
  const renderWithError = async (message) => renderStandaloneWeighingDetailPage(res, {
    weighing,
    photos: await loadLinkedPhotos({ pesagemAvulsaId: weighing.id }),
    formValues: req.body,
    error: message,
    navigation: getWeighbridgeNavigation(req),
  });

  if (error) {
    return renderWithError(error);
  }

  try {
    const updated = await updateStandaloneWeighing(req.params.id, payload, req.sessionUser);

    if (!updated) {
      return res.redirect(homeRedirect({ error: NOT_FOUND_MESSAGE }));
    }

    return res.redirect(buildRedirect(detailPath(updated.id), { avulsa_editada: '1' }));
  } catch (error) {
    console.error('Error updating standalone weighing:', error.code || error.message);
    return renderWithError('Não foi possível atualizar a pesagem avulsa agora.');
  }
});

router.get('/balanca/avulsas/:id', canAccessWeighbridge, async (req, res) => {
  try {
    const weighing = await getStandaloneWeighingById(req.params.id);

    if (!weighing) {
      return res.redirect(homeRedirect({ error: NOT_FOUND_MESSAGE }));
    }

    const photos = await loadLinkedPhotos({ pesagemAvulsaId: weighing.id });

    return renderStandaloneWeighingDetailPage(res, {
      weighing,
      photos,
      message: req.query.avulsa_editada ? 'Pesagem avulsa atualizada com sucesso.' : '',
      error: req.query.error || '',
      navigation: getWeighbridgeNavigation(req),
    });
  } catch (error) {
    console.error('Error loading standalone weighing detail:', error.code || error.message);
    return res.redirect(homeRedirect({ error: 'Não foi possível carregar a pesagem avulsa agora.' }));
  }
});

module.exports = router;
