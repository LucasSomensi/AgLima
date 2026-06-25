const { APP_TIME_ZONE } = require('./constants');
const { formatPlainDecimal } = require('./utils');

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

  return `${formatPlainDecimal(value)} kg`;
}

function buildTicketLines(outputInfo) {
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

function buildScaleOutputTicketPdf(outputInfo) {
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

    buildTicketLines(outputInfo).forEach((line, index) => {
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

module.exports = {
  buildScaleOutputTicketPdf,
  buildTicketLines,
};
