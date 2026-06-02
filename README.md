

## Contact form email setup

The `/contato` form sends messages through the MailerSend Email API, which works well in hosts that block outbound SMTP ports.

Configure these environment variables in your hosting provider before using the form:

| Variable | Required | Description |
| --- | --- | --- |
| `MAILERSEND_API_TOKEN` | Yes | MailerSend API token. Do not commit this value to Git. |
| `MAILERSEND_FROM_EMAIL` | Yes | Verified sender email/domain configured in MailerSend. |
| `CONTACT_TO` | Yes | Email address that receives contact form submissions. |
| `MAILERSEND_FROM_NAME` | No | Sender display name. Defaults to `AgroLima`. |
| `CONTACT_TO_NAME` | No | Recipient display name. Defaults to `AgroLima`. |

Example Railway variables:

```env
MAILERSEND_API_TOKEN=ms_xxxxxxxxxxxxxxxxxxxxx
MAILERSEND_FROM_EMAIL=contato@seudominio.com
MAILERSEND_FROM_NAME=AgroLima
CONTACT_TO=destino@exemplo.com
CONTACT_TO_NAME=AgroLima
```

After changing variables in Railway, redeploy or restart the service so the Node.js process reads the new values.

## Inicialização do usuário root no banco

O script `scripts/create-root-user.js` cria o usuário administrativo `root` no PostgreSQL. Ele lê a string de conexão e a senha do root a partir de variáveis de ambiente, gera o hash da senha com `bcrypt` e insere o registro somente se o `login` ainda não existir.

Variáveis de ambiente obrigatórias:

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | Sim | String de conexão do PostgreSQL usada pela biblioteca `pg`. |
| `ROOT_PASSWORD` | Sim | Senha que será criptografada e armazenada para o login `root`. Não commit este valor no Git. |

O script e o login esperam que a tabela `users` tenha pelo menos estas colunas:

```sql
id uuid primary key,
login text unique not null,
password_hash text not null,
role text not null,
disabled boolean not null default false,
must_change_password boolean not null default false,
created_at timestamptz not null default now()
```

Para executar localmente a partir da raiz do projeto, instale as dependências e rode:

```bash
npm install
DATABASE_URL="postgresql://usuario:senha@localhost:5432/agrolima" ROOT_PASSWORD="troque-esta-senha" npm run create-root-user
```

Para executar no Railway:

1. Adicione `ROOT_PASSWORD` nas variáveis do serviço.
2. Confirme que `DATABASE_URL` está disponível no serviço, normalmente a partir do banco PostgreSQL conectado.
3. Abra o shell do serviço ou o executor de comandos avulsos do Railway e execute:

```bash
npm run create-root-user
```

Se o login `root` já existir, o script termina com sucesso sem alterar o usuário existente.

## Login e gerenciamento de usuários

O `/login` autentica usuários salvos na tabela `users` do PostgreSQL usando `DATABASE_URL`. O usuário com `role = 'root'` é redirecionado para `/admin/usuarios`, onde pode adicionar e remover outros usuários do sistema. Usuários com `role = 'admin'` são redirecionados para `/admin`, onde acompanham a batelada atual, alteram a umidade alvo e consultam bateladas anteriores. Usuários com `role = 'silo_operator'` são redirecionados para `/secador`. Os perfis `client` e `weighbridge_operator` são redirecionados para páginas em construção em `/area-interna`.

Além de `DATABASE_URL`, configure também:

| Variable | Required | Description |
| --- | --- | --- |
| `SESSION_SECRET` | Yes | Secret usado para assinar o cookie de sessão. Use um valor longo e aleatório. |
| `SESSION_DURATION_DAYS` | No | Duração da sessão em dias. Use um número positivo; valores inválidos, zero ou negativos voltam ao padrão de 8 horas. |
| `SESSION_DURATION_HOURS` | No | Alternativa para configurar a duração da sessão em horas quando `SESSION_DURATION_DAYS` não estiver definida. Use um número positivo. |

Example Railway variable:

```env
SESSION_SECRET=troque-por-uma-string-longa-e-aleatoria
SESSION_DURATION_DAYS=30
```

As senhas criadas pelo painel root são armazenadas como hash `bcrypt` na coluna `password_hash`; a senha em texto puro nunca é gravada no banco.

## Horário do sistema

As telas e formulários do sistema usam sempre o fuso de Brasília (`America/Sao_Paulo`). Campos `datetime-local` enviados pelo navegador são interpretados como horário de Brasília antes de serem salvos no PostgreSQL, e datas recuperadas do banco também são exibidas nesse mesmo fuso.

## Perfis de usuário

O sistema trabalha com cinco perfis na coluna `users.role`:

| Perfil | Descrição |
| --- | --- |
| `root` | Usuário especial criado pelo script `npm run create-root-user`; gerencia as contas dos demais usuários. |
| `admin` | Sócios/administradores da empresa; acessam o painel administrativo do secador em modo consulta e podem ajustar a umidade alvo. |
| `client` | Clientes; futuramente consultarão volumes de soja e milho armazenados, mas por enquanto acessam uma página em construção. |
| `weighbridge_operator` | Operadores de balança; futuramente lançarão entradas e saídas de produto, mas por enquanto acessam uma página em construção. |
| `silo_operator` | Operadores de silo; acessam o painel compartilhado do secador em `/secador`. |

O painel do usuário `root` cria apenas usuários dos perfis `admin`, `client`, `weighbridge_operator` e `silo_operator`. O perfil `root` continua reservado ao script de inicialização.


## Painel administrativo do secador

Usuários com perfil `admin` acessam `/admin`. A tela inicial mostra a batelada ativa com status, data e hora de início, produto, umidade alvo e medições de umidade, sem botões operacionais de registrar umidade, iniciar descarga, iniciar nova batelada ou parar o secador. A mesma tela permite alterar a umidade alvo salva em `dryer_settings`; novas bateladas passam a usar esse valor no momento em que são iniciadas.

O botão **Ver bateladas anteriores** abre `/admin/bateladas`, com as bateladas concluídas em ordem cronológica reversa. Cada linha abre `/admin/bateladas/:id`, exibindo as informações salvas e medições daquela batelada.

## Painel do secador

Todos os usuários com perfil `silo_operator` compartilham o mesmo painel em `/secador`, pois a operação considera um único secador de grãos. O painel usa as tabelas `dryer_settings`, `dryer_batches` e `dryer_moisture_readings` no PostgreSQL.

Tabelas esperadas:

```sql
dryer_settings (
  id boolean primary key,
  target_moisture numeric(3,1) not null default 14.5,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references users(id) on delete set null
)

dryer_batches (
  id uuid primary key,
  grain_type text not null default 'corn',
  status text not null default 'active',
  started_at timestamptz not null default now(),
  discharge_started_at timestamptz,
  completed_at timestamptz,
  started_by_user_id uuid references users(id) on delete set null,
  completed_by_user_id uuid references users(id) on delete set null,
  target_moisture numeric(3,1) not null default 14.5,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

dryer_moisture_readings (
  id uuid primary key,
  batch_id uuid not null references dryer_batches(id) on delete cascade,
  measured_at timestamptz not null default now(),
  moisture_percent numeric(3,1) not null,
  measured_by_user_id uuid references users(id) on delete set null,
  measured_by_login text not null,
  created_at timestamptz not null default now()
)
```

Fluxo implementado:

1. O operador de silo clica em **Iniciar nova batelada**.
2. O sistema confirma a data/hora de início, usando o horário atual como padrão, e o status do painel passa a ser **Secando**.
3. Antes de iniciar outra batelada, o operador registra **Iniciar descarga**, salvando o horário em que o milho começa a ser enviado para os silos, e o status passa a ser **Descarregando**.
4. A batelada ativa anterior só pode ser encerrada por uma nova batelada depois de ter o horário de descarga registrado, e então uma nova batelada ativa é criada.
5. Se o operador clicar em **Parar secador**, após confirmação, a batelada ativa é concluída imediatamente, o status passa a ser **Parado** e a única ação disponível é **Iniciar nova batelada**.
6. A lista visível do painel passa a mostrar apenas as medições da batelada ativa.
7. As medições anteriores continuam salvas no banco para consulta posterior.
8. O operador adiciona medições de umidade entre `7,0%` e `40,0%`, com no máximo uma casa decimal.
9. Cada medição salva horário, valor, usuário responsável e login do operador.
10. Enquanto a descarga ainda não foi iniciada, o painel calcula a previsão de início da descarga usando a média integrada das umidades das últimas 1h45min (ou desde o início da batelada, se ela for mais recente). Após 1h45min de batelada a previsão parte do horário da última medição; antes disso ela parte do início da batelada mais 90 minutos. Antes da primeira medição a previsão fica vazia; se a previsão calculada já passou, o painel mostra `Descarga imediata`; depois que o operador inicia a descarga, o painel mostra o horário efetivamente registrado.

Como só existe um secador, recomenda-se manter no banco um índice único parcial para impedir mais de uma batelada ativa:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS dryer_batches_one_active_idx
ON dryer_batches ((status))
WHERE status = 'active';
```
