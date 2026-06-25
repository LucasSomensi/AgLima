# Fluxo de saídas da balança

Este documento resume o contexto técnico e operacional do fluxo de saídas da balança para facilitar manutenções futuras.

## Objetivo do fluxo

O operador de balança registra o carregamento de produto que sai da unidade, informando data/hora, placa, produto e tara; o peso bruto é adicionado depois nas listas da balança. A saída nasce sem contrato associado e, depois do lançamento, pode ser associada a um comprador/contrato com saldo disponível. A partir da associação, o sistema disponibiliza as informações necessárias para emissão de nota fiscal mantendo os saldos calculados nas listagens sem marcar automaticamente o contrato como embarcado.

Além do lançamento e da associação, o operador pode consultar a lista completa de saídas, abrir a tela de detalhes, dividir uma saída em duas cargas, deletar uma saída e desvincular uma saída de um contrato quando for necessário corrigir a associação.

## Banco de dados

A tabela principal do fluxo é `saidas_balanca`.

Campos centrais:

- `data_saida`: data/hora operacional da saída. O formulário sugere a data/hora atual, mas permite edição manual.
- `placa_caminhao`: placa normalizada em maiúsculas, sem pontuação, validada no padrão `ABC1234` ou `ABC1D23`.
- `produto`: usa o tipo `public.produto_contrato`, o mesmo de `contratos.produto` e `entradas_balanca.produto`; a aplicação aceita `milho` e `soja`.
- `peso_tara_kg`: peso tara informado na criação da saída; deve ser positivo.
- `peso_bruto_kg`: peso bruto informado depois da criação da saída; deve ser positivo e maior que a tara.
- `peso_liquido_kg`: coluna gerada pelo PostgreSQL a partir de `peso_bruto_kg - peso_tara_kg`.
- `criado_por_user_id`: operador de balança que registrou a saída.
- `contrato_id`: contrato associado à saída. Enquanto nulo, a saída permanece pendente de associação.
- `associado_por_user_id`: operador que associou a saída ao contrato.
- `associado_em`: data/hora da associação.
- `criado_em` e `atualizado_em`: datas de auditoria do registro.

Tabelas relacionadas:

- `contratos`: fornece produto, quantidade contratada, preço por saca, vendedor, comprador, observações e status `contrato_embarcado`.
- `compradores`: fornece nome curto para seleção e dados cadastrais completos para nota fiscal.
- `vendedores`: fornece dados do vendedor usados nas informações de nota fiscal.
- `users`: identifica os operadores que criam e associam saídas.

Restrições relevantes:

- A associação é completa: `contrato_id`, `associado_por_user_id` e `associado_em` devem estar todos preenchidos ou todos nulos.
- O banco exige peso bruto positivo. Quando a tara é preenchida, ela deve ser positiva e menor que o peso bruto.
- A placa deve respeitar o formato aceito pelo banco e pela aplicação.
- A saída pode ser associada a no máximo um contrato por vez.

## Arquivos principais

- `routes/weighbridge-routes.js`: rotas HTTP do operador de balança para listar, criar, associar, dividir, deletar, consultar NF e desvincular contrato de saídas.
- `routes/weighbridge-service.js`: validações, normalização dos dados, queries de saída, queries de contratos elegíveis e transações de associação/divisão/deleção/desvinculação.
- `routes/renderers.js`: renderização das listas, formulário de saída, associação, detalhes, contratos e informações de NF.
- `views/weighbridge-home.html`: página inicial `/balanca` com últimas entradas, últimas saídas e atalhos de operação.
- `views/weighbridge-outputs.html`: lista completa de saídas.
- `views/weighbridge-output-form.html`: formulário de nova saída.
- `views/weighbridge-output-detail.html`: tela de detalhes, divisão e deleção da saída.
- `views/weighbridge-associate-output.html`: seleção de comprador e contrato para associação.
- `views/weighbridge-output-invoice.html`: tela de informações para nota fiscal e desvinculação de contrato.
- `views/weighbridge-contracts.html`: lista de contratos com embarque pendente.
- `views/weighbridge-contract-detail.html`: detalhe de contrato aberto com saídas associadas.
- `public/css/styles.css`: estilos compartilhados e específicos das telas da balança.

## Rotas implementadas

- `GET /balanca`: lista as 10 últimas entradas e as 10 últimas saídas. A seção de saídas mostra data/hora, placa, produto, peso bruto, tara, peso líquido, contrato e ação.
- `GET /balanca/saidas`: lista todas as saídas em ordem cronológica reversa.
- `GET /balanca/saidas/nova`: abre o formulário de nova saída.
- `POST /balanca/saidas`: valida e cria uma saída com tara e sem peso bruto.
- `GET /balanca/saidas/:id`: abre a tela de detalhes da saída.
- `GET /balanca/saidas/:id/bruto`: abre o formulário para adicionar peso bruto a uma saída pendente.
- `POST /balanca/saidas/:id/bruto`: valida e grava o peso bruto da saída pendente.
- `POST /balanca/saidas/:id/dividir`: divide uma saída em duas, a partir do peso líquido desejado para a primeira saída.
- `POST /balanca/saidas/:id/deletar`: deleta a saída e recalcula o status de embarque do contrato associado, se houver.
- `GET /balanca/saidas/:id/associar`: abre a tela de associação de saída a contrato.
- `POST /balanca/saidas/:id/associar`: associa a saída selecionada ao contrato escolhido.
- `GET /balanca/saidas/:id/nf`: exibe as informações de nota fiscal da saída e do contrato associado.
- `POST /balanca/saidas/:id/desvincular-contrato`: remove a associação entre saída e contrato e recalcula o status de embarque do contrato.
- `GET /balanca/contratos`: lista contratos abertos com saldo positivo para embarque.
- `GET /balanca/contratos/:id`: exibe detalhe de contrato aberto e as saídas já associadas a ele.

## Fluxo operacional do operador

### 1. Acessar a área da balança

O usuário com perfil `weighbridge_operator` acessa `/balanca`. A tela inicial mostra:

- Atalhos para adicionar entrada, adicionar saída e consultar contratos.
- As 10 entradas mais recentes.
- As 10 saídas mais recentes.
- Link “Ver lista completa” na seção de saídas, apontando para `/balanca/saidas`.

Na lista de saídas, a data/hora é link para `/balanca/saidas/:id`. A coluna “Contrato” mostra `Pendente` quando ainda não há associação, ou link para o contrato quando `contrato_id` existe. A coluna “Ação” mostra “Associar contrato” para saídas pendentes e “Informações NF” para saídas já associadas.

### 2. Registrar uma nova saída

O operador clica em “Adicionar saída” e abre `/balanca/saidas/nova`.

Campos do formulário:

- Data e hora da saída (`data_saida`), preenchida inicialmente com a data/hora atual.
- Placa do caminhão (`placa_caminhao`).
- Produto (`produto`), selecionado entre milho e soja.
- Peso tara em kg (`peso_tara_kg`).

Ao enviar o formulário, `buildScaleOutputPayload` normaliza e valida os dados:

- Data/hora precisa ser válida.
- Placa é convertida para maiúsculas, sem caracteres não alfanuméricos, e precisa seguir `ABC1234` ou `ABC1D23`.
- Produto precisa ser `milho` ou `soja`.
- O peso tara aceita vírgula ou ponto decimal e precisa ser positivo e numérico.

Se houver erro, o formulário é renderizado novamente com os valores informados e a mensagem de validação. Se passar, `createScaleOutput` insere a saída em `saidas_balanca` com `peso_bruto_kg` nulo, `contrato_id` nulo e `criado_por_user_id` do operador logado. Depois o usuário volta para `/balanca` com a mensagem “Saída adicionada com sucesso.”

### 3. Consultar saídas

A tela inicial mostra apenas as 10 saídas mais recentes. Para auditoria ou busca manual, `/balanca/saidas` lista todas as saídas usando a mesma ordenação: `ORDER BY data_saida DESC, id DESC`.

As linhas exibem:

- Data/hora com link para a tela de detalhes.
- Placa.
- Produto.
- Peso bruto formatado em kg ou link “Adicionar bruto”.
- Tara formatada em kg.
- Peso líquido formatado em kg ou “-” enquanto o peso bruto estiver pendente.
- Contrato associado ou pendência.
- Ação contextual: associar contrato ou abrir informações de NF. A associação pode acontecer mesmo enquanto o peso bruto está pendente.

### 4. Abrir detalhes da saída

Em `/balanca/saidas/:id`, a tela mostra os dados operacionais principais:

- Data/hora.
- Placa.
- Produto.
- Peso tara.
- Peso bruto.
- Peso líquido.

Cada campo exibido possui botão “Copiar”, útil para conferência ou transcrição. A tela também mostra um link contextual:

- “Associar contrato”, se a saída ainda não possui contrato, mesmo antes do peso bruto.
- “Ver informações NF”, se a saída já possui contrato.

Na mesma tela ficam as ações de divisão e deleção quando já há peso líquido. Enquanto o peso bruto está pendente, a tela mostra a ação de adicionar bruto e mantém a deleção disponível; a associação ao contrato continua disponível pelo link contextual.

### 5. Associar saída a contrato

Uma saída recém-criada fica pendente de peso bruto e de contrato. O operador pode iniciar a associação pela lista ou pelo detalhe da saída, em `/balanca/saidas/:id/associar`, mesmo antes de adicionar o bruto. O peso bruto pode ser adicionado pela lista ou pelo detalhe da saída quando o caminhão retornar à balança. A tela `/balanca/saidas/:id/bruto` também possui o campo `Data e hora do peso bruto`, com o mesmo padrão de `datetime-local` usado na criação da saída: o valor inicial é a data/hora atual e o operador pode ajustar antes de salvar. Ao confirmar, o backend grava `peso_bruto_kg`, `peso_bruto_adicionado_em` e `atualizado_em`.

A tela de associação funciona em duas etapas:

1. O operador escolhe o comprador.
2. O sistema carrega os contratos disponíveis para aquele comprador e produto.

A seleção de compradores é calculada por `listEligibleBuyersForOutput`, considerando:

- A saída precisa existir e ainda estar sem contrato.
- O contrato precisa ter o mesmo produto da saída.
- O contrato não pode estar marcado como totalmente embarcado.
- O saldo do contrato precisa ser positivo, calculado como `contratos.quantidade_kg - SUM(saidas_balanca.peso_liquido_kg)` das saídas já associadas.

Depois que um comprador é escolhido, `listEligibleContractsForOutput` lista apenas os contratos elegíveis daquele comprador, com data, saldo e preço por saca. Se houver apenas um contrato disponível, ele é selecionado automaticamente pelo renderer. Se não houver contratos disponíveis, o botão de associação fica desabilitado e a tela informa a ausência de contrato com embarque pendente.

No envio do formulário, `associateScaleOutputToContract` executa a associação em transação:

- Bloqueia a saída (`FOR UPDATE`) e garante que ela existe e ainda está sem contrato.
- Bloqueia o contrato (`FOR UPDATE`) e confere comprador, produto e status.
- Recalcula a quantidade já embarcada do contrato.
- Rejeita contratos já embarcados ou sem saldo.
- Atualiza `saidas_balanca.contrato_id`, `associado_por_user_id`, `associado_em` e `atualizado_em`.
- Não altera `contratos.contrato_embarcado`; mesmo que a soma embarcada atinja ou ultrapasse a quantidade do contrato, a marcação de embarcado depende de ação manual de administrador.

Após sucesso, o operador retorna à tela inicial com “Saída associada ao contrato com sucesso.”

> Observação: a implementação atual não rejeita uma saída cujo peso líquido seja maior que o saldo restante; nesses casos, o saldo calculado pode chegar a zero ou ficar negativo, mas o contrato não é marcado como embarcado automaticamente.

### 6. Gerar e conferir informações para nota fiscal

A tela `/balanca/saidas/:id/nf` consolida a saída e o contrato associado.

Se a saída ainda não estiver associada, a tela informa que é necessário associar um contrato e mostra o botão de associação.

Se houver contrato, a tela exibe:

- Resumo da saída: data/hora, placa, produto e peso líquido.
- Dados fiscais do vendedor: nome completo e inscrição estadual.
- Dados fiscais do comprador: CPF/CNPJ, inscrição estadual, CEP, endereço e número.
- Dados da operação: natureza da operação, informações adicionais de interesse do contribuinte, produto, CFOP, peso líquido em kg e ton, preço por kg e preço por ton.
- Dados da transportadora: CNPJ, inscrição estadual, razão social, UF e placa.
- Observações do contrato.

Todos os campos relevantes possuem botão “Copiar”. O preço por kg é calculado na query com `round(preco_por_saca / 60, 10)` e o preço por ton com `round(preco_por_saca / 60 * 1000, 10)`, limitando ambos a no máximo 10 casas decimais.

### 7. Dividir uma saída

A divisão é feita na tela de detalhes, em `/balanca/saidas/:id`, pelo formulário “Dividir saída”. O operador informa o peso líquido desejado para a primeira saída.

O frontend calcula e exibe, em tempo real, o peso líquido estimado da segunda saída. O backend é a fonte de validação obrigatória em `splitScaleOutput`:

- O peso líquido da primeira saída precisa ser decimal positivo.
- A saída precisa existir.
- O peso líquido da primeira saída precisa ser menor que o peso líquido original.

A transação aplica a divisão assim:

1. Mantém a saída original como a primeira saída.
2. Atualiza o peso bruto da saída original para `peso_tara_original + peso_liquido_primeira`.
3. Cria uma nova saída com os mesmos `data_saida`, `placa_caminhao` e `produto`.
4. Na nova saída, usa como tara o novo bruto da primeira saída e como bruto o bruto original.
5. A nova saída preserva `peso_bruto_adicionado_em` da saída original.
6. A nova saída nasce sem contrato associado.
7. Não altera o status `contrato_embarcado` do contrato originalmente associado; os saldos continuam sendo calculados pelas consultas.

Efeito importante: se a saída original já estava associada a um contrato, a associação fica na primeira saída após a divisão. A segunda saída gerada fica pendente de associação e deve ser associada manualmente, se aplicável.

Após sucesso, o operador volta para `/balanca` com “Saída dividida com sucesso.”

### 8. Deletar uma saída

A tela de detalhes possui o campo “Motivo da deleção” antes do botão “Deletar saída”, com confirmação no navegador. O botão fica desabilitado até o motivo ter pelo menos 20 caracteres. O `POST /balanca/saidas/:id/deletar` valida o motivo e executa `deleteScaleOutput` em transação:

- Bloqueia a saída.
- Verifica se ela existe.
- Remove o registro de `saidas_balanca`.
- Se havia contrato associado, não altera `contrato_embarcado`; o total remanescente embarcado continua refletido nos cálculos de saldo das consultas.

Após sucesso, o operador volta para `/balanca` com “Saída deletada com sucesso.”

### 9. Desvincular uma saída de contrato

A ação de desvincular aparece na tela de informações NF quando a saída está associada. O formulário chama `POST /balanca/saidas/:id/desvincular-contrato`.

`unlinkScaleOutputFromContract` executa em transação:

- Bloqueia a saída.
- Garante que ela existe.
- Garante que há contrato associado.
- Limpa `contrato_id`, `associado_por_user_id` e `associado_em`.
- Atualiza `atualizado_em`.
- Não altera o status `contrato_embarcado` do contrato que perdeu a saída; o saldo volta a ser refletido apenas pelos cálculos das consultas.

Após sucesso, o operador volta para `/balanca/saidas/:id/nf` com a mensagem “Contrato desvinculado da saída com sucesso.” Como a saída fica sem contrato, a tela passa a oferecer associação novamente.

### 10. Consultar contratos pendentes pela balança

O operador também pode acessar `/balanca/contratos`, que lista contratos com embarque pendente. A lista considera contratos cujo `contrato_embarcado IS NOT TRUE` e cujo saldo calculado é positivo.

A linha de cada contrato mostra:

- Número do contrato, com link para `/balanca/contratos/:id`.
- Data do contrato.
- Comprador.
- Produto.
- Quantidade contratada.
- Quantidade já embarcada.
- Saldo.

No detalhe do contrato, o operador vê os dados completos necessários à operação e uma tabela de saídas associadas ao contrato. Cada saída associada possui link para sua tela de detalhes e link direto para “Informações NF”.

## Regras de negócio atuais

### Peso líquido

O operador não informa peso líquido diretamente na criação da saída. O banco calcula `peso_liquido_kg` como diferença entre peso bruto e peso tara.

### Associação a contrato

A associação é sempre feita depois da criação da saída. Não existe criação de saída já associada a contrato no formulário atual.

Contratos elegíveis precisam:

- Pertencer ao comprador selecionado.
- Ter o mesmo produto da saída.
- Não estar finalizados como embarcados.
- Ter saldo positivo considerando as saídas já associadas.

### Atualização automática de contrato embarcado

Ao associar, adicionar bruto, dividir, deletar ou desvincular uma saída, o fluxo da balança não altera `contrato_embarcado`. O saldo do contrato continua sendo calculado pela diferença entre `quantidade_kg` e a soma dos pesos líquidos das saídas associadas, podendo chegar a zero ou ficar negativo. A marcação de contrato embarcado depende de ação manual de administrador.

Assim, deleção, desvinculação e divisão apenas mudam as saídas associadas e, por consequência, os saldos calculados; nenhuma dessas ações finaliza ou reabre contrato automaticamente.

### Divisão de saída

A divisão preserva os dados operacionais da saída original, mas altera os pesos para separar a carga em duas saídas encadeadas. A nova saída usa como tara o novo bruto da primeira, e como bruto o bruto original. Isso faz com que o líquido da nova saída represente a sobra da carga original.

### Correções permitidas e limitações

- Não há rota de edição direta de data/hora, placa, produto ou pesos de uma saída já criada.
- Correções de associação devem ser feitas por desvinculação e nova associação.
- Correções de lançamento operacional incorreto exigem deletar e recriar a saída, ou dividir quando o problema for separação de carga.
- A deleção é definitiva e usa apenas confirmação do navegador.

## Mensagens de sucesso e erro

Mensagens de sucesso exibidas após redirects de saída:

- `saida_criada`: “Saída adicionada com sucesso.”
- `saida_deletada`: “Saída deletada com sucesso.”
- `saida_dividida`: “Saída dividida com sucesso.”
- `saida_bruto_adicionado`: “Peso bruto adicionado à saída com sucesso.”
- `saida_associada`: “Saída associada ao contrato com sucesso.”
- `contrato_desvinculado`: “Contrato desvinculado da saída com sucesso.”, exibida na tela de informações NF após a desvinculação.

As mensagens de criação, deleção, divisão e associação retornam para `/balanca`. Erros de validação de criação aparecem no próprio formulário. Erros de associação, divisão, deleção, NF e desvinculação redirecionam para a tela mais próxima da ação com a mensagem retornada pelo serviço ou uma mensagem genérica.

## Pontos de atenção para manutenção

- `associateScaleOutputToContract`, `splitScaleOutput`, `deleteScaleOutput` e `unlinkScaleOutputFromContract` usam transações porque alteram registros de saída e associação de contrato.
- `refreshContractShippedStatus` não altera `contrato_embarcado`; a função permanece inofensiva para chamadas existentes e documenta que a finalização do contrato é manual.
- A lista de saídas e as listas de contratos calculam saldos por agregação de `saidas_balanca.peso_liquido_kg`; qualquer mudança no cálculo de peso líquido ou na associação impacta esses saldos.
- A página de NF depende de joins com `contratos`, `compradores` e `vendedores`; campos cadastrais faltantes nesses cadastros afetam a conferência da nota.
- A rota genérica `GET /balanca/saidas/:id` fica depois das rotas específicas `/associar` e `/nf`, evitando conflito de roteamento.
