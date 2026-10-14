class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const invalid = (message) => new ApiError(400, 'INVALID_BODY', message);
const BIGINT_MAX = 9223372036854775807n;
function id(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d{0,18}$/.test(String(value))
      || (typeof value === 'number' && !Number.isSafeInteger(value)) || BigInt(value) > BIGINT_MAX) {
    throw new ApiError(400, 'INVALID_ID', 'ID deve ser um inteiro positivo; envie IDs grandes como texto.');
  }
  return String(value);
}

// API inputs are stricter than HTML forms. Existing builders still enforce the
// shared business rules; this boundary rejects coercion and accidental fields.
function body(req, allowed, required = []) {
  const value = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Envie um objeto JSON.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw invalid(`Campo não permitido: ${key}.`);
  for (const key of required) if (value[key] === undefined || value[key] === null || value[key] === '') throw invalid(`Campo obrigatório: ${key}.`);
  return { ...value };
}

function dateTime(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    throw invalid(`${field}: use YYYY-MM-DDTHH:mm[:ss], horário de Brasília, sem fuso.`);
  }
  const full = value.length === 16 ? `${value}:00` : value;
  const parsed = new Date(`${full}Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== full) throw invalid(`${field}: data inválida.`);
}

function fields(req, allowed, required) {
  const value = body(req, allowed, required);
  for (const [key, item] of Object.entries(value)) {
    if (item === null && !required?.includes(key) && ['peso_tara_kg', 'peso_bruto_kg', 'origem', 'umidade_percent', 'impureza_percent', 'graos_avariados_percent'].includes(key)) continue;
    if (['data_entrada', 'data_saida', 'peso_bruto_adicionado_em'].includes(key)) {
      dateTime(item, key);
    } else if (key === 'usar_tara_anterior') {
      if (typeof item !== 'boolean') throw invalid(`${key} deve ser booleano.`);
    } else if (key.endsWith('_kg') || key.endsWith('_percent')) {
      const percentage = key.endsWith('_percent');
      if (!['number', 'string'].includes(typeof item) || !/^\d{1,9}(?:\.\d{1,3})?$/.test(String(item))
          || !Number.isFinite(Number(item)) || Number(item) > (percentage ? 100 : 999999999.999)
          || Number(item) < 0 || (!percentage && Number(item) === 0)) {
        throw invalid(`${key}: decimal ${percentage ? 'entre 0 e 100' : 'positivo'}, com ponto e até 3 casas.`);
      }
      // The HTML builder normalizes using value || ''; strings preserve zero.
      value[key] = String(item);
    } else if (key.endsWith('_id')) {
      value[key] = id(item);
    } else if (typeof item !== 'string' || item.length > (key === 'motivo_delecao' ? 2000 : 200)) {
      throw invalid(`${key}: texto inválido ou muito longo.`);
    }
  }
  return value;
}

function payload(builder, value) {
  const result = builder(value);
  if (result.error) throw invalid(result.error);
  return result.payload;
}

function pagination(query) {
  const parse = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw new ApiError(400, 'INVALID_QUERY', 'Paginação inválida.');
    return Number(value);
  };
  const page = parse(query.pagina, 1, 1000000);
  const size = parse(query.limite, 50, 100);
  return { page, size, options: { limit: size + 1, offset: (page - 1) * size } };
}
function paged(rows, page) {
  return { items: rows.slice(0, page.size), pagina: page.page, limite: page.size, tem_proxima: rows.length > page.size };
}
module.exports = { ApiError, body, fields, id, payload, pagination, paged };
