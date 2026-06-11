const { APP_TIME_ZONE, BRASILIA_TIME_OFFSET, ROLE_LABELS, ROLES } = require('./constants');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRoleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function getHomePathForRole(role) {
  if (role === ROLES.ROOT) {
    return '/admin/usuarios';
  }

  if (role === ROLES.ADMIN) {
    return '/admin';
  }

  if (role === ROLES.SILO_OPERATOR) {
    return '/secador';
  }

  if (role === ROLES.WEIGHBRIDGE_OPERATOR) {
    return '/balanca';
  }

  return '/area-interna';
}

function parseOptionalDateTime(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return new Date();
  }

  const normalizedDateTime = rawValue.length === 16 ? `${rawValue}:00` : rawValue;
  const parsedDate = new Date(`${normalizedDateTime}${BRASILIA_TIME_OFFSET}`);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function getBrasiliaDateTimeParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce((parts, part) => {
      if (part.type !== 'literal') {
        parts[part.type] = part.value;
      }

      return parts;
    }, {});
}

function toDateTimeLocalValue(value = new Date()) {
  const parts = getBrasiliaDateTimeParts(value);

  if (!parts) {
    return '';
  }

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getDateOnlyParts(value) {
  if (typeof value === 'string') {
    const dateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (dateMatch) {
      return { year: dateMatch[1], month: dateMatch[2], day: dateMatch[3] };
    }
  }

  return null;
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const dateOnlyValue = toDateOnlyInputValue(value);

  if (!dateOnlyValue) {
    return '-';
  }

  const [year, month, day] = dateOnlyValue.split('-');

  return `${day}/${month}/${year}`;
}

function toDateOnlyInputValue(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const dateOnlyParts = getDateOnlyParts(value);

  if (dateOnlyParts) {
    return `${dateOnlyParts.year}-${dateOnlyParts.month}-${dateOnlyParts.day}`;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function toDateInputValue(value) {
  return toDateOnlyInputValue(value);
}

function formatTime(value) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatMoisture(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatDigitsOnly(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const digits = String(value).replace(/\D/g, '');

  return digits || '-';
}

function formatPlainDecimal(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const rawValue = String(value).trim();

  if (!rawValue) {
    return '-';
  }

  const normalizedValue = rawValue.replace(',', '.');

  if (!/^-?\d+(?:\.\d+)?$/.test(normalizedValue)) {
    return rawValue.replace('.', ',');
  }

  const [integerPart, decimalPart = ''] = normalizedValue.split('.');
  const trimmedDecimalPart = decimalPart.replace(/0+$/, '');

  return trimmedDecimalPart ? `${integerPart},${trimmedDecimalPart}` : integerPart;
}

function parseMoisturePercent(rawValue) {
  const normalizedValue = String(rawValue || '').trim().replace(',', '.');

  if (!/^\d{1,2}(?:\.\d)?$|^40(?:\.0)?$/.test(normalizedValue)) {
    return null;
  }

  const value = Number(normalizedValue);

  if (!Number.isFinite(value) || value < 7 || value > 40) {
    return null;
  }

  return Number(value.toFixed(1));
}

function buildRedirect(path, params) {
  const searchParams = new URLSearchParams(params);

  return `${path}?${searchParams.toString()}`;
}

module.exports = {
  buildRedirect,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatDigitsOnly,
  formatMoisture,
  formatPlainDecimal,
  formatTime,
  getHomePathForRole,
  getRoleLabel,
  parseMoisturePercent,
  parseOptionalDateTime,
  toDateInputValue,
  toDateOnlyInputValue,
  toDateTimeLocalValue,
};
