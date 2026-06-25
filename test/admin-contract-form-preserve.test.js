const assert = require('node:assert/strict');
const test = require('node:test');
const { renderAdminBuyerFormPage, renderAdminContractFormPage, renderAdminSellerFormPage } = require('../routes/renderers/admin-renderer');

function renderWith(renderer, args) {
  let html = '';
  const res = { send: (value) => { html = value; } };
  renderer(res, args);
  return html;
}

test('buyer form keeps submitted values when rendering validation errors', () => {
  const html = renderWith(renderAdminBuyerFormPage, {
    buyer: {
      nome: 'Comprador Teste',
      nome_completo: 'Comprador Teste LTDA',
      endereco: 'Rua A',
      numero: '123',
      cep: '85800-000',
      inscricao_estadual: '12345',
      cpf_cnpj: '12.345.678/0001-90',
    },
    error: 'Informe uma inscrição estadual com 10 dígitos ou mais.',
  });

  assert.match(html, /value="Comprador Teste"/);
  assert.match(html, /value="Comprador Teste LTDA"/);
  assert.match(html, /value="Rua A"/);
  assert.match(html, /value="123"/);
  assert.match(html, /value="85800-000"/);
  assert.match(html, /value="12345"/);
  assert.match(html, /value="12\.345\.678\/0001-90"/);
  assert.match(html, /Informe uma inscrição estadual com 10 dígitos ou mais\./);
});

test('seller form keeps submitted values when rendering validation errors', () => {
  const html = renderWith(renderAdminSellerFormPage, {
    seller: {
      nome: 'Vendedor Teste',
      nome_completo: 'Vendedor Teste LTDA',
    },
    error: 'Preencha nome e nome completo do vendedor.',
  });

  assert.match(html, /value="Vendedor Teste"/);
  assert.match(html, /value="Vendedor Teste LTDA"/);
  assert.match(html, /Preencha nome e nome completo do vendedor\./);
});

test('contract form keeps submitted values when rendering validation errors', () => {
  const html = renderWith(renderAdminContractFormPage, {
    buyers: [{ id: '7', nome: 'Comprador Teste' }],
    sellers: [{ id: '9', nome: 'Vendedor Teste' }],
    contract: {
      data_contrato: '2026-06-25',
      produto: 'milho',
      preco_por_saca: '65,50',
      comprador_id: '7',
      vendedor_id: '9',
      quantidade_kg: '1000,5',
      contrato_embarcado: true,
      data_recebimento: '2026-07-01',
      contrato_recebido: true,
      corretor: 'Corretor A',
      valor_corretagem_percentual: '1,25',
      corretagem_paga: true,
      inscricao_estadual_vendedor: '1234567890',
      natureza_operacao: 'Venda',
      cfop: '5101',
      razao_social_transportadora: 'Transportadora A',
      cnpj_transportadora: '12345678000190',
      inscricao_estadual_transportadora: 'ISENTO',
      uf_transportadora: 'PR',
      email: 'teste@example.com',
      informacoes_interesse_contribuinte: 'Info fiscal',
      observacoes: 'Observação',
    },
    error: 'Informe um preço por saca válido.',
  });

  assert.match(html, /name="data_contrato" type="date" value="2026-06-25"/);
  assert.match(html, /<option value="milho" selected>Milho<\/option>/);
  assert.match(html, /name="preco_por_saca"[^>]+value="65\.50"/);
  assert.match(html, /<option value="7" selected>Comprador Teste<\/option>/);
  assert.match(html, /<option value="9" selected>Vendedor Teste<\/option>/);
  assert.match(html, /name="quantidade_kg"[^>]+value="1000\.5"/);
  assert.match(html, /name="contrato_embarcado" type="checkbox" checked/);
  assert.match(html, /name="data_recebimento" type="date" value="2026-07-01"/);
  assert.match(html, /name="contrato_recebido" type="checkbox" checked/);
  assert.match(html, /name="corretor" type="text" value="Corretor A"/);
  assert.match(html, /name="valor_corretagem_percentual"[^>]+value="1\.25"/);
  assert.match(html, /name="corretagem_paga" type="checkbox" checked/);
  assert.match(html, /name="inscricao_estadual_vendedor" type="text" value="1234567890"/);
  assert.match(html, /name="natureza_operacao" type="text" value="Venda"/);
  assert.match(html, /name="cfop" type="text" value="5101"/);
  assert.match(html, /name="razao_social_transportadora" type="text" value="Transportadora A"/);
  assert.match(html, /name="cnpj_transportadora" type="text" value="12345678000190"/);
  assert.match(html, /name="inscricao_estadual_transportadora" type="text" value="ISENTO"/);
  assert.match(html, /name="uf_transportadora" type="text" maxlength="2" value="PR"/);
  assert.match(html, /name="email" type="email" value="teste@example.com"/);
  assert.match(html, />Info fiscal<\/textarea>/);
  assert.match(html, />Observação<\/textarea>/);
  assert.match(html, /Informe um preço por saca válido\./);
});
