const { ROLES } = require('./constants');
const { linkCaptureToRecord, listLinkedPhotos } = require('./scale-photo-service');

// Confirma a foto temporária criada pelos botões "usar peso da balança" ou
// "usar foto automática". Falhas aqui nunca desfazem o lançamento: no pior
// caso o peso fica sem foto e a captura temporária é descartada pela limpeza
// periódica.
async function linkWeightPhoto(req, { entradaId = null, saidaId = null, pesagemAvulsaId = null, tipoPeso, pesoKg }) {
  const captureId = String(req.body?.foto_captura_id || '').trim();

  if (!captureId) {
    return null;
  }

  try {
    return await linkCaptureToRecord({
      captureId,
      userId: req.sessionUser.userId,
      entradaId,
      saidaId,
      pesagemAvulsaId,
      tipoPeso,
      pesoKg,
    });
  } catch (error) {
    console.error('Error linking scale photo:', error.code || error.message);
    return null;
  }
}

async function loadLinkedPhotos(filter) {
  try {
    return await listLinkedPhotos(filter);
  } catch (error) {
    console.error('Error loading scale photos:', error.code || error.message);
    return [];
  }
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

module.exports = {
  getWeighbridgeNavigation,
  linkWeightPhoto,
  loadLinkedPhotos,
};
