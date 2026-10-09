const test = require('node:test');
const assert = require('node:assert/strict');

const { paginateItems } = require('../routes/utils');

test('paginateItems limits each page to 30 items and clamps invalid pages', () => {
  const items = Array.from({ length: 65 }, (_, index) => index + 1);

  assert.deepEqual(paginateItems(items, '2'), {
    items: items.slice(30, 60),
    page: 2,
    totalPages: 3,
    total: 65,
  });
  assert.equal(paginateItems(items, '999').page, 3);
  assert.equal(paginateItems(items, 'invalid').page, 1);
  assert.deepEqual(paginateItems([], '1'), { items: [], page: 1, totalPages: 1, total: 0 });
});
