/**
 * @komerce-arch
 * @role          market-delegation-provider-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, provider payloads
 * @outputs       provider read model and auditable provider mutations
 * @depends       middleware/auth.js, services/market-delegation-provider-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-write-via:providers-service providers
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        explicit
 * @doctrine      capabilities_authorize_provider_actions, client_market_id_never_authority, suspend_not_delete
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
  listProviders,
  createProvider,
  updateProvider,
  setProviderStatus,
} = require('../services/market-delegation-provider-service');

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

router.get('/markets/:marketCode/network/providers', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const authz = await resolveAuthorization(client, {
        userId: req.user.id,
        marketCode: req.params.marketCode,
        requiredCapability: 'provider.manage',
      });
      const providers = await listProviders(client, { marketId: authz.market_id });
      return { authz, providers };
    });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      providers: result.providers,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/network/providers', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const body = req.body || {};
    const provider = await withTransaction(client => createProvider(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      name: body.name,
      phone: body.phone,
    }));
    res.status(201).json({ success: true, provider });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.put('/markets/:marketCode/network/providers/:providerId', authenticate, async (req, res, next) => {
  try {
    rejectMarketId(req.body);
    const body = req.body || {};
    const provider = await withTransaction(client => updateProvider(client, {
      marketCode: req.params.marketCode,
      providerId: req.params.providerId,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      patch: {
        name: body.name,
        phone: body.phone,
        publicPhone: body.public_phone,
        publicWhatsapp: body.public_whatsapp,
      },
    }));
    res.json({ success: true, provider });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/network/providers/:providerId/suspend', authenticate, async (req, res, next) => {
  try {
    const provider = await withTransaction(client => setProviderStatus(client, {
      marketCode: req.params.marketCode,
      providerId: req.params.providerId,
      actorUserId: req.user.id,
      status: 'suspended',
      correlationId: correlationId(req),
    }));
    res.json({ success: true, provider });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/network/providers/:providerId/activate', authenticate, async (req, res, next) => {
  try {
    const provider = await withTransaction(client => setProviderStatus(client, {
      marketCode: req.params.marketCode,
      providerId: req.params.providerId,
      actorUserId: req.user.id,
      status: 'active',
      correlationId: correlationId(req),
    }));
    res.json({ success: true, provider });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
