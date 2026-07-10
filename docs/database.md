# Documentação do Banco de Dados

Este documento descreve o schema `public` do banco PostgreSQL usado pela aplicação AgroLima. Ele foi criado a partir dos arquivos `columns.txt` e `constraints.txt`, que contêm consultas ao `information_schema` do banco, e complementado com o comportamento observado no código da aplicação.

> **Uso para manutenção:** consulte este arquivo antes de alterar queries, telas administrativas, serviços do secador, contratos, entradas, saídas da balança ou autenticação. Se o banco for alterado, gere novamente `columns.txt` e `constraints.txt` e atualize esta documentação.

## Visão geral

- **Banco:** PostgreSQL.
- **Schema:** `public`.
- **Tabelas documentadas:**
  - [`compradores`](#compradores)
  - [`vendedores`](#vendedores)
  - [`contratos`](#contratos)
  - [`armazenamento_recalibracoes`](#armazenamento_recalibracoes)
  - [`entradas_balanca`](#entradas_balanca)
  - [`saidas_balanca`](#saidas_balanca)
  - [`auditoria_acoes`](#auditoria_acoes)
  - [`users`](#users)
  - [`dryer_settings`](#dryer_settings)
  - [`dryer_batches`](#dryer_batches)
  - [`dryer_moisture_readings`](#dryer_moisture_readings)

## Relacionamentos principais

| Origem | Coluna | Destino | Coluna | Uso principal |
| --- | --- | --- | --- | --- |
| `contratos` | `comprador_id` | `compradores` | `id` | Vincula cada contrato a um comprador. |
| `contratos` | `vendedor_id` | `vendedores` | `id` | Vincula cada contrato a um vendedor. |
| `armazenamento_recalibracoes` | `criado_por_user_id` | `users` | `id` | Registra o administrador que lançou a recalibração manual do estoque. |
| `entradas_balanca` | `criado_por_user_id` | `users` | `id` | Registra o operador que lançou a entrada. |
| `entradas_balanca` | `tara_usada_de_entrada_id` | `entradas_balanca` | `id` | Registra de qual entrada anterior a tara foi reaproveitada. |
| `entradas_balanca` | `tara_adicionada_por_user_id` | `users` | `id` | Registra o operador que adicionou tara manualmente. |
| `entradas_balanca` | `origem_definida_por_user_id` | `users` | `id` | Registra o operador que definiu a origem textual da entrada. |
| `entradas_balanca` | `classificado_por_user_id` | `users` | `id` | Registra o operador que lançou a classificação. |
| `entradas_balanca` | `cliente_user_id` | `users` | `id` | Preparado para associar a entrada a um usuário cliente. |
| `saidas_balanca` | `contrato_id` | `contratos` | `id` | Associação opcional da saída da balança ao contrato embarcado. |
| `saidas_balanca` | `criado_por_user_id` | `users` | `id` | Registra o operador que lançou a saída. |
| `saidas_balanca` | `associado_por_user_id` | `users` | `id` | Registra o operador que associou a saída ao contrato. |
| `auditoria_acoes` | `usuario_id` | `users` | `id` | Registra o usuário responsável pela ação auditada. |
| `dryer_batches` | `started_by_user_id` | `users` | `id` | Registra o usuário que iniciou a batelada. |
| `dryer_batches` | `completed_by_user_id` | `users` | `id` | Registra o usuário que concluiu/parou a batelada. |
| `dryer_moisture_readings` | `batch_id` | `dryer_batches` | `id` | Vincula medições de umidade a uma batelada. |
| `dryer_moisture_readings` | `measured_by_user_id` | `users` | `id` | Registra o usuário que lançou a medição. |
| `dryer_settings` | `updated_by_user_id` | `users` | `id` | Registra o usuário que atualizou a configuração do secador. |

---

## `compradores`

Armazena os compradores usados no cadastro de contratos.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `bigint` | Não | `nextval('compradores_id_seq'::regclass)` | Identificador sequencial do comprador. |
| `nome` | `character varying` | Não | — | Nome curto usado em listas, filtros e seleção de comprador. |
| `nome_completo` | `character varying` | Não | — | Nome completo ou razão social do comprador. |
| `endereco` | `character varying` | Não | — | Endereço do comprador. |
| `numero` | `character varying` | Não | — | Número do endereço. |
| `cep` | `character` | Não | — | CEP do comprador. A aplicação valida 8 dígitos. |
| `inscricao_estadual` | `character varying` | Não | — | Inscrição estadual. A aplicação valida 10 ou mais dígitos. |
| `cpf_cnpj` | `character varying` | Não | — | CPF ou CNPJ. A aplicação valida 11 ou 14 dígitos. |
| `criado_em` | `timestamp without time zone` | Não | `now()` | Data/hora de criação do registro. |
| `atualizado_em` | `timestamp without time zone` | Não | `now()` | Data/hora da última atualização. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `compradores_pkey` | `id` |
| Unique | `compradores_nome_unique` | `nome` |
| Check | `compradores_cep_formato_check` | `cep` |
| Check | `compradores_cpf_cnpj_check` | `cpf_cnpj` |
| Check | `compradores_inscricao_estadual_check` | `inscricao_estadual` |
| Check / not null | demais constraints `compradores_*_not_null` | `id`, `nome`, `nome_completo`, `endereco`, `numero`, `cep`, `inscricao_estadual`, `cpf_cnpj`, `criado_em`, `atualizado_em` |

---

## `vendedores`

Armazena os vendedores usados no cadastro de contratos.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `bigint` | Não | `nextval('vendedores_id_seq'::regclass)` | Identificador sequencial do vendedor. |
| `nome` | `character varying` | Não | — | Nome curto usado em listas e seleção de vendedor. |
| `nome_completo` | `character varying` | Não | — | Nome completo do vendedor. |
| `criado_em` | `timestamp without time zone` | Não | `now()` | Data/hora de criação do registro. |
| `atualizado_em` | `timestamp without time zone` | Não | `now()` | Data/hora da última atualização. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `vendedores_pkey` | `id` |
| Unique | `vendedores_nome_unique` | `nome` |
| Check / not null | constraints `vendedores_*_not_null` | `id`, `nome`, `nome_completo`, `criado_em`, `atualizado_em` |

---

## `contratos`

Armazena contratos comerciais de compra/venda de grãos. A tabela também guarda campos opcionais usados como apoio ao preenchimento da nota fiscal; esses campos aceitam `NULL` e registros antigos permanecem nulos até edição manual.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `bigint` | Não | `nextval('contratos_id_seq'::regclass)` | Identificador sequencial do contrato. |
| `data_contrato` | `date` | Não | — | Data do contrato. |
| `produto` | `USER-DEFINED` | Não | — | Tipo de produto. Pela aplicação, valores aceitos: `milho` e `soja`. |
| `preco_por_saca` | `numeric` | Não | — | Preço por saca. |
| `comprador_id` | `bigint` | Não | — | Comprador vinculado ao contrato. FK para `compradores.id`. |
| `vendedor_id` | `bigint` | Não | — | Vendedor vinculado ao contrato. FK para `vendedores.id`. |
| `quantidade_kg` | `numeric` | Não | — | Quantidade do contrato em quilogramas. |
| `contrato_embarcado` | `boolean` | Não | `false` | Indica se o contrato foi embarcado. |
| `data_recebimento` | `date` | Sim | — | Data de recebimento, quando aplicável. |
| `contrato_recebido` | `boolean` | Não | `false` | Indica se o contrato foi recebido. |
| `corretor` | `character varying` | Sim | — | Nome do corretor, quando houver. |
| `valor_corretagem_percentual` | `numeric` | Sim | — | Percentual/valor de corretagem informado no contrato. |
| `corretagem_paga` | `boolean` | Não | `false` | Indica se a corretagem foi paga. |
| `observacoes` | `text` | Sim | — | Observações livres sobre o contrato. |
| `criado_em` | `timestamp without time zone` | Não | `now()` | Data/hora de criação do registro. |
| `atualizado_em` | `timestamp without time zone` | Não | `now()` | Data/hora da última atualização. |
| `inscricao_estadual_vendedor` | `text` | Sim | — | Inscrição estadual do vendedor para apoio ao preenchimento da nota fiscal. |
| `natureza_operacao` | `text` | Sim | — | Natureza da operação para apoio ao preenchimento da nota fiscal. |
| `cfop` | `text` | Sim | — | CFOP informado no contrato para apoio à emissão da nota fiscal. |
| `informacoes_interesse_contribuinte` | `text` | Sim | — | Informações de interesse do contribuinte que podem ser levadas para a nota fiscal. |
| `razao_social_transportadora` | `text` | Sim | — | Razão social da transportadora usada na nota fiscal. |
| `cnpj_transportadora` | `text` | Sim | — | CNPJ da transportadora usada na nota fiscal. |
| `inscricao_estadual_transportadora` | `text` | Sim | — | Inscrição estadual da transportadora usada na nota fiscal. |
| `uf_transportadora` | `text` | Sim | — | UF da transportadora usada na nota fiscal. |
| `email` | `text` | Sim | — | E-mail relacionado ao contrato para apoio à emissão da nota fiscal. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `contratos_pkey` | `id` |
| Foreign key | `contratos_comprador_id_fk` | `comprador_id` → `compradores.id` |
| Foreign key | `contratos_vendedor_id_fk` | `vendedor_id` → `vendedores.id` |
| Check / not null | constraints `contratos_*_not_null` | `id`, `data_contrato`, `produto`, `preco_por_saca`, `comprador_id`, `vendedor_id`, `quantidade_kg`, `contrato_embarcado`, `contrato_recebido`, `corretagem_paga`, `criado_em`, `atualizado_em` |



---

## `armazenamento_recalibracoes`

Armazena os marcos manuais de recalibração do estoque do silo. Cada registro informa que, em determinada data/hora, um administrador conferiu fisicamente uma quantidade real de soja ou milho. O cálculo da página `/admin/armazenamento` usa a recalibração mais recente de cada produto como base e soma/subtrai apenas movimentações posteriores a essa data.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `bigint` | Não | — | Identificador sequencial da recalibração, criado por identity. |
| `produto` | `USER-DEFINED` | Não | — | Tipo `public.produto_contrato`; pela aplicação, valores aceitos: `milho` e `soja`. |
| `data_recalibracao` | `timestamp with time zone` | Não | — | Data/hora em que a medição física foi feita. |
| `quantidade_real_kg` | `numeric` | Não | — | Quantidade real conferida fisicamente no silo, em quilogramas. |
| `observacoes` | `text` | Sim | — | Observações livres sobre a conferência manual. |
| `criado_por_user_id` | `uuid` | Não | — | Administrador que registrou a recalibração. FK para `users.id`. |
| `criado_em` | `timestamp with time zone` | Não | `now()` | Data/hora de criação do registro. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `armazenamento_recalibracoes_pkey` | `id` |
| Foreign key | `armazenamento_recalibracoes_criado_por_user_id_fkey` | `criado_por_user_id` → `users.id` |
| Check | `armazenamento_recalibracoes_quantidade_real_nao_negativa_check` | `quantidade_real_kg` |
| Check | `armazenamento_recalibracoes_observacoes_texto_check` | `observacoes` |
| Check / not null | constraints `armazenamento_recalibracoes_*_not_null` | `id`, `produto`, `data_recalibracao`, `quantidade_real_kg`, `criado_por_user_id`, `criado_em` |

### Uso pela aplicação

- `/admin/armazenamento` lista o saldo atual por produto, usando a recalibração mais recente como base quando houver.
- `/admin/armazenamento/recalibracoes` insere uma nova medição manual com produto, data/hora, quantidade real e usuário administrador.
- O cálculo considera entradas e saídas com data maior que `data_recalibracao`, para que a medição manual represente o saldo exato naquele instante.


## `entradas_balanca`

Armazena as entradas registradas pelo operador de balança. Cada entrada nasce com data/hora, placa, produto e peso bruto. A tara pode ser copiada da última entrada da mesma placa que já tenha tara ou adicionada manualmente depois. A tabela também guarda a origem textual do produto, a classificação de qualidade e campos preparados para associar a entrada a um cliente do sistema.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `bigint` | Não | — | Identificador sequencial da entrada, criado por identity. |
| `data_entrada` | `timestamp with time zone` | Não | `now()` | Data/hora da entrada. O formulário preenche a data/hora atual, mas permite edição manual. |
| `placa_caminhao` | `character varying` | Não | — | Placa do veículo, normalizada para letras/números maiúsculos e validada no padrão brasileiro antigo ou Mercosul. |
| `produto` | `USER-DEFINED` | Não | — | Tipo `public.produto_contrato`, o mesmo usado por `contratos.produto` e `saidas_balanca.produto`; pela aplicação, valores aceitos: `milho` e `soja`. |
| `peso_bruto_kg` | `numeric` | Não | — | Peso bruto em quilogramas lançado na criação da entrada. |
| `peso_tara_kg` | `numeric` | Sim | — | Peso tara em quilogramas. Fica nulo até o operador adicionar tara ou escolher usar tara anterior. |
| `peso_liquido_kg` | `numeric` | Sim | — | Peso líquido gerado pelo banco como `peso_bruto_kg - peso_tara_kg`; permanece nulo enquanto não há tara. |
| `liquido_real_kg` | `numeric` | Sim | — | Peso líquido real armazenado para cálculo de estoque. Fica nulo enquanto falta tara ou classificação; quando classificado, desconta impureza e, se a umidade for maior que 14%, ajusta pela matéria seca usando divisor `0,86`. |
| `tara_usada_de_entrada_id` | `bigint` | Sim | — | Entrada anterior usada como origem da tara reaproveitada. FK para `entradas_balanca.id`. |
| `origem` | `text` | Sim | — | Origem textual do produto, como fazenda ou lote. Exemplo: `Fazenda São José`. |
| `origem_definida_por_user_id` | `uuid` | Sim | — | Usuário que definiu a origem. FK para `users.id`. |
| `origem_definida_em` | `timestamp with time zone` | Sim | — | Data/hora em que a origem foi definida. |
| `umidade_percent` | `numeric` | Sim | — | Percentual de umidade da classificação. O formulário usa padrão `14`. |
| `impureza_percent` | `numeric` | Sim | — | Percentual de impureza da classificação. O formulário usa padrão `1`. |
| `graos_avariados_percent` | `numeric` | Sim | — | Percentual de grãos avariados da classificação. O formulário usa padrão `0`. |
| `classificado_por_user_id` | `uuid` | Sim | — | Usuário que lançou a classificação. FK para `users.id`. |
| `classificado_em` | `timestamp with time zone` | Sim | — | Data/hora da classificação. |
| `cliente_user_id` | `uuid` | Sim | — | Usuário cliente associado à entrada. Preparado no banco, mas a ação ainda não está exposta na interface. |
| `cliente_associado_por_user_id` | `uuid` | Sim | — | Usuário operador que associou o cliente. Preparado para implementação futura. |
| `cliente_associado_em` | `timestamp with time zone` | Sim | — | Data/hora da associação futura com cliente. |
| `criado_por_user_id` | `uuid` | Não | — | Usuário operador que criou a entrada. FK para `users.id`. |
| `tara_adicionada_por_user_id` | `uuid` | Sim | — | Usuário que adicionou tara manualmente. FK para `users.id`. |
| `tara_adicionada_em` | `timestamp with time zone` | Sim | — | Data/hora em que a tara manual foi adicionada. |
| `criado_em` | `timestamp with time zone` | Não | `now()` | Data/hora de criação do registro. |
| `atualizado_em` | `timestamp with time zone` | Não | `now()` | Data/hora da última atualização. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `entradas_balanca_pkey` | `id` |
| Foreign key | `entradas_balanca_criado_por_user_id_fkey` | `criado_por_user_id` → `users.id` |
| Foreign key | `entradas_balanca_tara_adicionada_por_user_id_fkey` | `tara_adicionada_por_user_id` → `users.id` |
| Foreign key | `entradas_balanca_tara_usada_de_entrada_id_fkey` | `tara_usada_de_entrada_id` → `entradas_balanca.id` |
| Foreign key | `entradas_balanca_origem_definida_por_user_id_fkey` | `origem_definida_por_user_id` → `users.id` |
| Foreign key | `entradas_balanca_classificado_por_user_id_fkey` | `classificado_por_user_id` → `users.id` |
| Foreign key | `entradas_balanca_cliente_user_id_fkey` | `cliente_user_id` → `users.id` |
| Foreign key | `entradas_balanca_cliente_associado_por_user_id_fkey` | `cliente_associado_por_user_id` → `users.id` |
| Check | `entradas_balanca_placa_caminhao_formato_check` | `placa_caminhao` |
| Check | `entradas_balanca_peso_bruto_positivo_check` | `peso_bruto_kg` |
| Check | `entradas_balanca_peso_tara_positivo_check` | `peso_tara_kg` |
| Check | `entradas_balanca_peso_bruto_maior_tara_check` | `peso_bruto_kg`, `peso_tara_kg` |
| Check | `entradas_balanca_tara_origem_valida_check` | `tara_usada_de_entrada_id`, `peso_tara_kg` |
| Check | `entradas_balanca_tara_manual_auditoria_check` | `peso_tara_kg`, `tara_adicionada_por_user_id`, `tara_adicionada_em` |
| Check | `entradas_balanca_origem_texto_check` | `origem` |
| Check | `entradas_balanca_origem_completa_check` | `origem`, `origem_definida_por_user_id`, `origem_definida_em` |
| Check | `entradas_balanca_classificacao_completa_check` | `umidade_percent`, `impureza_percent`, `graos_avariados_percent`, `classificado_por_user_id`, `classificado_em` |
| Check | `entradas_balanca_umidade_intervalo_check` | `umidade_percent` |
| Check | `entradas_balanca_impureza_intervalo_check` | `impureza_percent` |
| Check | `entradas_balanca_graos_avariados_intervalo_check` | `graos_avariados_percent` |
| Check | `entradas_balanca_cliente_completo_check` | `cliente_user_id`, `cliente_associado_por_user_id`, `cliente_associado_em` |
| Check / not null | constraints `entradas_balanca_*_not_null` | `id`, `data_entrada`, `placa_caminhao`, `produto`, `peso_bruto_kg`, `criado_por_user_id`, `criado_em`, `atualizado_em` |

### Uso pela aplicação

- `/balanca/entradas/nova` permite lançar entrada com data/hora manual ou padrão atual, placa, produto e peso bruto.
- A tela de nova entrada consulta até 5 placas recentes em `entradas_balanca`, filtra conforme digitação e habilita “Usar tara anterior” quando a placa já tem entrada com tara.
- Ao usar tara anterior, a aplicação copia `peso_tara_kg` da entrada anterior mais recente da mesma placa e grava `tara_usada_de_entrada_id`.
- A página inicial `/balanca` lista as 10 entradas mais recentes usando `ORDER BY data_entrada DESC, id DESC`; `/balanca/entradas` mostra a lista completa.
- Nas tabelas de entradas de `/balanca` e `/balanca/entradas`, clicar na placa do caminhão copia para a área de transferência um relatório em cinco linhas com data/hora, placa, origem, peso líquido em kg e umidade em percentual; essa ação só fica disponível depois que a entrada possui origem, tara e classificação completas, e a umidade é copiada sempre com uma casa decimal.
- As ações atuais da lista são adicionar tara, adicionar classificação e definir origem. A ação de cliente está preparada no banco, mas ainda não foi implementada na interface.
- O campo `liquido_real_kg` é usado pelo módulo `/admin/armazenamento` para somar entradas no estoque. A fórmula aplicada considera os percentuais como valores de 0 a 100: para umidade até 14%, `(peso_liquido_kg * (1 - impureza_percent / 100))`; para umidade acima de 14%, `(peso_liquido_kg * (1 - impureza_percent / 100) * (1 - umidade_percent / 100) / 0.86)`.

---

## `saidas_balanca`

Armazena as saídas registradas pelo operador de balança. Cada saída nasce sem contrato (`contrato_id` nulo) e pode ser associada depois a um contrato ainda não totalmente embarcado. A tela da balança usa essa tabela para listar as saídas em ordem cronológica reversa, calcular o peso líquido e recuperar os dados necessários para emissão de nota fiscal via relacionamento com `contratos`, `compradores` e `vendedores`.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `bigint` | Não | `nextval('saidas_balanca_id_seq'::regclass)` | Identificador sequencial da saída. |
| `data_saida` | `timestamp with time zone` | Não | `now()` | Data/hora da saída informada pelo operador; o formulário preenche com a data/hora atual. |
| `placa_caminhao` | `character varying` | Não | — | Placa do caminhão, validada no padrão brasileiro antigo ou Mercosul. |
| `produto` | `USER-DEFINED` | Não | — | Tipo de produto da saída. Deve ser compatível com o tipo usado por `contratos.produto`; pela aplicação, valores aceitos: `milho` e `soja`. |
| `peso_tara_kg` | `numeric` | Não | — | Peso tara em quilogramas lançado na criação da saída. |
| `peso_bruto_kg` | `numeric` | Sim | — | Peso bruto em quilogramas. Fica nulo até o operador adicionar bruto pela lista de saídas e deve ser maior que a tara quando preenchido. |
| `peso_bruto_adicionado_em` | `timestamp with time zone` | Sim | — | Data/hora em que o peso bruto foi adicionado. O formulário de adição de bruto permite informar manualmente esse horário e preenche com a data/hora atual por padrão. |
| `peso_liquido_kg` | `numeric` | Sim | — | Peso líquido em quilogramas, calculado no banco a partir de `peso_bruto_kg - peso_tara_kg`. Aparece como nullable no `information_schema` por ser coluna gerada. |
| `criado_por_user_id` | `uuid` | Não | — | Usuário operador que criou a saída. FK para `users.id`. |
| `contrato_id` | `bigint` | Sim | — | Contrato associado à saída. Enquanto nulo, a saída fica pendente de associação. FK para `contratos.id`. |
| `associado_por_user_id` | `uuid` | Sim | — | Usuário operador que fez a associação com o contrato. FK para `users.id`. |
| `associado_em` | `timestamp with time zone` | Sim | — | Data/hora da associação com o contrato. |
| `criado_em` | `timestamp with time zone` | Não | `now()` | Data/hora de criação do registro. |
| `atualizado_em` | `timestamp with time zone` | Não | `now()` | Data/hora da última atualização do registro. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `saidas_balanca_pkey` | `id` |
| Foreign key | `saidas_balanca_contrato_id_fkey` | `contrato_id` → `contratos.id` |
| Foreign key | `saidas_balanca_criado_por_user_id_fkey` | `criado_por_user_id` → `users.id` |
| Foreign key | `saidas_balanca_associado_por_user_id_fkey` | `associado_por_user_id` → `users.id` |
| Check | `saidas_balanca_associacao_completa_check` | `contrato_id`, `associado_por_user_id`, `associado_em` |
| Check | `saidas_balanca_placa_caminhao_formato_check` | `placa_caminhao` |
| Check | `saidas_balanca_peso_tara_positivo_check` | `peso_tara_kg` |
| Check | `saidas_balanca_peso_bruto_positivo_check` | `peso_bruto_kg` |
| Check | `saidas_balanca_peso_bruto_maior_tara_check` | `peso_bruto_kg`, `peso_tara_kg` |
| Check / not null | constraints `saidas_balanca_*_not_null` | `id`, `data_saida`, `placa_caminhao`, `produto`, `peso_tara_kg`, `criado_por_user_id`, `criado_em`, `atualizado_em` |

### Uso pela aplicação

- A página inicial da balança exibe as 10 saídas mais recentes usando `ORDER BY data_saida DESC, id DESC`.
- A lista completa de saídas usa a mesma ordem cronológica reversa.
- Saídas com `contrato_id IS NULL` exibem ação para associar comprador e contrato.
- A associação filtra contratos pelo comprador escolhido, pelo mesmo `produto` da saída e por contratos com saldo de embarque positivo.
- Após associação, a página de detalhe da saída mostra dados necessários para emissão da nota fiscal, incluindo nomes completos de vendedor e comprador, CPF/CNPJ e inscrição estadual do comprador, preço por saca, preço por kg truncado em 8 casas decimais, observações do contrato e campos fiscais opcionais cadastrados no contrato.

---


## `auditoria_acoes`

Registra ações sensíveis executadas por usuários em entidades operacionais da balança. A tabela foi desenhada para ser flexível: novos tipos de ação podem ser gravados em `tipo_acao` sem criar novo enum ou alterar constraints de domínio. Os snapshots em `jsonb` guardam o estado anterior e posterior necessário para auditoria e eventual reversão manual.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `bigint` | Não | identity | Identificador sequencial da ação auditada. |
| `tipo_acao` | `text` | Não | — | Tipo lógico da ação, como `editar_entrada`, `deletar_saida`, `desvincular_contrato_saida` ou `dividir_saida`. |
| `entidade_tipo` | `text` | Não | — | Entidade afetada pela ação, como `entradas_balanca` ou `saidas_balanca`. |
| `entidade_id` | `text` | Não | — | Identificador da entidade afetada, armazenado como texto para manter compatibilidade com identificadores futuros. |
| `usuario_id` | `uuid` | Não | — | Usuário responsável pela ação. FK para `users.id`. |
| `usuario_login` | `text` | Sim | — | Snapshot do login do usuário no momento da ação. |
| `grupo_acao_id` | `uuid` | Não | `gen_random_uuid()` | Agrupa múltiplas linhas de auditoria da mesma operação lógica. |
| `dados_anteriores` | `jsonb` | Sim | — | Snapshot JSON do estado anterior da entidade, quando aplicável. |
| `dados_posteriores` | `jsonb` | Sim | — | Snapshot JSON do estado posterior da entidade, quando aplicável. |
| `detalhes` | `jsonb` | Não | `'{}'::jsonb` | Metadados específicos da ação. |
| `criado_em` | `timestamp with time zone` | Não | `now()` | Data/hora em que a auditoria foi registrada. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `auditoria_acoes_pkey` | `id` |
| Foreign key | `auditoria_acoes_usuario_id_fkey` | `usuario_id` → `users.id` |
| Check | `auditoria_acoes_tipo_acao_texto_check` | `tipo_acao` |
| Check | `auditoria_acoes_entidade_tipo_texto_check` | `entidade_tipo` |
| Check | `auditoria_acoes_entidade_id_texto_check` | `entidade_id` |
| Check | `auditoria_acoes_usuario_login_texto_check` | `usuario_login` |
| Check | `auditoria_acoes_dados_anteriores_objeto_check` | `dados_anteriores` |
| Check | `auditoria_acoes_dados_posteriores_objeto_check` | `dados_posteriores` |
| Check | `auditoria_acoes_detalhes_objeto_check` | `detalhes` |
| Check / not null | constraints `auditoria_acoes_*_not_null` | `id`, `tipo_acao`, `entidade_tipo`, `entidade_id`, `usuario_id`, `grupo_acao_id`, `detalhes`, `criado_em` |

### Índices operacionais

| Índice | Coluna(s) | Uso |
| --- | --- | --- |
| `auditoria_acoes_entidade_idx` | `entidade_tipo`, `entidade_id`, `criado_em DESC` | Consultar o histórico de uma entrada, saída ou outra entidade. |
| `auditoria_acoes_usuario_idx` | `usuario_id`, `criado_em DESC` | Consultar ações por usuário. |
| `auditoria_acoes_tipo_acao_idx` | `tipo_acao`, `criado_em DESC` | Consultar ações por tipo. |
| `auditoria_acoes_grupo_acao_idx` | `grupo_acao_id` | Recuperar todas as linhas geradas por uma operação composta, como divisão. |
| `auditoria_acoes_criado_em_idx` | `criado_em DESC` | Listagens cronológicas de auditoria. |

### Comportamento na aplicação

- O serviço da balança grava auditoria para edição e exclusão de entradas, exclusão de saídas, adição de peso bruto de saída, desvinculação de contrato e divisão de saída.
- As ações auditáveis são executadas em transação: a linha afetada é lida com `FOR UPDATE`, a mutação é aplicada e a auditoria é gravada antes do `COMMIT`.
- Para exclusões, `dados_anteriores` contém a linha removida e `dados_posteriores` fica nulo.
- Para edições, os dois snapshots são preenchidos.
- Para divisão de saída, duas linhas são gravadas com o mesmo `grupo_acao_id`: uma para a saída original alterada e outra para a nova saída criada.
- Consulte também [`docs/auditoria.md`](auditoria.md) para detalhes operacionais.


## `users`

Armazena usuários autenticados do sistema.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | Não | `gen_random_uuid()` | Identificador do usuário. |
| `login` | `character varying` | Não | — | Login único usado na autenticação. |
| `password_hash` | `text` | Não | — | Hash `bcrypt` da senha. A senha em texto puro não é armazenada. |
| `role` | `character varying` | Não | `'user'::character varying` | Perfil do usuário. A aplicação trabalha com `root`, `admin`, `client`, `weighbridge_operator` e `silo_operator`. |
| `disabled` | `boolean` | Não | `false` | Indica se a conta está desativada. |
| `must_change_password` | `boolean` | Não | `false` | Indica se o usuário deve trocar a senha. |
| `created_at` | `timestamp with time zone` | Não | `now()` | Data/hora de criação do usuário. |
| `updated_at` | `timestamp with time zone` | Não | `now()` | Data/hora da última atualização. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `users_pkey` | `id` |
| Unique | `users_login_key` | `login` |
| Check | `users_role_check` | `role` |
| Check / not null | constraints `users_*_not_null` | `id`, `login`, `password_hash`, `role`, `disabled`, `must_change_password`, `created_at`, `updated_at` |

### Perfis usados pela aplicação

| Perfil | Uso |
| --- | --- |
| `root` | Usuário administrativo inicial, criado pelo script `npm run create-root-user`; gerencia contas. |
| `admin` | Acessa o painel administrativo e consultas/ajustes do secador. |
| `client` | Perfil de cliente; atualmente direcionado para página em construção. |
| `weighbridge_operator` | Operador de balança; acessa `/balanca` para registrar saídas e associá-las a contratos. |
| `silo_operator` | Opera o painel do secador em `/secador`. |

---

## `dryer_settings`

Armazena a configuração global do secador. A tabela funciona como singleton: o código usa `id = true` e há uma constraint `dryer_settings_singleton`.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `boolean` | Não | `true` | Chave primária booleana usada para manter apenas um registro de configuração. |
| `target_moisture` | `numeric` | Não | `14.5` | Umidade alvo padrão usada ao iniciar novas bateladas. |
| `updated_at` | `timestamp with time zone` | Não | `now()` | Data/hora da última alteração. |
| `updated_by_user_id` | `uuid` | Sim | — | Usuário que alterou a configuração. FK para `users.id`. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `dryer_settings_pkey` | `id` |
| Foreign key | `dryer_settings_updated_by_user_id_fkey` | `updated_by_user_id` → `users.id` |
| Check | `dryer_settings_singleton` | `id` |
| Check | `dryer_settings_target_moisture_check` | `target_moisture` |
| Check / not null | constraints `dryer_settings_*_not_null` | `id`, `target_moisture`, `updated_at` |

---

## `dryer_batches`

Armazena as bateladas do secador.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | Não | `gen_random_uuid()` | Identificador da batelada. |
| `grain_type` | `text` | Não | `'corn'::text` | Tipo de grão. O código usa esse campo para exibir/iniciar bateladas. |
| `status` | `text` | Não | `'active'::text` | Status da batelada. O código usa `active` e `completed`. |
| `started_at` | `timestamp with time zone` | Não | `now()` | Data/hora de início da batelada. |
| `completed_at` | `timestamp with time zone` | Sim | — | Data/hora de conclusão da batelada. |
| `started_by_user_id` | `uuid` | Sim | — | Usuário que iniciou a batelada. FK para `users.id`. |
| `completed_by_user_id` | `uuid` | Sim | — | Usuário que concluiu/parou a batelada. FK para `users.id`. |
| `target_moisture` | `numeric` | Não | `14.5` | Umidade alvo copiada de `dryer_settings` no início da batelada. |
| `umidade_inicial` | `numeric` | Não | `28` | Umidade inicial informada pelo operador ao iniciar a batelada. A aplicação sugere a média das 5 últimas entradas da balança com `umidade_percent` disponível; se houver menos de 5, sugere `28%`. |
| `notes` | `text` | Sim | — | Observações da batelada, atualmente sem uso direto nas queries principais. |
| `created_at` | `timestamp with time zone` | Não | `now()` | Data/hora de criação do registro. |
| `updated_at` | `timestamp with time zone` | Não | `now()` | Data/hora da última atualização. |
| `discharge_started_at` | `timestamp with time zone` | Sim | — | Data/hora em que a descarga da batelada foi iniciada. |
| `final_moisture` | `numeric` | Sim | — | Umidade final média da batelada durante o período de descarga, calculada pela mesma regra de média ponderada usada no secador. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `dryer_batches_pkey` | `id` |
| Foreign key | `dryer_batches_started_by_user_id_fkey` | `started_by_user_id` → `users.id` |
| Foreign key | `dryer_batches_completed_by_user_id_fkey` | `completed_by_user_id` → `users.id` |
| Check | `dryer_batches_grain_type_check` | `grain_type` |
| Check | `dryer_batches_status_check` | `status` |
| Check | `dryer_batches_completed_at_check` | `status`, `completed_at` |
| Check | `dryer_batches_target_moisture_check` | `target_moisture` |
| Check | `dryer_batches_umidade_inicial_check` | `umidade_inicial` |
| Check / not null | constraints `dryer_batches_*_not_null` | `id`, `grain_type`, `status`, `started_at`, `target_moisture`, `umidade_inicial`, `created_at`, `updated_at` |

---

## `dryer_moisture_readings`

Armazena as leituras de umidade lançadas durante uma batelada do secador.

### Colunas

| Coluna | Tipo | Nulo? | Default | Descrição |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | Não | `gen_random_uuid()` | Identificador da leitura. |
| `batch_id` | `uuid` | Não | — | Batelada associada à leitura. FK para `dryer_batches.id`. |
| `measured_at` | `timestamp with time zone` | Não | `now()` | Data/hora da medição. |
| `moisture_percent` | `numeric` | Não | — | Percentual de umidade medido. |
| `measured_by_user_id` | `uuid` | Sim | — | Usuário que registrou a medição. FK para `users.id`. |
| `measured_by_login` | `text` | Não | — | Login gravado no momento da medição, preservando histórico mesmo se o usuário mudar. |
| `created_at` | `timestamp with time zone` | Não | `now()` | Data/hora de criação do registro. |
| `average_moisture` | `numeric` | Sim | — | Umidade média calculada após esta leitura, usando a janela móvel e a interpolação de `calculateAverageMoisture`. |
| `discharge_forecast_at` | `timestamp with time zone` | Sim | — | Horário previsto para início da descarga calculado após esta leitura. |
| `discharge_forecast_status` | `text` | Sim | — | Status retornado pela previsão após esta leitura, como `forecast`, `immediate` ou `unavailable`. |

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `dryer_moisture_readings_pkey` | `id` |
| Foreign key | `dryer_moisture_readings_batch_id_fkey` | `batch_id` → `dryer_batches.id` |
| Foreign key | `dryer_moisture_readings_measured_by_user_id_fkey` | `measured_by_user_id` → `users.id` |
| Check | `dryer_moisture_readings_moisture_check` | `moisture_percent` |
| Check / not null | constraints `dryer_moisture_readings_*_not_null` | `id`, `batch_id`, `measured_at`, `moisture_percent`, `measured_by_login`, `created_at` |

---

## Observações de manutenção

1. **Não há migrations versionadas neste repositório no momento desta documentação.** Por isso, o schema documentado aqui deve ser comparado com o banco real sempre que houver dúvida.
2. **`columns.txt` é a fonte dos tipos, nulidade e defaults.**
3. **`constraints.txt` é a fonte das chaves primárias, chaves estrangeiras, uniques e checks.**
4. **Algumas regras de domínio aparecem só pelo nome da constraint**, pois o arquivo de constraints não inclui a expressão SQL completa do `CHECK`. Exemplos: `users_role_check`, `dryer_batches_status_check`, `dryer_batches_grain_type_check` e `dryer_settings_target_moisture_check`.
5. **A aplicação complementa algumas validações no código**, como CPF/CNPJ, CEP, inscrição estadual, produtos aceitos em contratos, entradas e saídas da balança, associação futura de entradas a usuários com perfil cliente e perfis de usuário.

## Como atualizar este documento

1. Gere novamente `columns.txt` e `constraints.txt` a partir do banco atualizado.
2. Compare as diferenças entre os arquivos antigos e novos.
3. Atualize as tabelas e restrições neste documento.
4. Se possível, crie migrations ou um arquivo SQL de referência para evitar divergência entre código, documentação e banco real.
