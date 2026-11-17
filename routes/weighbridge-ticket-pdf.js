const { APP_TIME_ZONE } = require('./constants');

// Ticket em folha A4 retrato com duas vias idênticas (fazenda e motorista),
// separadas por uma linha de corte. Cada via traz os dados da pesagem à
// esquerda e, quando existem, as fotos da balança de cada peso à direita.
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const COPY_HEIGHT = A4_HEIGHT / 2;
const MARGIN_X = 32;
const MARGIN_Y = 26;
const CONTENT_WIDTH = A4_WIDTH - (MARGIN_X * 2);
const DATA_COLUMN_WIDTH = 252;
const COLUMN_GAP = 18;
const PHOTO_COLUMN_X = MARGIN_X + DATA_COLUMN_WIDTH + COLUMN_GAP;
const PHOTO_COLUMN_WIDTH = A4_WIDTH - MARGIN_X - PHOTO_COLUMN_X;
const SIGNATURE_AREA_HEIGHT = 40;
const FARM_NAME = 'Fazenda São José';
const COPY_LABELS = ['Via da fazenda', 'Via do motorista'];
const COLORS = {
  text: '#111111',
  muted: '#555555',
  rule: '#b5b5b5',
  highlight: '#ececec',
};

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
    year: 'numeric',
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

  return `${Math.round(Number(value)).toLocaleString('pt-BR')} kg`;
}

function formatTicketPercent(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%`;
}

function textOrDash(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || '-';
}

// --- Conteúdo de cada tipo de ticket -------------------------------------------------
// Cada função devolve o modelo do ticket: campos descritivos, pesos (com o
// tipo de foto correspondente), peso líquido, dados extras e assinaturas.

function buildScaleOutputTicket(outputInfo) {
  return {
    title: 'Ticket de saída',
    number: textOrDash(outputInfo.saida_id),
    fields: [
      ['Operador', textOrDash(outputInfo.operador_login)],
      ['Placa', textOrDash(outputInfo.placa_caminhao)],
      // O motorista é opcional: a linha só aparece quando o nome foi informado.
      ...(outputInfo.nome_motorista ? [['Motorista', outputInfo.nome_motorista]] : []),
      ['Produto', formatProductLabel(outputInfo.produto)],
      ['Vendedor', textOrDash(outputInfo.vendedor_nome_completo)],
      ['Comprador', textOrDash(outputInfo.comprador_nome_completo)],
    ],
    weights: [
      { label: 'Tara', photoType: 'tara', kg: outputInfo.peso_tara_kg, at: outputInfo.data_saida },
      { label: 'Bruto', photoType: 'bruto', kg: outputInfo.peso_bruto_kg, at: outputInfo.peso_bruto_adicionado_em },
    ],
    netKg: outputInfo.peso_liquido_kg,
    extras: [],
    signatures: ['Vendedor', 'Comprador'],
  };
}

// Mesmo layout do ticket de saída, trocando tara/bruto por pesagem 1 e 2. Os
// campos descritivos são livres e opcionais: em branco aparecem como "-",
// exceto o motorista, que (como na saída) só aparece quando informado.
function buildStandaloneWeighingTicket(weighing) {
  return {
    title: 'Pesagem avulsa',
    number: textOrDash(weighing.id),
    fields: [
      ['Operador', textOrDash(weighing.operador_login)],
      ['Placa', textOrDash(weighing.placa_caminhao)],
      ...(weighing.nome_motorista ? [['Motorista', weighing.nome_motorista]] : []),
      ['Produto', textOrDash(weighing.produto)],
      ['Vendedor', textOrDash(weighing.vendedor)],
      ['Comprador', textOrDash(weighing.comprador)],
    ],
    weights: [
      { label: 'Pesagem 1', photoType: 'pesagem_1', kg: weighing.pesagem_1_kg, at: weighing.pesagem_1_em },
      { label: 'Pesagem 2', photoType: 'pesagem_2', kg: weighing.pesagem_2_kg, at: weighing.pesagem_2_em },
    ],
    netKg: weighing.peso_liquido_kg,
    extras: [],
    signatures: ['Vendedor', 'Comprador'],
  };
}

function buildScaleInputTicket(inputInfo) {
  const reusedTare = Boolean(inputInfo.tara_usada_de_entrada_id);

  return {
    title: 'Ticket de entrada',
    number: textOrDash(inputInfo.entrada_id),
    fields: [
      ['Operador', textOrDash(inputInfo.operador_login)],
      ['Placa', textOrDash(inputInfo.placa_caminhao)],
      ['Produto', formatProductLabel(inputInfo.produto)],
      ['Origem', textOrDash(inputInfo.origem)],
    ],
    weights: [
      { label: 'Bruto', photoType: 'bruto', kg: inputInfo.peso_bruto_kg, at: inputInfo.data_entrada },
      {
        label: reusedTare ? 'Tara anterior' : 'Tara',
        photoType: 'tara',
        kg: inputInfo.peso_tara_kg,
        at: reusedTare ? inputInfo.tara_origem_data : inputInfo.tara_adicionada_em,
      },
    ],
    netKg: inputInfo.peso_liquido_kg,
    extras: [
      ['Umidade', formatTicketPercent(inputInfo.umidade_percent)],
      ['Impureza', formatTicketPercent(inputInfo.impureza_percent)],
      ['Avariados', formatTicketPercent(inputInfo.graos_avariados_percent)],
    ],
    signatures: ['Motorista', 'Operador'],
  };
}

// --- Desenho ---------------------------------------------------------------------------

// Escreve até maxLines linhas, cortando com reticências o que não couber.
function drawText(document, text, x, y, {
  width, font = 'Helvetica', size = 10, color = COLORS.text, align = 'left', maxLines = 1,
} = {}) {
  document.font(font).fontSize(size).fillColor(color);
  document.text(String(text), x, y, {
    width,
    height: size * 1.25 * maxLines,
    align,
    ellipsis: true,
    lineBreak: true,
  });
}

// Altura ocupada por um valor que pode quebrar em até maxLines linhas.
function measureText(document, text, { width, font = 'Helvetica', size = 10, maxLines = 1 }) {
  document.font(font).fontSize(size);
  const height = document.heightOfString(String(text), { width });
  return Math.min(height, size * 1.25 * maxLines);
}

function drawRule(document, x1, y, x2, color = COLORS.rule) {
  document.save().moveTo(x1, y).lineTo(x2, y).lineWidth(0.6).strokeColor(color).stroke().restore();
}

function drawHeader(document, ticket, top, copyLabel, issuedAt) {
  const y = top + MARGIN_Y;
  const halfWidth = CONTENT_WIDTH / 2;

  drawText(document, FARM_NAME, MARGIN_X, y, { width: halfWidth, font: 'Helvetica-Bold', size: 15 });
  drawText(document, `${ticket.title} nº ${ticket.number}`, MARGIN_X + halfWidth, y + 2, {
    width: halfWidth, font: 'Helvetica-Bold', size: 12, align: 'right',
  });
  drawText(document, `Emitido em ${formatTicketDateTime(issuedAt)}`, MARGIN_X, y + 20, {
    width: halfWidth, size: 8, color: COLORS.muted,
  });
  drawText(document, copyLabel.toUpperCase(), MARGIN_X + halfWidth, y + 20, {
    width: halfWidth, font: 'Helvetica-Bold', size: 8, color: COLORS.muted, align: 'right',
  });
  drawRule(document, MARGIN_X, y + 34, A4_WIDTH - MARGIN_X, COLORS.text);

  return y + 44;
}

function drawLabeledRows(document, rows, x, y, width) {
  const labelWidth = 66;
  let rowY = y;

  // Nomes longos (comprador, vendedor, motorista) quebram em até três linhas.
  for (const [label, value] of rows) {
    const valueOptions = { width: width - labelWidth, size: 10, maxLines: 3 };
    drawText(document, label, x, rowY + 1, { width: labelWidth, size: 8.5, color: COLORS.muted });
    drawText(document, value, x + labelWidth, rowY, valueOptions);
    rowY += Math.max(15, measureText(document, value, valueOptions) + 3);
  }

  return rowY;
}

function drawWeights(document, ticket, x, y, width) {
  const labelWidth = 78;
  const weightWidth = 78;
  const dateX = x + labelWidth + weightWidth + 12;
  const dateWidth = width - (dateX - x);
  let rowY = y;

  drawRule(document, x, rowY - 4, x + width);

  for (const weight of ticket.weights) {
    drawText(document, weight.label, x, rowY, { width: labelWidth, font: 'Helvetica-Bold', size: 10 });
    drawText(document, formatTicketWeight(weight.kg), x + labelWidth, rowY, {
      width: weightWidth, font: 'Helvetica-Bold', size: 10.5, align: 'right',
    });
    drawText(document, formatTicketDateTime(weight.at), dateX, rowY + 1, { width: dateWidth, size: 9, color: COLORS.muted });
    rowY += 17;
  }

  document.save().rect(x, rowY - 2, width, 22).fillColor(COLORS.highlight).fill().restore();
  drawText(document, 'Peso líquido', x + 4, rowY + 3, { width: labelWidth, font: 'Helvetica-Bold', size: 10.5 });
  drawText(document, formatTicketWeight(ticket.netKg), x + labelWidth, rowY + 2, {
    width: weightWidth, font: 'Helvetica-Bold', size: 12.5, align: 'right',
  });

  return rowY + 30;
}

function drawPhotos(document, photos, y, bottom) {
  const captionHeight = 13;
  const gap = 8;
  const slotHeight = ((bottom - y) - (gap * (photos.length - 1))) / photos.length;
  let slotY = y;

  for (const photo of photos) {
    // A moldura acompanha a proporção da foto, centralizada no espaço da via.
    const scale = Math.min(
      PHOTO_COLUMN_WIDTH / photo.image.width,
      (slotHeight - captionHeight) / photo.image.height
    );
    const imageWidth = photo.image.width * scale;
    const imageHeight = photo.image.height * scale;
    const imageX = PHOTO_COLUMN_X + ((PHOTO_COLUMN_WIDTH - imageWidth) / 2);

    document.image(photo.image, imageX, slotY, { width: imageWidth, height: imageHeight });
    document.save()
      .rect(imageX, slotY, imageWidth, imageHeight)
      .lineWidth(0.6)
      .strokeColor(COLORS.rule)
      .stroke()
      .restore();

    const caption = [
      photo.label,
      formatTicketWeight(photo.peso_kg),
      formatTicketDateTime(photo.capturada_em),
      photo.contingencia ? 'câmera indisponível' : null,
    ].filter(Boolean).join(' · ');
    drawText(document, caption, PHOTO_COLUMN_X, slotY + imageHeight + 3, {
      width: PHOTO_COLUMN_WIDTH, size: 8, color: COLORS.muted, align: 'center',
    });
    slotY += slotHeight + gap;
  }
}

function drawSignatures(document, signatures, top) {
  const lineY = top + COPY_HEIGHT - MARGIN_Y - 14;
  const gap = 40;
  const width = (CONTENT_WIDTH - (gap * (signatures.length - 1))) / signatures.length;

  signatures.forEach((label, index) => {
    const x = MARGIN_X + (index * (width + gap));
    drawRule(document, x, lineY, x + width, COLORS.text);
    drawText(document, `Assinatura do ${label.toLowerCase()}`, x, lineY + 4, {
      width, size: 8.5, color: COLORS.muted, align: 'center',
    });
  });

  return lineY - SIGNATURE_AREA_HEIGHT + 14;
}

function drawCutLine(document) {
  const y = COPY_HEIGHT;

  document.save()
    .moveTo(MARGIN_X / 2, y)
    .lineTo(A4_WIDTH - (MARGIN_X / 2), y)
    .lineWidth(0.6)
    .dash(5, { space: 4 })
    .strokeColor(COLORS.muted)
    .stroke()
    .undash()
    .restore();
  const label = 'corte aqui';
  document.font('Helvetica').fontSize(7);
  const labelWidth = document.widthOfString(label) + 10;
  document.save().rect((A4_WIDTH - labelWidth) / 2, y - 5, labelWidth, 10).fillColor('#ffffff').fill().restore();
  drawText(document, label, (A4_WIDTH - labelWidth) / 2, y - 3.5, { width: labelWidth, size: 7, color: COLORS.muted, align: 'center' });
}

function drawCopy(document, ticket, photos, top, copyLabel, issuedAt) {
  const bodyY = drawHeader(document, ticket, top, copyLabel, issuedAt);
  const bodyBottom = drawSignatures(document, ticket.signatures, top);
  const dataWidth = photos.length ? DATA_COLUMN_WIDTH : CONTENT_WIDTH;

  let y = drawLabeledRows(document, ticket.fields, MARGIN_X, bodyY, dataWidth);
  y = drawWeights(document, ticket, MARGIN_X, y + 12, dataWidth);

  if (ticket.extras.length) {
    drawLabeledRows(document, ticket.extras, MARGIN_X, y, dataWidth);
  }

  if (photos.length) {
    drawPhotos(document, photos, bodyY, bodyBottom);
  }
}

// Associa as fotos vinculadas aos pesos do ticket, na mesma ordem dos pesos.
// Fotos de tipos que o ticket não mostra e arquivos que não abrem como imagem
// ficam de fora, sem impedir a geração do PDF.
function preparePhotos(document, ticket, photos = []) {
  const prepared = [];

  for (const weight of ticket.weights) {
    const photo = photos.find((item) => item.tipo_peso === weight.photoType && item.buffer);

    if (!photo) continue;

    try {
      prepared.push({ ...photo, label: weight.label, image: document.openImage(photo.buffer) });
    } catch (error) {
      console.error('Ticket photo could not be embedded:', error.message);
    }
  }

  return prepared;
}

function renderTicketPdf(ticket, { photos = [], issuedAt = new Date() } = {}) {
  const PDFDocument = require('pdfkit');
  const document = new PDFDocument({
    size: 'A4',
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    info: { Title: `${ticket.title} ${ticket.number}`, Author: FARM_NAME },
    autoFirstPage: true,
  });
  const chunks = [];

  document.on('data', (chunk) => chunks.push(chunk));

  return new Promise((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    try {
      // A mesma imagem aberta uma vez é reutilizada nas duas vias, então o
      // arquivo não carrega cada foto em dobro.
      const preparedPhotos = preparePhotos(document, ticket, photos);

      COPY_LABELS.forEach((copyLabel, index) => {
        drawCopy(document, ticket, preparedPhotos, index * COPY_HEIGHT, copyLabel, issuedAt);
      });
      drawCutLine(document);
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}

function buildScaleOutputTicketPdf(outputInfo, options) {
  return renderTicketPdf(buildScaleOutputTicket(outputInfo), options);
}

function buildScaleInputTicketPdf(inputInfo, options) {
  return renderTicketPdf(buildScaleInputTicket(inputInfo), options);
}

function buildStandaloneWeighingTicketPdf(weighing, options) {
  return renderTicketPdf(buildStandaloneWeighingTicket(weighing), options);
}

module.exports = {
  buildScaleInputTicket,
  buildScaleInputTicketPdf,
  buildScaleOutputTicket,
  buildScaleOutputTicketPdf,
  buildStandaloneWeighingTicket,
  buildStandaloneWeighingTicketPdf,
  formatTicketDateTime,
  formatTicketWeight,
};
