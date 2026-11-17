# Pesagens avulsas da balança

Este documento descreve o fluxo de pesagens avulsas: tudo o que passa pela balança
e **não** é entrada nem saída de soja ou milho (calcário, adubo, areia, uma carreta
emprestada, conferência de um caminhão vazio etc.). As pesagens avulsas ficam numa
tabela própria, `pesagens_avulsas`, e não aparecem nas listas de entradas e saídas,
nos saldos de armazenagem, nos contratos nem nos relatórios desses fluxos.

## Objetivo do fluxo

O fluxo segue o das saídas, com bem mais liberdade para o operador:

| | Saídas | Pesagens avulsas |
| --- | --- | --- |
| Pesos | Tara na criação, bruto depois | Pesagem 1 na criação, pesagem 2 depois |
| Ordem dos pesos | Bruto precisa ser maior que a tara | Qualquer ordem: o veículo pode chegar cheio ou vazio |
| Peso líquido | `bruto - tara` | Diferença absoluta entre as pesagens |
| Placa | Obrigatória, padrão `ABC1234`/`ABC1D23` | Opcional, sem padrão fixo (até 10 letras/números) |
| Produto | `milho` ou `soja` | Texto livre opcional |
| Vendedor / comprador | Vêm do contrato | Texto livre opcional |
| Motorista | Opcional | Opcional |
| Contrato, NF, divisão | Sim | Não |
| Classificação | — | Não |
| Comentário | — | Texto livre opcional, preenchido na pesagem 1 |
| Foto da balança | Sim | Sim, nas duas pesagens |
| Ticket em PDF | Após bruto e contrato | Após a pesagem 2 |

## Implantação

1. Aplique `migrations/20261114_add_standalone_weighings.sql` no banco, depois das
   migrations de fotos (`20261111_add_scale_photos.sql` e
   `20261114_add_scale_photo_source.sql`). Ela roda numa única transação e:
   - cria a tabela `pesagens_avulsas` com índices;
   - adiciona `balanca_fotos.pesagem_avulsa_id` e recria as constraints de
     `balanca_fotos` para aceitar os tipos de peso `pesagem_1` e `pesagem_2`.
2. Publique a versão da aplicação.

A ordem entre os dois passos não quebra entradas e saídas: sem a migration, a página
inicial continua carregando (sem a seção de pesagens avulsas) e as fotos de entradas
e saídas continuam funcionando. Só as telas de pesagem avulsa retornam erro até a
migration ser aplicada. Nenhuma variável de ambiente nova é necessária.

No banco do Railway deste projeto, a migration foi aplicada em 14/11/2026: tabela,
constraints, índices, a coluna `balanca_fotos.pesagem_avulsa_id` e as constraints
recriadas de `balanca_fotos` foram verificados, e as fotos existentes continuaram
válidas. A conta de leitura `agrolima_leitura` não tem `SELECT` em
`pesagens_avulsas` (assim como em `balanca_fotos`); conceda manualmente se precisar
consultar essas tabelas por ela.

## Banco de dados

Tabela `pesagens_avulsas` (detalhes completos em [database.md](database.md#pesagens_avulsas)):

| Coluna | Descrição |
| --- | --- |
| `id` | Identificador sequencial; é o número do ticket. |
| `pesagem_1_kg`, `pesagem_1_em` | Primeira pesagem e sua data/hora. Obrigatórias. |
| `pesagem_2_kg`, `pesagem_2_em` | Segunda pesagem e sua data/hora. `NULL` enquanto o veículo está no pátio; peso e data entram e saem juntos. |
| `peso_liquido_kg` | Coluna gerada: `abs(pesagem_2_kg - pesagem_1_kg)`. `NULL` sem a pesagem 2. |
| `placa_caminhao` | Opcional. Maiúsculas, sem pontuação, até 10 letras/números. |
| `nome_motorista`, `produto`, `vendedor`, `comprador` | Texto livre opcional, até 120 caracteres. |
| `comentario` | Texto livre opcional, até 1000 caracteres, com quebras de linha. |
| `criado_por_user_id` | Operador da pesagem 1 (aparece no ticket como "Operador"). |
| `pesagem_2_por_user_id` | Operador que lançou a pesagem 2. |
| `criado_em`, `atualizado_em` | Auditoria do registro. |

Regras garantidas pelo banco: pesos positivos; pesagem 2 completa (peso e data) ou
ausente; textos `NULL` em vez de vazios ou só com espaços; placa no formato
`^[A-Z0-9]{1,10}$`; comentário com no máximo 1000 caracteres.

As duas pesagens podem ter o mesmo peso (líquido zero). A aplicação não impõe ordem
nem diferença mínima: a liberdade é do operador.

## Arquivos principais

- `routes/standalone-weighing-service.js`: validação, normalização e queries.
- `routes/standalone-weighing-routes.js`: rotas web `/balanca/avulsas`.
- `routes/weighbridge-api-routes.js`: rotas da API em `/api/v1/balanca/avulsas`.
- `routes/weighbridge-route-helpers.js`: navegação e vínculo de fotos, compartilhados
  com as rotas de entradas e saídas.
- `routes/renderers/weighbridge-renderer.js`: lista, formulários, detalhe, pátio e
  seção da página inicial.
- `routes/weighbridge-ticket-pdf.js`: ticket A4 com duas vias (`buildStandaloneWeighingTicket` e `buildStandaloneWeighingTicketPdf`).
- `routes/weighbridge-csv.js`: exportação CSV (`buildStandaloneWeighingsCsv`).
- `routes/scale-photo-service.js`: vínculo das fotos (`linkCaptureToRecord` com
  `pesagemAvulsaId`).
- `views/weighbridge-standalone-*.html`: telas.
- `test/standalone-weighings.test.js`: testes do fluxo.

## Rotas web

Todas exigem perfil `weighbridge_operator` ou `admin`.

| Rota | Ação |
| --- | --- |
| `GET /balanca/avulsas` | Lista completa, das mais novas para as mais antigas, paginada. |
| `GET /balanca/avulsas.csv` | Exporta todas as pesagens avulsas em CSV. |
| `GET /balanca/avulsas/nova` | Formulário da pesagem 1. |
| `POST /balanca/avulsas` | Cria a pesagem avulsa e volta para `/balanca`. |
| `GET /balanca/avulsas/:id` | Detalhes, fotos, edição e deleção. |
| `POST /balanca/avulsas/:id` | Salva a edição e volta para o detalhe. |
| `GET /balanca/avulsas/:id/pesagem-2` | Formulário da pesagem 2. |
| `POST /balanca/avulsas/:id/pesagem-2` | Grava a pesagem 2 e volta para `/balanca`. |
| `GET /balanca/avulsas/:id/ticket.pdf` | Ticket em PDF (só com a pesagem 2). |
| `POST /balanca/avulsas/:id/deletar` | Deleta com motivo de pelo menos 20 caracteres. |

## Fluxo operacional

### 1. Página inicial

Em `/balanca` há o cartão **Pesagem avulsa**, ao lado de adicionar entrada, adicionar
saída e contratos. Abaixo das últimas saídas fica a seção **Últimas 10 pesagens
avulsas**, com link para a lista completa.

Pesagens avulsas sem a pesagem 2 aparecem no **Pátio** com a movimentação "Avulsa",
ordenadas por data junto com entradas e saídas pendentes. Como não há bruto e tara,
a pesagem 1 ocupa as duas colunas de peso. Sem placa, a linha mostra "Sem placa". A
ação é **Adicionar pesagem 2**.

Administradores acessam a lista pelo botão **Ver pesagens avulsas** no painel
"Entradas e saídas" de `/admin`.

### 2. Pesagem 1

O formulário `/balanca/avulsas/nova` tem:

- data e hora da pesagem 1 (preenchida com o momento atual, editável);
- peso da pesagem 1, com os botões **usar peso da balança** e **usar foto
  automática**;
- placa, nome do motorista, produto, vendedor e comprador, todos opcionais;
- comentário, opcional, para anotar qualquer coisa relevante.

Normalização feita por `buildStandaloneWeighingPayload`:

- peso aceita vírgula ou ponto e precisa ser positivo;
- placa vira maiúsculas sem pontuação (`abc-1d23` → `ABC1D23`, `Trator 2` →
  `TRATOR2`) e pode ter até 10 caracteres;
- motorista, produto, vendedor e comprador têm espaços repetidos e das pontas
  removidos; o produto mantém maiúsculas e minúsculas como digitado;
- o comentário só perde espaços das pontas e mantém as quebras de linha;
- qualquer campo de texto em branco é gravado como `NULL`.

Com erro, o formulário volta com os valores digitados e a foto escolhida. Com
sucesso, o operador volta para `/balanca` com "Pesagem avulsa adicionada com
sucesso."

### 3. Pesagem 2

Pelo pátio, pela lista ou pelo detalhe, **Adicionar pesagem 2** abre
`/balanca/avulsas/:id/pesagem-2`. A tela mostra o resumo da pesagem 1 e o comentário.
O operador informa data/hora e peso (com os mesmos dois botões de balança e foto).

A pesagem 2 pode ser maior, menor ou igual à pesagem 1. O serviço só grava se a
pesagem ainda não tiver a pesagem 2 (`WHERE pesagem_2_kg IS NULL`, em transação com
bloqueio da linha). Depois de salvar, o operador volta para `/balanca` com "Pesagem 2
adicionada à pesagem avulsa com sucesso." O ticket fica disponível no link
**Imprimir ticket** da seção de últimas pesagens avulsas, na lista completa e no
detalhe.

### 4. Detalhes, edição e deleção

`/balanca/avulsas/:id` mostra todos os campos com botão **Copiar**, as fotos
vinculadas e:

- **Adicionar pesagem 2** e **Imprimir ticket** desabilitado, enquanto pendente;
- **Imprimir ticket**, depois da pesagem 2.

O formulário **Editar pesagem avulsa** permite corrigir todos os campos, inclusive
as duas pesagens e suas datas. Apagar o peso da pesagem 2 devolve a pesagem para o
pátio. Preencher a pesagem 2 pela edição sem data/hora usa o momento atual. Campos
de texto deixados em branco ficam sem valor.

A deleção exige motivo de pelo menos 20 caracteres e confirmação do navegador. As
fotos vinculadas não são apagadas (o vínculo vira `NULL`, como nas entradas e saídas).

## Fotos da balança

Os dois formulários de peso usam a mesma infraestrutura das entradas e saídas
(`public/js/weighbridge-scale-weight.js`):

- **usar peso da balança**: preenche com o peso atual e, se houver foto para esse
  peso, cria uma captura temporária;
- **usar foto automática**: abre as 20 últimas fotos automáticas do AutoWeight e
  preenche com o peso da foto escolhida.

Ao salvar, a captura é vinculada à pesagem avulsa (`balanca_fotos.pesagem_avulsa_id`)
com `tipo_peso = 'pesagem_1'` ou `'pesagem_2'`, desde que seja do mesmo operador,
esteja dentro da validade e o peso salvo seja exatamente o da balança. Peso digitado
ou alterado fica sem foto. No seletor de fotos automáticas, os usos anteriores
aparecem como "pesagem avulsa #12 (pesagem 1)".

Nas entradas e saídas, as fotos continuam sendo `bruto`/`tara`. O banco impede
misturar: `bruto`/`tara` só com `entrada_id`/`saida_id`, `pesagem_1`/`pesagem_2` só
com `pesagem_avulsa_id`, e cada foto pertence a no máximo um lançamento.

## Ticket em PDF

`GET /balanca/avulsas/:id/ticket.pdf` gera o ticket no mesmo layout A4 do ticket
de saída: duas vias (fazenda e motorista) numa folha, com linha de corte. Veja
[saidas.md](saidas.md#7-emitir-ticket-de-pesagem-da-saída). O arquivo é servido inline como
`ticket-pesagem-avulsa-:id.pdf` e só fica disponível depois da pesagem 2.

Cada via mostra:

- título "Pesagem avulsa nº 12" e os campos operador, placa, motorista, produto, vendedor e comprador;
- pesagem 1 e pesagem 2, cada uma com peso e data/hora, e o peso líquido em destaque;
- as fotos da balança vinculadas a cada pesagem (`pesagem_1` e `pesagem_2`), quando existirem;
- linhas de assinatura do vendedor e do comprador.

- O operador é o login de quem lançou a pesagem 1.
- Placa, produto, vendedor e comprador em branco aparecem como `-`.
- A linha do motorista só aparece quando o nome foi informado, como na saída.
- O comentário não sai no ticket; ele fica no sistema (detalhe, CSV e API).

## CSV

A exportação traz, em ordem crescente de data, as colunas `ID`, data/hora/peso de
cada pesagem, `Liquido kg`, `Placa`, `Motorista`, `Produto`, `Vendedor`,
`Comprador` e `Comentario`. Segue o padrão das outras exportações: separador `;`,
UTF-8 com BOM, horário de Brasília e decimais pt-BR. Comentários com quebra de linha
ficam numa única célula entre aspas.

## API operacional

A API v1 tem as mesmas ações em `/api/v1/balanca/avulsas`. Veja a seção de pesagens
avulsas em [api-balanca-operacional.md](api-balanca-operacional.md) e o contrato
[OpenAPI](api-balanca.openapi.json). Como nas entradas e saídas, a API não anexa
fotos; elas são exclusivas dos formulários web.

## Auditoria

| `tipo_acao` | Quando |
| --- | --- |
| `editar_pesagem_avulsa` | Ao adicionar a pesagem 2 (`detalhes.campo_editado = 'pesagem_2_kg'`) e ao salvar a edição. |
| `deletar_pesagem_avulsa` | Ao deletar, com o motivo em `detalhes.motivo_delecao` e a linha removida em `dados_anteriores`. |

A entidade é `pesagens_avulsas`. A criação não gera evento de auditoria (o autor fica
em `criado_por_user_id`), seguindo o padrão das saídas.

## Mensagens

| Parâmetro | Mensagem | Onde |
| --- | --- | --- |
| `avulsa_criada` | Pesagem avulsa adicionada com sucesso. | `/balanca` |
| `avulsa_deletada` | Pesagem avulsa deletada com sucesso. | `/balanca` |
| `avulsa_pesagem_2_adicionada` | Pesagem 2 adicionada à pesagem avulsa com sucesso. | `/balanca` |
| `avulsa_editada` | Pesagem avulsa atualizada com sucesso. | Detalhe |

## Pontos de atenção para manutenção

- As pesagens avulsas **não** entram em `/admin/armazenamento`, saldos de contratos
  ou relatórios de entradas e saídas. Se algum dia precisarem entrar, faça isso de
  forma explícita, nunca por uma `UNION` silenciosa.
- `listRecentAutomaticPhotos` lê `pesagem_avulsa_id` via `to_jsonb(c)` e
  `linkCaptureToRecord` só cita a coluna ao vincular uma pesagem avulsa. Isso mantém
  as fotos de entradas e saídas funcionando num banco ainda sem a migration. Depois
  que todos os ambientes tiverem a migration, essas consultas podem citar a coluna
  diretamente.
- A rota genérica `GET /balanca/avulsas/:id` fica depois das rotas específicas
  (`/pesagem-2`, `/ticket.pdf`, `/deletar`), e `/balanca/avulsas/nova` e
  `/balanca/avulsas.csv` ficam antes dela.
- IDs que não são inteiros positivos nunca chegam ao SQL: o serviço devolve "não
  encontrada".
