const https = require('https');
const { MAILERSEND_API_URL } = require('./constants');
const { escapeHtml } = require('./utils');

function hasEmailConfig() {
  return Boolean(
    process.env.MAILERSEND_API_TOKEN &&
      process.env.MAILERSEND_FROM_EMAIL &&
      process.env.CONTACT_TO
  );
}

function sendMailerSendEmail(payload) {
  const requestBody = JSON.stringify(payload);
  const url = new URL(MAILERSEND_API_URL);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.MAILERSEND_API_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }

          const error = new Error(`MailerSend request failed with status ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.responseBody = responseBody;
          reject(error);
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(new Error('MailerSend request timed out'));
    });

    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });
}

function buildContactEmail({ name, email, subject, message }) {
  const fromName = process.env.MAILERSEND_FROM_NAME || 'AgroLima';
  const toName = process.env.CONTACT_TO_NAME || 'AgroLima';

  return {
    from: {
      email: process.env.MAILERSEND_FROM_EMAIL,
      name: fromName,
    },
    to: [
      {
        email: process.env.CONTACT_TO,
        name: toName,
      },
    ],
    reply_to: {
      email,
      name,
    },
    subject: `[Contato AgroLima] ${subject}`,
    text: `Nome: ${name}\nE-mail: ${email}\nAssunto: ${subject}\n\nMensagem:\n${message}`,
    html: `
      <h2>Nova mensagem do site AgroLima</h2>
      <p><strong>Nome:</strong> ${escapeHtml(name)}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(email)}</p>
      <p><strong>Assunto:</strong> ${escapeHtml(subject)}</p>
      <p><strong>Mensagem:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    `,
  };
}

module.exports = {
  buildContactEmail,
  hasEmailConfig,
  sendMailerSendEmail,
};
