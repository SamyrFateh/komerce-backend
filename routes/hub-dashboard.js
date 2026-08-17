/**
 * @komerce-arch
 * @role          dashboard-hub-dashboard
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, parcel_items, parcels, products
 * @db-write      order_comments, order_incidents, parcels
 * @db-write-via:parcel-item-mutation-service parcel_items
 * @db-write-via:scan-write-service scans
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Hub Dashboard API v1.0
 * Centre de contrôle opérateur hub (Dubai)
 *
 * GET  /dashboard       — KPIs temps réel
 * GET  /queue           — File de travail priorisée
 * GET  /orders/:id      — Détail complet commande + colis + paiement + client
 * GET  /validate/:id    — Validations anti-erreur avant action
 * POST /orders/:id/start-prep   — Démarrer préparation
 * POST /orders/:id/create-parcel — Créer colis (complet ou partiel)
 * POST /parcels/:id/add-item    — Ajouter article au colis
 * POST /parcels/:id/remove-item — Retirer article du colis
 * POST /parcels/:id/ready       — Marquer colis prêt
 * POST /parcels/:id/ship        — Expédier colis + transport
 * POST /orders/:id/incident     — Signaler incident
 * POST /orders/:id/escalate     — Escalader admin
 * POST /orders/:id/comment      — Commentaire terrain
 * POST /orders/:id/backorder    — Marquer en attente fournisseur
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { safeSyncScanToParcels } = require('../utils/parcelSync');
const { generateParcelRef } = require('../utils/reference');
const { transitionOrderStatus } = require('../services/order-status-machine');
const { recordHubPreparationScan } = require('../services/scan-write-service');
const {
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
} = require('../services/parcel-item-mutation-service');
const log = require('../utils/logger').child({ module: 'hub-dashboard' });
const hubQueries = require('../services/hub-dashboard-queries');

const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];

// ── DDL géré par migrations/075_hub_shares_collective_schema.sql ────────────

// ── GET /dashboard — KPIs Hub (défensif) ────────────────────────────────────
router.get('/dashboard', ...hubAuth, async (req, res, next) => {
  try {
    const data = await hubQueries.getDashboardKPIs();
    res.json(data);
  } catch(e) { next(e); }
});

// ── GET /queue — File de travail priorisée ──────────────────────────────────
router.get('/queue', ...hubAuth, async (req, res, next) => {
  try {
    const data = await hubQueries.getQueue(req.query);
    res.json(data);
  } catch(e) { next(e); }
});

// ── GET /orders/:id — Détail complet ────────────────────────────────────────
router.get('/orders/:id', ...hubAuth, async (req, res, next) => {
  try {
    const data = await hubQueries.getOrderDetail(req.params.id);
    if (!data) return res.status(404).json({ error: 'Commande introuvable' });
    res.json(data);
  } catch(e) { next(e); }
});

// ── GET /validate/:id — Validations anti-erreur ────────────────────────────
router.get('/validate/:id', ...hubAuth, async (req, res, next) => {
  try {
    const data = await hubQueries.getValidation(req.params.id);
    if (!data) return res.status(404).json({ error: 'Commande introuvable' });
    res.json(data);
  } catch(e) { next(e); }
});

// ── POST /orders/:id/start-prep — Démarrer préparation ─────────────────────
router.post('/orders/:id/start-prep', ...hubAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT id, status, reference FROM orders WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = rows[0];

    if (!['confirmed', 'ordered'].includes(order.status)) {
      return res.status(400).json({
        error: `Impossible de préparer — statut actuel: ${order.status}`,
        hint: 'La commande doit être confirmée ou commandée'
      });
    }

    // Transition via state machine
    const _prepResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'preparation',
      actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
      source: 'hub_start_prep',
    });
    if (!_prepResult.success) {
      log.warn(`[HUB] transitionOrderStatus failed for ${order.id}: ${_prepResult.error}`);
    }

    // Log scan
    // R7 FIX — scan_code NOT NULL : générer un code synthétique pour les scans hub automatiques
    const scanCodePrep = `HUB-PREP-${order.id.slice(0, 8).toUpperCase()}`;
    await recordHubPreparationScan(db, {
      orderId: order.id,
      scannedBy: req.user.id,
      notes: `Pr\u00e9paration d\u00e9marr\u00e9e par ${req.user.full_name || 'hub'}`,
      scanCode: scanCodePrep,
    });

    // Log comment
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', 'Préparation démarrée')
    `, [order.id, req.user.id]);

    res.json({ message: `Commande ${order.reference} en préparation`, status: 'preparation' });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/create-parcel — Créer colis ───────────────────────────
router.post('/orders/:id/create-parcel', ...hubAuth, async (req, res, next) => {
  try {
    const { type = 'standard', notes, item_ids } = req.body;
    const { rows } = await db.query('SELECT id, reference FROM orders WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = rows[0];

    const reference = await generateParcelRef(db);

    // Generate security codes if available
    let external_code = null, seal_code = null;
    try {
      const security = require('../services/parcel-security');
      external_code = security.generateExternalCode();
      seal_code = security.generateSealCode();
    } catch(e) { /* security module not critical */ }

    const insertQ = external_code
      ? `INSERT INTO parcels (reference, external_code, seal_code, order_id, type, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft') RETURNING *`
      : `INSERT INTO parcels (reference, order_id, type, notes, status)
         VALUES ($1, $2, $3, $4, 'draft') RETURNING *`;

    const insertParams = external_code
      ? [reference, external_code, seal_code, order.id, type, notes || null]
      : [reference, order.id, type, notes || null];

    const { rows: [parcel] } = await db.query(insertQ, insertParams);

    // Auto-assign items if provided
    if (item_ids && item_ids.length) {
      for (const itemId of item_ids) {
        await assignWholeOrderItemToParcel(db, {
          parcelId: parcel.id,
          orderItemId: itemId,
          orderId: order.id,
        }).catch(() => {});
      }
    }

    // Log
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `Colis ${reference} créé (${type})`]);

    res.status(201).json({
      message: `Colis ${reference} créé`,
      parcel,
      items_assigned: item_ids ? item_ids.length : 0
    });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/auto-prepare — Auto-split + assign articles (R2 compliant) ──
// Crée automatiquement un colis et assigne tous les articles non-assignés.
// Déclenché sur premier scan QR d'une commande. L'opérateur ne décide rien.
router.post('/orders/:id/auto-prepare', ...hubAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock la commande
    const { rows: [order] } = await client.query(
      `SELECT id, reference, status FROM orders WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Commande introuvable' }); }

    if (!['confirmed', 'ordered', 'preparation'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Auto-prepare impossible — statut: ${order.status}`,
        hint: 'La commande doit être confirmée, commandée ou en préparation'
      });
    }

    // Articles non encore assignés à un colis actif
    const { rows: unassigned } = await client.query(`
      SELECT oi.id, oi.quantity, oi.product_id, p.name AS product_name, p.weight_kg
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM parcel_items pi
          JOIN parcels pa ON pa.id = pi.parcel_id AND pa.status != 'cancelled'
          WHERE pi.order_item_id = oi.id
        )
      ORDER BY oi.created_at ASC
    `, [order.id]);

    if (unassigned.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        message: 'Tous les articles sont déjà assignés à un colis',
        already_complete: true
      });
    }

    // Passer en preparation si besoin
    if (['confirmed', 'ordered'].includes(order.status)) {
      await transitionOrderStatus({
        orderId: order.id,
        newStatus: 'preparation',
        actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
        source: 'hub_auto_prepare',
        dbClient: client,
      });
    }

    // Créer un colis unique pour tous les articles non-assignés
    const reference = await generateParcelRef(client);

    let external_code = null, seal_code = null;
    try {
      const security = require('../services/parcel-security');
      external_code = security.generateExternalCode();
      seal_code = security.generateSealCode();
    } catch(e) { /* non-critique */ }

    const insertQ = external_code
      ? `INSERT INTO parcels (reference, external_code, seal_code, order_id, type, status, notes)
         VALUES ($1, $2, $3, $4, 'standard', 'draft', $5) RETURNING *`
      : `INSERT INTO parcels (reference, order_id, type, status, notes)
         VALUES ($1, $2, 'standard', 'draft', $3) RETURNING *`;

    const insertParams = external_code
      ? [reference, external_code, seal_code, order.id, `Auto-créé sur scan QR — ${unassigned.length} article(s)`]
      : [reference, order.id, `Auto-créé sur scan QR — ${unassigned.length} article(s)`];

    const { rows: [parcel] } = await client.query(insertQ, insertParams);

    // Assigner tous les articles non-assignés
    for (const item of unassigned) {
      await assignParcelItem(client, {
        parcelId: parcel.id,
        orderItemId: item.id,
        productId: item.product_id,
        quantity: item.quantity,
      });
    }

    const totalWeight = unassigned.reduce((s, i) => s + ((i.weight_kg || 0.5) * i.quantity), 0);
    await client.query(
      'UPDATE parcels SET weight_kg = $1 WHERE id = $2',
      [Math.round(totalWeight * 100) / 100, parcel.id]
    );

    // Log scan + commentaire
    // R7 FIX — scan_code NOT NULL : code synthétique pour scans hub automatiques
    try {
      await client.query('SAVEPOINT sp_scans_auto_prepare');
      const scanCodeAuto = `HUB-AUTO-${order.id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      await recordHubPreparationScan(client, {
        orderId: order.id,
        scannedBy: req.user.id,
        notes: `Auto-prepare: colis ${reference} cr\u00e9\u00e9, ${unassigned.length} article(s) assign\u00e9(s)`,
        scanCode: scanCodeAuto,
      });
      await client.query('RELEASE SAVEPOINT sp_scans_auto_prepare');
    } catch(e) {
      // scans table peut varier — sans SAVEPOINT, cette erreur aborte le
      // client et l'INSERT order_comments suivant échoue (auto-prepare
      // annulé silencieusement au COMMIT, RED-2/RED-2b).
      await client.query('ROLLBACK TO SAVEPOINT sp_scans_auto_prepare').catch(() => {});
      log.warn('[HUB] scan auto-prepare skipped:', e.message);
    }

    await client.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `📦 Auto-prepare: colis ${reference} créé (${unassigned.length} article(s))`]);

    await client.query('COMMIT');

    // Fetch colis complet post-commit
    const { rows: [fullParcel] } = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel.id]);

    res.status(201).json({
      message: `Colis ${reference} créé automatiquement — ${unassigned.length} article(s) assigné(s)`,
      parcel: fullParcel,
      items_assigned: unassigned.length,
      items: unassigned.map(i => ({ id: i.id, product_name: i.product_name, quantity: i.quantity })),
      next_action: 'ready', // l'opérateur n'a plus qu'à marquer prêt
    });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// ── POST /parcels/:id/add-item — Ajouter article ───────────────────────────
router.post('/parcels/:id/add-item', ...hubAuth, async (req, res, next) => {
  try {
    const { order_item_id, quantity } = req.body;
    if (!order_item_id) return res.status(400).json({ error: 'order_item_id requis' });

    const { rows: [parcel] } = await db.query(
      'SELECT id, order_id, reference FROM parcels WHERE id = $1', [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });

    // Verify item belongs to same order
    const { rows: [item] } = await db.query(
      'SELECT id, quantity, product_id FROM order_items WHERE id = $1 AND order_id = $2',
      [order_item_id, parcel.order_id]
    );
    if (!item) return res.status(400).json({ error: "Article n'appartient pas à cette commande" });

    const qty = quantity || item.quantity;

    const pi = await addParcelItem(db, {
      parcelId: parcel.id,
      orderItemId: order_item_id,
      productId: item.product_id,
      quantity: qty,
    });

    res.json({
      message: 'Article ajout\u00e9',
      item: pi || { already_assigned: true }
    });
  } catch(e) { next(e); }
});

// ── POST /parcels/:id/remove-item — Retirer article ────────────────────────
router.post('/parcels/:id/remove-item', ...hubAuth, async (req, res, next) => {
  try {
    const { order_item_id } = req.body;
    if (!order_item_id) return res.status(400).json({ error: 'order_item_id requis' });

    const deleted = await removeParcelItem(db, {
      parcelId: req.params.id,
      orderItemId: order_item_id,
    });

    if (!deleted) {
      return res.status(404).json({
        error: 'Article non trouv\u00e9 dans ce colis'
      });
    }

    res.json({
      message: 'Article retir\u00e9',
      deleted
    });
  } catch(e) { next(e); }
});

// ── POST /parcels/:id/ready — Marquer prêt ─────────────────────────────────
router.post('/parcels/:id/ready', ...hubAuth, async (req, res, next) => {
  try {
    const { rows: [parcel] } = await db.query(
      "SELECT id, order_id, reference, status FROM parcels WHERE id = $1",
      [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });

    // Garde de complétude : TOUS les articles de la commande doivent être
    // dans un colis actif (1 colis = 1 commande). Pas juste "au moins un".
    const { rows: [cov] } = await db.query(`
      SELECT COUNT(oi.id) AS total,
             COUNT(pi.order_item_id) FILTER (WHERE pa.status <> 'cancelled') AS packed
      FROM order_items oi
      LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id
      LEFT JOIN parcels pa ON pa.id = pi.parcel_id
      WHERE oi.order_id = $1
    `, [parcel.order_id]);
    if (parseInt(cov.total) === 0 || parseInt(cov.packed) < parseInt(cov.total)) {
      return res.status(400).json({
        error: 'Colis incomplet',
        hint: `${cov.packed}/${cov.total} article(s) emballé(s) — emballez tout avant de marquer prêt`
      });
    }

    // Une seule voie d'écriture : parcelSync (statut + order history + parcel_event)
    await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'preparation',
      scan_id: null,
      scanned_by: req.user.id,
      notes: `Colis ${parcel.reference} prêt`
    });

    res.json({ message: `Colis ${parcel.reference} prêt`, status: 'preparation' });
  } catch(e) { next(e); }
});

// ── POST /parcels/:id/ship — Expédier ──────────────────────────────────────
router.post('/parcels/:id/ship', ...hubAuth, async (req, res, next) => {
  try {
    const { transport, batch_id, notes } = req.body;

    const { rows: [parcel] } = await db.query(
      "SELECT id, order_id, reference, status FROM parcels WHERE id = $1",
      [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });
    if (parcel.status === 'draft') {
      return res.status(400).json({
        error: 'Colis non préparé',
        hint: 'Marquez le colis prêt avant de l’expédier'
      });
    }

    // Anti-error: check parcel is ready
    const { rows: [itemCheck] } = await db.query(
      'SELECT COUNT(*) AS cnt FROM parcel_items WHERE parcel_id = $1',
      [parcel.id]
    );
    if (parseInt(itemCheck.cnt) === 0) {
      return res.status(400).json({
        error: 'Impossible — colis vide',
        hint: 'Ajoutez des articles et marquez prêt avant expédition'
      });
    }

    // Anti-error: check order payment for non-cash
    const { rows: [order] } = await db.query(
      'SELECT payment_mode, payment_status, reference FROM orders WHERE id = $1',
      [parcel.order_id]
    );
    if (order.payment_status !== 'paid' && order.payment_mode !== 'cash_relais') {
      return res.status(400).json({
        error: `⚠️ Commande ${order.reference} non payée`,
        hint: 'Vérifiez le paiement avant expédition'
      });
    }

    // Sync via parcelSync (handles order status cascade)
    await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'shipped',
      scan_id: null,
      scanned_by: req.user.id,
      notes: notes || `Expédié par hub — transport: ${transport || 'non spécifié'}`
    });

    // Update parcel with transport info
    await db.query(`
      UPDATE parcels SET
        shipped_at = NOW(),
        notes = COALESCE(notes, '') || $1,
        updated_at = NOW()
      WHERE id = $2
    `, [
      `\n[SHIPPED] ${new Date().toISOString()} | transport: ${transport || '-'} | batch: ${batch_id || '-'}`,
      parcel.id
    ]);

    // Log
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [parcel.order_id, req.user.id,
       `Colis ${parcel.reference} expédié — ${transport || 'transport non précisé'}`]);

    res.json({
      message: `Colis ${parcel.reference} expédié ✈️`,
      status: 'shipped',
      transport: transport || null
    });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/incident — Signaler incident ──────────────────────────
router.post('/orders/:id/incident', ...hubAuth, async (req, res, next) => {
  try {
    const { type, description, priority = 'normal' } = req.body;
    if (!type || !description) {
      return res.status(400).json({ error: 'type et description requis' });
    }

    const validTypes = ['retard', 'blocage', 'paiement', 'stock', 'colis_endommage', 'colis_perdu', 'client_absent', 'autre'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Type invalide. Valides: ${validTypes.join(', ')}` });
    }

    const { rows: [order] } = await db.query('SELECT id FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [order.id, type, description, priority, req.user.id]);

    // Auto-comment
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `🚨 Incident ${type}: ${description}`]);

    res.status(201).json({ message: 'Incident signalé', incident });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/escalate — Escalader ──────────────────────────────────
router.post('/orders/:id/escalate', ...hubAuth, async (req, res, next) => {
  try {
    const { reason, priority = 'high' } = req.body;
    if (!reason) return res.status(400).json({ error: 'Raison requise' });

    const { rows: [order] } = await db.query(
      'SELECT id, reference FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Create critical incident
    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, 'autre', $2, 'urgent', $3)
      RETURNING *
    `, [order.id, `[ESCALADE] ${reason}`, req.user.id]);

    // Log comment
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `⚠️ ESCALADE: ${reason}`]);

    res.status(201).json({
      message: `Commande ${order.reference} escaladée`,
      incident,
      priority
    });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/comment — Commentaire terrain ─────────────────────────
router.post('/orders/:id/comment', ...hubAuth, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenu requis' });

    const { rows: [order] } = await db.query('SELECT id FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const { rows: [comment] } = await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
      RETURNING *
    `, [order.id, req.user.id, req.body.content]);

    res.json({ message: 'Commentaire ajouté', comment });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/backorder — Marquer en attente fournisseur ─────────────
router.post('/orders/:id/backorder', ...hubAuth, async (req, res, next) => {
  try {
    const { reason, items_waiting } = req.body;

    const { rows: [order] } = await db.query(
      'SELECT id, reference FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Create incident
    await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, 'stock', $2, 'normal', $3)
    `, [order.id, reason || 'En attente fournisseur', req.user.id]);

    // Log
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id,
       `📦 Backorder: ${reason || 'En attente fournisseur'}${items_waiting ? ` (${items_waiting.length} articles)` : ''}`]);

    res.json({
      message: `Commande ${order.reference} marquée en attente`,
      status: 'backorder'
    });
  } catch(e) { next(e); }
});

module.exports = router;

