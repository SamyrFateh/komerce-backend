/**
 * @komerce-arch
 * @role          logistics-parcels
 * @domain        logistics
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, parcel_events, parcel_items, parcels, products, relais, users
 * @db-write      orders, parcel_items, parcels, pickup_verify_attempts
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Parcels CRUD API (R1 compliant + Security v1.0)
 *
 * SÉCURITÉ LOGISTIQUE v1.0 :
 *   [S1] external_code neutre généré à la création
 *   [S2] seal_code attribué à la création
 *   [S3] parcel_event loggé à chaque changement de statut
 *   [S4] Vérification poids (weight checkpoint) optionnelle
 *   [S5] GET /api/parcels/:ref/events — historique événements
 *   [S6] POST /api/parcels/:id/weight — enregistrer un checkpoint poids
 *   [S7] POST /api/parcels/:id/verify-seal — vérifier le scellé
 *
 * GET    /api/parcels               — Liste colis (filtres, pagination)
 * GET    /api/parcels/:ref          — Détail colis par référence
 * GET    /api/parcels/:ref/events   — [NEW] Historique événements sécurité
 * POST   /api/parcels               — Créer colis manuellement
 * PATCH  /api/parcels/:id/status    — Changer statut via parcelSync (R1)
 * POST   /api/parcels/:id/weight    — [NEW] Checkpoint poids
 * POST   /api/parcels/:id/verify-seal — [NEW] Vérifier scellé
 * POST   /api/parcels/:id/items     — Ajouter article au colis
 * DELETE /api/parcels/:id/items/:item_id — Retirer article du colis
 * POST   /api/parcels/optimize      — Optimiser la répartition des items
 * POST   /api/parcels/bootstrap/:orderId — Migrer une commande legacy
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { parcels } = require('../validators');
const { safeSyncScanToParcels } = require('../utils/parcelSync');
const { generateParcelRef } = require('../utils/reference');
const { PARCEL_STATUSES } = require('../utils/parcels');
// parcelOptimizationService retiré — doctrine DOUANE_DECLARATION_PIVOT (2026-06-25)
// Moteur de bin-packing démantelé : optimise le calage physique, axe que ni le
// transporteur (volume) ni l'agent douanier (facture déclarée) ne regardent.
// Actif phase Avion uniquement — à réécrire à neuf si ce besoin revient.
const { evaluateOrderParcelLinkRules } = require('../utils/orderParcelLinkRules');
const log = require('../utils/logger').child({ module: 'parcels' });

// [XREL-02] Rate-limit vérification scellé — réutilise la table
// pickup_verify_attempts (migrations existantes) sans toucher à
// routes/tracking.js (hors périmètre RC-SEC). Clé = hash(parcelId + IP),
// token stocké = `seal:<parcelId>` pour distinguer du flux retrait client.
const SEAL_VERIFY_LIMIT = 10;
const SEAL_VERIFY_WINDOW_MINUTES = 15;

function sealVerifyClientIp(req) {
  const raw = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  return String(raw).split(',')[0].trim() || 'unknown';
}

function sealVerifyAttemptKey(parcelId, req) {
  const ipHash = crypto.createHash('sha256').update(sealVerifyClientIp(req)).digest('hex');
  return crypto.createHash('sha256').update(`seal:${parcelId}:${ipHash}`).digest('hex');
}

async function checkSealVerifyLimit(parcelId, req) {
  const key = sealVerifyAttemptKey(parcelId, req);
  const token = `seal:${parcelId}`;
  const ipHash = crypto.createHash('sha256').update(sealVerifyClientIp(req)).digest('hex');

  await db.query('DELETE FROM pickup_verify_attempts WHERE reset_at <= NOW()');

  const { rows: [entry] } = await db.query(`
    INSERT INTO pickup_verify_attempts (attempt_key, token, ip_hash, count, reset_at)
    VALUES ($1, $2, $3, 1, NOW() + ($4 || ' minutes')::interval)
    ON CONFLICT (attempt_key)
    DO UPDATE SET
      count = CASE
        WHEN pickup_verify_attempts.reset_at <= NOW() THEN 1
        ELSE pickup_verify_attempts.count + 1
      END,
      reset_at = CASE
        WHEN pickup_verify_attempts.reset_at <= NOW()
          THEN NOW() + ($4 || ' minutes')::interval
        ELSE pickup_verify_attempts.reset_at
      END,
      updated_at = NOW()
    RETURNING count, reset_at
  `, [key, token, ipHash, SEAL_VERIFY_WINDOW_MINUTES]);

  const retryAfter = Math.max(1, Math.ceil((new Date(entry.reset_at).getTime() - Date.now()) / 1000));
  return { exceeded: entry.count > SEAL_VERIFY_LIMIT, retryAfter, count: entry.count };
}

// [S1-S5] Sécurité logistique
const {
  generateExternalCode,
  generateSealCode,
  logParcelEvent,
  checkWeightIntegrity,
  verifySeal,
} = require('../services/parcel-security');

const adminAgent = [authenticate, requireRole(['admin', 'agent_hub'])];
const adminAgentRelais = [authenticate, requireRole(['admin', 'agent_hub', 'agent_relais'])];

const STATUS_TO_STEP = {
  preparation: 'preparation',
  shipped:     'shipped',
  in_transit:  'in_transit',
  available:   'relais_received',
  collected:   'collected',
  cancelled:   'cancelled',
};

// GET /api/parcels
router.get('/', ...adminAgentRelais, validate({ query: parcels.list }), async (req, res, next) => {
  try {
    const { status, shipment_id, order_id, search, page = 1, limit = 50 } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 50, 100);
    const safePage = Math.max(parseInt(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) { conditions.push(`p.status = $${idx++}`); params.push(status); }
    if (shipment_id) { conditions.push(`p.shipment_id = $${idx++}`); params.push(shipment_id); }
    if (order_id) { conditions.push(`p.order_id = $${idx++}`); params.push(order_id); }
    if (search) { conditions.push(`(p.reference ILIKE $${idx} OR p.external_code ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

    // Agent relais: only see parcels for their relay point's orders
    if (req.user.role === 'agent_relais') {
      conditions.push(`o.relais_id IN (SELECT r.id FROM relais r WHERE r.phone = (SELECT u.phone FROM users u WHERE u.id = $${idx++}))`);
      params.push(req.user.id);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM parcels p LEFT JOIN orders o ON o.id = p.order_id ${where}`, params); // AUD-07: where = parameterized condition templates; values remain bound in params
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await db.query(`
      SELECT p.*, p.external_code,
             o.reference AS order_reference, o.status AS order_status,
             o.destination_island, o.routing_mode,
             (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS items_count
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      ${where} /* AUD-07: parameterized condition templates */
      ORDER BY p.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, safeLimit, offset]);

    res.json({ data: rows, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } });
  } catch(e) { next(e); }
});

// GET /api/parcels/:ref — aussi cherche par external_code
router.get('/:ref', ...adminAgentRelais, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT p.*, o.reference AS order_reference, o.status AS order_status, o.user_id, o.relais_id,
             o.destination_island, o.routing_mode, o.transit_hub
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.reference = $1 OR p.external_code = $1
    `, [req.params.ref]);

    if (!rows.length) return res.status(404).json({ error: 'Colis introuvable' });
    const parcel = rows[0];

    const items = await db.query(`
      SELECT pi.*, oi.quantity AS order_qty, oi.price_kmf,
             pr.name AS product_name, pr.image_url AS product_image
      FROM parcel_items pi
      LEFT JOIN order_items oi ON oi.id = pi.order_item_id
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE pi.parcel_id = $1
      ORDER BY pi.created_at ASC
    `, [parcel.id]);

    parcel.items = items.rows;

    // [S3] Info interne uniquement — pas sur l'étiquette physique
    // Les items, noms produits, valeurs sont dans cette réponse API (système)
    // mais ne seront JAMAIS sur l'étiquette PDF (voir logistics.js)

    res.json(parcel);
  } catch(e) { next(e); }
});

// [S5] GET /api/parcels/:ref/events — Historique événements sécurité
router.get('/:ref/events', ...adminAgentRelais, async (req, res, next) => {
  try {
    // Trouver le colis par ref ou external_code
    const parcel = await db.query(
      'SELECT id FROM parcels WHERE reference = $1 OR external_code = $1',
      [req.params.ref]
    );
    if (!parcel.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const { rows } = await db.query(`
      SELECT pe.*, u.full_name AS actor_name, u.role AS actor_role
      FROM parcel_events pe
      LEFT JOIN users u ON u.id = pe.actor_id
      WHERE pe.parcel_id = $1
      ORDER BY pe.created_at ASC
    `, [parcel.rows[0].id]);

    res.json({ parcel_id: parcel.rows[0].id, events: rows, count: rows.length });
  } catch(e) { next(e); }
});

// POST /api/parcels — [S1] external_code + seal_code + event logged
router.post('/', ...adminAgent, validate({ body: parcels.create }), async (req, res, next) => {
  try {
    const { order_id, type = 'standard', notes, weight_kg } = req.body;

    const orderCheck = await db.query('SELECT id FROM orders WHERE id = $1', [order_id]);
    if (!orderCheck.rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const reference = await generateParcelRef(db);
    const external_code = generateExternalCode();
    const seal_code = generateSealCode();

    const { rows } = await db.query(`
      INSERT INTO parcels (reference, external_code, seal_code, order_id, type, notes, status,
                           weight_kg, last_weight_kg)
      VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $7)
      RETURNING *
    `, [reference, external_code, seal_code, order_id, type, notes || null, weight_kg || null]);

    // Set last_weight_at if weight was provided
    if (weight_kg) {
      await db.query('UPDATE parcels SET last_weight_at = NOW() WHERE id = $1', [rows[0].id]);
    }

    const parcel = rows[0];

    // [S2] Logger la création
    await logParcelEvent(db, {
      parcel_id: parcel.id,
      event_type: 'created',
      actor_id: req.user.id,
      notes: `Colis créé — type: ${type}`,
      metadata: { order_id, type, external_code, seal_code },
    });

    if (weight_kg) {
      await logParcelEvent(db, {
        parcel_id: parcel.id,
        event_type: 'weight_recorded',
        actor_id: req.user.id,
        weight_kg,
        notes: 'Poids initial',
      });
    }

    // [S2] Logger le scellé
    await logParcelEvent(db, {
      parcel_id: parcel.id,
      event_type: 'sealed',
      actor_id: req.user.id,
      notes: 'Scellé initial appliqué',
      metadata: { seal_code },
    });

    res.status(201).json(parcel);
  } catch(e) {
    if (e.code === '23505' && e.constraint === 'one_draft_per_order') {
      return res.status(409).json({ error: 'Un colis draft existe déjà pour cette commande' });
    }
    next(e);
  }
});

// PATCH /api/parcels/:id/status — [S3] log event on every status change
router.patch('/:id/status', ...adminAgent, validate({ body: parcels.updateStatus }), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const parcelCheck = await db.query('SELECT id, order_id, status, external_code FROM parcels WHERE id = $1', [req.params.id]);
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const parcel = parcelCheck.rows[0];
    const step = STATUS_TO_STEP[status];
    if (!step) return res.status(400).json({ error: `Statut invalide : ${status}` });

    const oldStatus = parcel.status;

    await safeSyncScanToParcels({
      order_id:    parcel.order_id,
      step,
      scan_id:     null,
      scanned_by:  req.user.id,
      notes:       notes || `Status → ${status}`,
    });

    // [S2] Logger le changement de statut
    await logParcelEvent(db, {
      parcel_id: parcel.id,
      event_type: 'status_changed',
      actor_id: req.user.id,
      notes: notes || `${oldStatus} → ${status}`,
      metadata: { from: oldStatus, to: status },
    });

    // Évaluer les règles de liaison order ↔ parcel (R1/R2/R3)
    const triggeredRule = await evaluateOrderParcelLinkRules(parcel.order_id, db);
    if (triggeredRule) {
      log.info(`[LINK-RULE] ${triggeredRule} déclenché pour order ${parcel.order_id}`);
    }

    const [parcelResult, orderResult] = await Promise.all([
      db.query('SELECT * FROM parcels WHERE id = $1', [req.params.id]),
      db.query('SELECT id, status, computed_status FROM orders WHERE id = $1', [parcel.order_id]),
    ]);

    const updatedOrder = orderResult.rows[0];

    res.json({
      ...parcelResult.rows[0],
      link_rule_triggered: triggeredRule,
      order: updatedOrder
        ? { id: updatedOrder.id, status: updatedOrder.status, computed_status: updatedOrder.computed_status }
        : null,
    });
  } catch(e) { next(e); }
});

// [S6] POST /api/parcels/:id/weight — Checkpoint poids
router.post('/:id/weight', ...adminAgentRelais, async (req, res, next) => {
  try {
    const { weight_kg, location } = req.body;
    if (!weight_kg || isNaN(parseFloat(weight_kg))) {
      return res.status(400).json({ error: 'weight_kg requis (nombre)' });
    }

    const parcelCheck = await db.query(
      `SELECT p.id, p.last_weight_kg, p.last_weight_location, p.external_code, o.relais_id
       FROM parcels p LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const parcel = parcelCheck.rows[0];

    // [XREL-01] IDOR cross-relais : un agent_relais ne peut peser que les
    // colis d'une commande de SON relais (même pattern que
    // services/parcel-operations.js:381).
    if (req.user.role === 'agent_relais' && String(parcel.relais_id) !== String(req.user.relais_id)) {
      log.warn(`[IDOR] bloqué — user ${req.user.id} (relais ${req.user.relais_id}) → parcel ${parcel.id} (order relais ${parcel.relais_id})`);
      return res.status(403).json({ error: "Ce colis n'appartient pas à une commande de votre relais" });
    }

    // [S5] Vérifier l'intégrité poids
    const anomaly = checkWeightIntegrity(parcel.last_weight_kg, weight_kg);

    // Mettre à jour le dernier poids
    await db.query(`
      UPDATE parcels
      SET last_weight_kg = $1, last_weight_at = NOW(), last_weight_location = $2, updated_at = NOW()
      WHERE id = $3
    `, [weight_kg, location || null, parcel.id]);

    // Logger le checkpoint
    await logParcelEvent(db, {
      parcel_id: parcel.id,
      event_type: anomaly ? 'anomaly_detected' : 'weight_checked',
      actor_id: req.user.id,
      location,
      weight_kg: parseFloat(weight_kg),
      notes: anomaly ? anomaly.message : `Poids vérifié: ${weight_kg}kg`,
      metadata: anomaly ? { anomaly, previous: parcel.last_weight_kg } : { previous: parcel.last_weight_kg },
    });

    res.json({
      parcel_id: parcel.id,
      external_code: parcel.external_code,
      weight_kg: parseFloat(weight_kg),
      previous_weight_kg: parcel.last_weight_kg ? parseFloat(parcel.last_weight_kg) : null,
      anomaly: anomaly || null,
      status: anomaly ? 'warning' : 'ok',
    });
  } catch(e) { next(e); }
});

// [S7] POST /api/parcels/:id/verify-seal — Vérifier le scellé
router.post('/:id/verify-seal', ...adminAgentRelais, async (req, res, next) => {
  try {
    const { seal_code: providedSeal } = req.body;
    if (!providedSeal) return res.status(400).json({ error: 'seal_code requis' });

    const parcelCheck = await db.query(
      `SELECT p.id, p.seal_code, p.external_code, o.relais_id
       FROM parcels p LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const parcel = parcelCheck.rows[0];

    // [XREL-02] IDOR cross-relais : même garde que /:id/weight.
    if (req.user.role === 'agent_relais' && String(parcel.relais_id) !== String(req.user.relais_id)) {
      log.warn(`[IDOR] bloqué — user ${req.user.id} (relais ${req.user.relais_id}) → parcel ${parcel.id} (order relais ${parcel.relais_id})`);
      return res.status(403).json({ error: "Ce colis n'appartient pas à une commande de votre relais" });
    }

    // [XREL-02] Rate-limit — le scellé est un oracle : limiter les tentatives.
    const limit = await checkSealVerifyLimit(parcel.id, req);
    if (limit.exceeded) {
      return res.status(429).json({ error: 'Trop de tentatives de vérification', retryAfter: limit.retryAfter });
    }

    const result = verifySeal(parcel.seal_code, providedSeal);

    // Logger la vérification
    await logParcelEvent(db, {
      parcel_id: parcel.id,
      event_type: result.valid ? 'seal_verified' : 'anomaly_detected',
      actor_id: req.user.id,
      notes: result.valid ? 'Scellé vérifié OK' : `Scellé invalide: ${result.reason}`,
      metadata: { valid: result.valid, reason: result.reason || null },
    });

    if (!result.valid) {
      return res.status(422).json({
        parcel_id: parcel.id,
        external_code: parcel.external_code,
        seal_valid: false,
        reason: result.reason,
        message: result.reason === 'seal_mismatch'
          ? '⚠️ ALERTE: Le scellé ne correspond pas — possible ouverture/substitution'
          : '⚠️ Scellé manquant',
      });
    }

    res.json({
      parcel_id: parcel.id,
      external_code: parcel.external_code,
      seal_valid: true,
      message: '✅ Scellé vérifié — intégrité confirmée',
    });
  } catch(e) { next(e); }
});

// POST /api/parcels/:id/items
router.post('/:id/items', ...adminAgent, validate({ body: parcels.addItem }), async (req, res, next) => {
  try {
    const { order_item_id, quantity } = req.body;
    const parcelCheck = await db.query('SELECT id, order_id FROM parcels WHERE id = $1', [req.params.id]);
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const itemCheck = await db.query('SELECT id FROM order_items WHERE id = $1', [order_item_id]);
    if (!itemCheck.rows.length) return res.status(404).json({ error: 'Article de commande introuvable' });

    const { rows } = await db.query(`
      INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.id, order_item_id, quantity]);

    res.status(201).json(rows[0]);
  } catch(e) {
    if (e.code === '23505' && e.constraint === 'unique_order_item_per_parcel') {
      return res.status(409).json({ error: 'Cet article est déjà assigné à un colis' });
    }
    next(e);
  }
});

// DELETE /api/parcels/:id/items/:item_id
router.delete('/:id/items/:item_id', ...adminAgent, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM parcel_items WHERE parcel_id = $1 AND id = $2 RETURNING *',
      [req.params.id, req.params.item_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Article de colis introuvable' });
    res.json({ message: 'Article retiré du colis', deleted: rows[0] });
  } catch(e) { next(e); }
});

// POST /api/parcels/optimize — DÉMANTELÉ (doctrine DOUANE_DECLARATION_PIVOT, 2026-06-25)
// Moteur de bin-packing retiré. Le droit douanier est non-déterministe et se
// joue sur la facture déclarée, pas sur le calage physique du colis.
router.post('/optimize', ...adminAgent, (req, res) => {
  res.status(410).json({
    error: 'Endpoint retiré',
    reason: 'Moteur de bin-packing démantelé (doctrine DOUANE_DECLARATION_PIVOT). ' +
            'Le colisage est une décision de déclaration, pas un algorithme.',
  });
});

// POST /api/parcels/bootstrap/:orderId — DÉMANTELÉ (doctrine DOUANE_DECLARATION_PIVOT, 2026-06-25)
router.post('/bootstrap/:orderId', ...adminAgent, (req, res) => {
  res.status(410).json({
    error: 'Endpoint retiré',
    reason: 'Moteur de bin-packing démantelé (doctrine DOUANE_DECLARATION_PIVOT). ' +
            'Le colisage est une décision de déclaration, pas un algorithme.',
  });
});



module.exports = router;
