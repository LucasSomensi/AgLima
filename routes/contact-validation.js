const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeContactPayload(body = {}) {
  return {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim(),
    subject: String(body.subject || '').trim(),
    message: String(body.message || '').trim(),
    website: String(body.website || '').trim(),
  };
}

function validateContactPayload(payload) {
  if (payload.name.length < 2 || payload.name.length > 100) {
    return 'Informe um nome válido.';
  }

  if (payload.email.length === 0 || payload.email.length > 254 || !EMAIL_PATTERN.test(payload.email)) {
    return 'Informe um e-mail válido.';
  }

  if (payload.subject.length < 3 || payload.subject.length > 150) {
    return 'Informe um assunto válido.';
  }

  if (payload.message.length < 10 || payload.message.length > 5000) {
    return 'Informe uma mensagem válida.';
  }

  return null;
}

module.exports = {
  normalizeContactPayload,
  validateContactPayload,
};
