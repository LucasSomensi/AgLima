const crypto = require('crypto');
const express = require('express');
const {
  buildScaleWeightPayload,
  saveCurrentScaleWeight,
  SCALE_ONE_ID,
} = require('./scale-reading-service');
const {
  buildAutomaticPhotoPayload,
  buildWeightWithPhotoPayload,
  saveAutomaticPhoto,
  saveCurrentWeightWithPhoto,
} = require('./scale-photo-service');
const { MAX_PHOTO_BYTES } = require('./scale-photo-storage');

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

// Fotos chegam como corpo binário image/jpeg; os metadados vão em cabeçalhos.
// O parser só é aplicado nestas rotas, e o limite global de 100 KB continua
// valendo para o restante da aplicação.
const parseJpegBody = express.raw({ type: 'image/jpeg', limit: MAX_PHOTO_BYTES });

function requireJpegBody(req, res, next) {
  if (!req.is('image/jpeg') || !Buffer.isBuffer(req.body)) {
    return res.status(415).json({ error: 'Envie a foto com Content-Type image/jpeg.' });
  }

  return next();
}

function sendPhotoStorageError(res, error, context) {
  console.error(`${context}:`, error.code || error.message);

  if (error.code === 'ENOSPC') {
    return res.status(507).json({ error: 'Sem espaço no volume de fotos.' });
  }

  return res.status(500).json({ error: 'Não foi possível salvar a foto da balança.' });
}

router.post('/api/balancas/1/peso-com-foto', requireScaleApiKey, parseJpegBody, requireJpegBody, async (req, res) => {
  const { payload, error } = buildWeightWithPhotoPayload({ headers: req.headers, body: req.body });

  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const reading = await saveCurrentWeightWithPhoto(SCALE_ONE_ID, payload);
    return res.status(200).json({
      balanca_id: reading.balanca_id,
      peso_kg: reading.peso_kg,
      atualizado_em: reading.atualizado_em,
      foto: true,
    });
  } catch (saveError) {
    return sendPhotoStorageError(res, saveError, 'Error saving current scale weight with photo');
  }
});

router.put('/api/balancas/1/fotos/automaticas/:chave', requireScaleApiKey, parseJpegBody, requireJpegBody, async (req, res) => {
  const { payload, error } = buildAutomaticPhotoPayload({ key: req.params.chave, headers: req.headers, body: req.body });

  if (error) {
    return res.status(400).json({ error });
  }

  try {
    const { created, photo } = await saveAutomaticPhoto(SCALE_ONE_ID, payload);
    return res.status(created ? 201 : 200).json({
      id: photo.id,
      chave: photo.chave_cliente,
      peso_kg: photo.peso_kg,
      capturada_em: photo.capturada_em,
      recebida_em: photo.recebida_em,
      contingencia: photo.contingencia,
      status: photo.status,
    });
  } catch (saveError) {
    return sendPhotoStorageError(res, saveError, 'Error saving automatic scale photo');
  }
});

module.exports = {
  requireScaleApiKey,
  router,
};
