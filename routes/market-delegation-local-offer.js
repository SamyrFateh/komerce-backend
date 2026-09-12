/**
 * @komerce-arch
 * @role          market-delegation-local-offer-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, exposure payloads
 * @outputs       service/physical_offer read models and auditable exposure mutations
 * @depends       middleware/auth.js, services/market-delegation-local-offer-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-write-via:providers-service services, physical_offers
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        explicit
 * @doctrine      capabilities_authorize_local_offer_exposure, client_market_id_never_authority
 * @impact-areas  market, delegation, providers-services
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  resolveAuthorization,
  listServices,
  listPhysicalOffers,
  setServiceExposure,
  setPhysicalOfferExposure,
} = require('../services/market-delegation-local-offer-service');

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

router.get('/markets/:marketCode/local-offer/services', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const authz = await resolveAuthorization(client, {
        userId: req.user.id, marketCode: req.params.marketCode, requiredCapability: 'local_offer.manage',
      });
      const services = await listServices(client, { marketId: authz.market_id });
      return { authz, services };
    });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      services: result.services,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.put('/markets/:marketCode/local-offer/services/:serviceId', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const service = await withTransaction(client => setServiceExposure(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      serviceId: req.params.serviceId,
      exposure: (req.body || {}).commercial_exposure,
    }));
    res.json({ success: true, service });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.get('/markets/:marketCode/local-offer/physical-offers', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const authz = await resolveAuthorization(client, {
        userId: req.user.id, marketCode: req.params.marketCode, requiredCapability: 'local_offer.manage',
      });
      const physicalOffers = await listPhysicalOffers(client, { marketId: authz.market_id });
      return { authz, physicalOffers };
    });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      physical_offers: result.physicalOffers,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.put('/markets/:marketCode/local-offer/physical-offers/:physicalOfferId', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const physicalOffer = await withTransaction(client => setPhysicalOfferExposure(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      physicalOfferId: req.params.physicalOfferId,
      exposure: (req.body || {}).commercial_exposure,
    }));
    res.json({ success: true, physical_offer: physicalOffer });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
