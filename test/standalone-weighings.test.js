const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/agrolima';

const { pool } = require('../routes/database');
const { ROLES } = require('../routes/constants');
const { setSessionCookie } = require('../routes/auth');
const { createCsrfToken } = require('../routes/csrf');
const userService = require('../routes/user-service');
const photoService = require('../routes/scale-photo-service');
const standalone = require('../routes/standalone-weighing-service');
const auth = require('../routes/weighbridge-api-auth');
const { loginLimiter } = require('../routes/weighbridge-api-routes');
const { buildStandaloneWeighingsCsv } = require('../routes/weighbridge-csv');
const {
  buildScaleOutputTicket,
  buildStandaloneWeighingTicket,
  buildStandaloneWeighingTicketPdf,
} = require('../routes/weighbridge-ticket-pdf');
const {
  renderStandaloneWeighingDetailPage,
  renderStandaloneWeighingFormPage,
  renderStandaloneWeighingSecondFormPage,
  renderStandaloneWeighingsListPage,
  renderWeighbridgeHomePage,
} = require('../routes/renderers/weighbridge-renderer');

const CAPTURE_ID = '0b9f7c1e-3d2a-4c5b-9e8f-1a2b3c4d5e6f';
const PHOTO_ID = '6f5e4d3c-2b1a-4f8e-9d7c-0a1b2c3d4e5f';
const USER = { userId: 'a1b2c3d4-0000-4000-8000-000000000001', login: 'balanca' };

const pending = {
  id: '5',
  placa_caminhao: 'ABC1D23',
  nome_motorista: null,
  produto: 'Calcário',
  vendedor: null,
  comprador: null,
  comentario: 'Linha 1\nLinha <2>',
  pesagem_1_kg: '15320.000',
  pesagem_1_em: new Date('2026-11-14T13:00:00Z'),
  pesagem_2_kg: null,
  pesagem_2_em: null,
  peso_liquido_kg: null,
  operador_login: 'balanca',
};
const complete = {
  ...pending,
  nome_motorista: 'João da Silva',
  vendedor: 'Fazenda Vizinha',
  comprador: 'Cooperativa',
  pesagem_2_kg: '41000.000',
  pesagem_2_em: new Date('2026-11-14T14:30:00Z'),
  peso_liquido_kg: '25680.000',
};

function renderPage(renderFn, params) {
  let html = '';
  renderFn({ send: (value) => { html = value; } }, params);
  return html;
}

function request(server, { method = 'GET', path: requestPath, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: requestPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          buffer,
          text,
          data: res.headers['content-type']?.includes('application/json') && text ? JSON.parse(text) : null,
        });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function startServer(t) {
  const app = require('../app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

function operatorSession(t) {
  const user = {
    id: USER.userId,
    login: USER.login,
    role: ROLES.WEIGHBRIDGE_OPERATOR,
    disabled: false,
    must_change_password: false,
    session_version: 1,
  };
  t.mock.method(userService, 'findActiveUserById', async () => user);
  const headers = {};
  setSessionCookie({ setHeader: (name, value) => { headers[name] = value; } }, user);
  const cookie = headers['Set-Cookie'].split(';')[0];
  return { user, cookie, csrf: createCsrfToken({ headers: { cookie } }) };
}

function postForm(server, cookie, requestPath, fields) {
  return request(server, {
    method: 'POST',
    path: requestPath,
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function mockTransaction(t, previousRow, { updatedRow = previousRow } = {}) {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (/FOR UPDATE/.test(sql)) return { rows: previousRow ? [previousRow] : [] };
      if (/RETURNING \*/.test(sql)) return { rows: updatedRow ? [updatedRow] : [] };
      return { rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return calls;
}

// --- Migration -----------------------------------------------------------------

test('migration creates the table and lets photos be linked to standalone weighings', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261114_add_standalone_weighings.sql'), 'utf8');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.pesagens_avulsas/);
  assert.match(sql, /peso_liquido_kg numeric GENERATED ALWAYS AS \(abs\(pesagem_2_kg - pesagem_1_kg\)\) STORED/);
  assert.match(sql, /CHECK \(\(pesagem_2_kg IS NULL\) = \(pesagem_2_em IS NULL\)\)/);
  assert.match(sql, /REFERENCES public\.pesagens_avulsas\(id\) ON DELETE SET NULL/);
  assert.match(sql, /tipo_peso IN \('bruto', 'tara', 'pesagem_1', 'pesagem_2'\)/);
  assert.match(sql, /num_nonnulls\(entrada_id, saida_id, pesagem_avulsa_id\) <= 1/);
  // Nenhuma regra pode exigir pesagem_avulsa_id preenchido, senão o ON DELETE
  // SET NULL falharia ao excluir uma pesagem com foto.
  assert.doesNotMatch(sql, /pesagem_avulsa_id IS NOT NULL\s*(AND|\))/);
});

// --- Validação -----------------------------------------------------------------

test('only the first weight is required; free text fields are normalized or null', () => {
  assert.match(standalone.buildStandaloneWeighingPayload({}).error, /peso válido para a pesagem 1/);
  assert.match(standalone.buildStandaloneWeighingPayload({ pesagem_1_kg: '0' }).error, /pesagem 1/);
  assert.match(standalone.buildStandaloneWeighingPayload({ pesagem_1_kg: '10', pesagem_1_em: 'ontem' }).error, /data e hora/);

  const minimal = standalone.buildStandaloneWeighingPayload({ pesagem_1_kg: '15320,5' });
  assert.equal(minimal.error, undefined);
  assert.equal(minimal.payload.pesagem1Kg, '15320.5');
  assert.ok(minimal.payload.pesagem1Em instanceof Date);
  for (const key of ['placaCaminhao', 'nomeMotorista', 'produto', 'vendedor', 'comprador', 'comentario']) {
    assert.equal(minimal.payload[key], null, key);
  }

  const filled = standalone.buildStandaloneWeighingPayload({
    pesagem_1_em: '2026-11-14T10:00',
    pesagem_1_kg: '15320',
    placa_caminhao: 'abc-1d23',
    nome_motorista: '  João   da Silva ',
    produto: ' calcário  dolomítico ',
    vendedor: '   ',
    comprador: 'Coop',
    comentario: '  Linha 1\r\nLinha   2  ',
  });
  assert.equal(filled.payload.placaCaminhao, 'ABC1D23');
  assert.equal(filled.payload.nomeMotorista, 'João da Silva');
  assert.equal(filled.payload.produto, 'calcário dolomítico');
  assert.equal(filled.payload.vendedor, null);
  assert.equal(filled.payload.comentario, 'Linha 1\nLinha   2');
  assert.equal(filled.payload.pesagem1Em.toISOString(), '2026-11-14T13:00:00.000Z');

  // Placa sem padrão fixo (trator, reboque, placa estrangeira), só tamanho.
  assert.equal(standalone.buildStandaloneWeighingPayload({ pesagem_1_kg: '1', placa_caminhao: 'TRATOR 2' }).payload.placaCaminhao, 'TRATOR2');
  assert.match(standalone.buildStandaloneWeighingPayload({ pesagem_1_kg: '1', placa_caminhao: 'ABCDEFGHIJK' }).error, /no máximo 10/);
  assert.match(standalone.buildStandaloneWeighingPayload({ pesagem_1_kg: '1', produto: 'a'.repeat(121) }).error, /produto pode ter no máximo 120/);
  assert.match(standalone.buildStandaloneWeighingPayload({ pesagem_1_kg: '1', comentario: 'a'.repeat(1001) }).error, /comentário pode ter no máximo 1000/);
  assert.equal(standalone.buildStandaloneWeighingPayload({ pesagem_1_kg: '1', comentario: 'ç'.repeat(1000) }).error, undefined);
});

test('second weight and edit payloads', () => {
  assert.match(standalone.buildStandaloneWeighingSecondPayload({}).error, /pesagem 2/);
  const second = standalone.buildStandaloneWeighingSecondPayload({ pesagem_2_kg: '41000', pesagem_2_em: '2026-11-14T11:30' });
  assert.equal(second.payload.pesagem2Kg, '41000');
  assert.equal(second.payload.pesagem2Em.toISOString(), '2026-11-14T14:30:00.000Z');

  // A pesagem 2 pode ser menor que a pesagem 1: não há ordem entre elas.
  assert.equal(standalone.buildStandaloneWeighingSecondPayload({ pesagem_2_kg: '1' }).error, undefined);

  const pendingEdit = standalone.buildStandaloneWeighingEditPayload({ pesagem_1_kg: '15320', pesagem_2_kg: '', pesagem_2_em: '2026-11-14T11:30' });
  assert.equal(pendingEdit.payload.pesagem2Kg, null);
  assert.equal(pendingEdit.payload.pesagem2Em, null);

  const completeEdit = standalone.buildStandaloneWeighingEditPayload({ pesagem_1_kg: '15320', pesagem_2_kg: '9000', pesagem_2_em: '' });
  assert.equal(completeEdit.payload.pesagem2Kg, '9000');
  assert.ok(completeEdit.payload.pesagem2Em instanceof Date);

  assert.match(standalone.buildStandaloneWeighingEditPayload({ pesagem_1_kg: '15320', pesagem_2_kg: 'abc' }).error, /deixe o campo em branco/);
});

// --- Banco -----------------------------------------------------------------------

test('create inserts the first weight with free text and the operator', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => { calls.push({ sql, values }); return { rows: [{ id: '5' }] }; });

  const { payload } = standalone.buildStandaloneWeighingPayload({ pesagem_1_em: '2026-11-14T10:00', pesagem_1_kg: '15320', produto: 'Calcário' });
  assert.deepEqual(await standalone.createStandaloneWeighing(payload, USER.userId), { id: '5' });
  assert.match(calls[0].sql, /INSERT INTO pesagens_avulsas/);
  assert.deepEqual(calls[0].values.slice(1), ['15320', null, null, 'Calcário', null, null, null, USER.userId]);
});

test('lists filter pending weighings in the database and invalid ids never reach SQL', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; });

  await standalone.listStandaloneWeighings({ pendingOnly: true, order: 'asc' });
  await standalone.listStandaloneWeighings({ limit: 10 });
  assert.match(calls[0].sql, /WHERE p\.pesagem_2_kg IS NULL/);
  assert.match(calls[0].sql, /ORDER BY p\.pesagem_1_em ASC, p\.id ASC/);
  assert.doesNotMatch(calls[1].sql, /WHERE/);
  assert.deepEqual(calls[1].values, [10, 0]);

  assert.equal(await standalone.getStandaloneWeighingById('abc'), null);
  assert.equal(await standalone.addStandaloneWeighingSecond('1;DROP', {}, USER), null);
  assert.equal(await standalone.updateStandaloneWeighing('-1', {}, USER), null);
  await assert.rejects(standalone.deleteStandaloneWeighing('x', USER, 'motivo'), { code: 'NOT_FOUND' });
  assert.equal(calls.length, 2);
});

test('second weight is written once, with audit', async (t) => {
  const calls = mockTransaction(t, { id: '5', pesagem_2_kg: null }, { updatedRow: { id: '5', pesagem_2_kg: '41000' } });
  const { payload } = standalone.buildStandaloneWeighingSecondPayload({ pesagem_2_kg: '41000' });

  assert.deepEqual(await standalone.addStandaloneWeighingSecond('5', payload, USER), { id: '5' });
  const update = calls.find((call) => /UPDATE pesagens_avulsas/.test(call.sql));
  assert.match(update.sql, /AND pesagem_2_kg IS NULL/);
  assert.equal(update.values[3], USER.userId);
  const audit = calls.find((call) => /INSERT INTO auditoria_acoes/.test(call.sql));
  assert.equal(audit.values[0], 'editar_pesagem_avulsa');
  assert.equal(audit.values[1], 'pesagens_avulsas');
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));

  const already = mockTransaction(t, { id: '5', pesagem_2_kg: '41000' }, { updatedRow: null });
  assert.equal(await standalone.addStandaloneWeighingSecond('5', payload, USER), null);
  assert.ok(!already.some((call) => /auditoria_acoes/.test(call.sql)));
});

test('edit replaces every field, tracks who added the second weight and audits', async (t) => {
  const calls = mockTransaction(t, { id: '5' }, { updatedRow: { id: '5' } });
  const { payload } = standalone.buildStandaloneWeighingEditPayload({ pesagem_1_kg: '15320', pesagem_2_kg: '', comentario: 'novo' });

  assert.deepEqual(await standalone.updateStandaloneWeighing('5', payload, USER), { id: '5' });
  const update = calls.find((call) => /UPDATE pesagens_avulsas/.test(call.sql));
  assert.match(update.sql, /WHEN \$10::numeric IS NULL THEN NULL/);
  assert.match(update.sql, /WHEN pesagem_2_kg IS NULL THEN \$12::uuid/);
  assert.equal(update.values[8], 'novo');
  assert.equal(update.values[9], null);
  assert.equal(update.values[11], USER.userId);
  assert.ok(calls.some((call) => /INSERT INTO auditoria_acoes/.test(call.sql)));

  mockTransaction(t, null);
  assert.equal(await standalone.updateStandaloneWeighing('6', payload, USER), null);
});

test('delete keeps the reason in the audit and reports missing records', async (t) => {
  const calls = mockTransaction(t, { id: '5', produto: 'Calcário' });
  await standalone.deleteStandaloneWeighing('5', USER, 'Pesagem lançada em duplicidade.');
  assert.ok(calls.some((call) => /DELETE FROM pesagens_avulsas WHERE id = \$1/.test(call.sql)));
  const audit = calls.find((call) => /INSERT INTO auditoria_acoes/.test(call.sql));
  assert.equal(audit.values[0], 'deletar_pesagem_avulsa');
  assert.deepEqual(audit.values[7], { motivo_delecao: 'Pesagem lançada em duplicidade.' });

  const missing = mockTransaction(t, null);
  await assert.rejects(standalone.deleteStandaloneWeighing('6', USER, 'motivo'), { code: 'NOT_FOUND' });
  assert.ok(missing.some((call) => call.sql === 'ROLLBACK'));
});

// --- Fotos -------------------------------------------------------------------------

test('photo captures link to standalone weighings only as pesagem_1 or pesagem_2', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => { calls.push({ sql, values }); return { rows: [{ id: CAPTURE_ID }] }; });

  const reject = (args) => photoService.linkCaptureToRecord({ captureId: CAPTURE_ID, userId: 'u', pesoKg: '1', ...args });
  assert.equal(await reject({ pesagemAvulsaId: '5', tipoPeso: 'bruto' }), null);
  assert.equal(await reject({ saidaId: '5', tipoPeso: 'pesagem_1' }), null);
  assert.equal(await reject({ saidaId: '5', pesagemAvulsaId: '5', tipoPeso: 'tara' }), null);
  assert.equal(calls.length, 0);

  assert.deepEqual(await reject({ pesagemAvulsaId: '5', tipoPeso: 'pesagem_2', pesoKg: '41000' }), { id: CAPTURE_ID });
  assert.match(calls[0].sql, /pesagem_avulsa_id = \$7/);
  assert.deepEqual(calls[0].values, [CAPTURE_ID, 'u', null, null, 'pesagem_2', '41000', '5']);

  // Entradas e saídas continuam sem citar a coluna nova (bancos sem a migration).
  await reject({ entradaId: '9', tipoPeso: 'bruto' });
  assert.doesNotMatch(calls[1].sql, /pesagem_avulsa_id/);
  assert.equal(calls[1].values.length, 6);
});

test('linked photos are listed by standalone weighing and recent photos read uses safely', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; });

  await photoService.listLinkedPhotos({ pesagemAvulsaId: '5' });
  assert.match(calls[0].sql, /WHERE pesagem_avulsa_id = \$1/);
  assert.deepEqual(calls[0].values, ['5']);

  await photoService.listRecentAutomaticPhotos(1);
  assert.match(calls[1].sql, /to_jsonb\(c\) -> 'pesagem_avulsa_id'/);
  assert.doesNotMatch(calls[1].sql, /c\.pesagem_avulsa_id/);
});

// --- Ticket e CSV --------------------------------------------------------------------

test('ticket follows the output ticket layout with first and second weights', async () => {
  const ticket = buildStandaloneWeighingTicket(complete);
  const outputTicket = buildScaleOutputTicket({
    saida_id: '5', operador_login: 'balanca', placa_caminhao: 'ABC1D23', nome_motorista: 'João da Silva',
    produto: 'soja', vendedor_nome_completo: 'V', comprador_nome_completo: 'C',
  });
  assert.equal(ticket.title, 'Pesagem avulsa');
  assert.equal(ticket.number, '5');
  assert.deepEqual(ticket.fields.map(([label]) => label), outputTicket.fields.map(([label]) => label));
  assert.deepEqual(ticket.fields, [
    ['Operador', 'balanca'],
    ['Placa', 'ABC1D23'],
    ['Motorista', 'João da Silva'],
    ['Produto', 'Calcário'],
    ['Vendedor', 'Fazenda Vizinha'],
    ['Comprador', 'Cooperativa'],
  ]);
  assert.deepEqual(ticket.weights.map(({ label, photoType }) => [label, photoType]), [
    ['Pesagem 1', 'pesagem_1'],
    ['Pesagem 2', 'pesagem_2'],
  ]);
  assert.equal(Number(ticket.weights[0].kg), 15320);
  assert.equal(Number(ticket.weights[1].kg), 41000);
  assert.equal(Number(ticket.netKg), 25680);
  assert.deepEqual(ticket.signatures, ['Vendedor', 'Comprador']);

  const blank = buildStandaloneWeighingTicket({ ...complete, placa_caminhao: null, nome_motorista: null, produto: null, vendedor: null, comprador: null });
  assert.ok(!blank.fields.some(([label]) => label === 'Motorista'));
  for (const label of ['Placa', 'Produto', 'Vendedor', 'Comprador']) {
    assert.deepEqual(blank.fields.find(([name]) => name === label), [label, '-'], label);
  }

  const pdf = await buildStandaloneWeighingTicketPdf(complete);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

test('CSV exports every field, keeping comments with line breaks in one cell', () => {
  const csv = buildStandaloneWeighingsCsv([complete, pending]);
  const [header] = csv.replace('﻿', '').split('\r\n');
  assert.equal(header, 'ID;Data pesagem 1;Hora pesagem 1;Pesagem 1 kg;Data pesagem 2;Hora pesagem 2;Pesagem 2 kg;Liquido kg;Placa;Motorista;Produto;Vendedor;Comprador;Comentario');
  assert.match(csv, /5;14\/11\/2026;10:00:00;15\.320;14\/11\/2026;11:30:00;41\.000;25\.680;ABC1D23;João da Silva;Calcário;Fazenda Vizinha;Cooperativa;"Linha 1\nLinha <2>"/);
  assert.match(csv, /5;14\/11\/2026;10:00:00;15\.320;;;;;ABC1D23;;Calcário;;;/);
});

// --- Telas ---------------------------------------------------------------------------

test('both weight forms have the scale weight and automatic photo buttons', () => {
  for (const [file, target] of [
    ['weighbridge-standalone-form.html', 'pesagem_1_kg'],
    ['weighbridge-standalone-second-form.html', 'pesagem_2_kg'],
  ]) {
    const html = fs.readFileSync(path.join(__dirname, '../views', file), 'utf8');
    assert.match(html, new RegExp(`data-scale-weight-target="${target}"`), file);
    assert.match(html, new RegExp(`data-scale-photo-pick-target="${target}"`), file);
    assert.match(html, /name="foto_captura_id"[^>]*data-scale-photo-capture/, file);
    assert.match(html, /\/js\/weighbridge-scale-weight\.js/, file);
  }
});

test('first weight form keeps typed values, escapes them and never expands placeholders typed by the user', () => {
  const html = renderPage(renderStandaloneWeighingFormPage, {
    formValues: { pesagem_1_kg: '15320', produto: '<b>Areia</b>', comentario: '{{WEIGHBRIDGE_HOME_HREF}} ok', foto_captura_id: CAPTURE_ID },
    error: 'Erro de teste',
  });
  assert.match(html, /Erro de teste/);
  assert.match(html, /name="produto" type="text" value="&lt;b&gt;Areia&lt;\/b&gt;"/);
  assert.match(html, />\{\{WEIGHBRIDGE_HOME_HREF\}\} ok<\/textarea>/);
  assert.match(html, new RegExp(`name="foto_captura_id" value="${CAPTURE_ID}"`));
  assert.match(html, /href="\/balanca" title="Voltar à balança" aria-label="Voltar à balança"/);
  assert.doesNotMatch(html, /name="(produto|vendedor|comprador|placa_caminhao|nome_motorista|comentario)"[^>]*required/);
  // Fora o texto digitado pelo operador, nenhum placeholder sobra no HTML.
  assert.doesNotMatch(html.replace('{{WEIGHBRIDGE_HOME_HREF}} ok', ''), /{{(?!CSRF_TOKEN)[A-Z_0-9]+}}/);
});

test('second weight form shows the first weight and the comment', () => {
  const html = renderPage(renderStandaloneWeighingSecondFormPage, { weighing: pending });
  assert.match(html, /action="\/balanca\/avulsas\/5\/pesagem-2"/);
  assert.match(html, /<h1>Pesagem 2 · Avulsa #5<\/h1>/);
  assert.match(html, /<a class="wb-plate wb-plate--lg" href="\/balanca\/avulsas\/5">ABC1D23<\/a>/);
  assert.match(html, /Calcário<\/span>/);
  assert.match(html, /P1 15\.320 kg<\/span>/);
  assert.match(html, /Linha 1\nLinha &lt;2&gt;/);
  assert.doesNotMatch(html, /{{(?!CSRF_TOKEN)[A-Z_0-9]+}}/);
});

test('detail page offers the ticket only after the second weight', () => {
  const pendingHtml = renderPage(renderStandaloneWeighingDetailPage, { weighing: pending, photos: [] });
  assert.match(pendingHtml, /href="\/balanca\/avulsas\/5\/pesagem-2"[^>]*aria-label="Adicionar pesagem 2"/);
  assert.match(pendingHtml, /disabled title="Imprimir ticket \(falta a pesagem 2\)"/);
  assert.doesNotMatch(pendingHtml, /avulsas\/5\/ticket\.pdf/);
  assert.match(pendingHtml, /data-copy="Linha 1&#10;Linha &lt;2&gt;" aria-label="Copiar Comentário"><span class="wb-copy-label">Comentário<\/span><span class="wb-copy-value">Linha 1\nLinha &lt;2&gt;<\/span>/);
  assert.match(pendingHtml, /<button class="wb-copy wb-copy--empty" type="button" data-copy="" aria-label="Copiar Motorista">/);
  assert.match(pendingHtml, /action="\/balanca\/avulsas\/5\/deletar"/);
  assert.doesNotMatch(pendingHtml, /{{(?!CSRF_TOKEN)[A-Z_0-9]+}}/);

  const completeHtml = renderPage(renderStandaloneWeighingDetailPage, {
    weighing: complete,
    photos: [{ id: PHOTO_ID, tipo_peso: 'pesagem_2', peso_kg: 41000, capturada_em: complete.pesagem_2_em, status: 'vinculada' }],
  });
  assert.match(completeHtml, /href="\/balanca\/avulsas\/5\/ticket\.pdf"[^>]*aria-label="Imprimir ticket" target="_blank" rel="noopener"/);
  assert.match(completeHtml, /<span class="wb-weight-label">Líquido<\/span>\s*<button class="wb-weight-value" type="button" data-copy="25680"/);
  assert.match(completeHtml, /Pesagem 2 · 41\.000 kg/);
  assert.match(completeHtml, /name="pesagem_2_kg" type="number"[^>]*value="41000\.000"/);
});

test('list and home show standalone weighings separately; pending ones go to the yard', () => {
  const list = renderPage(renderStandaloneWeighingsListPage, { weighings: [complete, { ...pending, placa_caminhao: null, produto: null }] });
  assert.match(list, /href="\/balanca\/avulsas\.csv"/);
  assert.match(list, /href="\/balanca\/avulsas\/5\/ticket\.pdf"/);
  assert.match(list, /href="\/balanca\/avulsas\/5\/pesagem-2"[^>]*aria-label="Adicionar pesagem 2"/);
  assert.match(renderPage(renderStandaloneWeighingsListPage, { weighings: [] }), /Nenhuma pesagem avulsa cadastrada/);

  const home = renderPage(renderWeighbridgeHomePage, {
    standaloneWeighings: [complete],
    yardStandaloneWeighings: [{ ...pending, placa_caminhao: null, produto: '<i>Areia</i>' }, complete],
  });
  assert.match(home, /href="\/balanca\/avulsas\/nova"/);
  assert.match(home, /<tr data-movement-type="avulsa">/);
  const yard = home.split('aria-labelledby="yard-title"')[1].split('</section>')[0];
  assert.match(yard, /<span class="wb-type wb-type--avulsa" title="Avulsa"/);
  assert.match(yard, /Sem placa/);
  assert.match(yard, /&lt;i&gt;Areia&lt;\/i&gt;/);
  assert.match(yard, /<span class="wb-tag">P1<\/span>15\.320/);
  assert.equal((yard.match(/aria-label="Adicionar pesagem 2"/g) || []).length, 1, 'pesagem completa não fica no pátio');

  const empty = renderPage(renderWeighbridgeHomePage, {});
  assert.match(empty, /Nenhuma movimentação recente/);
  assert.doesNotMatch(empty, /yard-title|{{STANDALONE_ROWS}}/);
});

// --- Rotas web ---------------------------------------------------------------------

test('saving the first weight links the capture as pesagem_1', async (t) => {
  const { cookie, csrf, user } = operatorSession(t);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => {
    calls.push({ sql, values });
    if (/INSERT INTO pesagens_avulsas/.test(sql)) return { rows: [{ id: '5' }] };
    return { rows: [{ id: CAPTURE_ID }] };
  });
  const server = await startServer(t);

  const invalid = await postForm(server, cookie, '/balanca/avulsas', { _csrf: csrf, pesagem_1_kg: '', produto: 'Areia' });
  assert.equal(invalid.statusCode, 200);
  assert.match(invalid.text, /Informe um peso válido para a pesagem 1/);
  assert.match(invalid.text, /value="Areia"/);

  const response = await postForm(server, cookie, '/balanca/avulsas', {
    _csrf: csrf, pesagem_1_em: '2026-11-14T10:00', pesagem_1_kg: '15320', foto_captura_id: CAPTURE_ID,
  });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/balanca?avulsa_criada=1');
  const link = calls.find((call) => /UPDATE balanca_fotos/.test(call.sql));
  assert.deepEqual(link.values, [CAPTURE_ID, user.id, null, null, 'pesagem_1', '15320', '5']);
});

test('saving the second weight links pesagem_2 and returns to the home page', async (t) => {
  const { cookie, csrf, user } = operatorSession(t);
  const calls = mockTransaction(t, { id: '5', pesagem_2_kg: null }, { updatedRow: { id: '5' } });
  t.mock.method(pool, 'query', async (sql, values) => {
    calls.push({ sql, values });
    if (/FROM pesagens_avulsas p/.test(sql)) return { rows: [pending] };
    return { rows: [{ id: CAPTURE_ID }] };
  });
  const server = await startServer(t);

  const response = await postForm(server, cookie, '/balanca/avulsas/5/pesagem-2', {
    _csrf: csrf, pesagem_2_em: '2026-11-14T11:30', pesagem_2_kg: '41000', foto_captura_id: CAPTURE_ID,
  });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/balanca?avulsa_pesagem_2_adicionada=1&avulsa_id=5');
  const link = calls.find((call) => /UPDATE balanca_fotos/.test(call.sql));
  assert.deepEqual(link.values, [CAPTURE_ID, user.id, null, null, 'pesagem_2', '41000', '5']);
});

test('ticket route requires the second weight and serves an inline PDF', async (t) => {
  const { cookie } = operatorSession(t);
  let row = pending;
  t.mock.method(pool, 'query', async () => ({ rows: [row] }));
  const server = await startServer(t);

  const anonymous = await request(server, { path: '/balanca/avulsas/5/ticket.pdf' });
  assert.notEqual(anonymous.statusCode, 200);

  const blocked = await request(server, { path: '/balanca/avulsas/5/ticket.pdf', headers: { Cookie: cookie } });
  assert.equal(blocked.statusCode, 302);
  assert.match(blocked.headers.location, /^\/balanca\/avulsas\/5\?error=/);

  row = complete;
  const response = await request(server, { path: '/balanca/avulsas/5/ticket.pdf', headers: { Cookie: cookie } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(response.headers['content-disposition'], 'inline; filename="ticket-pesagem-avulsa-5.pdf"');
  assert.equal(response.buffer.subarray(0, 4).toString(), '%PDF');
});

test('home keeps working before the standalone weighings migration is applied', async (t) => {
  const { cookie } = operatorSession(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(pool, 'query', async (sql) => {
    if (/pesagens_avulsas/.test(sql)) throw Object.assign(new Error('relation "pesagens_avulsas" does not exist'), { code: '42P01' });
    return { rows: [] };
  });
  const server = await startServer(t);

  const response = await request(server, { path: '/balanca', headers: { Cookie: cookie } });
  assert.equal(response.statusCode, 200);
  assert.match(response.text, /id="recent-title">Recentes/);
  assert.match(response.text, /Nenhuma movimentação recente/);
});

test('automatic photo picker describes uses in standalone weighings', async (t) => {
  const { cookie } = operatorSession(t);
  t.mock.method(pool, 'query', async () => ({
    rows: [{
      id: PHOTO_ID,
      status: 'recebida',
      peso_kg: 15320,
      capturada_em: new Date('2026-11-10T18:05:00Z'),
      contingencia: false,
      usos: [{ entrada_id: null, saida_id: null, pesagem_avulsa_id: 5, tipo_peso: 'pesagem_1' }],
    }],
  }));
  const server = await startServer(t);

  const response = await request(server, { path: '/balanca/fotos/automaticas/recentes', headers: { Cookie: cookie } });
  assert.deepEqual(response.data.fotos[0].usos, ['pesagem avulsa #5 (pesagem 1)']);
});

// --- API operacional -------------------------------------------------------------------

test('operational API manages standalone weighings', async (t) => {
  const TOKEN = 'b'.repeat(64);
  const actor = { id: USER.userId, login: USER.login, role: ROLES.WEIGHBRIDGE_OPERATOR, disabled: false };
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('JOIN public.users')) return { rows: [actor] };
    assert.fail(`unexpected query: ${sql}`);
  });
  loginLimiter.reset();
  const server = await startServer(t);
  const api = (method, requestPath, data) => request(server, {
    method,
    path: `/api/v1/balanca${requestPath}`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert.equal(auth.hashToken(TOKEN).length, 64);

  const created = [];
  const updated = [];
  let row = pending;
  t.mock.method(standalone, 'createStandaloneWeighing', async (data, userId) => { created.push({ data, userId }); return { id: '5' }; });
  t.mock.method(standalone, 'getStandaloneWeighingById', async (id) => (id === '5' ? row : null));
  t.mock.method(standalone, 'listStandaloneWeighings', async (options) => { created.push({ options }); return [pending]; });
  t.mock.method(standalone, 'updateStandaloneWeighing', async (id, data, user) => { updated.push({ id, data, user }); return { id }; });
  t.mock.method(standalone, 'addStandaloneWeighingSecond', async (id, data) => (row.pesagem_2_kg ? null : { id, data }));
  t.mock.method(standalone, 'deleteStandaloneWeighing', async (id, user, reason) => { updated.push({ id, user, reason }); });

  const post = await api('POST', '/avulsas', { pesagem_1_kg: 15320, produto: 'Calcário', comentario: null });
  assert.equal(post.statusCode, 201);
  assert.equal(post.headers.location, '/api/v1/balanca/avulsas/5');
  assert.equal(created[0].userId, actor.id);
  assert.equal(created[0].data.pesagem1Kg, '15320');
  assert.equal(created[0].data.comentario, null);

  for (const bad of [{}, { pesagem_1_kg: 0 }, { pesagem_1_kg: 1, contrato_id: 1 }, { pesagem_1_kg: 1, produto: 42 },
    { pesagem_1_kg: 1, comentario: 'a'.repeat(2001) }, { pesagem_1_kg: 1, pesagem_1_em: '2026-11-14T10:00Z' }]) {
    assert.equal((await api('POST', '/avulsas', bad)).statusCode, 400, JSON.stringify(bad).slice(0, 60));
  }

  const page = await api('GET', '/avulsas?pendentes=true&limite=1');
  assert.equal(page.statusCode, 200);
  assert.equal(page.data.items[0].id, '5');
  assert.deepEqual(created.at(-1).options, { limit: 2, offset: 0, pendingOnly: true });
  assert.equal((await api('GET', '/avulsas?pendentes=sim')).statusCode, 400);
  assert.equal((await api('GET', '/avulsas/5')).data.produto, 'Calcário');
  assert.equal((await api('GET', '/avulsas/6')).statusCode, 404);

  const fullEdit = {
    pesagem_1_em: '2026-11-14T10:00', pesagem_1_kg: '15320', pesagem_2_kg: null, pesagem_2_em: null,
    placa_caminhao: null, nome_motorista: null, produto: 'Areia', vendedor: null, comprador: null, comentario: 'ok',
  };
  assert.equal((await api('PUT', '/avulsas/5', fullEdit)).statusCode, 200);
  assert.equal(updated[0].data.produto, 'Areia');
  assert.equal(updated[0].data.pesagem2Kg, null);
  assert.equal(updated[0].user.userId, actor.id);
  const { comentario, ...partial } = fullEdit;
  void comentario;
  assert.equal((await api('PUT', '/avulsas/5', partial)).statusCode, 400);

  assert.equal((await api('GET', '/avulsas/5/ticket.pdf')).statusCode, 409);
  assert.equal((await api('POST', '/avulsas/5/pesagem-2', { pesagem_2_kg: 41000 })).statusCode, 200);
  assert.equal((await api('POST', '/avulsas/6/pesagem-2', { pesagem_2_kg: 41000 })).statusCode, 404);
  row = complete;
  assert.equal((await api('POST', '/avulsas/5/pesagem-2', { pesagem_2_kg: 41000 })).statusCode, 409);
  const ticket = await api('GET', '/avulsas/5/ticket.pdf');
  assert.equal(ticket.statusCode, 200);
  assert.equal(ticket.buffer.subarray(0, 4).toString(), '%PDF');

  const csv = await api('GET', '/avulsas.csv');
  assert.equal(csv.statusCode, 200);
  assert.match(csv.text, /Calcário/);

  assert.equal((await api('POST', '/avulsas/5/deletar', { motivo_delecao: 'Pesagem lançada em duplicidade.' })).statusCode, 204);
  assert.equal(updated.at(-1).reason, 'Pesagem lançada em duplicidade.');
});
