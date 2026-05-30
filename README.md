

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
