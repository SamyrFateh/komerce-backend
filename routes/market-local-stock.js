/**
 * @komerce-arch
 * @role          market-local-stock-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, market code, receipt payload, Idempotency-Key
 * @outputs       local stock list, receipt declaration, exposure update
 * @depends       middleware/auth.js, services/market-delegation-local-stock-service.js
 * @used-by       bootstrap/api-routes.js, public/dashboards/canonical/js/market-local-offer.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-delegation-local-stock-service local_stock, market_delegation_audit
 * @db-txn        none
 * @doctrine      country_lead_only_local_stock_declaration, client_market_id_never_authority
 * @impact-areas  market-delegation, local-stock
 * @version       2026-11
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const svc = require('../services/market-delegation-local-stock-service');

function sendError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

async function withClient(work) {
  const client = await db.getClient();
  try { return await work(client); } finally { if (client && client.release) client.release(); }
}

function forbidMarketId(body) {
  if (body && (body.market_id != null || body.marketId != null)) {
    throw Object.assign(new Error('market_id client interdit ; utilisez le code marché de la route.'), { code: 'MARKET_ID_FORBIDDEN', status: 400 });
  }
}

router.get('/:marketCode/local-stock', authenticate, async (req, res, next) => {
  try {
    const out = await withClient(c => svc.listMarketStock(c, {
      actorUserId: req.user.id, actorRole: req.user.role, marketCode: req.params.marketCode,
    }));
    res.set('Cache-Control', 'private, no-store');
    res.json({ market: { code: out.authz.market_code }, stock: out.stock, relais: out.relais });
  } catch (e) { if (!sendError(res, e)) next(e); }
});

router.post('/:marketCode/local-stock/receipts', authenticate, async (req, res, next) => {
  try {
    const b = req.body || {};
    forbidMarketId(b);
    const out = await withClient(c => svc.declareReceipt(c, {
      actorUserId: req.user.id, actorRole: req.user.role, marketCode: req.params.marketCode,
      productId: b.product_id, relaisId: b.relais_id, qtyReceived: b.qty_received,
      proofRef: b.proof_ref, note: b.note, idempotencyKey: req.get('Idempotency-Key'),
    }));
    res.status(out.replayed ? 200 : 201).json(out);
  } catch (e) { if (!sendError(res, e)) next(e); }
});

router.put('/:marketCode/local-stock/:productId/exposure', authenticate, async (req, res, next) => {
  try {
    const b = req.body || {};
    forbidMarketId(b);
    const row = await withClient(c => svc.setExposure(c, {
      actorUserId: req.user.id, actorRole: req.user.role, marketCode: req.params.marketCode,
      productId: req.params.productId, exposure: b.commercial_exposure,
      correlationId: req.get('x-correlation-id') || null,
    }));
    res.json({ success: true, stock: row });
  } catch (e) { if (!sendError(res, e)) next(e); }
});

module.exports = router;
