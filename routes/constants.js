const ROOT_LOGIN = 'root';
const ROLES = {
  ROOT: 'root',
  ADMIN: 'admin',
  CLIENT: 'client',
  WEIGHBRIDGE_OPERATOR: 'weighbridge_operator',
  SILO_OPERATOR: 'silo_operator',
};
const MANAGED_ROLES = [
  ROLES.ADMIN,
  ROLES.CLIENT,
  ROLES.WEIGHBRIDGE_OPERATOR,
  ROLES.SILO_OPERATOR,
];
const ROLE_LABELS = {
  [ROLES.ROOT]: 'Root',
  [ROLES.ADMIN]: 'Administrador',
  [ROLES.CLIENT]: 'Cliente',
  [ROLES.WEIGHBRIDGE_OPERATOR]: 'Operador de balança',
  [ROLES.SILO_OPERATOR]: 'Operador de silo',
};
const GRAIN_LABELS = {
  corn: 'Milho',
  soy: 'Soja',
};
const BCRYPT_SALT_ROUNDS = 12;
const SESSION_COOKIE_NAME = 'agrolima_session';
const HOUR_IN_MS = 1000 * 60 * 60;
const DEFAULT_SESSION_DURATION_HOURS = 8;
const SESSION_DURATION_ENV_OPTIONS = [
  { name: 'SESSION_DURATION_DAYS', multiplier: 24 * HOUR_IN_MS },
  { name: 'SESSION_DURATION_HOURS', multiplier: HOUR_IN_MS },
];

function parsePositiveNumber(value) {
  if (value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();

  if (normalizedValue === '') {
    return null;
  }

  const numericValue = Number(normalizedValue);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
}

function getSessionDurationMs() {
  for (const { name, multiplier } of SESSION_DURATION_ENV_OPTIONS) {
    const rawValue = process.env[name];
    const numericValue = parsePositiveNumber(rawValue);

    if (numericValue !== null) {
      return numericValue * multiplier;
    }

    if (rawValue !== undefined) {
      console.warn(
        `${name} must be a positive number. Ignoring this value for session duration.`
      );
    }
  }

  return DEFAULT_SESSION_DURATION_HOURS * HOUR_IN_MS;
}

const SESSION_DURATION_MS = getSessionDurationMs();
const APP_TIME_ZONE = 'America/Sao_Paulo';
const BRASILIA_TIME_OFFSET = '-03:00';
const MAILERSEND_API_URL = 'https://api.mailersend.com/v1/email';

module.exports = {
  APP_TIME_ZONE,
  BCRYPT_SALT_ROUNDS,
  BRASILIA_TIME_OFFSET,
  GRAIN_LABELS,
  MAILERSEND_API_URL,
  MANAGED_ROLES,
  ROLE_LABELS,
  ROLES,
  ROOT_LOGIN,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
};
