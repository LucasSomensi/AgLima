const backupService = require('./backup-service');

async function downloadBackup(req, res) {
  const controller = new AbortController();
  const onClose = () => { if (!res.writableFinished) controller.abort(); };
  res.on('close', onClose);
  let backup;
  try {
    backup = await backupService.createBackup({ signal: controller.signal });
    if (controller.signal.aborted) return;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await new Promise((resolve, reject) => {
      res.download(backup.filePath, backup.fileName, (error) => error ? reject(error) : resolve());
    });
    if (!controller.signal.aborted) await backup.recordDelivery(req.sessionUser.userId);
  } catch (error) {
    // Errors from libpq/pg_dump may contain connection details; never log them.
    console.error('Database backup was not completed.');
    if (!res.headersSent && !res.destroyed) {
      const message = error.code === 'BACKUP_BUSY'
        ? 'Já existe um backup em andamento. Aguarde e tente novamente.'
        : 'Não foi possível concluir o backup. Tente novamente ou contate o responsável pelo sistema.';
      res.redirect(`/admin?error=${encodeURIComponent(message)}`);
    } else if (!res.writableFinished && !res.destroyed) {
      res.destroy();
    }
  } finally {
    res.removeListener('close', onClose);
    if (backup) {
      try { await backup.cleanup(); }
      catch { console.error('Database backup cleanup failed.'); }
    }
  }
}

module.exports = { downloadBackup };
