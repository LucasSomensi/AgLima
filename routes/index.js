const express = require('express');
const https = require('https');
const path = require('path');
const router = express.Router();

const MAILERSEND_API_URL = 'https://api.mailersend.com/v1/email';

function hasEmailConfig() {
  return Boolean(
    process.env.MAILERSEND_API_TOKEN &&
      process.env.MAILERSEND_FROM_EMAIL &&
      process.env.CONTACT_TO
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

// Serve the index.html file for the root route
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

router.get('/contato', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/contact.html'));
});

router.post('/contato', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).send('Por favor, preencha todos os campos do formulário.');
  }

  if (!hasEmailConfig()) {
    console.error('Missing MailerSend configuration for contact form.');
    return res
      .status(500)
      .send('Não foi possível enviar sua mensagem agora. Tente novamente mais tarde.');
  }

  try {
    await sendMailerSendEmail(buildContactEmail({ name, email, subject, message }));

    return res.sendFile(path.join(__dirname, '../views/contact-received.html'));
  } catch (error) {
    console.error('Error sending contact email with MailerSend:', {
      message: error.message,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
    return res
      .status(500)
      .send('Não foi possível enviar sua mensagem agora. Tente novamente mais tarde.');
  }
});

router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/construction.html'));
});

module.exports = router;
