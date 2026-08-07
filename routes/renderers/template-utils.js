const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../utils');

function buildAlertHtml(message, type = 'success') {
  if (!message) {
    return '';
  }

  const cssClass = type === 'error' ? 'login-error' : 'admin-success';
  return `<p class="${cssClass}" role="alert">${escapeHtml(message)}</p>`;
}

function escapeHtmlWithLineBreaks(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function readTemplate(templateName) {
  return fs.readFileSync(path.join(__dirname, '../../views', templateName), 'utf8');
}

function replacePlaceholders(templateHtml, placeholders = {}) {
  return Object.entries(placeholders).reduce((html, [placeholder, value]) => {
    const safeValue = value === null || value === undefined ? '' : String(value);
    return html.replace(new RegExp(`{{${placeholder}}}`, 'g'), safeValue);
  }, templateHtml);
}

function renderTemplate(templateName, placeholders = {}) {
  return replacePlaceholders(readTemplate(templateName), placeholders);
}

function renderEmptyRow(colSpan, message) {
  return `<tr><td colspan="${escapeHtml(colSpan)}">${escapeHtml(message)}</td></tr>`;
}

function buildPaginationHtml({ page, totalPages, basePath, ariaLabel }) {
  const pageLinks = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    const currentAttribute = pageNumber === page ? ' aria-current="page"' : '';
    return `<a class="pagination-page${pageNumber === page ? ' is-active' : ''}" href="${escapeHtml(basePath)}?pagina=${pageNumber}"${currentAttribute}>${pageNumber}</a>`;
  }).join('');

  return `<nav class="table-pagination" aria-label="${escapeHtml(ariaLabel)}">
    <span class="table-pagination-summary">Página ${escapeHtml(page)} de ${escapeHtml(totalPages)}</span>
    <div class="table-pagination-pages">${pageLinks}</div>
  </nav>`;
}

module.exports = {
  buildAlertHtml,
  buildPaginationHtml,
  escapeHtmlWithLineBreaks,
  readTemplate,
  renderEmptyRow,
  renderTemplate,
  replacePlaceholders,
};
