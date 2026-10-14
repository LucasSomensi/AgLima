# Auditoria de ações da balança

Este documento descreve a trilha de auditoria criada para registrar ações sensíveis feitas por usuários nas entradas e saídas da balança.

## Objetivo

A tabela `auditoria_acoes` guarda uma linha para cada ação auditável executada pelo sistema. A linha registra o usuário responsável, a entidade afetada, o tipo da ação, snapshots em JSON antes/depois da mudança e metadados específicos da operação.

A estratégia principal é manter a tabela flexível: `tipo_acao`, `entidade_tipo` e `entidade_id` são campos textuais, e os dados variáveis ficam em `jsonb`. Isso permite adicionar novos tipos de ação no futuro sem alterar o schema do banco.

## Tabela `auditoria_acoes`

| Coluna | Uso |
| --- | --- |
| `id` | Identificador sequencial da auditoria. |
| `tipo_acao` | Nome lógico da ação registrada. |
| `entidade_tipo` | Tabela ou domínio funcional afetado, como `entradas_balanca` ou `saidas_balanca`. |
| `entidade_id` | Identificador da entidade afetada, em texto para aceitar formatos futuros. |
| `usuario_id` | Usuário responsável pela ação. FK para `users.id`. |
| `usuario_login` | Snapshot opcional do login no momento da ação. |
| `grupo_acao_id` | Agrupa várias linhas geradas por uma única operação lógica. |
| `dados_anteriores` | Snapshot JSON do estado anterior da entidade. |
| `dados_posteriores` | Snapshot JSON do estado posterior da entidade. |
| `detalhes` | Metadados adicionais específicos da ação. |
| `criado_em` | Data/hora em que a auditoria foi gravada. |

## Ações registradas pelo código

| `tipo_acao` | Quando é gravada | Entidade |
| --- | --- | --- |
| `editar_entrada` | Ao salvar o formulário de detalhes de uma entrada. | `entradas_balanca` |
| `deletar_entrada` | Ao deletar uma entrada. O motivo obrigatório informado pelo operador é salvo em `detalhes.motivo_delecao`. | `entradas_balanca` |
| `editar_saida` | Ao adicionar o peso bruto de uma saída, que altera os dados operacionais da saída. | `saidas_balanca` |
| `deletar_saida` | Ao deletar uma saída. O motivo obrigatório informado pelo operador é salvo em `detalhes.motivo_delecao`. | `saidas_balanca` |
| `desvincular_contrato_saida` | Ao remover o vínculo entre uma saída e um contrato. | `saidas_balanca` |
| `dividir_saida` | Ao dividir uma saída em duas linhas. | `saidas_balanca` |

> A edição geral de saída também registra `editar_saida`. Divisão de entradas não
> está implementada. A [API operacional](api-balanca-operacional.md) reutiliza esses
> serviços: a autoria vem do usuário autenticado pelo token, nunca de um ID enviado
> pelo cliente. Criação, tara, origem, classificação e associação conservam seus
> campos de autoria nas próprias tabelas, sem novos tipos de evento nesta versão.

## Reversão manual

A auditoria foi desenhada para oferecer dados suficientes para uma reversão manual controlada:

- exclusões guardam a linha removida em `dados_anteriores`;
- edições guardam `dados_anteriores` e `dados_posteriores`;
- desvinculação de contrato guarda o contrato removido em `detalhes.contrato_id_desvinculado`;
- divisão de saída cria duas linhas de auditoria com o mesmo `grupo_acao_id`, uma para a saída original alterada e outra para a nova saída criada.

A aplicação não faz rollback automático a partir da tabela. Se uma reversão for necessária, um administrador deve analisar a auditoria e aplicar a correção apropriada no banco.

## Padrão de implementação

As mutações auditáveis são feitas dentro de transações no serviço da balança. O fluxo é:

1. bloquear e ler a linha atual com `FOR UPDATE`;
2. executar a alteração;
3. gravar a linha de auditoria com os snapshots;
4. confirmar a transação.

Isso evita que a alteração operacional seja confirmada sem o respectivo registro de auditoria.
