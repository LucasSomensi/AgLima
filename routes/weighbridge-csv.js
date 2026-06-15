function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildCsv(rows) {
  return `\uFEFF${rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n')}`;
}

function buildScaleInputsCsv(inputs) {
  return buildCsv([
    [
      'Data/hora',
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
    ...inputs.map((input) => [
      input.data_entrada,
      input.placa_caminhao,
      input.produto,
      input.peso_bruto_kg,
      input.peso_tara_kg,
      input.peso_liquido_kg,
      input.origem,
      input.umidade_percent,
      input.impureza_percent,
      input.graos_avariados_percent,
    ]),
  ]);
}

function buildScaleOutputsCsv(outputs) {
  return buildCsv([
    [
      'Data/hora',
      'Placa',
      'Produto',
      'Bruto kg',
      'Tara kg',
      'Liquido kg',
      'Contrato',
      'Comprador',
    ],
    ...outputs.map((output) => [
      output.data_saida,
      output.placa_caminhao,
      output.produto,
      output.peso_bruto_kg,
      output.peso_tara_kg,
      output.peso_liquido_kg,
      output.contrato_id ? `Contrato #${output.contrato_id}` : 'Pendente',
      output.comprador_nome,
    ]),
  ]);
}

module.exports = {
  buildScaleInputsCsv,
  buildScaleOutputsCsv,
  escapeCsvValue,
};
