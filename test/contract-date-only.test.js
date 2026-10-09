const assert = require('node:assert/strict');
const test = require('node:test');
const { renderAdminContractsPage } = require('../routes/renderers');
const { buildContractPayload } = require('../routes/contract-service');
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

test('contract payload converts blank fiscal fields and observations to null', () => {
  const { payload, error } = buildContractPayload({
    data_contrato: '2026-06-17',
    produto: 'soja',
    preco_por_saca: '120.50',
    comprador_id: '1',
    vendedor_id: '2',
    quantidade_kg: '1000',
    inscricao_estadual_vendedor: ' ',
    natureza_operacao: '',
    cfop: '',
    informacoes_interesse_contribuinte: '',
    razao_social_transportadora: '',
    cnpj_transportadora: '',
    inscricao_estadual_transportadora: '',
    uf_transportadora: '',
    email: '',
    observacoes: '',
  });

  assert.equal(error, undefined);
  assert.equal(payload.inscricaoEstadualVendedor, null);
  assert.equal(payload.naturezaOperacao, null);
  assert.equal(payload.cfop, null);
  assert.equal(payload.informacoesInteresseContribuinte, null);
  assert.equal(payload.razaoSocialTransportadora, null);
  assert.equal(payload.cnpjTransportadora, null);
  assert.equal(payload.inscricaoEstadualTransportadora, null);
  assert.equal(payload.ufTransportadora, null);
  assert.equal(payload.email, null);
  assert.equal(payload.observacoes, null);
});
