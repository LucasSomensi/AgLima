const bcrypt = require('bcrypt');
const express = require('express');
const { clearSessionCookie, setSessionCookie } = require('./auth');
const { renderLoginPage } = require('./renderers/auth-renderer');
const userService = require('./user-service');
const { getHomePathForRole } = require('./utils');
const { loginRateLimiter } = require('./rate-limit');
const authLoginService = require('./auth-login-service');

const { LOGIN_EVENT_RESULTS } = authLoginService;

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.sessionUser) {
    return res.redirect(getHomePathForRole(req.sessionUser.role));
  }

  return renderLoginPage(res);
});

router.post('/login', loginRateLimiter, async (req, res) => {
  const { login, password } = req.body;
  const loginProvided = String(login || '').trim() || '(login vazio)';
  const ipAddress = String(req.ip || '').trim() || null;
  const userAgent = String(req.get('user-agent') || '').trim() || null;
  let user = null;

  try {
    user = await userService.findUserByLogin(login);

    if (!user) {
      await authLoginService.recordLoginEvent({
        login: loginProvided,
        result: LOGIN_EVENT_RESULTS.UNKNOWN_USER,
        ipAddress,
        userAgent,
      });
      return renderLoginPage(res, { unauthorized: true });
    }

    if (user.disabled) {
      await authLoginService.recordLoginEvent({
        login: loginProvided,
        userId: user.id,
        result: LOGIN_EVENT_RESULTS.DISABLED_USER,
        ipAddress,
        userAgent,
      });
      return renderLoginPage(res, { unauthorized: true });
    }

    const passwordMatches = await bcrypt.compare(String(password || ''), user.password_hash);

    if (!passwordMatches) {
      await authLoginService.recordLoginEvent({
        login: loginProvided,
        userId: user.id,
        result: LOGIN_EVENT_RESULTS.INVALID_PASSWORD,
        ipAddress,
        userAgent,
      });
      return renderLoginPage(res, { unauthorized: true });
    }

    await authLoginService.recordLoginEvent({
      login: loginProvided,
      userId: user.id,
      result: LOGIN_EVENT_RESULTS.SUCCESS,
      ipAddress,
      userAgent,
    });
    setSessionCookie(res, user);
    return res.redirect(getHomePathForRole(user.role));
  } catch (error) {
    console.error('Error authenticating user:', error.message);

    try {
      await authLoginService.recordLoginEvent({
        login: loginProvided,
        userId: user?.id || null,
        result: LOGIN_EVENT_RESULTS.SYSTEM_ERROR,
        ipAddress,
        userAgent,
      });
    } catch (loggingError) {
      console.error('Error recording failed authentication event:', loggingError.message);
    }

    return renderLoginPage(res, { systemError: true });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return res.redirect('/login');
});

module.exports = router;
