const CSV_SEPARATOR = ';';
const BRASILIA_TIME_ZONE = 'America/Sao_Paulo';

const brasiliaDateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BRASILIA_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);

  if (/[";\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildCsv(rows) {
  return `\uFEFF${rows.map((row) => row.map(escapeCsvValue).join(CSV_SEPARATOR)).join('\r\n')}`;
}

function formatBrasiliaDateTime(value) {
  if (!value) {
    return { date: '', time: '' };
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return { date: '', time: '' };
  }

  const parts = Object.fromEntries(
    brasiliaDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.day}/${parts.month}/${parts.year}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function formatCsvDecimal(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    return String(value);
  }

  return numberValue.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatCsvWeightKg(value) {
  return formatCsvDecimal(value);
}

function buildScaleInputsCsv(inputs) {
  return buildCsv([
    [
      'Data',
      'Hora',
      'Placa',
      'Produto',
      'Bruto kg',
      'Tara kg',
      'Liquido kg',
      'Origem',
      'Umidade %',
      'Impureza %',
      'Graos avariados %',
    ],
    ...inputs.map((input) => {
      const { date, time } = formatBrasiliaDateTime(input.data_entrada);

      return [
        date,
        time,
        input.placa_caminhao,
        input.produto,
        formatCsvWeightKg(input.peso_bruto_kg),
        formatCsvWeightKg(input.peso_tara_kg),
        formatCsvWeightKg(input.peso_liquido_kg),
        input.origem,
        formatCsvDecimal(input.umidade_percent),
        formatCsvDecimal(input.impureza_percent),
        formatCsvDecimal(input.graos_avariados_percent),
      ];
    }),
  ]);
}

function buildScaleOutputsCsv(outputs) {
  return buildCsv([
    [
      'Data',
      'Hora',
      'Placa',
      'Produto',
      'Bruto kg',
      'Tara kg',
      'Liquido kg',
      'Contrato',
      'Comprador',
    ],
    ...outputs.map((output) => {
      const { date, time } = formatBrasiliaDateTime(output.data_saida);

      return [
        date,
        time,
        output.placa_caminhao,
        output.produto,
        formatCsvWeightKg(output.peso_bruto_kg),
        formatCsvWeightKg(output.peso_tara_kg),
        formatCsvWeightKg(output.peso_liquido_kg),
        output.contrato_id ? `Contrato #${output.contrato_id}` : 'Pendente',
        output.comprador_nome,
      ];
    }),
  ]);
}

module.exports = {
  buildScaleInputsCsv,
  buildScaleOutputsCsv,
  escapeCsvValue,
  formatBrasiliaDateTime,
  formatCsvDecimal,
  formatCsvWeightKg,
};
