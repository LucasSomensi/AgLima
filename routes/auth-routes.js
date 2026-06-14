const bcrypt = require('bcrypt');
const express = require('express');
const { clearSessionCookie, setSessionCookie } = require('./auth');
const { renderLoginPage } = require('./renderers/auth-renderer');
const { findUserByLogin } = require('./user-service');
const { getHomePathForRole } = require('./utils');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.sessionUser) {
    return res.redirect(getHomePathForRole(req.sessionUser.role));
  }

  return renderLoginPage(res);
});

router.post('/login', async (req, res) => {
  const { login, password } = req.body;

  try {
    const user = await findUserByLogin(login);
    const isAuthorized =
      user &&
      !user.disabled &&
      (await bcrypt.compare(String(password || ''), user.password_hash));

    if (!isAuthorized) {
      return renderLoginPage(res, { unauthorized: true });
    }

    setSessionCookie(res, user);
    return res.redirect(getHomePathForRole(user.role));
  } catch (error) {
    console.error('Error authenticating user:', error.message);
    return renderLoginPage(res, { systemError: true });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return res.redirect('/login');
});

module.exports = router;
