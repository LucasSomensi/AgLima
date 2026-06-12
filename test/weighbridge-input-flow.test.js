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
  tara_usada_de_entrada_id: null,
  origem: null,
  umidade_percent: null,
  impureza_percent: null,
  graos_avariados_percent: null,
  cliente_user_id: null,
};

test('weighbridge home renders pending input actions', () => {
  const html = renderPage(renderWeighbridgeHomePage, {
    inputs: [baseInput],
    outputs: [],
    message: '',
    error: '',
  });

  assert.match(html, /Últimas 10 entradas/);
  assert.match(html, /<th>Classificação<\/th>/);
  assert.match(html, /href="\/balanca\/entradas">Ver lista completa/);
  assert.match(html, /href="\/balanca\/entradas\/11">/);
  assert.match(html, /href="\/balanca\/entradas\/11\/tara">Adicionar tara/);
  assert.match(html, /href="\/balanca\/entradas\/11\/classificacao">Adicionar classificação/);
  assert.match(html, /href="\/balanca\/entradas\/11\/origem">Definir origem/);
});


test('weighbridge inputs list uses classification as the final input column', () => {
  const html = renderPage(renderScaleInputsListPage, {
    inputs: [baseInput],
  });

  assert.match(html, /<th>Classificação<\/th>/);
  assert.doesNotMatch(html, /<th>Ação<\/th>/);
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
  assert.match(html, /Classificada/);
  assert.doesNotMatch(html, /Adicionar cliente/);
});

test('input form renders recent plate suggestions and previous tare checkbox', () => {
  const html = renderPage(renderScaleInputFormPage, {
    formValues: {},
    plateSuggestions: [{ placa_caminhao: 'ABC1D23', tem_tara_anterior: true, peso_tara_kg: '12000' }],
    error: '',
  });

  assert.match(html, /ABC1D23/);
  assert.match(html, /Usar tara anterior/);
  assert.match(html, /id="usar_tara_anterior"/);
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
      origem: 'Fazenda São José',
      umidade_percent: '14',
      impureza_percent: '1',
      graos_avariados_percent: '0',
    },
    formValues: {},
    message: '',
    error: '',
  });

  assert.match(html, /<dt>Placa<\/dt><dd>ABC1D23<\/dd>/);
  assert.match(html, /name="peso_tara_kg"[^>]+value="12000"/);
  assert.match(html, /name="origem"[^>]+value="Fazenda São José"/);
  assert.match(html, /name="umidade_percent"[^>]+value="14"/);
  assert.match(html, /name="impureza_percent"[^>]+value="1"/);
  assert.match(html, /name="graos_avariados_percent"[^>]+value="0"/);
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
