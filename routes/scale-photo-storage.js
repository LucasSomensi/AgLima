const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_PHOTOS_DIR = '/app/fotos';
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const CONTINGENCY_MARKER = Buffer.from('AutoWeight:contingencia', 'latin1');
const CONTINGENCY_SCAN_BYTES = 512;
// Pastas do volume: "atual" guarda só a foto que acompanha o peso atual;
// "capturas" guarda as fotos dos lançamentos; "automaticas", as do AutoWeight.
const CURRENT_DIR = 'atual';
const STORED_PHOTO_PATTERN = /^(automaticas|capturas)\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/;
const CURRENT_PHOTO_PATTERN = /^atual\/[0-9a-f-]{36}\.jpg$/;

function getPhotosDir() {
  return path.resolve(process.env.FOTOS_DIR || DEFAULT_PHOTOS_DIR);
}

function photoError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Aceita somente JPEG completo: começa com SOI (FF D8 FF) e termina com EOI
// (FF D9), tolerando alguns bytes de preenchimento depois do marcador final.
function isJpeg(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    return false;
  }

  const tailStart = Math.max(2, buffer.length - 32);
  return buffer.subarray(tailStart).lastIndexOf(Buffer.from([0xff, 0xd9])) !== -1;
}

function validatePhotoBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return 'Envie a foto como corpo binário com Content-Type image/jpeg.';
  }

  if (buffer.length > MAX_PHOTO_BYTES) {
    return 'A foto excede 8 MB.';
  }

  if (!isJpeg(buffer)) {
    return 'O corpo enviado não é um JPEG válido.';
  }

  return null;
}

// A imagem de contingência do AutoWeight (câmera indisponível) carrega um
// comentário JPEG com este marcador logo no início do arquivo.
function isContingencyPhoto(buffer) {
  return buffer.subarray(0, CONTINGENCY_SCAN_BYTES).includes(CONTINGENCY_MARKER);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildStoredPhotoPath(kind, date = new Date()) {
  if (kind !== 'automaticas' && kind !== 'capturas') {
    throw new Error(`Tipo de pasta de foto inválido: ${kind}`);
  }

  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${kind}/${year}/${month}/${crypto.randomUUID()}.jpg`;
}

function buildCurrentPhotoPath() {
  return `${CURRENT_DIR}/${crypto.randomUUID()}.jpg`;
}

// Converte o caminho relativo gravado no banco em caminho absoluto, aceitando
// apenas os formatos gerados pelo próprio servidor. Nenhum nome vindo do
// cliente chega ao sistema de arquivos.
function resolvePhotoPath(relativePath) {
  const value = String(relativePath || '');

  if (!STORED_PHOTO_PATTERN.test(value) && !CURRENT_PHOTO_PATTERN.test(value)) {
    throw photoError('INVALID_PHOTO_PATH', 'Caminho de foto inválido.');
  }

  const baseDir = getPhotosDir();
  const absolutePath = path.resolve(baseDir, value);

  if (!absolutePath.startsWith(`${baseDir}${path.sep}`)) {
    throw photoError('INVALID_PHOTO_PATH', 'Caminho de foto inválido.');
  }

  return absolutePath;
}

// Grava em arquivo temporário, força a escrita no disco e só então renomeia:
// um leitor nunca encontra uma foto pela metade.
async function writePhotoAtomically(relativePath, buffer) {
  const finalPath = resolvePhotoPath(relativePath);
  const tempPath = `${finalPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;

  await fs.mkdir(path.dirname(finalPath), { recursive: true });

  const handle = await fs.open(tempPath, 'wx');

  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function copyPhoto(sourceRelativePath, targetRelativePath) {
  const sourcePath = resolvePhotoPath(sourceRelativePath);
  const buffer = await fs.readFile(sourcePath);
  await writePhotoAtomically(targetRelativePath, buffer);
  return buffer;
}

async function deletePhotoFile(relativePath) {
  if (!relativePath) {
    return;
  }

  try {
    await fs.rm(resolvePhotoPath(relativePath), { force: true });
  } catch (error) {
    console.error('Não foi possível remover a foto da balança:', error.code || error.message);
  }
}

// Remove arquivos da pasta "atual" que não são a foto vigente nem foram
// gravados há pouco (sobras de um processo interrompido no meio da troca).
async function pruneCurrentPhotos(keepRelativePath, { olderThanMs = 60 * 60 * 1000 } = {}) {
  const currentDir = path.join(getPhotosDir(), CURRENT_DIR);
  let entries = [];

  try {
    entries = await fs.readdir(currentDir);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  const keepName = keepRelativePath ? path.basename(keepRelativePath) : null;
  const limit = Date.now() - olderThanMs;
  let removed = 0;

  for (const name of entries) {
    if (name === keepName || !/^[0-9a-f-]{36}\.jpg(\.[0-9a-f]{12}\.tmp)?$/.test(name)) {
      continue;
    }

    const filePath = path.join(currentDir, name);
    const stats = await fs.stat(filePath).catch(() => null);

    if (stats && stats.mtimeMs < limit) {
      await fs.rm(filePath, { force: true });
      removed += 1;
    }
  }

  return removed;
}

// Confere, na inicialização, se o processo consegue gravar no volume. O
// resultado vai para o log para facilitar o diagnóstico no Railway.
async function checkPhotosDirWritable() {
  const baseDir = getPhotosDir();
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'n/d';
  const probePath = path.join(baseDir, `.teste-escrita-${process.pid}`);

  try {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(probePath, 'ok');
    await fs.rm(probePath, { force: true });
    console.log(`Fotos da balança: gravando em ${baseDir} (uid ${uid}).`);
    return true;
  } catch (error) {
    console.error(`Fotos da balança: sem permissão de escrita em ${baseDir} (uid ${uid}): ${error.code || error.message}.`);
    return false;
  }
}

module.exports = {
  buildCurrentPhotoPath,
  buildStoredPhotoPath,
  checkPhotosDirWritable,
  copyPhoto,
  deletePhotoFile,
  getPhotosDir,
  isContingencyPhoto,
  isJpeg,
  MAX_PHOTO_BYTES,
  pruneCurrentPhotos,
  resolvePhotoPath,
  sha256,
  validatePhotoBuffer,
  writePhotoAtomically,
};
