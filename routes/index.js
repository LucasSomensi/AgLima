const express = require('express');
const { attachSession } = require('./auth');
const adminRoutes = require('./admin-routes');
const authRoutes = require('./auth-routes');
const dryerRoutes = require('./dryer-routes');
const internalRoutes = require('./internal-routes');
const publicRoutes = require('./public-routes');
const weighbridgeRoutes = require('./weighbridge-routes');

const router = express.Router();

router.use(attachSession);
router.use(publicRoutes);
router.use(authRoutes);
router.use(internalRoutes);
router.use(dryerRoutes);
router.use(weighbridgeRoutes);
router.use(adminRoutes);

module.exports = router;
