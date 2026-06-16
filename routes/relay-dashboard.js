/**
 * @komerce-arch
 * @role          dashboard-relay-dashboard
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders
 * @db-write      order_comments, order_incidents
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
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
const log = require('../utils/logger').child({ module: 'relay-dashboard' });
const { getDashboardKPIs, getOrders, getOrderDetail } = require('../services/relay-dashboard-queries');

router.use(authenticate, requireRole(['admin', 'agent_relais']));

// ── Security helper — vérifie que la commande appartient au relais ──────────
async function assertOrderBelongsToRelais(req, res, orderId) {
  const { rows: [order] } = await db.query(
    'SELECT id, reference, status, relais_id FROM orders WHERE id = $1',
    [orderId]
  );
  if (!order) {
    res.status(404).json({ error: 'Commande introuvable' });
    return null;
  }
  if (req.user.role !== 'admin' && String(order.relais_id) !== String(req.user.relais_id)) {
    log.warn(`[RELAY] IDOR bloqué — user ${req.user.id} (relais ${req.user.relais_id}) → order ${order.id} (relais ${order.relais_id})`);
    res.status(403).json({ error: "Cette commande n'appartient pas à votre relais" });
    return null;
  }
  return order;
}

// GET /dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    res.json(await getDashboardKPIs(req.user));
  } catch(err) { next(err); }
});

// GET /orders
router.get('/orders', async (req, res, next) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;
    res.json(await getOrders(req.user, { status, search, limit, offset }));
  } catch(err) { next(err); }
});

// GET /orders/:id
router.get('/orders/:id', async (req, res, next) => {
  try {
    const result = await getOrderDetail(req.user, req.params.id);
    if (!result) return res.status(404).json({ error: 'Commande introuvable' });
    if (result.forbidden) return res.status(403).json({ error: "Cette commande n'appartient pas à votre relais" });
    res.json(result);
  } catch(err) { next(err); }
});

// POST /orders/:id/incident
router.post('/orders/:id/incident', async (req, res, next) => {
  try {
    const { type, description, priority } = req.body;
    if (!type) return res.status(400).json({ error: "Type d'incident requis" });

    const validTypes = ['retard','blocage','paiement','stock','colis_endommage','colis_perdu','client_absent','autre'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Type invalide. Valides: ${validTypes.join(', ')}` });
    }

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
router.post('/orders/:id/comment', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Texte requis' });

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
router.post('/orders/:id/escalate', async (req, res, next) => {
  try {
    const { reason, priority } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: "Raison d'escalade requise" });

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
router.patch('/orders/:id/client-absent', async (req, res, next) => {
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
