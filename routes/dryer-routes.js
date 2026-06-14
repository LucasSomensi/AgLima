const express = require('express');
const { requireRole } = require('./auth');
const { ROLES } = require('./constants');
const {
  addDryerMoistureReading,
  getActiveDryerBatch,
  getDryerSettings,
  listDryerMoistureReadings,
  startDryerBatch,
  startDryerBatchDischarge,
  stopDryerBatch,
} = require('./dryer-service');
const { renderDryerPanelPage } = require('./renderers/dryer-renderer');
const { buildRedirect, parseMoisturePercent } = require('./utils');

const router = express.Router();
const canAccessDryer = requireRole(ROLES.SILO_OPERATOR, ROLES.ROOT);

function buildDryerRedirect(params) {
  return buildRedirect('/secador', params);
}

router.get('/secador', canAccessDryer, async (req, res) => {
  try {
    const [settings, batch] = await Promise.all([getDryerSettings(), getActiveDryerBatch()]);
    const readings = await listDryerMoistureReadings(batch?.id);

    return renderDryerPanelPage(res, {
      batch,
      readings,
      settings,
      message: req.query.started
        ? 'Nova batelada iniciada com sucesso.'
        : req.query.reading
          ? 'Medição de umidade registrada com sucesso.'
          : req.query.discharge
            ? 'Início da descarga registrado com sucesso.'
            : req.query.stopped
              ? 'Secador parado com sucesso.'
              : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading dryer panel:', error.message);
    return res.status(500).send('Não foi possível carregar o painel do secador agora.');
  }
});

router.post('/secador/bateladas', canAccessDryer, async (req, res) => {
  const startedAt = new Date();
  const grainType = 'corn';

  try {
    await startDryerBatch({ startedAt, grainType, user: req.sessionUser });
    return res.redirect(buildDryerRedirect({ started: '1' }));
  } catch (error) {
    if (error.code === 'DISCHARGE_NOT_STARTED') {
      return res.redirect(buildDryerRedirect({ error: error.message }));
    }

    console.error('Error starting dryer batch:', error.message);
    return res.redirect(buildDryerRedirect({ error: 'Não foi possível iniciar a nova batelada agora.' }));
  }
});

router.post('/secador/bateladas/descarga', canAccessDryer, async (req, res) => {
  const dischargeStartedAt = new Date();

  try {
    await startDryerBatchDischarge({ dischargeStartedAt });
    return res.redirect(buildDryerRedirect({ discharge: '1' }));
  } catch (error) {
    if (error.code === 'NO_ACTIVE_BATCH' || error.code === 'DISCHARGE_ALREADY_STARTED') {
      return res.redirect(buildDryerRedirect({ error: error.message }));
    }

    console.error('Error starting dryer discharge:', error.message);
    return res.redirect(buildDryerRedirect({ error: 'Não foi possível iniciar a descarga agora.' }));
  }
});

router.post('/secador/bateladas/parar', canAccessDryer, async (req, res) => {
  const stoppedAt = new Date();

  try {
    await stopDryerBatch({ stoppedAt, user: req.sessionUser });
    return res.redirect(buildDryerRedirect({ stopped: '1' }));
  } catch (error) {
    if (error.code === 'NO_ACTIVE_BATCH') {
      return res.redirect(buildDryerRedirect({ error: error.message }));
    }

    console.error('Error stopping dryer batch:', error.message);
    return res.redirect(buildDryerRedirect({ error: 'Não foi possível parar o secador agora.' }));
  }
});

router.post('/secador/umidades', canAccessDryer, async (req, res) => {
  const measuredAt = new Date();
  const moisturePercent = parseMoisturePercent(req.body.moisture_percent);

  if (moisturePercent === null) {
    return res.redirect(buildDryerRedirect({ error: 'Informe uma umidade entre 7,0% e 40,0%, com no máximo uma casa decimal.' }));
  }

  try {
    await addDryerMoistureReading({ measuredAt, moisturePercent, user: req.sessionUser });
    return res.redirect(buildDryerRedirect({ reading: '1' }));
  } catch (error) {
    if (error.code === 'NO_ACTIVE_BATCH') {
      return res.redirect(buildDryerRedirect({ error: error.message }));
    }

    console.error('Error adding dryer moisture reading:', error.message);
    return res.redirect(buildDryerRedirect({ error: 'Não foi possível registrar a umidade agora.' }));
  }
});

module.exports = router;
