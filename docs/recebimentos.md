# Recebimentos de contratos

## Acesso e fluxo

A página `/admin` mostra os últimos 10 recebimentos por ordem de registro e oferece um único link para `/admin/recebimentos`. Essa página reúne o formulário de registro e o histórico completo, paginado em grupos de 30. O administrador escolhe um contrato com saldo positivo, informa a data efetiva, o valor e um comentário opcional, e clica em **Registrar recebimento**. A data `contratos.data_recebimento` continua sendo a previsão, usada nas notificações.

O histórico de um contrato fica em `/balanca/contratos/:id`. O administrador vê ali, além das saídas, o valor bruto, o desconto de SENAR, o valor esperado, o total recebido, o saldo, os lançamentos e a ação manual **Marcar contrato como recebido**. O operador de balança vê apenas os dados operacionais e as saídas; a consulta de recebimentos não é feita para sua sessão. O formulário, a lista geral e a ação de marcação exigem administrador.

Cada lançamento em `contrato_recebimentos` guarda contrato, data efetiva, valor em reais, observação, usuário responsável e instante de registro. Não há edição de lançamentos pela interface atual. O histórico inicial de contratos já recebidos é uma linha de abertura, pois os pagamentos antigos não tinham parcelas registradas.

## Cálculo financeiro

O contrato tem a coluna `desconta_senar boolean NOT NULL DEFAULT true`. O formulário permite escolher **Sim** ou **Não**; o padrão é **Sim**. Na migração, todos os contratos existentes recebem `true`.

1. `bruto = ROUND(quantidade_kg × preco_por_saca ÷ 60, 2)`.
2. Se `desconta_senar`, `desconto = ROUND(bruto × 0,002, 2)`; caso contrário, `desconto = 0`.
3. `valor_esperado = bruto − desconto`.
4. `saldo = valor_esperado − SUM(recebimentos.valor)`.

Os cálculos usam `numeric` no PostgreSQL e arredondam em centavos. Por exemplo, um bruto de R$ 10.000,00 tem desconto de R$ 20,00 e valor esperado de R$ 9.980,00. Sem SENAR, o valor esperado é R$ 10.000,00. Lista, painel, notificações e validação de lançamentos usam essa mesma regra.

O serviço aceita somente valores positivos com até duas casas decimais e datas válidas. A gravação bloqueia a linha do contrato em uma transação e rejeita valores acima do saldo. A edição do contrato não pode reduzir seu novo valor esperado abaixo do total já recebido.

O marcador `contrato_recebido` é uma decisão manual do administrador, separada do saldo calculado. Lançar pagamentos ou alterar o valor do contrato não muda esse marcador. A notificação de recebimento aparece quando chega a data prevista e o marcador ainda é falso, mesmo que a soma já tenha zerado o saldo. Sua única ação é **Marcar como recebido**. O detalhe do contrato também oferece essa ação, inclusive para contratos sem data prevista. Isso permite encerrar um contrato com pequena diferença de centavos sem falsificar um lançamento. Após a marcação, a diferença continua visível no histórico, mas sai do total de pendências financeiras no painel.

## Migração

Aplicar `migrations/20261009_add_contract_receipts.sql` em PostgreSQL 15 ou superior. Em uma transação, ela adiciona `desconta_senar` com padrão `true`, cria `contrato_recebimentos` e gera uma linha de abertura para cada contrato anteriormente marcado como recebido. O valor dessa linha já é o líquido esperado com SENAR. Ela não altera recebimentos lançados por usuários. O preenchimento usa `MERGE` para evitar que o editor SQL do Railway acrescente um `LIMIT` inválido à migração.
