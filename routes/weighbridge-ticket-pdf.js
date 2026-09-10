const { APP_TIME_ZONE } = require('./constants');

const THERMAL_80MM_WIDTH_POINTS = 226.77;
const TICKET_HEIGHT_POINTS = 430;
const TICKET_MARGIN_POINTS = 12;

function formatProductLabel(value) {
  const labels = {
    milho: 'Milho',
    soja: 'Soja',
  };

  return labels[value] || value || '-';
}

function formatTicketDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APP_TIME_ZONE,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace(',', '');
}

function formatTicketWeight(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${Math.round(Number(value))} kg`;
}

function formatTicketPercent(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%`;
}

function buildScaleOutputTicketLines(outputInfo) {
  return [
    '------------------------------',
    'Fazenda São José',
    ' ',
    `Ticket: ${outputInfo.saida_id || '-'}`,
    `Operador: ${outputInfo.operador_login || '-'}`,
    `Placa: ${outputInfo.placa_caminhao || '-'}`,
    `Produto: ${formatProductLabel(outputInfo.produto)}`,
    `Vendedor: ${outputInfo.vendedor_nome_completo || '-'}`,
    `Comprador: ${outputInfo.comprador_nome_completo || '-'}`,
    ' ',
    ' ',
    ' ',
    `Tara: ${formatTicketWeight(outputInfo.peso_tara_kg)} ${formatTicketDateTime(outputInfo.data_saida)}`,
    `Bruto: ${formatTicketWeight(outputInfo.peso_bruto_kg)} ${formatTicketDateTime(outputInfo.peso_bruto_adicionado_em)}`,
    `PLiq: ${formatTicketWeight(outputInfo.peso_liquido_kg)}`,
    ' ',
    ' ',
    ' ',
    'Ass Vendedor: ____________________',
    ' ',
    ' ',
    'Ass Comprador: ____________________',
    '---------------------------------',
  ];
}

function buildScaleInputTicketLines(inputInfo) {
  const tareLabel = inputInfo.tara_usada_de_entrada_id ? 'Tara anterior' : 'Tara';
  const tareDate = inputInfo.tara_usada_de_entrada_id
    ? inputInfo.tara_origem_data
    : inputInfo.tara_adicionada_em;

  return [
    '------------------------------',
    'Fazenda São José',
    ' ',
    `Entrada: ${inputInfo.entrada_id || '-'}`,
    `Operador: ${inputInfo.operador_login || '-'}`,
    `Placa: ${inputInfo.placa_caminhao || '-'}`,
    `Produto: ${formatProductLabel(inputInfo.produto)}`,
    `Origem: ${inputInfo.origem || '-'}`,
    ' ',
    `Bruto: ${formatTicketWeight(inputInfo.peso_bruto_kg)} ${formatTicketDateTime(inputInfo.data_entrada)}`,
    `${tareLabel}: ${formatTicketWeight(inputInfo.peso_tara_kg)} ${formatTicketDateTime(tareDate)}`,
    `PLiq: ${formatTicketWeight(inputInfo.peso_liquido_kg)}`,
    ' ',
    `Umid: ${formatTicketPercent(inputInfo.umidade_percent)}`,
    `Impur: ${formatTicketPercent(inputInfo.impureza_percent)}`,
    `Avar: ${formatTicketPercent(inputInfo.graos_avariados_percent)}`,
    ' ',
    'Ass Motorista: __________________',
    ' ',
    ' ',
    'Ass Operador: ___________________',
    '---------------------------------',
  ];
}

function buildThermalTicketPdf(lines) {
  const PDFDocument = require('pdfkit');
  const document = new PDFDocument({
    size: [THERMAL_80MM_WIDTH_POINTS, TICKET_HEIGHT_POINTS],
    margins: {
      top: TICKET_MARGIN_POINTS,
      right: TICKET_MARGIN_POINTS,
      bottom: TICKET_MARGIN_POINTS,
      left: TICKET_MARGIN_POINTS,
    },
    bufferPages: false,
    autoFirstPage: true,
  });
  const chunks = [];

  document.on('data', (chunk) => chunks.push(chunk));

  return new Promise((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.font('Courier').fontSize(9);

    lines.forEach((line, index) => {
      const options = index === 1
        ? { align: 'center' }
        : { align: 'left' };

      if (index === 1) {
        document.font('Courier-Bold');
      } else {
        document.font('Courier');
      }

      document.text(line, options);
      document.moveDown(0.15);
    });

    document.end();
  });
}

function buildScaleOutputTicketPdf(outputInfo) {
  return buildThermalTicketPdf(buildScaleOutputTicketLines(outputInfo));
}

function buildScaleInputTicketPdf(inputInfo) {
  return buildThermalTicketPdf(buildScaleInputTicketLines(inputInfo));
}

module.exports = {
  buildScaleInputTicketLines,
  buildScaleInputTicketPdf,
  buildScaleOutputTicketPdf,
  buildScaleOutputTicketLines,
  buildTicketLines: buildScaleOutputTicketLines,
};
