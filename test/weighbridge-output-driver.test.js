const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/agrolima';

const { pool } = require('../routes/database');
const service = require('../routes/weighbridge-service');
const validation = require('../routes/weighbridge-api-validation');
const { renderScaleOutputDetailPage, renderScaleOutputFormPage } = require('../routes/renderers');

const baseBody = {
  data_saida: '2026-11-10T09:30',
  placa_caminhao: 'ABC1D23',
  produto: 'soja',
  peso_tara_kg: '12000',
};

const outputInfo = {
  saida_id: 7,
  data_saida: '2026-11-10T12:30:00.000Z',
  placa_caminhao: 'ABC1D23',
  produto: 'soja',
  peso_tara_kg: '12000',
  peso_bruto_kg: null,
  peso_liquido_kg: null,
  contrato_id: null,
};

function renderPage(renderFn, params) {
  let html = '';
  renderFn({ send: (value) => { html = value; } }, params);
  return html;
}

function mockTransactionClient(t, previousRow) {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/FOR UPDATE/.test(sql)) return { rows: [previousRow] };
      if (/RETURNING \*/.test(sql)) return { rows: [{ ...previousRow, id: previousRow.id, contrato_id: previousRow.contrato_id }] };
      if (/gen_random_uuid/.test(sql)) return { rows: [{ id: 'group-id' }] };
      return { rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return calls;
}

test('output payload normalizes the optional driver name', () => {
  const filled = service.buildScaleOutputPayload({ ...baseBody, nome_motorista: '  João   da\tSilva  ' });
  assert.equal(filled.error, undefined);
  assert.equal(filled.payload.nomeMotorista, 'João da Silva');

  assert.equal(service.buildScaleOutputPayload({ ...baseBody, nome_motorista: '   ' }).payload.nomeMotorista, null);
  assert.equal(service.buildScaleOutputPayload({ ...baseBody, nome_motorista: null }).payload.nomeMotorista, null);
  assert.equal(service.buildScaleOutputPayload(baseBody).payload.nomeMotorista, undefined);

  const tooLong = service.buildScaleOutputPayload({ ...baseBody, nome_motorista: 'a'.repeat(121) });
  assert.match(tooLong.error, /no máximo 120 caracteres/);
  assert.equal(service.buildScaleOutputPayload({ ...baseBody, nome_motorista: 'a'.repeat(120) }).error, undefined);

  const edit = service.buildScaleOutputEditPayload({ ...baseBody, peso_bruto_kg: '', nome_motorista: 'Maria' });
  assert.equal(edit.payload.nomeMotorista, 'Maria');
  assert.equal(edit.payload.pesoBrutoKg, null);
});

test('createScaleOutput stores the driver name or NULL', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => { calls.push({ sql, values }); return { rows: [{ id: '1' }] }; });

  await service.createScaleOutput({ ...service.buildScaleOutputPayload({ ...baseBody, nome_motorista: 'João' }).payload }, 'user-1');
  await service.createScaleOutput({ ...service.buildScaleOutputPayload(baseBody).payload }, 'user-1');

  assert.match(calls[0].sql, /nome_motorista/);
  assert.equal(calls[0].values.at(-1), 'João');
  assert.equal(calls[1].values.at(-1), null);
});

test('updateScaleOutput sets, clears or preserves the driver name', async (t) => {
  const previous = { id: '7', contrato_id: null, nome_motorista: 'Antigo' };

  const cases = [
    [{ ...baseBody, peso_bruto_kg: '', nome_motorista: 'Novo' }, true, 'Novo'],
    [{ ...baseBody, peso_bruto_kg: '', nome_motorista: '' }, true, null],
    [{ ...baseBody, peso_bruto_kg: '' }, false, null],
  ];

  for (const [body, shouldSet, value] of cases) {
    const calls = mockTransactionClient(t, previous);
    await service.updateScaleOutput('7', service.buildScaleOutputEditPayload(body).payload, { userId: 'user-1', login: 'op' });
    const update = calls.find((call) => /UPDATE saidas_balanca/.test(call.sql));
    assert.match(update.sql, /nome_motorista = CASE WHEN \$7::boolean THEN \$8::varchar ELSE nome_motorista END/);
    assert.equal(update.values[6], shouldSet);
    assert.equal(update.values[7], value);
  }
});

test('splitScaleOutput copies the driver name to the new output', async (t) => {
  const calls = mockTransactionClient(t, {
    id: '7',
    data_saida: new Date('2026-11-10T12:30:00Z'),
    placa_caminhao: 'ABC1D23',
    nome_motorista: 'João',
    produto: 'soja',
    peso_tara_kg: '10000',
    peso_bruto_kg: '40000',
    peso_liquido_kg: '30000',
    contrato_id: null,
  });

  await service.splitScaleOutput('7', '20000', { userId: 'user-1', login: 'op' });
  const insert = calls.find((call) => /INSERT INTO saidas_balanca/.test(call.sql));
  assert.match(insert.sql, /nome_motorista/);
  assert.equal(insert.values.at(-1), 'João');
});

test('new output form offers an optional driver name field and keeps typed values', () => {
  const html = renderPage(renderScaleOutputFormPage, { formValues: { ...baseBody, nome_motorista: 'Zé <Carga>' } });
  assert.match(html, /Nome do motorista \(opcional\)/);
  assert.match(html, /name="nome_motorista" type="text" value="Zé &lt;Carga&gt;" maxlength="120"/);
  assert.doesNotMatch(html, /name="nome_motorista"[^>]*required/);
  assert.doesNotMatch(html, /{{NOME_MOTORISTA}}/);
});

test('output detail shows the driver name and lets the operator edit it', () => {
  const withDriver = renderPage(renderScaleOutputDetailPage, { outputInfo: { ...outputInfo, nome_motorista: 'João da Silva' } });
  assert.match(withDriver, /<dt>Motorista<\/dt><dd><span class="copy-field-value">João da Silva<\/span>/);
  assert.match(withDriver, /name="nome_motorista" type="text" value="João da Silva" maxlength="120"/);

  const withoutDriver = renderPage(renderScaleOutputDetailPage, { outputInfo: { ...outputInfo, nome_motorista: null } });
  assert.match(withoutDriver, /<dt>Motorista<\/dt><dd><span class="copy-field-value">-<\/span>/);
  assert.match(withoutDriver, /name="nome_motorista" type="text" value="" maxlength="120"/);

  const afterError = renderPage(renderScaleOutputDetailPage, {
    outputInfo: { ...outputInfo, nome_motorista: 'João' },
    formValues: { nome_motorista: '' },
    error: 'Erro',
  });
  assert.match(afterError, /name="nome_motorista" type="text" value="" maxlength="120"/);
});

test('API validation accepts the driver name as optional text or null', () => {
  const allowed = ['data_saida', 'placa_caminhao', 'produto', 'peso_tara_kg', 'nome_motorista'];
  assert.equal(validation.fields({ body: { ...baseBody, nome_motorista: null } }, allowed, []).nome_motorista, null);
  assert.equal(validation.fields({ body: { ...baseBody, nome_motorista: 'João' } }, allowed, []).nome_motorista, 'João');
  assert.throws(() => validation.fields({ body: { ...baseBody, nome_motorista: 123 } }, allowed, []));
  assert.throws(() => validation.fields({ body: { ...baseBody, nome_motorista: 'a'.repeat(201) } }, allowed, []));
});

test('driver name migration adds a nullable column without touching existing rows', () => {
  const sql = fs.readFileSync(require.resolve('../migrations/20261110_add_output_driver_name.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS nome_motorista character varying\(120\);/);
  assert.doesNotMatch(sql, /NOT NULL|UPDATE public\.saidas_balanca/);
  assert.match(sql, /CHECK \(nome_motorista IS NULL OR btrim\(nome_motorista\) <> ''\)/);
});
