const CSV_SEPARATOR = ';';

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

function calculateHoursSinceBatchStart(reading) {
  const startedAt = new Date(reading.batch_started_at).getTime();
  const measuredAt = new Date(reading.measured_at).getTime();

  if (!Number.isFinite(startedAt) || !Number.isFinite(measuredAt)) {
    return null;
  }

  return (measuredAt - startedAt) / (60 * 60 * 1000);
}

function buildDryerMoistureReadingsCsv(readings) {
  return buildCsv([
    ['batelada', 'hora', 'umidade'],
    ...readings.map((reading) => [
      reading.batch_id,
      formatCsvDecimal(calculateHoursSinceBatchStart(reading)),
      formatCsvDecimal(reading.moisture_percent),
    ]),
  ]);
}

module.exports = {
  buildDryerMoistureReadingsCsv,
  calculateHoursSinceBatchStart,
  formatCsvDecimal,
};
