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
 * @doctrine      delegated_capabilities_or_verified_central_admin_catalog_only, client_market_id_never_authority, market_catalog_summary_is_server_truth
 * @impact-areas  market, delegation, catalog
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { assertMarketOperationAllowed } = require('../services/market-operation-guard');
const { listAuthorizedMarketsForCapability } = require('../services/market-delegation-service');
const {
  resolveCatalogAuthorization,
  listExposure,
  listReviewQueue,
  listReadyToSell,
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

// Only catalog.read delegation is authoritative for this screen. The
// global dashboard list of active markets is NOT a membership grant.
// This endpoint returns codes, no commercial data or personal identifiers.
router.get('/catalog/authorized-markets', authenticate, async (req, res, next) => {
  try {
    // A central Admin can choose any actively assigned market, explicitly.
    // All other roles still require a live catalog.read market membership.
    const centralRole = req.user.role === 'admin'
      ? (await db.query('SELECT role FROM users WHERE id=$1::uuid LIMIT 1', [req.user.id])).rows[0]?.role === 'admin'
      : false;
    const markets = centralRole
      ? (await db.query(`
          SELECT m.code AS market_code
            FROM markets m
            JOIN market_operating_assignments a
              ON a.market_id = m.id AND a.status = 'ACTIVE'
           WHERE m.lifecycle_status IN ('ACTIVE', 'SUSPENDED')
           ORDER BY m.code`)).rows
      : await listAuthorizedMarketsForCapability(db, {
          userId: req.user.id,
          requiredCapability: 'catalog.read',
        });
    res.set('Cache-Control', 'private, no-store');
    return res.json({
      required_capability: 'catalog.read',
      market_codes: [...new Set(markets.map(row => row.market_code))],
    });
  } catch (err) {
    next(err);
  }
});

router.get('/markets/:marketCode/catalog/exposure', authenticate, async (req, res, next) => {
  try {
    const requestedPage = Number(req.query.price_page || 1);
    const pricePage = Number.isSafeInteger(requestedPage) && requestedPage >= 1 ? Math.min(requestedPage, 10000) : 1;
    const result = await withTransaction(async (client) => {
      // Lecture = catalog.read (universel, viewer inclus). L'écriture reste
      // gardée par catalog.expose sur la route PUT ci-dessous — voir
      // migration 236_market_delegation_catalog_read_capability.sql pour le
      // pourquoi (catalog.expose n'était jamais accordé à un viewer, par
      // conception de la migration 207 ; ça bloquait donc aussi sa lecture).
      const authz = await resolveCatalogAuthorization(client, {
        userId: req.user.id,
        actorRole: req.user.role,
        marketCode: req.params.marketCode,
        requiredCapability: 'catalog.read',
      });
      const [exposure, reviewQueue] = await Promise.all([
        listExposure(client, { marketId: authz.market_id }),
        listReviewQueue(client, { marketId: authz.market_id, limit: 100 }),
      ]);
      const readyToSell = await listReadyToSell(client, {
        market: {
          id: authz.market_id,
          code: authz.market_code,
          name: authz.market_name,
          currency: authz.currency,
        },
        capabilities: authz.capabilities,
        reviewQueue,
        exposure,
        limit: 100,
        offset: (pricePage - 1) * 100,
        search: String(req.query.price_search || '').slice(0,120),
      });
      return {
        authz,
        exposure,
        reviewQueue,
        readyToSell,
        summary: {
          ...summarizeExposure(exposure),
          incoming_products: reviewQueue.total,
          ready_to_sell: readyToSell.summary.ready,
        },
      };
    });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      summary: result.summary,
      review_queue: result.reviewQueue,
      ready_to_sell: result.readyToSell,
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
      actorRole: req.user.role,
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
    const exposure = await withTransaction(async client => {
      // Q2 : une nouvelle exposition exige un marché actif ; masquer reste toujours possible.
      if (body.commercial_exposure === 'ENABLED') await assertMarketOperationAllowed(client, req.params.marketCode, 'catalog_exposure_enable');
      return setExposure(client, {
        marketCode: req.params.marketCode,
        actorUserId: req.user.id,
        actorRole: req.user.role,
        correlationId: correlationId(req),
        productId: req.params.productId,
        exposure: body.commercial_exposure,
      });
    });
    res.json({ success: true, exposure });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
