const assert = require('node:assert/strict');
const test = require('node:test');
const {
  renderScaleInputClassificationFormPage,
  renderScaleInputFormPage,
  renderWeighbridgeHomePage,
} = require('../routes/renderers');
const {
  buildScaleInputClassificationPayload,
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
  assert.match(html, /href="\/balanca\/entradas">Ver lista completa/);
  assert.match(html, /href="\/balanca\/entradas\/11">/);
  assert.match(html, /href="\/balanca\/entradas\/11\/tara">Adicionar tara/);
  assert.match(html, /href="\/balanca\/entradas\/11\/classificacao">Adicionar classificação/);
  assert.match(html, /href="\/balanca\/entradas\/11\/origem">Definir origem/);
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
