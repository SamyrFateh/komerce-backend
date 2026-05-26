'use strict';

/**
 * KOMERCE — Shared cart cash contribution routes
 *
 * Public:
 *   POST /api/shared-carts/public/:token/contributions/cash
 *
 * Agent/Admin:
 *   POST /api/shared-carts/contributions/:id/confirm-cash
 */

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const cash = require('../services/shared-cart-cash-service');

const router = express.Router();

router.post('/public/:token/contributions/cash', async (req, res, next) => {
  try {
    const result = await cash.createPendingCashContribution(req.params.token, req.body || {});
    res.status(201).json({
      contribution_id: result.contribution.id,
      cash_reference: result.contribution.cash_reference,
      status: result.contribution.status,
      payment_method: result.contribution.payment_method,
      amount_kmf: result.contribution.amount_kmf,
      message: 'Contribution cash créée. Elle comptera uniquement après confirmation par un agent ou admin.',
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

router.post('/contributions/:id/confirm-cash', authenticate, requireRole(['admin', 'agent_relais']), async (req, res, next) => {
  try {
    const result = await cash.confirmCashContribution(req.params.id, req.user, req.body || {});
    res.json({
      ok: true,
      already_confirmed: !!result.already_confirmed,
      contribution: result.contribution,
      cart: result.cart || null,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    next(err);
  }
});

module.exports = { router };
