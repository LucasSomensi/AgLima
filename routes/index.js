const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const router = express.Router();

function createTransporter() {
  const port = Number(process.env.SMTP_PORT || 587);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function hasEmailConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.CONTACT_TO
  );
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
    console.error('Missing SMTP configuration for contact form.');
    return res
      .status(500)
      .send('Não foi possível enviar sua mensagem agora. Tente novamente mais tarde.');
  }

  try {
    const transporter = createTransporter();

    await transporter.sendMail({
      from: `AgroLima <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_TO,
      replyTo: email,
      subject: `[Contato AgroLima] ${subject}`,
      text: `Nome: ${name}\nE-mail: ${email}\nAssunto: ${subject}\n\nMensagem:\n${message}`,
    });

    return res.send(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Mensagem enviada | AgroLima</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/css/bootstrap.min.css" integrity="sha384-xOolHFLEh07PJGoPkLv1IbcEPTNtaed2xpHsD9ESMhqIYd0nLMwNLD69Npy4HI+N" crossorigin="anonymous">
    <link rel="stylesheet" href="/css/styles.css">
  </head>
  <body>
    <main class="page-shell">
      <section class="content-card contact-card">
        <a class="back-link" href="/contato">← Voltar ao contato</a>
        <span class="eyebrow">Mensagem enviada</span>
        <h1 class="page-title">Obrigado pelo contato!</h1>
        <p class="page-description">Recebemos sua mensagem e retornaremos assim que possível.</p>
      </section>
    </main>
  </body>
</html>`);
  } catch (error) {
    console.error('Error sending contact email:', error);
    return res
      .status(500)
      .send('Não foi possível enviar sua mensagem agora. Tente novamente mais tarde.');
  }
});

router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/construction.html'));
});

module.exports = router;
