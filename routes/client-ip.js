const net = require('node:net');

// No Railway, o socket recebido pela aplicação é sempre do proxy de borda, e o
// número de saltos em X-Forwarded-For não é fixo. O Railway sobrescreve o
// cabeçalho X-Real-IP em toda requisição pública com o IP real do cliente, então
// ele é a fonte confiável nesse ambiente.
const RAILWAY_CLIENT_IP_HEADER = 'x-real-ip';

function getClientIpHeader(env = process.env) {
  if (env.CLIENT_IP_HEADER !== undefined) {
    // Valor vazio desativa explicitamente o uso de cabeçalho.
    return String(env.CLIENT_IP_HEADER).trim().toLowerCase() || null;
  }

  return env.RAILWAY_PROJECT_ID ? RAILWAY_CLIENT_IP_HEADER : null;
}

function getClientIp(req, env = process.env) {
  const header = getClientIpHeader(env);

  if (header) {
    const headerValue = String(req.headers?.[header] || '').trim();

    if (net.isIP(headerValue)) {
      return headerValue;
    }
  }

  return req.ip || req.socket?.remoteAddress || null;
}

module.exports = {
  getClientIp,
  getClientIpHeader,
};
