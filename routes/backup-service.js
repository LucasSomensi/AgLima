const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ensureDatabaseConfigured, pool } = require('./database');

const BACKUP_INTERVAL_MS = 10 * 24 * 60 * 60 * 1000;
const BACKUP_TIMEOUT_MS = 5 * 60 * 1000;
const LOCK_ID = 173428091;

function buildBackupNotification(lastDelivery, now = new Date()) {
  const elapsed = lastDelivery ? now.getTime() - new Date(lastDelivery).getTime() : null;
  if (elapsed !== null && elapsed < BACKUP_INTERVAL_MS) return null;
  return {
    type: 'backup_due',
    daysSinceBackup: elapsed === null ? null : Math.floor(elapsed / 86400000),
    actionPath: '/admin/backup',
  };
}

async function getBackupNotification() {
  ensureDatabaseConfigured();
  try {
    const { rows } = await pool.query('SELECT MAX(delivered_at) AS last_delivery FROM public.database_backups');
    return buildBackupNotification(rows[0].last_delivery);
  } catch (error) {
    // Keep the existing dashboard available during deployment before the migration.
    if (error.code === '42P01') return null;
    throw error;
  }
}

// Pass credentials through the child environment, never through command arguments.
function buildDumpEnvironment(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database URL');
  const env = {
    PATH: process.env.PATH,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'agrolima-backup',
    PGSSLMODE: url.searchParams.get('sslmode') || 'prefer',
  };
  for (const [param, variable] of Object.entries({ sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY' })) {
    if (url.searchParams.has(param)) env[variable] = url.searchParams.get(param);
  }
  return env;
}

function runProcess(command, args, { signal, spawnProcess = spawn, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Backup cancelled'));
    const child = spawnProcess(command, args, { env, stdio: ['ignore', 'ignore', 'ignore'] });
    let cancelled = false;
    const cancel = () => { cancelled = true; child.kill('SIGKILL'); };
    const timeout = setTimeout(cancel, BACKUP_TIMEOUT_MS);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const dispose = () => { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); };
    child.once('error', () => { dispose(); reject(new Error('Não foi possível executar a ferramenta de backup. Verifique a instalação.')); });
    child.once('close', (code) => {
      dispose();
      if (cancelled || code !== 0) return reject(new Error('Não foi possível concluir o backup dentro do prazo.'));
      resolve();
    });
  });
}

function runDump(filePath, { signal, snapshot, spawnProcess } = {}) {
  if (!snapshot) throw new Error('Backup snapshot is required');
  return runProcess(process.env.PG_DUMP_PATH || 'pg_dump', [
    '--format=custom', '--no-owner', '--no-privileges', '--no-password',
    '--exclude-table-data-and-children=public.users', '--lock-wait-timeout=10000',
    `--snapshot=${snapshot}`, '--file', filePath,
  ], { signal, spawnProcess, env: buildDumpEnvironment(process.env.DATABASE_URL) });
}

async function exportUsers(client, filePath, signal) {
  // Discover columns, but never select password_hash into the application.
  const { rows: columns } = await client.query(`SELECT attname FROM pg_attribute
    WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname <> 'password_hash' ORDER BY attnum`);
  if (!columns.length) throw new Error('Users columns not found');
  const projection = columns.map(({ attname }) => `"${attname.replace(/"/g, '""')}"`).join(', ');
  await client.query(`DECLARE backup_users NO SCROLL CURSOR FOR
    SELECT row_to_json(exported) AS data FROM (SELECT ${projection} FROM public.users) exported`);
  const file = await fs.open(filePath, 'wx', 0o600);
  try {
    await file.write('[\n');
    let first = true;
    while (true) {
      if (signal?.aborted) throw new Error('Backup cancelled');
      const { rows } = await client.query('FETCH FORWARD 500 FROM backup_users');
      if (!rows.length) break;
      for (const { data } of rows) {
        await file.write(`${first ? '' : ',\n'}${JSON.stringify(data)}`);
        first = false;
      }
    }
    await file.write('\n]\n');
  } finally { await file.close(); }
  await client.query('CLOSE backup_users');
}

function packageBackup(directory, filePath, { signal } = {}) {
  return runProcess('tar', ['-czf', filePath, '-C', directory, 'database.dump', 'users.json', 'LEIA-ME.txt'], { signal });
}

async function createBackup({ signal, dump = runDump, pack = packageBackup } = {}) {
  ensureDatabaseConfigured();
  const client = await pool.connect();
  let directory;
  let locked = false;
  let cleaned = false;
  let transaction = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    } finally {
      try {
        if (transaction) await client.query('ROLLBACK');
        if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
        client.release();
      } catch (error) {
        client.release(error);
      }
    }
  }
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID]);
    locked = result.rows[0].locked;
    if (!locked) {
      const error = new Error('Já existe um backup em andamento. Aguarde e tente novamente.');
      error.code = 'BACKUP_BUSY';
      throw error;
    }
    // Fail before generating/downloading if the migration has not been installed.
    await client.query('SELECT id FROM public.database_backups LIMIT 0');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agrolima-backup-'));
    const startedAt = new Date();
    const fileName = `agrolima-sem-senhas-${startedAt.toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    const filePath = path.join(directory, fileName);
    const dumpPath = path.join(directory, 'database.dump');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query('LOCK TABLE public.users IN ACCESS SHARE MODE');
    const { rows: snapshots } = await client.query('SELECT pg_export_snapshot() AS snapshot');
    await exportUsers(client, path.join(directory, 'users.json'), signal);
    await dump(dumpPath, { signal, snapshot: snapshots[0].snapshot });
    await client.query('COMMIT');
    transaction = false;
    if (signal?.aborted) throw new Error('Backup cancelled');
    const { size: dumpSize } = await fs.stat(dumpPath);
    const file = await fs.open(dumpPath, 'r');
    try {
      const signature = Buffer.alloc(5);
      await file.read(signature, 0, 5, 0);
      if (signature.toString() !== 'PGDMP' || dumpSize <= 5) throw new Error('Invalid backup archive');
    } finally { await file.close(); }
    await fs.writeFile(path.join(directory, 'LEIA-ME.txt'),
      `AgroLima — backup gerado em ${startedAt.toISOString()}\n` +
      'database.dump: estrutura e dados do banco, sem os registros de public.users.\n' +
      'users.json: registros de public.users, sem a coluna password_hash.\n' +
      'Os dois arquivos representam o mesmo snapshot. Nenhuma senha foi alterada na origem.\n' +
      'A restauração requer tratamento dos usuários sem senha e não é automatizada.\n' +
      'Guarde este arquivo com segurança: contém dados pessoais e comerciais.\n', { mode: 0o600 });
    await pack(directory, filePath, { signal });
    if (signal?.aborted) throw new Error('Backup cancelled');
    const { size } = await fs.stat(filePath);
    if (!size) throw new Error('Empty backup archive');
    await fs.chmod(filePath, 0o600);
    return {
      filePath, fileName, cleanup,
      async recordDelivery(userId) {
        await client.query(`INSERT INTO public.database_backups
          (snapshot_started_at, requested_by_user_id, file_name, size_bytes)
          VALUES ($1, $2, $3, $4)`, [startedAt, userId, fileName, size]);
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

module.exports = { buildBackupNotification, getBackupNotification, createBackup, buildDumpEnvironment, runDump, exportUsers };
