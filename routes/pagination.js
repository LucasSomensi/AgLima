const PAGE_SIZE = 50;
const PAGE_FETCH_LIMIT = PAGE_SIZE + 1;

class InvalidCursorError extends Error {
  constructor() {
    super('Cursor inválido.');
    this.name = 'InvalidCursorError';
    this.code = 'INVALID_CURSOR';
  }
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) {
    return { cursor: null, error: null };
  }

  try {
    const decoded = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { cursor: null, error: new InvalidCursorError() };
    }

    return { cursor: parsed, error: null };
  } catch (_error) {
    return { cursor: null, error: new InvalidCursorError() };
  }
}

function buildPage(rows, cursorBuilder) {
  const items = rows.slice(0, PAGE_SIZE);
  const hasNextPage = rows.length > PAGE_SIZE;
  const lastItem = items[items.length - 1] || null;

  return {
    items,
    hasNextPage,
    nextCursor: hasNextPage && lastItem ? encodeCursor(cursorBuilder(lastItem)) : null,
  };
}

module.exports = {
  InvalidCursorError,
  PAGE_SIZE,
  PAGE_FETCH_LIMIT,
  buildPage,
  decodeCursor,
  encodeCursor,
};
