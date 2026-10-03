/**
 * @komerce-arch
 * @role          dashboard-relay-dashboard
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, middleware/require-market-delegated-role.js, middleware/require-market-delegated-capability.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, orders
 * @db-write      order_comments, order_incidents
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, capability_is_the_authority_not_role, relay_id_is_server_boundary
 * @impact-areas  dashboard, admin-dashboard, market
 * @version       2026-10-d5
 */

'use strict';

/**
 * routes/relay-dashboard.js — Façade R9
 * Lectures dans services/relay-dashboard-queries.js
 * Mutations (incident/comment/escalate/client-absent) restent ici — inserts simples.
 *
 * GET  /dashboard              → getDashboardKPIs
 * GET  /orders                 → getOrders
 * GET  /orders/:id             → getOrderDetail
 * POST /orders/:id/incident    → mutation locale
 * POST /orders/:id/comment     → mutation locale
 * POST /orders/:id/escalate    → mutation locale
 * PATCH /orders/:id/client-absent → mutation locale
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachMarketDelegatedRoleFor } = require('../middleware/require-market-delegated-role');
const { attachAuthorizedMarketsForCapability, requireMarketDelegatedCapability } = require('../middleware/require-market-delegated-capability');
const log = require('../utils/logger').child({ module: 'relay-dashboard' });
const { getDashboardKPIs, getOrders, getOrderDetail } = require('../services/relay-dashboard-queries');

// D5 Market Control Plane — admin reste central, agent_relais reste borné par
// son relais_id serveur. Un market_operator doit prouver operations.read pour
// les lectures et hub.supervise pour les mutations de supervision. La
// projection de rôle request-local n'est jamais une autorité marché.
const attachOperationsReadMarkets = attachAuthorizedMarketsForCapability('operations.read', { audit: false });
const relaySuperviseCapability = requireMarketDelegatedCapability('hub.supervise', { audit: false });

function attachRelayReadAuthority(req, res, next) {
  if (!req.user || req.user.role !== 'market_operator') return next();
  return attachOperationsReadMarkets(req, res, next);
}

function requireRelaySupervise(req, res, next) {
  if (!req.user || req.user.role !== 'market_operator') return next();
  return relaySuperviseCapability(req, res, next);
}

const relayRead = [
  authenticate,
  attachMarketDelegatedRoleFor(['admin', 'agent_relais', 'market_operator']),
  requireRole(['admin', 'agent_relais', 'market_operator']),
  attachRelayReadAuthority,
];

const relaySupervise = [
  authenticate,
  attachMarketDelegatedRoleFor(['admin', 'agent_relais', 'market_operator']),
  requireRole(['admin', 'agent_relais', 'market_operator']),
];

async function resolveOrderMarket(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.reference, o.status, o.relais_id, o.market_id, m.code AS market_code
         FROM orders o
         JOIN markets m ON m.id = o.market_id
        WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    req.relayOrder = rows[0];
    req.params.marketCode = rows[0].market_code;
    return next();
  } catch (err) { return next(err); }
}

// ── Security helper — vérifie que la commande appartient au relais ──────────
// 3 cas : admin (aucun check), agent_relais (relais_id fixe, IDOR fix
// préservé), market_operator (capability hub.supervise déjà prouvée sur le
// market_code résolu depuis la commande).
async function assertOrderBelongsToRelais(req, res, orderId) {
  const order = req.relayOrder && String(req.relayOrder.id) === String(orderId)
    ? req.relayOrder
    : (await db.query(
      'SELECT id, reference, status, relais_id, market_id FROM orders WHERE id = $1',
      [orderId]
    )).rows[0];
  if (!order) {
    res.status(404).json({ error: 'Commande introuvable' });
    return null;
  }

  if (req.user.role === 'agent_relais') {
    if (String(order.relais_id) !== String(req.user.relais_id)) {
      log.warn(`[RELAY] IDOR bloqué — user ${req.user.id} (relais ${req.user.relais_id}) → order ${order.id} (relais ${order.relais_id})`);
      res.status(403).json({ error: "Cette commande n'appartient pas à votre relais" });
      return null;
    }
    return order;
  }

  if (req.user.role === 'market_operator') {
    if (!req.marketDelegatedCapability
        || req.marketDelegatedCapability.capability !== 'hub.supervise'
        || String(req.marketDelegatedCapability.market_id) !== String(order.market_id)) {
      res.status(403).json({ error: 'Commande hors de votre périmètre marché', code: 'MARKET_CAPABILITY_REQUIRED' });
      return null;
    }
    return order;
  }

  // admin : aucun check, comportement inchangé.
  return order;
}

// GET /dashboard
router.get('/dashboard', ...relayRead, async (req, res, next) => {
  try {
    res.json(await getDashboardKPIs(req.user, { authorizedMarkets: req.authorizedMarkets }));
  } catch(err) { next(err); }
});

// GET /orders
router.get('/orders', ...relayRead, async (req, res, next) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;
    res.json(await getOrders(req.user, { status, search, limit, offset }, { authorizedMarkets: req.authorizedMarkets }));
  } catch(err) { next(err); }
});

// GET /orders/:id
router.get('/orders/:id', ...relayRead, async (req, res, next) => {
  try {
    const result = await getOrderDetail(req.user, req.params.id, { authorizedMarkets: req.authorizedMarkets });
    if (!result) return res.status(404).json({ error: 'Commande introuvable' });
    if (result.forbidden) return res.status(403).json({ error: "Cette commande n'appartient pas à votre relais ou marché", code: 'market_scope_denied' });
    res.json(result);
  } catch(err) { next(err); }
});

function validateIncidentBody(req, res, next) {
  const { type } = req.body || {};
  if (!type) return res.status(400).json({ error: "Type d'incident requis" });
  const validTypes = ['retard','blocage','paiement','stock','colis_endommage','colis_perdu','client_absent','autre'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Type invalide. Valides: ${validTypes.join(', ')}` });
  }
  return next();
}

function validateCommentBody(req, res, next) {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Texte requis' });
  return next();
}

function validateEscalateBody(req, res, next) {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: "Raison d'escalade requise" });
  return next();
}

// POST /orders/:id/incident
router.post('/orders/:id/incident', ...relaySupervise, validateIncidentBody, resolveOrderMarket, requireRelaySupervise, async (req, res, next) => {
  try {
    const { type, description, priority } = req.body;
    const order = await assertOrderBelongsToRelais(req, res, req.params.id);
    if (!order) return;

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, reporter_id, reporter_name, type, description, priority)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [order.id, req.user.id, req.user.full_name, type, description || null, priority || 'normal']);

    log.info(`[RELAY] 🚨 Incident ${incident.id} créé — commande ${order.reference} — type: ${type}`);
    res.status(201).json({ success: true, incident });
  } catch(err) { next(err); }
});

// POST /orders/:id/comment
router.post('/orders/:id/comment', ...relaySupervise, validateCommentBody, resolveOrderMarket, requireRelaySupervise, async (req, res, next) => {
  try {
    const { text } = req.body;
    const order = await assertOrderBelongsToRelais(req, res, req.params.id);
    if (!order) return;

    const { rows: [comment] } = await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, author_role, text)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [order.id, req.user.id, req.user.full_name, req.user.role, text.trim()]);

    res.status(201).json({ success: true, comment });
  } catch(err) { next(err); }
});

// POST /orders/:id/escalate
router.post('/orders/:id/escalate', ...relaySupervise, validateEscalateBody, resolveOrderMarket, requireRelaySupervise, async (req, res, next) => {
  try {
    const { reason, priority } = req.body;
    const order = await assertOrderBelongsToRelais(req, res, req.params.id);
    if (!order) return;

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, reporter_id, reporter_name, type, description, priority)
      VALUES ($1, $2, $3, 'autre', $4, $5)
      RETURNING *
    `, [order.id, req.user.id, req.user.full_name, `⚠️ ESCALADE HUB: ${reason.trim()}`, priority || 'high']);

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, author_role, text)
      VALUES ($1, $2, $3, $4, $5)
    `, [order.id, req.user.id, req.user.full_name, req.user.role, `⚠️ Escaladé au hub: ${reason.trim()}`]);

    log.info(`[RELAY] ⚠️ Escalade hub — commande ${order.reference} — raison: ${reason}`);
    res.status(201).json({ success: true, incident, message: 'Escalade envoyée au hub' });
  } catch(err) { next(err); }
});

// PATCH /orders/:id/client-absent
router.patch('/orders/:id/client-absent', ...relaySupervise, resolveOrderMarket, requireRelaySupervise, async (req, res, next) => {
  try {
    const order = await assertOrderBelongsToRelais(req, res, req.params.id);
    if (!order) return;

    if (order.status !== 'available') {
      return res.status(422).json({ error: 'Seules les commandes "available" peuvent être marquées client absent' });
    }

    await db.query(`
      INSERT INTO order_incidents (order_id, reporter_id, reporter_name, type, description, priority)
      VALUES ($1, $2, $3, 'client_absent', $4, 'normal')
    `, [order.id, req.user.id, req.user.full_name, `Client absent — relancé par ${req.user.full_name}`]);

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, author_role, text)
      VALUES ($1, $2, $3, $4, 'Client absent — relance programmée')
    `, [order.id, req.user.id, req.user.full_name, req.user.role]);

    log.info(`[RELAY] 👤 Client absent — commande ${order.reference}`);
    res.json({ success: true, message: 'Client marqué absent, relance programmée' });
  } catch(err) { next(err); }
});

module.exports = router;
