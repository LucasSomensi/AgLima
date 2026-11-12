const { cleanupScalePhotos } = require('./scale-photo-service');
const { checkPhotosDirWritable } = require('./scale-photo-storage');

const FIRST_RUN_DELAY_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function runScalePhotoCleanup() {
  try {
    const result = await cleanupScalePhotos();
    const total = result.expiredCaptures + result.expiredAutomatic + result.prunedCurrent;

    if (total > 0) {
      console.log(
        `Fotos da balança: ${result.expiredCaptures} captura(s) temporária(s) vencida(s), `
        + `${result.expiredAutomatic} foto(s) automática(s) fora da retenção e `
        + `${result.prunedCurrent} sobra(s) da foto atual removida(s).`
      );
    }
  } catch (error) {
    console.error('Fotos da balança: falha na limpeza periódica:', error.code || error.message);
  }
}

// Verifica o volume ao iniciar e agenda a limpeza. Os timers não seguram o
// processo aberto (unref), então não atrapalham o encerramento do servidor.
function startScalePhotoMaintenance() {
  if (!process.env.DATABASE_URL) {
    return;
  }

  checkPhotosDirWritable();
  setTimeout(runScalePhotoCleanup, FIRST_RUN_DELAY_MS).unref();
  setInterval(runScalePhotoCleanup, CLEANUP_INTERVAL_MS).unref();
}

module.exports = {
  runScalePhotoCleanup,
  startScalePhotoMaintenance,
};
