# Fluxo de entradas da balança

Este documento resume o contexto técnico do fluxo de entradas da balança para facilitar manutenções futuras.

## Objetivo do fluxo

O operador de balança registra a chegada de um veículo com produto. O lançamento inicial guarda data/hora, placa, produto e peso bruto. Depois, a entrada pode receber tara, classificação e origem. O banco já possui campos para associação futura a cliente, mas essa ação ainda não aparece na interface.

## Banco de dados

A tabela principal é `entradas_balanca`.

Campos centrais:

- `data_entrada`: data/hora operacional da entrada. O formulário sugere a data atual, mas permite edição manual.
- `placa_caminhao`: placa normalizada em maiúsculas, sem pontuação.
- `produto`: usa o tipo `public.produto_contrato`, o mesmo de `contratos.produto` e `saidas_balanca.produto`.
- `peso_bruto_kg`: preenchido na criação da entrada.
- `peso_tara_kg`: nulo até ser copiado de tara anterior ou adicionado manualmente.
- `peso_liquido_kg`: coluna gerada pelo PostgreSQL; só fica preenchida quando existe tara.
- `tara_usada_de_entrada_id`: aponta para a entrada anterior de onde a tara foi copiada.
- `origem`: texto livre para fazenda/lote de origem.
- `umidade_percent`, `impureza_percent`, `graos_avariados_percent`: classificação da entrada.
- `cliente_user_id`: reservado para implementação futura de associação com clientes (`users.role = 'client'`).

## Arquivos principais

- `routes/weighbridge-routes.js`: rotas HTTP do operador de balança.
- `routes/weighbridge-service.js`: validações e queries de entradas e saídas da balança.
- `routes/renderers.js`: renderização HTML das listas e formulários.
- `views/weighbridge-home.html`: página inicial `/balanca` com últimas entradas e saídas.
- `views/weighbridge-input-form.html`: formulário de nova entrada e autocomplete de placas.
- `views/weighbridge-input-tare-form.html`: formulário para adicionar tara manual.
- `views/weighbridge-input-classification-form.html`: formulário para adicionar classificação.
- `views/weighbridge-input-origin-form.html`: formulário para definir origem.
- `public/css/styles.css`: estilos compartilhados e específicos do fluxo.

## Rotas implementadas

- `GET /balanca`: lista as 10 últimas entradas e as 10 últimas saídas.
- `GET /balanca/entradas/nova`: abre formulário de nova entrada.
- `POST /balanca/entradas`: cria entrada.
- `GET /balanca/entradas/placas?q=...`: retorna até 5 placas recentes para autocomplete.
- `GET /balanca/entradas/tara-anterior?placa=...`: retorna a tara anterior da placa, se existir.
- `GET /balanca/entradas/:id/tara`: abre formulário de tara manual.
- `POST /balanca/entradas/:id/tara`: grava tara manual.
- `GET /balanca/entradas/:id/classificacao`: abre formulário de classificação.
- `POST /balanca/entradas/:id/classificacao`: grava classificação.
- `GET /balanca/entradas/:id/origem`: abre formulário de origem.
- `POST /balanca/entradas/:id/origem`: grava origem.

## Regras de negócio atuais

### Placas recentes

A query retorna no máximo 5 placas distintas, priorizando a entrada mais recente de cada placa. Conforme o operador digita, o frontend chama `/balanca/entradas/placas?q=...` e atualiza os botões abaixo do campo de placa.

### Tara anterior

A opção “Usar tara anterior” começa desabilitada. Ela é habilitada quando a placa selecionada possui alguma entrada anterior com `peso_tara_kg IS NOT NULL`.

Ao confirmar com essa opção marcada, o backend busca novamente a tara anterior. Isso evita confiar apenas no estado do navegador.

### Tara manual

A ação “Adicionar tara” aparece apenas quando `peso_tara_kg` está nulo. O `UPDATE` só grava se a entrada ainda estiver sem tara e se `peso_bruto_kg > peso_tara_kg`.

### Classificação

Os valores padrão do formulário são:

- umidade: `14`;
- impureza: `1`;
- grãos avariados: `0`.

Os três campos são salvos em conjunto, junto com `classificado_por_user_id` e `classificado_em`.

### Origem

A origem é texto livre por enquanto. Exemplo: `Fazenda São José`. O banco exige que, se `origem` estiver preenchida, também existam `origem_definida_por_user_id` e `origem_definida_em`.

### Cliente futuro

Não há ação na interface para associar cliente. Quando for implementado, o service deve listar apenas usuários com:

```sql
role = 'client'
AND disabled IS NOT TRUE
```

Na gravação, valide novamente que o usuário selecionado ainda tem `role = 'client'`.

## Pontos de atenção para mudanças futuras

1. Se novos produtos forem adicionados ao enum `public.produto_contrato`, atualize os selects HTML e `PRODUCT_VALUES` em `routes/weighbridge-service.js`.
2. Se a origem deixar de ser texto livre e virar cadastro, crie uma tabela própria e migre `entradas_balanca.origem` para uma FK ou mantenha ambos durante transição.
3. Se a classificação precisar gerar descontos ou peso líquido ajustado, crie colunas separadas; não altere `peso_liquido_kg`, que hoje representa apenas `peso_bruto_kg - peso_tara_kg`.
4. Se a tara anterior precisar considerar apenas entradas concluídas/classificadas, altere `getPreviousTareForPlate` em `routes/weighbridge-service.js`.
5. Se o operador puder editar origem/classificação, remova as travas de interface/queries que assumem preenchimento único e mantenha auditoria de atualização.
