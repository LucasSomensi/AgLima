const express = require('express');
const { requireRole } = require('./auth');
const { ROLES } = require('./constants');
const {
  addDryerMoistureReading,
  getActiveDryerBatch,
  getDryerSettings,
  listDryerMoistureReadings,
  startDryerBatch,
} = require('./dryer-service');
const { renderDryerPanelPage } = require('./renderers');
const { buildRedirect, parseMoisturePercent, parseOptionalDateTime } = require('./utils');

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
          : '',
      error: req.query.error || '',
    });
  } catch (error) {
    console.error('Error loading dryer panel:', error.message);
    return res.status(500).send('Não foi possível carregar o painel do secador agora.');
  }
});

router.post('/secador/bateladas', canAccessDryer, async (req, res) => {
  const startedAt = parseOptionalDateTime(req.body.started_at);
  const grainType = ['corn', 'soy'].includes(req.body.grain_type) ? req.body.grain_type : 'corn';

  if (!startedAt) {
    return res.redirect(buildDryerRedirect({ error: 'Informe uma data e hora válidas para iniciar a batelada.' }));
  }

  try {
    await startDryerBatch({ startedAt, grainType, user: req.sessionUser });
    return res.redirect(buildDryerRedirect({ started: '1' }));
  } catch (error) {
    console.error('Error starting dryer batch:', error.message);
    return res.redirect(buildDryerRedirect({ error: 'Não foi possível iniciar a nova batelada agora.' }));
  }
});

router.post('/secador/umidades', canAccessDryer, async (req, res) => {
  const measuredAt = parseOptionalDateTime(req.body.measured_at);
  const moisturePercent = parseMoisturePercent(req.body.moisture_percent);

  if (!measuredAt) {
    return res.redirect(buildDryerRedirect({ error: 'Informe uma data e hora válidas para a medição.' }));
  }

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
