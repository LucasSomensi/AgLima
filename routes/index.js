const express = require('express');
const { attachSession } = require('./auth');
const { csrfProtection } = require('./csrf');
const adminRoutes = require('./admin-routes');
const authRoutes = require('./auth-routes');
const dryerRoutes = require('./dryer-routes');
const internalRoutes = require('./internal-routes');
const publicRoutes = require('./public-routes');
const { router: scaleApiRoutes } = require('./scale-api-routes');
const weighbridgeRoutes = require('./weighbridge-routes');
const { router: weighbridgeApiRoutes } = require('./weighbridge-api-routes');

const router = express.Router();

// Bearer APIs do not authenticate through browser cookies and are not subject
// to browser-form CSRF middleware, even if a client happens to send a cookie.
router.use(scaleApiRoutes);
router.use('/api/v1/balanca', weighbridgeApiRoutes);
router.use('/api', (req, res) => res.status(404).json({ code: 'NOT_FOUND', error: 'Endpoint não encontrado.' }));
router.use(attachSession);
router.use(csrfProtection);
router.use(publicRoutes);
router.use(authRoutes);
router.use(internalRoutes);
router.use(dryerRoutes);
router.use(weighbridgeRoutes);
router.use(adminRoutes);

module.exports = router;
