# nodejs
A minimal Node.js web application.

![static-site](public/images/static-site.png)

For a step-by-step guide to deploying on [Railway](https://railway.app/?referralCode=alphasec), see [this](https://alphasec.io/how-to-deploy-a-nodejs-app-on-railway/) post, or click the button below.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/deploy/Abo1zu?referralCode=alphasec)

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
