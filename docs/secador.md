# Fluxo do operador de secador

Este documento resume o contexto técnico e operacional do painel do secador para facilitar manutenções futuras.

## Objetivo do fluxo

O operador de silo acompanha e registra a operação de um único secador de grãos em `/secador`. O fluxo controla a batelada ativa, o momento em que a descarga para os silos começa, as medições de umidade feitas durante a secagem e a parada manual do secador quando necessário.

O sistema considera que todos os usuários com perfil `silo_operator` compartilham o mesmo painel e a mesma batelada ativa. Usuários `root` também podem acessar o painel operacional. Administradores acompanham o secador por telas próprias de consulta e configuração, sem executar as ações operacionais do secador.

## Banco de dados

As tabelas principais são `dryer_settings`, `dryer_batches`, `dryer_moisture_readings` e, para sugerir a umidade inicial, `entradas_balanca`.

### `dryer_settings`

Guarda a configuração global do secador. O código trata a tabela como singleton usando `id = true`.

Campos centrais:

- `id`: chave booleana fixa para manter um único registro de configuração.
- `target_moisture`: umidade alvo padrão usada ao iniciar novas bateladas.
- `updated_at`: data/hora da última alteração da configuração.
- `updated_by_user_id`: usuário que alterou a configuração.

### `dryer_batches`

Guarda as bateladas do secador.

Campos centrais:

- `id`: identificador da batelada.
- `grain_type`: tipo de grão. O fluxo operacional atual inicia bateladas de milho (`corn`).
- `status`: status persistido da batelada. O código usa `active` para a batelada em andamento e `completed` para bateladas encerradas.
- `started_at`: data/hora em que a batelada foi iniciada.
- `discharge_started_at`: data/hora em que o operador iniciou a descarga para os silos.
- `completed_at`: data/hora em que a batelada foi encerrada, seja por início de nova batelada depois da descarga, seja por parada manual.
- `started_by_user_id`: usuário que iniciou a batelada.
- `completed_by_user_id`: usuário que concluiu/parou a batelada.
- `target_moisture`: umidade alvo copiada de `dryer_settings` no momento do início da batelada.
- `umidade_inicial`: umidade inicial digitada pelo operador ao confirmar o início da batelada. Aceita valores decimais entre `5%` e `50%`.
- `notes`: observações, atualmente sem uso direto nas telas principais.

### `dryer_moisture_readings`

Guarda as medições de umidade lançadas durante a batelada.

Campos centrais:

- `batch_id`: batelada associada à leitura.
- `measured_at`: data/hora da medição, preenchida pelo backend no momento do lançamento.
- `moisture_percent`: percentual de umidade medido.
- `measured_by_user_id`: usuário que registrou a medição.
- `measured_by_login`: login gravado no momento da medição, preservando o histórico mesmo que o cadastro do usuário mude depois.

## Arquivos principais

- `routes/dryer-routes.js`: rotas HTTP do painel operacional do secador.
- `routes/dryer-service.js`: queries, transações e regras de negócio do secador.
- `routes/dryer-forecast.js`: cálculo da previsão de início da descarga.
- `routes/renderers/dryer-renderer.js`: renderização do painel `/secador`.
- `views/dryer-panel.html`: template HTML do painel operacional.
- `public/js/app.js`: comportamentos compartilhados de confirmação, carregamento e interação da interface.
- `public/js/dryer-pwa.js`: registro do service worker do painel do secador.
- `public/sw.js`: regras de cache; rotas autenticadas do secador consultam a rede.
- `public/manifest.webmanifest`: metadados de instalação/PWA do painel.
- `routes/admin-routes.js` e `routes/renderers/admin-renderer.js`: telas administrativas de consulta do secador e ajuste de umidade alvo.

## Rotas implementadas

### Operador de secador

- `GET /secador`: mostra o painel operacional com status, início da batelada, previsão ou horário de descarga, umidade inicial da batelada ativa, formulário de umidade, ação principal e medições da batelada ativa.
- `GET /secador/bateladas/nova`: mostra a etapa de confirmação para iniciar nova batelada, com o campo editável de umidade inicial preenchido pela média das 5 últimas entradas classificadas da balança ou por `28%` quando não houver 5 entradas com umidade disponível.
- `POST /secador/bateladas`: inicia uma nova batelada usando a umidade inicial confirmada. Se já houver batelada ativa sem descarga iniciada, rejeita a ação.
- `POST /secador/bateladas/descarga`: registra o início da descarga da batelada ativa.
- `POST /secador/bateladas/parar`: para o secador e conclui imediatamente a batelada ativa.
- `POST /secador/umidades`: registra uma medição de umidade na batelada ativa.

### Administração relacionada

- `GET /admin/secador`: mostra o painel administrativo de consulta do secador.
- `POST /admin/secador/configuracoes`: atualiza a umidade alvo global em `dryer_settings`.
- `GET /admin/bateladas`: lista bateladas concluídas em ordem cronológica reversa.
- `GET /admin/bateladas/:id`: mostra os detalhes e medições de uma batelada concluída.

## Perfis e permissões

- `silo_operator`: acessa o painel operacional em `/secador` e executa as ações do fluxo.
- `root`: também pode acessar `/secador`, útil para suporte e operação emergencial.
- `admin`: acompanha o secador pelas rotas administrativas. Pode alterar a umidade alvo, mas não deve iniciar batelada, iniciar descarga, registrar umidade ou parar o secador pela tela administrativa.

## Fluxo operacional do operador

### 1. Acessar o painel

O operador entra em `/secador`. O painel mostra três estados principais:

- **Parado**: não existe batelada ativa. O registro de umidade fica desabilitado e a ação principal é “Iniciar nova batelada”.
- **Secando**: existe batelada ativa sem `discharge_started_at`. O operador pode registrar umidades, iniciar a descarga ou parar o secador.
- **Descarregando**: existe batelada ativa com `discharge_started_at`. O operador ainda pode registrar umidades, pode parar o secador ou iniciar uma nova batelada, o que encerra a batelada atual.

### 2. Iniciar uma nova batelada

Quando não há batelada ativa, o operador clica em “Iniciar nova batelada” e é levado para uma página de confirmação. Nessa página, precisa revisar ou editar a `umidade_inicial` antes de confirmar. O campo vem preenchido pela média de `umidade_percent` das 5 últimas linhas de `entradas_balanca` que tenham umidade disponível, ordenadas pelas datas mais recentes de entrada/criação. Se a consulta encontrar menos de 5 entradas com umidade, o campo usa `28%`.

Ao confirmar, o backend grava:

- `grain_type = 'corn'`;
- `umidade_inicial` com o valor decimal confirmado pelo operador, validado entre `5%` e `50%`;
- `status = 'active'`;
- `started_at` com o horário atual do servidor;
- `started_by_user_id` com o usuário logado;
- `target_moisture` copiada da configuração global vigente em `dryer_settings`.

Se já existir uma batelada ativa com descarga iniciada, o mesmo botão abre a confirmação e, depois da confirmação, inicia a próxima batelada e encerra a anterior no mesmo horário. A batelada anterior recebe `status = 'completed'`, `completed_at` igual ao início da nova batelada e `completed_by_user_id` do operador logado.

Se já existir uma batelada ativa sem descarga iniciada, o sistema bloqueia a nova batelada e orienta o operador a iniciar a descarga da batelada atual antes.

### 3. Registrar medições de umidade

Com uma batelada ativa, o operador informa a umidade medida e clica em “Registrar umidade”.

Regras atuais:

- a umidade deve estar entre `7,0%` e `40,0%`;
- o valor aceita no máximo uma casa decimal;
- o horário da leitura é sempre o horário atual do servidor;
- cada leitura fica vinculada à batelada ativa no momento do lançamento;
- a leitura salva o usuário responsável e o login usado no momento.

A lista exibida no painel mostra apenas as medições da batelada ativa, ordenadas por horário de medição. Medições de bateladas anteriores permanecem no banco para consulta posterior pela administração.

### 4. Acompanhar a previsão de descarga

Enquanto a descarga ainda não foi iniciada, o painel calcula uma previsão para auxiliar o operador a decidir quando começar a descarga. A previsão já pode ser calculada desde o início da batelada, antes da primeira medição, usando `m` igual à umidade inicial e tratando o horário da última medição como o horário de início da batelada.

O cálculo parte da média de umidades `m` no período entre a última medição e 1h45min antes dela. Exemplo: se a última medição foi às 13:00, a janela vai de 11:15 até 13:00. Se parte dessa janela for anterior ao início da batelada, o sistema supõe que todo esse período anterior teve umidade igual à umidade inicial da batelada. Por exemplo, se a batelada começou às 13:00 com umidade inicial de 28% e a primeira medição foi feita às 13:15, a média considera 28% de 11:30 até 13:00. Essa regra também vale quando a batelada atravessa a meia-noite, pois o cálculo usa data e hora completas, não apenas o horário do dia.

Para calcular `m`, a umidade inicial e as medições são tratadas como pontos de uma função de umidade ao longo do tempo. O sistema integra numericamente essa função na janela de interesse, usando interpolação linear entre pontos, e divide a área pelo tempo da janela.

Com a média `m`, a umidade alvo da batelada (`alvo`) e os parâmetros atuais `a = 0,79542` e `b = 1,88673`, a previsão usa as fórmulas abaixo:

```text
x_inf = b / (1 - a)
alpha = a ** (1 / 6)
beta = (alvo - x_inf) / (m - x_inf)
minutos restantes = 15 * ln(beta) / ln(alpha) - 90
```

A umidade alvo padrão é `14,5%`, mas administradores podem alterá-la. Cada batelada usa a umidade alvo copiada no momento em que foi iniciada. Os parâmetros `a` e `b` ainda são fixos no código, mas foram pensados para poderem ser configurados por administradores futuramente.

A regra normal soma os `minutos restantes` ao horário da última medição:

```text
hora prevista para início da descarga = hora da última medição + minutos restantes
```

Se o horário atual do servidor já for maior que o horário previsto, o painel mostra “Descarga imediata”. Depois que o operador clica em “Iniciar descarga”, toda essa lógica deixa de ser recalculada para a batelada e o painel passa a mostrar o horário em que a descarga realmente começou.

### 5. Iniciar descarga

Enquanto a batelada está secando, a ação principal é “Iniciar descarga”. Ao confirmar, o backend grava `discharge_started_at` com o horário atual do servidor. O status visual muda de **Secando** para **Descarregando**.

A descarga só pode ser iniciada se houver batelada ativa e se ela ainda não tiver descarga registrada. Tentativas duplicadas retornam mensagem amigável para o operador.

### 6. Iniciar a próxima batelada depois da descarga

Depois que a descarga foi iniciada, a ação principal passa a ser “Iniciar nova batelada”. Ao confirmar, o sistema encerra a batelada ativa e cria a nova batelada em uma única transação.

Essa regra evita abrir uma batelada nova antes de registrar quando a produção anterior começou a ser enviada para os silos.

### 7. Parar o secador

Em qualquer batelada ativa, o operador pode usar “Parar secador”. A ação pede confirmação e encerra imediatamente a batelada ativa, gravando:

- `status = 'completed'`;
- `completed_at` com o horário atual do servidor;
- `completed_by_user_id` com o operador logado.

Após a parada, o painel volta ao estado **Parado** e a única ação operacional liberada é iniciar uma nova batelada.

## Regras de negócio atuais

### Batelada ativa única

O service usa uma transação com `pg_advisory_xact_lock(20260530)` ao iniciar batelada, iniciar descarga e parar o secador. Isso serializa operações concorrentes no fluxo do secador.

Como a operação considera apenas um secador, recomenda-se manter no banco um índice único parcial para impedir mais de uma batelada ativa:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS dryer_batches_one_active_idx
ON dryer_batches ((status))
WHERE status = 'active';
```

### Horários operacionais

As ações do operador usam o horário atual do servidor. A interface não permite editar manualmente `started_at`, `discharge_started_at`, `completed_at` ou `measured_at` no painel operacional.

### Umidade alvo

A umidade alvo é configurada no painel administrativo e fica em `dryer_settings.target_moisture`. Quando uma nova batelada começa, o valor vigente é copiado para `dryer_batches.target_moisture`. Alterações posteriores na configuração global não mudam a umidade alvo de bateladas já iniciadas.

### Produto

O fluxo operacional atual inicia bateladas com `grain_type = 'corn'`. Se outros produtos forem habilitados futuramente, será necessário alterar a interface do operador, as validações do service e a documentação do banco.

### PWA e cache

O painel do secador possui manifesto e registro de service worker para facilitar uso em dispositivos de operação. As rotas `/secador` e `/secador/*` não devem ser atendidas por cache estático, pois exibem dados operacionais autenticados e sensíveis ao tempo.

## Pontos de atenção para mudanças futuras

1. Se a operação passar a ter mais de um secador, será necessário adicionar um identificador de secador nas tabelas, rever o índice de batelada ativa única e ajustar todas as queries que hoje assumem singleton.
2. Se o operador puder editar horários manualmente, valide a ordem temporal entre início, medições, descarga e conclusão, mantendo trilha de auditoria.
3. Se novos tipos de grão forem adicionados, atualize o formulário operacional, as constraints do banco e a lógica que hoje usa `corn` fixo.
4. Se a fórmula de previsão de descarga mudar, atualize `routes/dryer-forecast.js`, os testes relacionados e a explicação deste documento.
5. Se as medições puderem ser corrigidas ou excluídas, registre quem alterou, quando alterou e preserve histórico suficiente para auditoria.
6. Se o painel administrativo ganhar ações operacionais, mantenha clara a separação de permissões entre consulta/configuração e operação do secador.
