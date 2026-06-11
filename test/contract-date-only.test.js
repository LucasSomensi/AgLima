const assert = require('node:assert/strict');
const test = require('node:test');
const { types } = require('pg');
require('../routes/database');
const { buildContractPayload } = require('../routes/contract-service');
const { renderAdminContractsPage } = require('../routes/renderers');
const { formatDate, toDateOnlyInputValue } = require('../routes/utils');

function renderContractsPage(selectedContract) {
  let html = '';

  renderAdminContractsPage(
    { send: (value) => { html = value; } },
    {
      buyers: [],
      sellers: [],
      contracts: [],
      selectedContract,
    }
  );

  return html;
}

test('PostgreSQL date parser keeps date-only columns as strings', () => {
  const parsePostgresDate = types.getTypeParser(1082, 'text');

  assert.equal(parsePostgresDate('2026-06-11'), '2026-06-11');
});

test('date-only helpers preserve UTC-midnight Date objects without timezone conversion', () => {
  assert.equal(toDateOnlyInputValue('2026-06-11'), '2026-06-11');
  assert.equal(toDateOnlyInputValue(new Date('2026-06-11T00:00:00.000Z')), '2026-06-11');
  assert.equal(formatDate(new Date('2026-06-11T00:00:00.000Z')), '11/06/2026');
});

test('contract payload keeps submitted dates as YYYY-MM-DD strings for database writes', () => {
  const { payload, error } = buildContractPayload({
    data_contrato: '2026-06-11',
    produto: 'milho',
    preco_por_saca: '60.30',
    comprador_id: '1',
    vendedor_id: '2',
    quantidade_kg: '600000',
    data_recebimento: '2026-06-11',
  });

  assert.equal(error, undefined);
  assert.equal(payload.dataContrato, '2026-06-11');
  assert.equal(payload.dataRecebimento, '2026-06-11');
});

test('contract form renders data_contrato from UTC Date without timezone conversion', () => {
  const html = renderContractsPage({
    id: 1,
    data_contrato: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.match(
    html,
    /<input class="form-control" name="data_contrato" type="date" value="2026-06-11" required>/
  );
});

test('contract form renders data_recebimento from UTC Date without timezone conversion', () => {
  const html = renderContractsPage({
    id: 1,
    data_recebimento: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.match(
    html,
    /<input class="form-control" name="data_recebimento" type="date" value="2026-06-11">/
  );
});
