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
  const rows = [['batelada', 'hora', 'umidade_media']];
  const batchesWithInitialMoisture = new Set();

  for (const reading of readings) {
    if (!batchesWithInitialMoisture.has(reading.batch_id)) {
      rows.push([
        reading.batch_id,
        formatCsvDecimal(0),
        formatCsvDecimal(reading.batch_initial_moisture),
      ]);
      batchesWithInitialMoisture.add(reading.batch_id);
    }

    if (reading.measured_at) {
      rows.push([
        reading.batch_id,
        formatCsvDecimal(calculateHoursSinceBatchStart(reading)),
        formatCsvDecimal(reading.average_moisture),
      ]);
    }
  }

  return buildCsv(rows);
}

module.exports = {
  buildDryerMoistureReadingsCsv,
  calculateHoursSinceBatchStart,
  formatCsvDecimal,
};
