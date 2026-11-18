const assert = require('node:assert/strict');
const test = require('node:test');
const {
  renderScaleInputClassificationFormPage,
  renderScaleInputDetailPage,
  renderScaleInputFormPage,
  renderScaleInputsListPage,
  renderWeighbridgeHomePage,
} = require('../routes/renderers');
const {
  buildScaleInputClassificationPayload,
  buildScaleInputEditPayload,
  buildScaleInputPayload,
} = require('../routes/weighbridge-service');
const { buildScaleInputTicket } = require('../routes/weighbridge-ticket-pdf');

function renderPage(renderFn, params) {
  let html = '';

  renderFn({ send: (value) => { html = value; } }, params);

  return html;
}

const baseInput = {
  id: 11,
  data_entrada: '2026-06-12T12:30:00.000Z',
  placa_caminhao: 'ABC1D23',
  produto: 'milho',
  peso_bruto_kg: '30000',
  peso_tara_kg: null,
  peso_liquido_kg: null,
  liquido_real_kg: null,
  tara_usada_de_entrada_id: null,
  origem: null,
  umidade_percent: null,
  impureza_percent: null,
  graos_avariados_percent: null,
  cliente_user_id: null,
};

test('input detail enables ticket printing only after tare and net weight', () => {
  const pendingHtml = renderPage(renderScaleInputDetailPage, {
    input: baseInput,
    message: '',
    error: '',
  });
  const completeHtml = renderPage(renderScaleInputDetailPage, {
    input: {
      ...baseInput,
      peso_tara_kg: '10000',
      peso_liquido_kg: '20000',
    },
    message: '',
    error: '',
  });

  assert.match(pendingHtml, /<button class="wb-btn" type="button" disabled title="Imprimir ticket \(falta a tara\)" aria-label="Imprimir ticket">/);
  assert.doesNotMatch(pendingHtml, /href="\/balanca\/entradas\/11\/ticket\.pdf"/);
  assert.match(pendingHtml, /href="\/balanca\/entradas\/11\/tara"[^>]*aria-label="Adicionar tara"/);
  assert.match(completeHtml, /href="\/balanca\/entradas\/11\/ticket\.pdf"[^>]*aria-label="Imprimir ticket" target="_blank"/);
  assert.doesNotMatch(completeHtml, /disabled[^>]*aria-label="Imprimir ticket"/);
});

test('input ticket includes weighing, classification, and reused tare details', () => {
  const ticket = buildScaleInputTicket({
    entrada_id: 11,
    operador_login: 'operador-balanca',
    placa_caminhao: 'ABC1D23',
    produto: 'milho',
    origem: 'Fazenda Boa Vista',
    data_entrada: '2026-06-11T12:30:00.000Z',
    peso_bruto_kg: '42000',
    peso_tara_kg: '10000',
    peso_liquido_kg: '32000',
    tara_usada_de_entrada_id: 3,
    tara_origem_data: '2026-06-10T17:45:00.000Z',
    tara_adicionada_em: '2026-06-11T13:00:00.000Z',
    umidade_percent: '14.25',
    impureza_percent: '1',
    graos_avariados_percent: '0',
  });

  assert.equal(ticket.title, 'Ticket de entrada');
  assert.equal(ticket.number, '11');
  assert.deepEqual(ticket.fields, [
    ['Operador', 'operador-balanca'],
    ['Placa', 'ABC1D23'],
    ['Produto', 'Milho'],
    ['Origem', 'Fazenda Boa Vista'],
  ]);
  assert.deepEqual(ticket.weights.map(({ label, photoType, at }) => [label, photoType, at]), [
    ['Bruto', 'bruto', '2026-06-11T12:30:00.000Z'],
    ['Tara anterior', 'tara', '2026-06-10T17:45:00.000Z'],
  ]);
  assert.equal(ticket.netKg, '32000');
  assert.deepEqual(ticket.extras, [['Umidade', '14,25%'], ['Impureza', '1%'], ['Avariados', '0%']]);
  assert.deepEqual(ticket.signatures, ['Motorista', 'Operador']);

  const manualTare = buildScaleInputTicket({ tara_adicionada_em: '2026-06-11T13:00:00.000Z' });
  assert.deepEqual([manualTare.weights[1].label, manualTare.weights[1].at], ['Tara', '2026-06-11T13:00:00.000Z']);
});

test('weighbridge home renders pending input actions', () => {
  const html = renderPage(renderWeighbridgeHomePage, {
    inputs: [baseInput],
    outputs: [],
    message: '',
    error: '',
  });

  assert.match(html, /id="recent-title">Recentes/);
  assert.match(html, /<tr data-movement-type="entrada">/);
  assert.match(html, /href="\/balanca\/entradas" title="Lista completa de entradas"/);
  assert.match(html, /href="\/balanca\/entradas\/11"/);
  assert.match(html, /href="\/balanca\/entradas\/11\/tara"[^>]*aria-label="Adicionar tara"/);
  assert.match(html, /href="\/balanca\/entradas\/11\/classificacao"[^>]*aria-label="Adicionar classificação"/);
  assert.match(html, /href="\/balanca\/entradas\/11\/origem"[^>]*aria-label="Definir origem"/);
  assert.doesNotMatch(html, /entradas\/11\/ticket\.pdf/);
});

test('weighbridge input plate copies entry report to clipboard only when complete', () => {
  const html = renderPage(renderScaleInputsListPage, {
    inputs: [{
      ...baseInput,
      peso_tara_kg: '12000',
      peso_liquido_kg: '18000',
      liquido_real_kg: '17820',
      origem: 'Fazenda São José',
      umidade_percent: '14',
      impureza_percent: '1',
      graos_avariados_percent: '0',
    }],
  });

  assert.match(html, /<button class="wb-btn wb-btn--sm wb-btn--icon" type="button" data-clipboard-report=/);
  assert.match(html, /data-clipboard-report="12\/06\/2026 09:30&#10;ABC1D23&#10;Fazenda São José&#10;18000kg&#10;Umidade: 14,0%"/);
  assert.match(html, /aria-label="Copiar relatório da entrada ABC1D23"/);
  assert.match(html, /<script src="\/js\/weighbridge-ui\.js"><\/script>/);
});

test('weighbridge input plate is plain text until origin tare and classification are complete', () => {
  const html = renderPage(renderScaleInputsListPage, {
    inputs: [{
      ...baseInput,
      peso_tara_kg: '12000',
      peso_liquido_kg: '18000',
      origem: 'Fazenda São José',
      umidade_percent: '14',
    }],
  });

  assert.match(html, /<a class="wb-plate" href="\/balanca\/entradas\/11">ABC1D23<\/a>/);
  assert.doesNotMatch(html, /data-clipboard-report=/);
});

test('weighbridge home renders completed input states without client action', () => {
  const html = renderPage(renderWeighbridgeHomePage, {
    inputs: [{
      ...baseInput,
      peso_tara_kg: '12000',
      peso_liquido_kg: '18000',
      tara_usada_de_entrada_id: 3,
      origem: 'Fazenda São José',
      umidade_percent: '14',
      impureza_percent: '1',
      graos_avariados_percent: '0',
    }],
    outputs: [],
    message: '',
    error: '',
  });

  assert.match(html, /Tara anterior/);
  assert.match(html, /Fazenda São José/);
  assert.match(html, /title="Umidade 14% · Impureza 1% · Avariados 0%"/);
  assert.match(html, /entradas\/11\/ticket\.pdf/);
  assert.doesNotMatch(html, /aria-label="(Adicionar tara|Definir origem|Adicionar classificação)"/);
  assert.doesNotMatch(html, /Adicionar cliente/);
});

test('input form defaults product by entry date and limits gross weight', () => {
  const aprilHtml = renderPage(renderScaleInputFormPage, {
    formValues: { data_entrada: '2026-04-30T10:00' },
    plateSuggestions: [],
    error: '',
  });
  const mayHtml = renderPage(renderScaleInputFormPage, {
    formValues: { data_entrada: '2026-05-01T10:00' },
    plateSuggestions: [],
    error: '',
  });

  assert.match(aprilHtml, /<option value="soja" selected>Soja<\/option>/);
  assert.match(mayHtml, /<option value="milho" selected>Milho<\/option>/);
  assert.match(mayHtml, /name="peso_bruto_kg"[^>]+max="79999\.999"/);
});

test('classification form defaults to 14, 1, and 0', () => {
  const html = renderPage(renderScaleInputClassificationFormPage, {
    input: baseInput,
    formValues: {},
    error: '',
  });

  assert.match(html, /name="umidade_percent"[^>]+value="14"/);
  assert.match(html, /name="impureza_percent"[^>]+value="1"/);
  assert.match(html, /name="graos_avariados_percent"[^>]+value="0"/);
});

test('input payload supports manual date and current date fallback', () => {
  const withManualDate = buildScaleInputPayload({
    data_entrada: '2026-06-12T09:30',
    placa_caminhao: 'abc-1d23',
    produto: 'milho',
    peso_bruto_kg: '30000',
  });
  const withFallbackDate = buildScaleInputPayload({
    placa_caminhao: 'ABC1D23',
    produto: 'soja',
    peso_bruto_kg: '30000',
  });

  assert.equal(withManualDate.error, undefined);
  assert.equal(withManualDate.payload.placaCaminhao, 'ABC1D23');
  assert.equal(withManualDate.payload.produto, 'milho');
  assert.ok(withManualDate.payload.dataEntrada instanceof Date);
  const overweight = buildScaleInputPayload({
    data_entrada: '2026-06-12T09:30',
    placa_caminhao: 'ABC1D23',
    produto: 'milho',
    peso_bruto_kg: '80000',
  });

  assert.equal(withFallbackDate.error, undefined);
  assert.ok(withFallbackDate.payload.dataEntrada instanceof Date);
  assert.match(overweight.error, /abaixo de 80\.000 kg/);
});

test('classification payload accepts zero damaged grains and rejects over 100', () => {
  const validPayload = buildScaleInputClassificationPayload({
    umidade_percent: '14',
    impureza_percent: '1',
    graos_avariados_percent: '0',
  });
  const invalidPayload = buildScaleInputClassificationPayload({
    umidade_percent: '101',
    impureza_percent: '1',
    graos_avariados_percent: '0',
  });

  assert.deepEqual(validPayload.payload, {
    umidadePercent: '14',
    impurezaPercent: '1',
    graosAvariadosPercent: '0',
  });
  assert.match(invalidPayload.error, /umidade/);
});

test('input detail edit form exposes tare, origin, and classification fields', () => {
  const html = renderPage(renderScaleInputDetailPage, {
    input: {
      ...baseInput,
      peso_tara_kg: '12000',
      peso_liquido_kg: '18000',
      liquido_real_kg: '17820.6',
      origem: 'Fazenda São José',
      umidade_percent: '14',
      impureza_percent: '1',
      graos_avariados_percent: '0',
    },
    formValues: {},
    message: '',
    error: '',
  });

  assert.match(html, /<span class="wb-plate wb-plate--lg">ABC1D23<\/span>/);
  assert.match(html, /Líquido real 17821 kg/);
  assert.match(html, /<details class="wb-details" id="editar">/);
  assert.match(html, /name="peso_tara_kg"[^>]+value="12000"/);
  assert.match(html, /name="origem"[^>]+value="Fazenda São José"/);
  assert.match(html, /name="umidade_percent"[^>]+value="14"/);
  assert.match(html, /name="impureza_percent"[^>]+value="1"/);
  assert.match(html, /name="graos_avariados_percent"[^>]+value="0"/);
  assert.match(html, /name="motivo_delecao"[^>]+minlength="20"/);
  assert.match(html, /class="btn-danger-action deletion-reason-submit" type="submit" disabled>Deletar entrada/);
  assert.match(html, /src="\/js\/deletion-reason.js"/);
});

test('input edit payload accepts complete editable data and blank optional fields', () => {
  const fullPayload = buildScaleInputEditPayload({
    data_entrada: '2026-06-12T09:30',
    placa_caminhao: 'abc-1d23',
    produto: 'milho',
    peso_bruto_kg: '30000',
    peso_tara_kg: '12000',
    origem: '  Fazenda   São José  ',
    umidade_percent: '14',
    impureza_percent: '1',
    graos_avariados_percent: '0',
  });
  const blankPayload = buildScaleInputEditPayload({
    data_entrada: '2026-06-12T09:30',
    placa_caminhao: 'ABC1D23',
    produto: 'soja',
    peso_bruto_kg: '30000',
    peso_tara_kg: '',
    origem: '',
    umidade_percent: '',
    impureza_percent: '',
    graos_avariados_percent: '',
  });
  const invalidTare = buildScaleInputEditPayload({
    data_entrada: '2026-06-12T09:30',
    placa_caminhao: 'ABC1D23',
    produto: 'milho',
    peso_bruto_kg: '30000',
    peso_tara_kg: '30000',
  });

  assert.equal(fullPayload.error, undefined);
  assert.equal(fullPayload.payload.placaCaminhao, 'ABC1D23');
  assert.equal(fullPayload.payload.pesoTaraKg, '12000');
  assert.equal(fullPayload.payload.origem, 'Fazenda São José');
  assert.equal(fullPayload.payload.graosAvariadosPercent, '0');
  assert.equal(blankPayload.payload.pesoTaraKg, null);
  assert.equal(blankPayload.payload.origem, null);
  assert.equal(blankPayload.payload.umidadePercent, null);
  assert.match(invalidTare.error, /maior que o peso tara/);
});

const { buildScaleInputsCsv } = require('../routes/weighbridge-csv');

test('scale inputs CSV exports rows in the provided chronological order and escapes fields', () => {
  const csv = buildScaleInputsCsv([
    {
      ...baseInput,
      data_entrada: '2026-06-10T08:00:00.000Z',
      origem: 'Fazenda "A", Talhão 1',
      umidade_percent: '14',
      impureza_percent: '1',
      graos_avariados_percent: '0',
    },
    {
      ...baseInput,
      id: 12,
      data_entrada: '2026-06-11T08:00:00.000Z',
      placa_caminhao: 'DEF4G56',
      origem: null,
    },
  ]);

  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');

  assert.equal(rows[0], 'Data;Hora;Placa;Produto;Bruto kg;Tara kg;Liquido kg;Origem;Umidade %;Impureza %;Graos avariados %');
  assert.match(rows[1], /^10\/06\/2026;05:00:00;ABC1D23/);
  assert.match(rows[1], /"Fazenda ""A"", Talhão 1"/);
  assert.match(rows[1], /;30\.000;;;"Fazenda/);
  assert.match(rows[2], /^11\/06\/2026;05:00:00;DEF4G56/);
});

test('scale inputs CSV preserves whole kilogram weights without dividing by one thousand', () => {
  const csv = buildScaleInputsCsv([
    {
      ...baseInput,
      peso_bruto_kg: '61170',
      peso_tara_kg: '10000',
      peso_liquido_kg: '51170',
    },
  ]);

  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');

  assert.match(rows[1], /;61\.170;10\.000;51\.170;/);
});
