/**
 * @komerce-arch
 * @role          market-delegation-structure-event-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   critical
 * @inputs        authenticated user, canonical market code, structure cost event payload
 * @outputs       economic_structure_cost_events read model, auditable MARKET_DIRECT event recording
 * @depends       middleware/auth.js, services/market-delegation-structure-event-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-write-via:pricing-period-structure economic_structure_cost_events
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        explicit
 * @doctrine      capabilities_authorize_structure_event_recording, client_market_id_never_authority, group_scope_never_delegated
 * @impact-areas  market, delegation, economic-engine
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  resolveAuthorization,
  listStructureEvents,
  recordStructureEvent,
} = require('../services/market-delegation-structure-event-service');

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

router.get('/markets/:marketCode/structure-events', authenticate, async (req, res, next) => {
  try {
    const result = await withTransaction(client => listStructureEvents(client, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      chargeId: req.query.charge_id || null,
      limit: req.query.limit,
    }));
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      assignment_id: result.authz.assignment_id,
      actor_capabilities: result.authz.capabilities,
      events: result.events,
    });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

// recordStructureEvent gère sa propre transaction via le writer canonique
// (economic-engine) — pas de withTransaction ici, l'audit market-delegation
// est un second appel distinct après succès. Voir la doc du service.
router.post('/markets/:marketCode/structure-events', authenticate, async (req, res, next) => {
  try {
    const event = await recordStructureEvent(db, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      correlationId: correlationId(req),
      payload: req.body || {},
    });
    res.status(201).json({ success: true, event });
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
