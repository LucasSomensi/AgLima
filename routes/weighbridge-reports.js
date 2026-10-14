const { toDateOnlyInputValue, toDateTimeLocalValue } = require('./utils');

function canCopyInputReport(input) {
  return Boolean(input.origem) && input.peso_tara_kg != null
    && ['umidade_percent', 'impureza_percent', 'graos_avariados_percent'].every((field) => input[field] != null);
}

function buildInputClipboardReport(input) {
  const local = toDateTimeLocalValue(input.data_entrada);
  let date = '-';
  if (local) {
    const [dayPart, time] = local.split('T');
    const [year, month, day] = dayPart.split('-');
    date = `${day}/${month}/${year} ${time}`;
  }
  const weight = input.peso_liquido_kg == null ? '-' : String(Math.round(Number(input.peso_liquido_kg)));
  const moisture = input.umidade_percent == null ? '-' : Number(input.umidade_percent).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return [date, input.placa_caminhao || '-', input.origem || '-', `${weight}kg`, `Umidade: ${moisture}%`].join('\n');
}

function buildScaleOutputInvoiceName(info) {
  return `${toDateOnlyInputValue(info.data_saida) || '-'} ${info.placa_caminhao || '-'} ${(info.produto || '-').toUpperCase()} ${info.saida_id || '-'}`;
}
module.exports = { canCopyInputReport, buildInputClipboardReport, buildScaleOutputInvoiceName };
