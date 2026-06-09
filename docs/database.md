# Documentação do Banco de Dados

Este documento descreve o schema `public` do banco PostgreSQL usado pela aplicação AgroLima. Ele foi criado a partir dos arquivos `columns.txt` e `constraints.txt`, que contêm consultas ao `information_schema` do banco, e complementado com o comportamento observado no código da aplicação.

> **Uso para manutenção:** consulte este arquivo antes de alterar queries, telas administrativas, serviços do secador, contratos ou autenticação. Se o banco for alterado, gere novamente `columns.txt` e `constraints.txt` e atualize esta documentação.

## Visão geral

- **Banco:** PostgreSQL.
- **Schema:** `public`.
- **Tabelas documentadas:**
  - [`compradores`](#compradores)
  - [`vendedores`](#vendedores)
  - [`contratos`](#contratos)
  - [`users`](#users)
  - [`dryer_settings`](#dryer_settings)
  - [`dryer_batches`](#dryer_batches)
  - [`dryer_moisture_readings`](#dryer_moisture_readings)

## Relacionamentos principais

| Origem | Coluna | Destino | Coluna | Uso principal |
| --- | --- | --- | --- | --- |
| `contratos` | `comprador_id` | `compradores` | `id` | Vincula cada contrato a um comprador. |
| `contratos` | `vendedor_id` | `vendedores` | `id` | Vincula cada contrato a um vendedor. |
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

Armazena contratos comerciais de compra/venda de grãos.

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

### Restrições

| Tipo | Nome | Coluna(s) / referência |
| --- | --- | --- |
| Primary key | `contratos_pkey` | `id` |
| Foreign key | `contratos_comprador_id_fk` | `comprador_id` → `compradores.id` |
| Foreign key | `contratos_vendedor_id_fk` | `vendedor_id` → `vendedores.id` |
| Check / not null | constraints `contratos_*_not_null` | `id`, `data_contrato`, `produto`, `preco_por_saca`, `comprador_id`, `vendedor_id`, `quantidade_kg`, `contrato_embarcado`, `contrato_recebido`, `corretagem_paga`, `criado_em`, `atualizado_em` |

---

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
| `weighbridge_operator` | Operador de balança; atualmente direcionado para página em construção. |
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
| `notes` | `text` | Sim | — | Observações da batelada, atualmente sem uso direto nas queries principais. |
| `created_at` | `timestamp with time zone` | Não | `now()` | Data/hora de criação do registro. |
| `updated_at` | `timestamp with time zone` | Não | `now()` | Data/hora da última atualização. |
| `discharge_started_at` | `timestamp with time zone` | Sim | — | Data/hora em que a descarga da batelada foi iniciada. |

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
| Check / not null | constraints `dryer_batches_*_not_null` | `id`, `grain_type`, `status`, `started_at`, `target_moisture`, `created_at`, `updated_at` |

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
5. **A aplicação complementa algumas validações no código**, como CPF/CNPJ, CEP, inscrição estadual, produtos aceitos em contratos e perfis de usuário.

## Como atualizar este documento

1. Gere novamente `columns.txt` e `constraints.txt` a partir do banco atualizado.
2. Compare as diferenças entre os arquivos antigos e novos.
3. Atualize as tabelas e restrições neste documento.
4. Se possível, crie migrations ou um arquivo SQL de referência para evitar divergência entre código, documentação e banco real.
