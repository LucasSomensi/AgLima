

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

O script espera que a tabela `users` tenha pelo menos estas colunas:

```sql
login text unique not null,
password_hash text not null,
role text not null
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

## Root login setup

The `/login` page authenticates a single administrative user:

| Variable | Required | Description |
| --- | --- | --- |
| `ROOT_PASSWORD` | Yes | Password for the `root` login. Do not commit this value to Git. |

Example local or Railway variable:

```env
ROOT_PASSWORD=troque-esta-senha
```

When the login is `root` and the password matches `ROOT_PASSWORD`, the user is redirected to `/area-interna`, which currently shows the construction page.
