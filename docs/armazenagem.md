# Módulo de armazenagem

Este documento descreve a motivação, as decisões técnicas e o funcionamento do módulo administrativo de armazenagem, implementado na página `/admin/armazenamento`.

## Motivação

A AgroLima precisa que o administrador acompanhe, de forma rápida, quanto milho e quanta soja existem atualmente armazenados nos silos. Antes deste módulo, as entradas e saídas já existiam na balança, mas não havia uma tela administrativa que consolidasse esses movimentos em um saldo operacional de estoque.

O saldo de armazenagem não deve ser apenas a soma do `peso_liquido_kg` das entradas, porque a classificação da entrada informa umidade e impureza. Esses fatores impactam o volume real que deve ser considerado como armazenado. Por isso, o banco passou a expor `entradas_balanca.liquido_real_kg`, que representa o peso líquido ajustado para armazenagem.

Também existe a necessidade operacional de recalibrar o saldo. Em conferências físicas, o administrador pode constatar que, em uma data/hora específica, havia uma quantidade real diferente do saldo calculado. A partir dessa medição, o sistema deve tratar a quantidade conferida como nova base e aplicar somente entradas e saídas posteriores.

## Visão geral da solução

A página `/admin/armazenamento` exibe:

- saldo atual por produto;
- última recalibração usada como base do cálculo;
- total de entradas posteriores à base;
- total de saídas posteriores à base;
- quantidade de entradas pendentes que ainda não entram no cálculo por falta de `liquido_real_kg`;
- formulário para registrar nova recalibração manual;
- histórico recente de recalibrações.

O cálculo geral por produto é:

```text
saldo atual = quantidade da última recalibração
              + entradas com liquido_real_kg após a recalibração
              - saídas com peso_liquido_kg após a recalibração
```

Se o produto ainda não tiver recalibração, a base é `0` e o sistema considera todas as entradas e saídas disponíveis.

## Banco de dados

### `entradas_balanca.liquido_real_kg`

A coluna `liquido_real_kg` é usada como a quantidade que efetivamente entra no estoque. Ela deve ser calculada a partir da tara, da classificação e do peso líquido da entrada.

Como os campos de classificação são armazenados como percentuais entre `0` e `100`, as fórmulas equivalentes são:

```text
Para umidade <= 14%:
liquido_real_kg = peso_liquido_kg * (1 - impureza_percent / 100)

Para umidade > 14%:
liquido_real_kg = peso_liquido_kg
                  * (1 - impureza_percent / 100)
                  * (1 - umidade_percent / 100)
                  / 0.86
```

Quando uma entrada ainda não tem tara ou classificação completa, `liquido_real_kg` permanece nulo e essa entrada não compõe o saldo de armazenagem. A página exibe essas entradas como pendentes por produto para ajudar a identificar lacunas operacionais.

### `armazenamento_recalibracoes`

A tabela `armazenamento_recalibracoes` registra medições físicas feitas por administradores.

Campos principais:

- `produto`: `milho` ou `soja`, usando o enum `public.produto_contrato`;
- `data_recalibracao`: data/hora em que o administrador conferiu fisicamente o silo;
- `quantidade_real_kg`: quantidade real verificada no silo;
- `observacoes`: texto opcional para contexto da conferência;
- `criado_por_user_id`: administrador que registrou a recalibração;
- `criado_em`: data/hora de criação do registro.

A recalibração mais recente de cada produto é usada como base do cálculo. Movimentações com data exatamente igual à `data_recalibracao` não são somadas/subtraídas novamente; o serviço considera somente movimentos com data posterior (`>`), porque a medição física já representa o saldo naquele instante.

## Arquivos principais

- `routes/admin-routes.js`: registra as rotas administrativas de leitura e criação de recalibração.
- `routes/storage-service.js`: centraliza as queries e validações do módulo de armazenagem.
- `routes/renderers/admin-renderer.js`: monta o HTML dinâmico da página de armazenagem.
- `views/admin-storage.html`: template da tela `/admin/armazenamento`.
- `public/css/styles.css`: estilos específicos da página de armazenagem.
- `docs/database.md`: documentação do schema atualizado, incluindo `armazenamento_recalibracoes` e `liquido_real_kg`.

## Rotas implementadas

### `GET /admin/armazenamento`

Carrega a página administrativa de armazenagem.

O handler busca, em paralelo:

1. resumo atual por produto;
2. histórico recente de recalibrações;
3. contagem de entradas sem `liquido_real_kg`.

Depois chama o renderer da página com os dados e eventuais mensagens de sucesso/erro.

### `POST /admin/armazenamento/recalibracoes`

Registra uma nova recalibração manual.

Validações aplicadas:

- produto precisa ser `milho` ou `soja`;
- data/hora precisa ser válida;
- quantidade real precisa ser maior ou igual a zero;
- quantidade aceita até três casas decimais;
- observações vazias são normalizadas para `NULL`.

Após sucesso, redireciona para `/admin/armazenamento?recalibrado=1`.

## Detalhes do cálculo

A query de resumo usa uma CTE para buscar a última recalibração de cada produto:

```sql
SELECT DISTINCT ON (produto)
       id,
       produto,
       data_recalibracao,
       quantidade_real_kg
FROM armazenamento_recalibracoes
ORDER BY produto, data_recalibracao DESC, id DESC
```

Depois, para cada produto do enum `public.produto_contrato`, a query soma entradas e saídas por `LATERAL JOIN`, usando a data da recalibração como corte quando ela existir.

Entradas consideradas:

```sql
e.produto = produto_atual
AND e.liquido_real_kg IS NOT NULL
AND (
  data_recalibracao IS NULL
  OR e.data_entrada > data_recalibracao
)
```

Saídas consideradas:

```sql
s.produto = produto_atual
AND s.peso_liquido_kg IS NOT NULL
AND (
  data_recalibracao IS NULL
  OR s.data_saida > data_recalibracao
)
```

A decisão de usar `enum_range(NULL::public.produto_contrato)` garante que a tela continue exibindo todos os produtos cadastrados no enum, mesmo que não haja movimentações ou recalibrações para algum deles.

## Regras de negócio

### Recalibração como marco operacional

A recalibração é tratada como a verdade operacional do estoque em um momento específico. Ela não altera entradas ou saídas antigas; apenas muda a base usada no cálculo a partir daquela data/hora.

Isso preserva histórico e evita mutações em lançamentos de balança já auditáveis.

### Entradas pendentes

Uma entrada sem `liquido_real_kg` não deve entrar no saldo, pois o sistema ainda não sabe o peso ajustado para armazenagem.

Na prática, isso geralmente indica falta de tara ou classificação. A tela mostra a quantidade de entradas pendentes por produto para orientar correções no fluxo da balança.

### Saídas pendentes de bruto

Uma saída só reduz o saldo quando `peso_liquido_kg` está preenchido. Como esse campo depende do peso bruto, saídas ainda sem bruto não são subtraídas do estoque.

### Precisão decimal

O módulo preserva valores decimais em quilogramas e o backend aceita recalibrações com até três casas decimais para manter consistência com os pesos da balança. Na apresentação, pesos em kg e em sacas são arredondados para o inteiro mais próximo.

## Pontos de atenção para mudanças futuras

1. Se novos produtos forem adicionados ao enum `public.produto_contrato`, atualize os selects HTML que hoje listam explicitamente `milho` e `soja`.
2. Se o banco mudar a regra de geração de `liquido_real_kg`, revise este documento e os testes do fluxo de entradas.
3. Se a recalibração precisar ser editável ou removível, implemente trilha de auditoria antes de permitir alteração direta de registros históricos.
4. Se houver múltiplos silos independentes para o mesmo produto, será necessário adicionar uma dimensão de silo/local à tabela de recalibrações e às entradas/saídas usadas no cálculo.
5. Se uma entrada ou saída for editada com data anterior/posterior à última recalibração, o saldo pode mudar automaticamente. Esse comportamento é esperado porque a data operacional define se o movimento pertence ou não ao período pós-recalibração.
