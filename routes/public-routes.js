const express = require('express');
const path = require('path');
const mailer = require('./mailer');
const { normalizeContactPayload, validateContactPayload } = require('./contact-validation');
const { contactRateLimiter } = require('./rate-limit');

const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

router.get('/contato', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/contact.html'));
});

router.post('/contato', contactRateLimiter, async (req, res) => {
  const payload = normalizeContactPayload(req.body);
  const { name, email, subject, message, website } = payload;

  if (website) {
    return res.sendFile(path.join(__dirname, '../views/contact-received.html'));
  }

  const validationError = validateContactPayload(payload);
  if (validationError) {
    return res.status(400).send(validationError);
  }

  if (!mailer.hasEmailConfig()) {
    console.error('Missing MailerSend configuration for contact form.');
    return res
      .status(500)
      .send('Não foi possível enviar sua mensagem agora. Tente novamente mais tarde.');
  }

  try {
    await mailer.sendMailerSendEmail(mailer.buildContactEmail({ name, email, subject, message }));

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

module.exports = router;
