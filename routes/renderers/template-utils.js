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

module.exports = {
  buildAlertHtml,
  readTemplate,
  renderEmptyRow,
  renderTemplate,
  replacePlaceholders,
};
