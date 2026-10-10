const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = 'postgres://backup:secret%40test@example.invalid/db';
const { pool } = require('../routes/database');
const service = require('../routes/backup-service');
const { downloadBackup } = require('../routes/backup-download');
const { renderAdminHomePage } = require('../routes/renderers');

test('backup reminder: first download and exact ten-day boundary', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(service.buildBackupNotification(null, now).daysSinceBackup, null);
  assert.equal(service.buildBackupNotification('2026-09-30T12:00:01Z', now), null);
  assert.equal(service.buildBackupNotification('2026-09-30T12:00:00Z', now).daysSinceBackup, 10);
  assert.equal(service.buildBackupNotification('2026-09-28T12:00:00Z', now).daysSinceBackup, 12);
});

test('missing migration does not break dashboard', async (t) => {
  t.mock.method(pool, 'query', async () => { throw Object.assign(new Error(), { code: '42P01' }); });
  assert.equal(await service.getBackupNotification(), null);
});

test('backup notification renders protected download form without contract label', () => {
  let html;
  renderAdminHomePage({ send: (value) => { html = value; } }, {
    notifications: [service.buildBackupNotification(null)], contractsSummary: {},
    dryerBatch: null, storageSummary: [], scaleInputs: [], scaleOutputs: [],
  });
  assert.match(html, /action="\/admin\/backup"/);
  assert.match(html, /Nenhum backup foi baixado ainda/);
  assert.match(html, /sem os hashes das senhas/);
  assert.match(html, /CSRF_TOKEN/);
  assert.doesNotMatch(html, /Contrato #undefined/);
});

test('pg_dump excludes users data and uses shared snapshot; credentials only in env', async () => {
  await service.runDump('/tmp/test.dump', {
    snapshot: '00000001-00000001-1',
    spawnProcess(command, args, options) {
      assert.ok(args.includes('--exclude-table-data-and-children=public.users'));
      assert.ok(args.includes('--snapshot=00000001-00000001-1'));
      assert.equal(args.some((arg) => arg.includes('secret')), false);
      assert.equal(options.env.PGPASSWORD, 'secret@test');
      const child = new EventEmitter();
      process.nextTick(() => child.emit('close', 0));
      return child;
    },
  });
});

test('pg_dump failure and cancellation reject', async () => {
  await assert.rejects(service.runDump('/tmp/test.dump', {
    snapshot: 'snapshot', spawnProcess() {
      const child = new EventEmitter();
      process.nextTick(() => child.emit('close', 1));
      return child;
    },
  }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.runDump('/tmp/test.dump', {
    snapshot: 'snapshot', signal: controller.signal,
    spawnProcess() { assert.fail('must not spawn after cancellation'); },
  }));
});

function fakeClient({ busy = false } = {}) {
  const statements = [];
  let fetched = false;
  let released = false;
  return {
    statements, get released() { return released; },
    release() { released = true; },
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: !busy }] };
      if (sql.includes('pg_export_snapshot')) return { rows: [{ snapshot: 'consistent-snapshot' }] };
      if (sql.includes('pg_attribute')) {
        assert.match(sql, /attname <> 'password_hash'/);
        return { rows: ['id', 'login', 'role', 'created_at'].map((attname) => ({ attname })) };
      }
      if (sql.startsWith('DECLARE')) assert.doesNotMatch(sql, /password_hash/);
      if (sql.startsWith('FETCH')) {
        if (fetched) return { rows: [] };
        fetched = true;
        return { rows: [{ data: { id: 'user-id', login: 'Teste " especial', role: 'admin', created_at: '2026-10-10T12:00:00.123456+00:00' } }] };
      }
      return { rows: [] };
    },
  };
}

test('package contains users without hashes; consistent snapshot, history and cleanup', async (t) => {
  const client = fakeClient();
  t.mock.method(pool, 'connect', async () => client);
  const backup = await service.createBackup({ dump: async (filePath, options) => {
    assert.equal(options.snapshot, 'consistent-snapshot');
    await fs.writeFile(filePath, 'PGDMP-fake-content');
  } });
  t.after(() => backup.cleanup());
  assert.match(backup.fileName, /sem-senhas.*\.tar\.gz$/);
  const files = execFileSync('tar', ['-tzf', backup.filePath], { encoding: 'utf8' });
  assert.match(files, /database.dump\nusers.json\nLEIA-ME.txt/);
  const users = execFileSync('tar', ['-xOzf', backup.filePath, 'users.json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(users)[0].login, 'Teste " especial');
  assert.doesNotMatch(users, /password_hash/);
  assert.equal((await fs.stat(backup.filePath)).mode & 0o777, 0o600);
  assert.equal(client.statements.some(({ sql }) => sql.includes('INSERT INTO')), false);
  await backup.recordDelivery('admin-id');
  assert.equal(client.statements.find(({ sql }) => sql.includes('INSERT INTO')).values[1], 'admin-id');
  await backup.cleanup();
  assert.equal(client.released, true);
  await assert.rejects(fs.stat(backup.filePath), { code: 'ENOENT' });
});

test('failed generation rolls back, removes files and releases lock', async (t) => {
  const client = fakeClient();
  t.mock.method(pool, 'connect', async () => client);
  let dumpPath;
  await assert.rejects(service.createBackup({ dump: async (filePath) => {
    dumpPath = filePath;
    await fs.writeFile(filePath, 'incomplete');
    throw new Error('failure');
  } }));
  assert.ok(client.statements.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(client.statements.some(({ sql }) => sql.includes('pg_advisory_unlock')));
  assert.equal(client.released, true);
  await assert.rejects(fs.stat(dumpPath), { code: 'ENOENT' });
});

test('concurrent backup is refused before generating files', async (t) => {
  const client = fakeClient({ busy: true });
  t.mock.method(pool, 'connect', async () => client);
  await assert.rejects(service.createBackup({ dump: () => assert.fail('must not dump') }), { code: 'BACKUP_BUSY' });
  assert.equal(client.released, true);
});

for (const outcome of ['success', 'failed', 'cancelled']) {
  test(`download ${outcome}: only successful transfer updates history`, async (t) => {
    let recorded = false;
    let cleaned = false;
    t.mock.method(console, 'error', () => {});
    t.mock.method(service, 'createBackup', async () => ({
      filePath: '/fake', fileName: 'backup.tar.gz',
      recordDelivery: async (id) => { assert.equal(id, 'admin'); recorded = true; },
      cleanup: async () => { cleaned = true; },
    }));
    const res = new EventEmitter();
    Object.assign(res, {
      writableFinished: false, headersSent: false, destroyed: false,
      setHeader() {}, redirect() {}, destroy() {},
      download(file, name, callback) {
        assert.equal(recorded, false);
        if (outcome === 'cancelled') { res.destroyed = true; res.emit('close'); }
        if (outcome === 'success') res.writableFinished = true;
        callback(outcome === 'failed' ? new Error('transfer error') : null);
      },
    });
    await downloadBackup({ sessionUser: { userId: 'admin' } }, res);
    assert.equal(recorded, outcome === 'success');
    assert.equal(cleaned, true);
  });
}

test('backup endpoint enforces administrator role and CSRF before generation', async (t) => {
  process.env.SESSION_SECRET = 'backup-test-secret';
  const express = require('express');
  const { csrfProtection, createCsrfToken } = require('../routes/csrf');
  const app = express();
  let role = null;
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.sessionUser = role ? { userId: 'admin', role } : null;
    next();
  });
  app.use(csrfProtection);
  app.use(require('../routes/admin-routes'));
  let calls = 0;
  t.mock.method(service, 'createBackup', async () => {
    calls += 1;
    throw new Error('test stops before generation');
  });
  t.mock.method(console, 'error', () => {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/admin/backup`;
  const token = createCsrfToken({ headers: {} });
  const post = (csrf = token) => fetch(url, {
    method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ _csrf: csrf }),
  });
  assert.equal((await post()).status, 302);
  role = 'client';
  assert.equal((await post()).status, 403);
  role = 'admin';
  assert.equal((await post('invalid')).status, 403);
  assert.equal(calls, 0);
  assert.equal((await post()).status, 302);
  assert.equal(calls, 1);
});
