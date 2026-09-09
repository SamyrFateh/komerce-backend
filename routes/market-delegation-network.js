/**
 * @komerce-arch
 * @role          market-delegation-network-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, relais payloads
 * @outputs       relais read model and auditable network mutations
 * @depends       middleware/auth.js, services/market-delegation-network-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-delegation-network-service relais
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        explicit
 * @doctrine      capabilities_authorize_network_actions, client_market_id_never_authority, suspend_not_delete
 * @impact-areas  market, delegation, logistics, network
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  resolveAuthorization,
  listRelais,
  createRelais,
  updateRelais,
  setRelaisActive,
} = require('../services/market-delegation-network-service');

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

// market_id/marketId ne sont jamais une preuve d'autorité côté client — le
// marché vient exclusivement du :marketCode de la route, résolu serveur.
function rejectMarketId(body) {
  if (body && (body.market_id != null || body.marketId != null)) {
    const error = new Error('market_id client interdit ; utilisez le code marché de la route.');
    error.code = 'MARKET_ID_FORBIDDEN';
    error.status = 400;
    throw error;
  }
}

router.get('/markets/:marketCode/network/relais', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const authz = await resolveAuthorization(client, {
        userId: req.user.id,
        marketCode: req.params.marketCode,
        requiredCapability: 'network.read',
      });
      const relais = await listRelais(client, { marketId: authz.market_id });
      return { authz, relais };
    });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      relais: result.relais,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/network/relais', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const body = req.body || {};
    const relais = await withTransaction(client => createRelais(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      name: body.name,
      agentName: body.agent_name,
      phone: body.phone,
      address: body.address,
      zone: body.zone,
      hours: body.hours,
      island: body.island,
      islandCode: body.island_code,
      latitude: body.latitude,
      longitude: body.longitude,
      photoUrl: body.photo_url,
    }));
    res.status(201).json({ success: true, relais });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.put('/markets/:marketCode/network/relais/:relaisId', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const body = req.body || {};
    const relais = await withTransaction(client => updateRelais(client, {
      marketCode: req.params.marketCode,
      relaisId: req.params.relaisId,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      patch: {
        name: body.name,
        agentName: body.agent_name,
        phone: body.phone,
        address: body.address,
        zone: body.zone,
        hours: body.hours,
        island: body.island,
        islandCode: body.island_code,
        latitude: body.latitude,
        longitude: body.longitude,
        photoUrl: body.photo_url,
      },
    }));
    res.json({ success: true, relais });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/network/relais/:relaisId/suspend', authenticate, async (req, res, next) => {
  try {
    const relais = await withTransaction(client => setRelaisActive(client, {
      marketCode: req.params.marketCode,
      relaisId: req.params.relaisId,
      actorUserId: req.user.id,
      active: false,
      correlationId: correlationId(req),
    }));
    res.json({ success: true, relais });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/network/relais/:relaisId/activate', authenticate, async (req, res, next) => {
  try {
    const relais = await withTransaction(client => setRelaisActive(client, {
      marketCode: req.params.marketCode,
      relaisId: req.params.relaisId,
      actorUserId: req.user.id,
      active: true,
      correlationId: correlationId(req),
    }));
    res.json({ success: true, relais });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
