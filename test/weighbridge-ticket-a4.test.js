const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example.invalid/agrolima';

const { pool } = require('../routes/database');
const { ROLES } = require('../routes/constants');
const { setSessionCookie } = require('../routes/auth');
const userService = require('../routes/user-service');
const storage = require('../routes/scale-photo-storage');
const photoService = require('../routes/scale-photo-service');
const {
  buildScaleInputTicketPdf,
  buildScaleOutputTicketPdf,
  buildStandaloneWeighingTicketPdf,
} = require('../routes/weighbridge-ticket-pdf');

const PHOTO = fs.readFileSync(path.join(__dirname, '../public/images/silos.jpeg'));

const output = {
  saida_id: 7,
  operador_login: 'balanca',
  placa_caminhao: 'ABC1D23',
  nome_motorista: 'Motorista Com Um Nome Bem Comprido Para Testar Quebra De Linha No Ticket',
  produto: 'soja',
  vendedor_nome_completo: 'Vendedor',
  comprador_nome_completo: 'Comprador',
  contrato_id: 3,
  data_saida: '2026-11-17T12:00:00Z',
  peso_bruto_adicionado_em: '2026-11-17T14:00:00Z',
  peso_tara_kg: '15320',
  peso_bruto_kg: '47350',
  peso_liquido_kg: '32030',
};

function countImages(pdf) {
  return (pdf.toString('latin1').match(/\/Subtype \/Image/g) || []).length;
}

function photo(tipoPeso, extra = {}) {
  return { tipo_peso: tipoPeso, peso_kg: 15320, capturada_em: '2026-11-17T12:00:00Z', contingencia: false, buffer: PHOTO, ...extra };
}

test('ticket is a single A4 page holding both copies', async () => {
  const pdf = await buildScaleOutputTicketPdf(output);
  const raw = pdf.toString('latin1');

  assert.equal(raw.slice(0, 5), '%PDF-');
  assert.match(raw, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(raw, /\/Type \/Pages\s*\/Count 1/);
  assert.equal(countImages(pdf), 0);
});

test('each photo is embedded once and reused by both copies', async () => {
  const pdf = await buildScaleOutputTicketPdf(output, { photos: [photo('tara'), photo('bruto', { peso_kg: 47350 })] });
  assert.equal(countImages(pdf), 2);
  assert.ok(pdf.length < (PHOTO.length * 2) + 50000, 'cada foto aparece uma única vez no arquivo');
});

test('only photos matching the ticket weights are printed', async () => {
  const inputPdf = await buildScaleInputTicketPdf(
    { entrada_id: 1, peso_bruto_kg: '40000', peso_tara_kg: '15000', peso_liquido_kg: '25000' },
    { photos: [photo('bruto'), photo('pesagem_1')] }
  );
  assert.equal(countImages(inputPdf), 1);

  const standalonePdf = await buildStandaloneWeighingTicketPdf(
    { id: 5, pesagem_1_kg: 15320, pesagem_2_kg: 41000, peso_liquido_kg: 25680 },
    { photos: [photo('pesagem_2'), photo('tara')] }
  );
  assert.equal(countImages(standalonePdf), 1);
});

test('a photo that is not a valid image is skipped without failing the ticket', async (t) => {
  t.mock.method(console, 'error', () => {});
  const pdf = await buildScaleOutputTicketPdf(output, {
    photos: [photo('tara', { buffer: Buffer.from('nao e imagem') }), photo('bruto')],
  });
  assert.equal(countImages(pdf), 1);
});

test('ticket photos keep the latest photo of each weight type and skip unreadable files', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agrolima-ticket-'));
  const previous = process.env.FOTOS_DIR;
  process.env.FOTOS_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.FOTOS_DIR;
    else process.env.FOTOS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  t.mock.method(console, 'error', () => {});

  const oldTare = storage.buildStoredPhotoPath('capturas');
  const newTare = storage.buildStoredPhotoPath('capturas');
  const missingGross = storage.buildStoredPhotoPath('capturas');
  await storage.writePhotoAtomically(oldTare, PHOTO);
  await storage.writePhotoAtomically(newTare, PHOTO);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, values) => {
    calls.push({ sql, values });
    return {
      rows: [
        { id: 'a', tipo_peso: 'tara', arquivo: oldTare },
        { id: 'b', tipo_peso: 'tara', arquivo: newTare },
        { id: 'c', tipo_peso: 'bruto', arquivo: missingGross },
      ],
    };
  });

  const photos = await photoService.loadTicketPhotos({ saidaId: '7' });

  assert.match(calls[0].sql, /WHERE saida_id = \$1/);
  assert.deepEqual(photos.map((item) => item.id), ['b']);
  assert.ok(Buffer.isBuffer(photos[0].buffer));
});

test('ticket photos degrade to none when the photo table is unavailable', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(pool, 'query', async () => { throw new Error('relation does not exist'); });
  assert.deepEqual(await photoService.loadTicketPhotos({ entradaId: '1' }), []);
});

test('output ticket route prints the linked photos', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agrolima-ticket-route-'));
  const previous = process.env.FOTOS_DIR;
  process.env.FOTOS_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.FOTOS_DIR;
    else process.env.FOTOS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const arquivo = storage.buildStoredPhotoPath('capturas');
  await storage.writePhotoAtomically(arquivo, PHOTO);

  const user = {
    id: 'a1b2c3d4-0000-4000-8000-000000000001', login: 'balanca', role: ROLES.WEIGHBRIDGE_OPERATOR,
    disabled: false, must_change_password: false, session_version: 1,
  };
  t.mock.method(userService, 'findActiveUserById', async () => user);
  const headers = {};
  setSessionCookie({ setHeader: (name, value) => { headers[name] = value; } }, user);
  const cookie = headers['Set-Cookie'].split(';')[0];

  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM balanca_fotos/.test(sql)) {
      return { rows: [{ id: 'p1', tipo_peso: 'bruto', arquivo, peso_kg: 47350, capturada_em: '2026-11-17T14:00:00Z', contingencia: false }] };
    }
    return { rows: [output] };
  });

  const app = require('../app');
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: '/balanca/saidas/7/ticket.pdf', headers: { Cookie: cookie },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(countImages(response.body), 1);
});
