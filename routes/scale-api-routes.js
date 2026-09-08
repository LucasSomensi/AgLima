const crypto = require('crypto');
const express = require('express');
const {
  buildScaleWeightPayload,
  saveCurrentScaleWeight,
  SCALE_ONE_ID,
} = require('./scale-reading-service');

const router = express.Router();

function safeCompare(value, expectedValue) {
  const valueBuffer = Buffer.from(String(value || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expectedValue || ''), 'utf8');

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function requireScaleApiKey(req, res, next) {
  const configuredKey = process.env.api_key;

  if (!configuredKey) {
    console.error('Missing api_key environment variable for scale API.');
    return res.status(503).json({ error: 'API da balança não configurada.' });
  }

  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer (.+)$/);

  if (!match || !safeCompare(match[1], configuredKey)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'Chave de API inválida ou ausente.' });
  }

  return next();
}

router.post('/api/balancas/1/peso', requireScaleApiKey, async (req, res) => {
  const { payload, error } = buildScaleWeightPayload(req.body);

  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const reading = await saveCurrentScaleWeight(SCALE_ONE_ID, payload.pesoKg);
    return res.status(200).json({
      balanca_id: reading.balanca_id,
      peso_kg: reading.peso_kg,
      atualizado_em: reading.atualizado_em,
    });
  } catch (saveError) {
    console.error('Error saving current scale weight:', saveError.message);
    return res.status(500).json({ error: 'Não foi possível salvar o peso da balança.' });
  }
});

module.exports = {
  requireScaleApiKey,
  router,
};
