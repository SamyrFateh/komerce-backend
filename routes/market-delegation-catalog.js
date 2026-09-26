/**
 * @komerce-arch
 * @role          market-delegation-catalog-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, product exposure payload
 * @outputs       product exposure read model and auditable exposure mutations
 * @depends       middleware/auth.js, services/market-delegation-catalog-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-write-via:catalog-market-exposure-service product_market_exposure
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        explicit
 * @doctrine      capabilities_authorize_catalog_exposure, client_market_id_never_authority, market_catalog_summary_is_server_truth
 * @impact-areas  market, delegation, catalog
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  resolveAuthorization,
  listExposure,
  listReviewQueue,
  summarizeExposure,
  setExposure,
  validateForMarket,
} = require('../services/market-delegation-catalog-service');

function correlationId(req) {
  const raw = req.headers['x-correlation-id'];
  return raw ? String(raw).slice(0, 200) : null;
}

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
    throw error;
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

function sendDelegationError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

function rejectMarketId(body) {
  if (body && (body.market_id != null || body.marketId != null)) {
    const error = new Error('market_id client interdit ; utilisez le code marché de la route.');
    error.code = 'MARKET_ID_FORBIDDEN';
    error.status = 400;
    throw error;
  }
}

router.get('/markets/:marketCode/catalog/exposure', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      // Lecture = catalog.read (universel, viewer inclus). L'écriture reste
      // gardée par catalog.expose sur la route PUT ci-dessous — voir
      // migration 236_market_delegation_catalog_read_capability.sql pour le
      // pourquoi (catalog.expose n'était jamais accordé à un viewer, par
      // conception de la migration 207 ; ça bloquait donc aussi sa lecture).
      const authz = await resolveAuthorization(client, {
        userId: req.user.id,
        marketCode: req.params.marketCode,
        requiredCapability: 'catalog.read',
      });
      const [exposure, reviewQueue] = await Promise.all([
        listExposure(client, { marketId: authz.market_id }),
        listReviewQueue(client, { marketId: authz.market_id, limit: 100 }),
      ]);
      return {
        authz,
        exposure,
        reviewQueue,
        summary: {
          ...summarizeExposure(exposure),
          incoming_products: reviewQueue.total,
        },
      };
    });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      summary: result.summary,
      review_queue: result.reviewQueue,
      exposure: result.exposure,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/catalog/review/:productId/validate', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const result = await withTransaction(client => validateForMarket(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      productId: req.params.productId,
    }));
    res.json({ success: true, validation: result });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.put('/markets/:marketCode/catalog/exposure/:productId', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const body = req.body || {};
    const exposure = await withTransaction(client => setExposure(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      productId: req.params.productId,
      exposure: body.commercial_exposure,
    }));
    res.json({ success: true, exposure });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
