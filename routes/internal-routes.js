const express = require('express');
const { requireAuth } = require('./auth');
const { ROLES } = require('./constants');
const { renderConstructionPage } = require('./renderers');
const { getHomePathForRole } = require('./utils');

const router = express.Router();

router.get('/area-interna', requireAuth, (req, res) => {
  if ([ROLES.ROOT, ROLES.ADMIN, ROLES.SILO_OPERATOR, ROLES.WEIGHBRIDGE_OPERATOR].includes(req.sessionUser.role)) {
    return res.redirect(getHomePathForRole(req.sessionUser.role));
  }

  return renderConstructionPage(res, req.sessionUser.role);
});

module.exports = router;
