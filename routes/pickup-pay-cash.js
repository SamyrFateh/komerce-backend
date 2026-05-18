'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { confirmPickupCashPayment } = require('../services/confirm-pickup-cash-payment');
const { generateAndStoreSecret } = require('./pickup-secret');

function requireRelaisOrAdmin(req, res, next) {
  const role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'agent_relais') {
    return res.status(403).json({ error: 'Accès réservé agents relais et admin' });
  }
  return next();
}

router.post('/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const result = await confirmPickupCashPayment({
      orderId: req.params.orderId,
      user: req.user,
      payload: req.body,
      generateAndStoreSecret,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
