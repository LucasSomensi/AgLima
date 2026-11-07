const DEVELOPMENT_SESSION_SECRET = 'unsafe-development-session-secret';
const DEVELOPMENT_CSRF_SECRET = 'unsafe-development-csrf-secret';
const MIN_RECOMMENDED_SECRET_LENGTH = 32;

// Valores de exemplo publicados na documentação nunca devem assinar sessões reais.
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'troque-por-uma-string-longa-e-aleatoria',
  DEVELOPMENT_SESSION_SECRET,
  DEVELOPMENT_CSRF_SECRET,
]);

let warnedAboutDevelopmentSecret = false;

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function getConfiguredSecret(name, env = process.env) {
  const value = env[name];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getSessionSecret(env = process.env) {
  const secret = getConfiguredSecret('SESSION_SECRET', env);

  if (secret) {
    return secret;
  }

  if (isProduction(env)) {
    // Sem segredo, qualquer pessoa com acesso ao código conseguiria assinar um
    // cookie de sessão válido (inclusive de root). Nunca usar fallback aqui.
    throw new Error('SESSION_SECRET é obrigatório em produção.');
  }

  warnAboutDevelopmentSecret();
  return DEVELOPMENT_SESSION_SECRET;
}

function getCsrfSecret(env = process.env) {
  const secret = getConfiguredSecret('CSRF_SECRET', env) || getConfiguredSecret('SESSION_SECRET', env);

  if (secret) {
    return secret;
  }

  if (isProduction(env)) {
    throw new Error('CSRF_SECRET ou SESSION_SECRET é obrigatório em produção.');
  }

  warnAboutDevelopmentSecret();
  return DEVELOPMENT_CSRF_SECRET;
}

function warnAboutDevelopmentSecret() {
  if (!warnedAboutDevelopmentSecret) {
    warnedAboutDevelopmentSecret = true;
    console.warn('SESSION_SECRET não configurado. Usando segredo inseguro de desenvolvimento.');
  }
}

// Executada na inicialização do servidor: em produção, recusa subir com
// segredos ausentes ou de exemplo, em vez de falhar só na primeira requisição.
function assertSecurityConfig(env = process.env) {
  if (!isProduction(env)) {
    return;
  }

  const sessionSecret = getConfiguredSecret('SESSION_SECRET', env);
  const csrfSecret = getConfiguredSecret('CSRF_SECRET', env);

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET é obrigatório em produção. Configure um valor longo e aleatório antes de iniciar o servidor.');
  }

  for (const [name, value] of [['SESSION_SECRET', sessionSecret], ['CSRF_SECRET', csrfSecret]]) {
    if (value && KNOWN_PLACEHOLDER_SECRETS.has(value.trim())) {
      throw new Error(`${name} está com um valor de exemplo. Gere um valor longo e aleatório.`);
    }

    if (value && value.length < MIN_RECOMMENDED_SECRET_LENGTH) {
      console.warn(`${name} tem menos de ${MIN_RECOMMENDED_SECRET_LENGTH} caracteres. Recomenda-se um valor mais longo.`);
    }
  }
}

module.exports = {
  assertSecurityConfig,
  getCsrfSecret,
  getSessionSecret,
};
