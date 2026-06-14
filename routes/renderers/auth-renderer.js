const { buildAlertHtml, renderTemplate } = require('./template-utils');

function renderLoginPage(res, { unauthorized = false, systemError = false } = {}) {
  const errorMessage = unauthorized
    ? buildAlertHtml('Login não autorizado. Confira o login e a senha e tente novamente.', 'error')
    : systemError
      ? buildAlertHtml('Não foi possível acessar o sistema agora. Tente novamente mais tarde.', 'error')
      : '';
  const loginHtml = renderTemplate('login.html', {
    LOGIN_ERROR: errorMessage,
  });

  res.status(unauthorized ? 401 : systemError ? 500 : 200).send(loginHtml);
}

module.exports = {
  renderLoginPage,
};
