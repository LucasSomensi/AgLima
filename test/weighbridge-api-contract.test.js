const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const spec = require('../docs/api-balanca.openapi.json');
const { router } = require('../routes/weighbridge-api-routes');

test('OpenAPI documents every operational route and resolves every local reference', () => {
  const actual = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = '/api/v1/balanca' + (layer.route.path === '/' ? '' : layer.route.path.replace(':id', '{id}'));
    for (const method of Object.keys(layer.route.methods)) {
      assert.ok(spec.paths[path]?.[method], `Undocumented ${method} ${path}`);
      actual.push(`${method} ${path}`);
    }
  }
  const documented = Object.entries(spec.paths).filter(([path]) => path.startsWith('/api/v1/'))
    .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method} ${path}`));
  assert.deepEqual(actual.sort(), documented.sort());
  const ids = new Set();
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const operation of Object.values(methods)) {
      assert.ok(!ids.has(operation.operationId)); ids.add(operation.operationId);
      if (path.includes('{id}')) assert.ok(operation.parameters.some((p) => p.name === 'id' && p.in === 'path' && p.required));
    }
  }
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.ok(value.$ref.startsWith('#/'));
      let target = spec;
      for (const segment of value.$ref.slice(2).split('/')) target = target?.[segment];
      assert.ok(target, value.$ref);
    }
    if (value.required && value.properties) for (const key of value.required) assert.ok(key in value.properties);
    Object.values(value).forEach(walk);
  }
  walk(spec);
});

test('session migration revokes tokens on credential changes and cascades user deletion', () => {
  const sql = fs.readFileSync(require.resolve('../migrations/20261014_add_weighbridge_api_sessions.sql'), 'utf8');
  assert.match(sql, /REFERENCES public.users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /AFTER UPDATE OF password_hash, role, disabled/);
  assert.match(sql, /DELETE FROM public.balanca_api_sessoes WHERE usuario_id = NEW.id/);
  assert.doesNotMatch(sql, /INSERT INTO public.users|UPDATE public.users|password_hash text/);
});
