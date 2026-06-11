const assert = require('node:assert/strict');
const test = require('node:test');
const { renderAdminContractsPage } = require('../routes/renderers');
const { toDateOnlyInputValue } = require('../routes/utils');

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

test('toDateOnlyInputValue preserves PostgreSQL date values parsed as UTC Date objects', () => {
  assert.equal(toDateOnlyInputValue('2026-06-11'), '2026-06-11');
  assert.equal(toDateOnlyInputValue(new Date('2026-06-11T00:00:00.000Z')), '2026-06-11');
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
