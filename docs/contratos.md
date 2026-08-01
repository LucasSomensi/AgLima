# Administração de contratos

A página `/admin/contratos` é o ponto central para consulta dos cadastros usados nos contratos da AgroLima. Ela exige acesso de administrador e organiza a operação em três listas independentes: compradores, vendedores e contratos.

## Página principal

A tela principal exibe apenas informações resumidas para manter a navegação rápida:

- **Compradores:** mostra o nome de cada comprador e o botão **Editar**.
- **Vendedores:** mostra o nome de cada vendedor e o botão **Editar**.
- **Contratos:** mostra data, comprador, produto, preço por saca, quantidade em kg e o botão **Editar**.

Na apresentação de pesos, valores em kg são arredondados para o inteiro mais próximo. Valores em sacas também são inteiros nos demais módulos, mas, no contexto de acompanhamento do cumprimento dos contratos (quantidade, quantidade embarcada e saldo), podem ser exibidos com até duas casas decimais.

No topo de cada lista há um botão para criação:

- **Novo comprador** abre `/admin/contratos/compradores/novo`.
- **Novo vendedor** abre `/admin/contratos/vendedores/novo`.
- **Novo contrato** abre `/admin/contratos/contratos/novo`.

A seção de contratos mantém o filtro entre **Em aberto** e **Todos**. Por padrão, a página lista contratos em aberto; a opção **Todos** inclui contratos já encerrados.

## Formulários separados

Os campos de edição e criação ficam fora da página principal para reduzir o tamanho da tela `/admin/contratos`.

### Compradores

- Criação: `/admin/contratos/compradores/novo`.
- Edição: `/admin/contratos/compradores/:id/editar`.
- Campos: nome, nome completo, endereço, número, CEP, inscrição estadual e CPF/CNPJ.

Ao salvar com sucesso, o administrador volta para `/admin/contratos` com uma mensagem de confirmação. Em caso de erro de validação ou duplicidade, o formulário é reaberto com a mensagem de erro.

### Vendedores

- Criação: `/admin/contratos/vendedores/novo`.
- Edição: `/admin/contratos/vendedores/:id/editar`.
- Campos: nome e nome completo.

Ao salvar com sucesso, o administrador volta para `/admin/contratos` com uma mensagem de confirmação. Em caso de erro de validação ou duplicidade, o formulário é reaberto com a mensagem de erro.

### Contratos

- Criação: `/admin/contratos/contratos/novo`.
- Edição: `/admin/contratos/contratos/:id/editar`.
- Campos principais: data do contrato, produto, preço por saca, comprador, vendedor, quantidade em kg, data de recebimento, corretor e percentual de corretagem.
- Marcadores: contrato embarcado, contrato recebido e corretagem paga.
- Campos avançados: inscrição estadual do vendedor, natureza da operação, CFOP, dados da transportadora, e-mail, informações de interesse do contribuinte e observações.

Ao salvar com sucesso, o administrador volta para `/admin/contratos` com uma mensagem de confirmação. Em caso de erro, o formulário é reaberto para correção.

## Regras de contrato em aberto

Um contrato é considerado em aberto quando ainda existe alguma pendência operacional ou financeira, como embarque não marcado, recebimento não marcado ou corretagem não paga. Esses contratos aparecem no filtro padrão **Em aberto** da lista principal.
