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

test('contract form renders fiscal fields inside collapsed advanced section', () => {
  const html = renderContractsPage({
    id: 1,
    inscricao_estadual_vendedor: '1234567890',
    natureza_operacao: 'Venda de produção do estabelecimento',
    cfop: '5101',
    informacoes_interesse_contribuinte: 'Informação complementar',
    razao_social_transportadora: 'Transportadora Exemplo LTDA',
    cnpj_transportadora: '00.000.000/0001-00',
    inscricao_estadual_transportadora: 'ISENTO',
    uf_transportadora: 'PR',
    email: 'nf@example.com',
    observacoes: 'Observação do contrato',
  });

  assert.match(html, /<details class="contracts-advanced-fields">/);
  assert.match(html, /<summary class="btn-secondary-action contracts-advanced-toggle">avançado<\/summary>/);
  assert.match(html, /name="inscricao_estadual_vendedor" type="text" value="1234567890"/);
  assert.match(html, /name="natureza_operacao" type="text" value="Venda de produção do estabelecimento"/);
  assert.match(html, /name="cfop" type="text" value="5101"/);
  assert.match(html, /name="razao_social_transportadora" type="text" value="Transportadora Exemplo LTDA"/);
  assert.match(html, /name="cnpj_transportadora" type="text" value="00.000.000\/0001-00"/);
  assert.match(html, /name="inscricao_estadual_transportadora" type="text" value="ISENTO"/);
  assert.match(html, /name="uf_transportadora" type="text" maxlength="2" value="PR"/);
  assert.match(html, /name="email" type="text" value="nf@example.com"/);
  assert.match(html, /name="informacoes_interesse_contribuinte" rows="3"[^>]*>Informação complementar<\/textarea>/);
  assert.match(html, /name="observacoes" rows="3"[^>]*>Observação do contrato<\/textarea>/);
  assert.match(html, /Campos avançados em branco serão salvos como nulos\./);
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
