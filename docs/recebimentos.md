# Recebimentos de contratos

## Acesso e fluxo

A página `/admin/contratos/contratos/:id/recebimentos` exige administrador. A lista de contratos liga a essa página e mostra o saldo a receber. A página detalha valor bruto, desconto de SENAR, valor esperado, total recebido, saldo e histórico. O administrador informa a data efetiva, o valor recebido e uma observação opcional. A data `contratos.data_recebimento` continua sendo a previsão, usada nas notificações.

Cada lançamento em `contrato_recebimentos` guarda contrato, data efetiva, valor em reais, observação, usuário responsável e instante de registro. Não há edição de lançamentos pela interface atual. O histórico inicial de contratos já recebidos é uma linha de abertura, pois os pagamentos antigos não tinham parcelas registradas.

## Cálculo financeiro

O contrato tem a coluna `desconta_senar boolean NOT NULL DEFAULT true`. O formulário permite escolher **Sim** ou **Não**; o padrão é **Sim**. Na migração, todos os contratos existentes recebem `true`.

1. `bruto = ROUND(quantidade_kg × preco_por_saca ÷ 60, 2)`.
2. Se `desconta_senar`, `desconto = ROUND(bruto × 0,002, 2)`; caso contrário, `desconto = 0`.
3. `valor_esperado = bruto − desconto`.
4. `saldo = valor_esperado − SUM(recebimentos.valor)`.

Os cálculos usam `numeric` no PostgreSQL e arredondam em centavos. Por exemplo, um bruto de R$ 10.000,00 tem desconto de R$ 20,00 e valor esperado de R$ 9.980,00. Sem SENAR, o valor esperado é R$ 10.000,00. Lista, painel, notificações e validação de lançamentos usam essa mesma regra.

O serviço aceita somente valores positivos com até duas casas decimais e datas válidas. A gravação bloqueia a linha do contrato em uma transação e rejeita valores acima do saldo. A edição do contrato não pode reduzir seu novo valor esperado abaixo do total já recebido. `contrato_recebido` passa a verdadeiro quando os lançamentos completam o valor esperado.

## Migração

Aplicar `migrations/20261009_add_contract_receipts.sql`. Em uma transação, ela adiciona `desconta_senar` com padrão `true`, cria `contrato_recebimentos` e gera uma linha de abertura para cada contrato anteriormente marcado como recebido. O valor dessa linha já é o líquido esperado com SENAR. Ela não altera recebimentos lançados por usuários.
