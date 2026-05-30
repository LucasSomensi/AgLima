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
const SESSION_DURATION_MS = 1000 * 60 * 60 * 8;
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
