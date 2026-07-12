const assert = require('node:assert/strict');
const test = require('node:test');
const { encodeCursor, decodeCursor } = require('../routes/pagination');

function makeRows(count, dateField) {
  return Array.from({ length: count }, (_, index) => ({
    id: 100 - index,
    [dateField]: `2026-07-12T10:${String(index).padStart(2, '0')}:00.000Z`,
    created_at: `2026-07-12T09:${String(index).padStart(2, '0')}:00.000Z`,
  }));
}

function loadServiceWithMock(modulePath, rows) {
  const databasePath = require.resolve('../routes/database');
  const servicePath = require.resolve(modulePath);
  delete require.cache[databasePath];
  delete require.cache[servicePath];
  const calls = [];
  require.cache[databasePath] = {
    exports: {
      ensureDatabaseConfigured() {},
      pool: {
        async query(sql, values = []) {
          calls.push({ sql, values });
          return { rows };
        },
      },
    },
  };
  return { service: require(modulePath), calls };
}

test('scale inputs cursor pagination fetches 51 and builds nextCursor from last returned item', async () => {
  const rows = makeRows(51, 'data_entrada');
  const { service, calls } = loadServiceWithMock('../routes/weighbridge-service', rows);

  const page = await service.listScaleInputs({ paginate: true });

  assert.equal(page.items.length, 50);
  assert.equal(page.hasNextPage, true);
  assert.deepEqual(decodeCursor(page.nextCursor).cursor, { data_entrada: rows[49].data_entrada, id: rows[49].id });
  assert.match(calls[0].sql, /ORDER BY data_entrada DESC, id DESC/);
  assert.match(calls[0].sql, /LIMIT \$1/);
  assert.deepEqual(calls[0].values, [51]);
});

test('scale inputs second page applies descending tuple comparison without loss or duplication', async () => {
  const firstRows = makeRows(51, 'data_entrada');
  const cursor = encodeCursor({ data_entrada: firstRows[49].data_entrada, id: firstRows[49].id });
  const secondRows = makeRows(10, 'data_entrada').map((row) => ({ ...row, id: row.id - 50 }));
  const { service, calls } = loadServiceWithMock('../routes/weighbridge-service', secondRows);

  const page = await service.listScaleInputs({ paginate: true, cursor });

  assert.equal(page.items.length, 10);
  assert.equal(page.hasNextPage, false);
  assert.equal(page.nextCursor, null);
  assert.match(calls[0].sql, /WHERE \(data_entrada, id\) < \(\$1::timestamptz, \$2::bigint\)/);
  assert.match(calls[0].sql, /LIMIT \$3/);
  assert.deepEqual(calls[0].values, [firstRows[49].data_entrada, firstRows[49].id, 51]);
  assert.equal(new Set([...firstRows.slice(0, 50).map((row) => row.id), ...secondRows.map((row) => row.id)]).size, 60);
});

test('scale outputs cursor pagination is stable when dates are equal', async () => {
  const rows = makeRows(51, 'data_saida').map((row) => ({ ...row, data_saida: '2026-07-12T10:00:00.000Z' }));
  const { service, calls } = loadServiceWithMock('../routes/weighbridge-service', rows);

  const page = await service.listScaleOutputs({ paginate: true });

  assert.equal(page.items.length, 50);
  assert.deepEqual(decodeCursor(page.nextCursor).cursor, { data_saida: rows[49].data_saida, id: rows[49].id });
  assert.match(calls[0].sql, /ORDER BY s\.data_saida DESC, s\.id DESC/);
});

test('dryer batches cursor pagination uses started_at created_at id and rejects invalid cursor', async () => {
  const rows = makeRows(51, 'started_at');
  const { service, calls } = loadServiceWithMock('../routes/dryer-service', rows);

  const page = await service.listCompletedDryerBatches({ paginate: true });

  assert.equal(page.items.length, 50);
  assert.deepEqual(decodeCursor(page.nextCursor).cursor, {
    started_at: rows[49].started_at,
    created_at: rows[49].created_at,
    id: rows[49].id,
  });
  assert.match(calls[0].sql, /ORDER BY started_at DESC, created_at DESC, id DESC/);
  assert.match(calls[0].sql, /LIMIT \$1/);

  await assert.rejects(
    () => service.listCompletedDryerBatches({ paginate: true, cursor: 'invalido' }),
    /Cursor inválido\./
  );
});

test('CSV list calls remain unpaginated', async () => {
  const rows = makeRows(2, 'data_entrada');
  const { service, calls } = loadServiceWithMock('../routes/weighbridge-service', rows);

  const result = await service.listScaleInputs({ order: 'asc' });

  assert.equal(result.length, 2);
  assert.doesNotMatch(calls[0].sql, /LIMIT 51|LIMIT \$/);
  assert.match(calls[0].sql, /ORDER BY data_entrada ASC, id ASC/);
});

const { renderScaleInputsListPage } = require('../routes/renderers/weighbridge-renderer');
const { renderAdminBatchesPage } = require('../routes/renderers/admin-renderer');

function renderPage(renderFn, params) {
  let html = '';
  renderFn({ send(value) { html = value; } }, params);
  return html;
}

test('pagination links preserve existing filters and are not rendered without next page', () => {
  const html = renderPage(renderScaleInputsListPage, {
    inputs: [],
    hasNextPage: true,
    nextCursor: 'abc123',
    currentUrl: '/balanca/entradas?produto=milho&cursor=old',
  });

  assert.match(html, /href="\/balanca\/entradas\?produto=milho&amp;cursor=abc123">Próxima página/);
  assert.match(html, /onclick="history\.back\(\)">Voltar/);
  assert.match(html, /Nenhuma entrada cadastrada\./);

  const lastPageHtml = renderPage(renderAdminBatchesPage, {
    batches: [],
    hasNextPage: false,
    nextCursor: null,
  });
  assert.doesNotMatch(lastPageHtml, /Próxima página/);
});
