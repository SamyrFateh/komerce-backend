/**
 * @komerce-arch
 * @role          purchasing
 * @domain        unknown
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — Purchasing Routes v8.2
 *
 * Routes HTTP admin uniquement — logique métier déléguée aux services :
 *   • triggerPurchasing   → services/purchasing-trigger-service.js
 *   • processReceive      → services/purchasing-receive-service.js
 *
 * module.exports.triggerPurchasing est ré-exporté pour la compatibilité
 * avec payments.js, pickup-secret.js, repair-ordered-without-purchase-orders.js.
 *
 * Routes exposées :
 *   GET  /api/purchasing                              → pipeline sourcing en cours
 *   GET  /api/purchasing/suppliers                    → liste fournisseurs actifs
 *   POST /api/purchasing/suppliers                    → créer un fournisseur
 *   POST /api/purchasing/suppliers/:id/map            → mapper un produit → fournisseur
 *   DELETE /api/purchasing/suppliers/:id              → supprimer un fournisseur
 *   GET  /api/purchasing/order/:order_id/completeness → état de réception d'une commande [v8.2]
 *   GET  /api/purchasing/:order_id                    → achats liés à une commande
 *   POST /api/purchasing/:order_id/confirm            → confirmer manuellement un achat
 *   POST /api/purchasing/:id/receive                  → marquer reçu au Hub Dubai [v8.2]
 *   DELETE /api/purchasing/po/:po_id                  → annuler une purchase order
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'purchasing' });

const { triggerPurchasing } = require('../services/purchasing-trigger-service');
const { processReceive }    = require('../services/purchasing-receive-service');
const { deleteSupplier, confirmPurchaseOrder, cancelPurchaseOrder } = require('../services/purchasing-admin-service');

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/purchasing — pipeline sourcing en cours ────────────────────────

router.get('/', ...guard, async (req, res, next) => {
  try {
    const { status } = req.query;
    const conditions = ['1=1'];
    const params     = [];
    if (status) { conditions.push(`po.status = $${params.length + 1}`); params.push(status); }

    const { rows } = await db.query(`
      SELECT
        po.*,
        o.reference AS order_ref,
        o.status    AS order_status,
        s.name      AS supplier_name,
        s.platform,
        s.auto_order,
        s.contact_phone
      FROM purchase_orders po
      JOIN orders    o ON o.id  = po.order_id
      JOIN suppliers s ON s.id  = po.supplier_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY po.created_at DESC
      LIMIT 100
    `, params);

    res.json({ purchase_orders: rows, total: rows.length });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   GESTION FOURNISSEURS — déclarées avant /:order_id pour éviter conflit Express
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/purchasing/suppliers ───────────────────────────────────────────

router.get('/suppliers', ...guard, async (req, res, next) => {
  try {
    const { platform, active } = req.query;
    const conditions = ['1=1'];
    const params     = [];

    if (platform) { conditions.push(`platform = $${params.length + 1}`); params.push(platform); }
    if (active !== undefined) { conditions.push(`is_active = $${params.length + 1}`); params.push(active === 'true'); }
    conditions.push('s.deleted_at IS NULL');

    const { rows } = await db.query(`
      SELECT
        s.*,
        COUNT(DISTINCT ps.product_id) AS products_mapped,
        COUNT(DISTINCT po.id)         AS purchase_orders_total
      FROM suppliers s
      LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.is_active = TRUE AND ps.deleted_at IS NULL
      LEFT JOIN purchase_orders   po ON po.supplier_id = s.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.id
      ORDER BY s.name
    `, params);

    const safe = rows.map(({ api_key_enc, api_secret_enc, ...s }) => ({
      ...s,
      has_api_key: !!api_key_enc,
    }));

    res.json(safe);
  } catch(err) { next(err); }
});

// ─── POST /api/purchasing/suppliers — créer un fournisseur ───────────────────

router.post('/suppliers', ...guard, async (req, res, next) => {
  try {
    const {
      name, platform, contact_name, contact_phone, contact_email,
      api_key_enc, api_secret_enc, account_id,
      auto_order = false, lead_time_days = 2, notes,
    } = req.body;

    if (!name || !platform) {
      return res.status(400).json({ error: 'name et platform obligatoires' });
    }

    const { rows: [supplier] } = await db.query(`
      INSERT INTO suppliers
        (name, platform, contact_name, contact_phone, contact_email,
         api_key_enc, api_secret_enc, account_id,
         auto_order, lead_time_days, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, name, platform, auto_order, lead_time_days, is_active, created_at
    `, [name, platform, contact_name, contact_phone, contact_email,
        api_key_enc, api_secret_enc, account_id,
        auto_order, lead_time_days, notes]);

    res.status(201).json(supplier);
  } catch(err) { next(err); }
});

// ─── POST /api/purchasing/suppliers/:id/map — mapper produit → fournisseur ───

router.post('/suppliers/:id/map', ...guard, async (req, res, next) => {
  try {
    const {
      product_id,
      supplier_sku,
      supplier_url,
      supplier_price_aed,
      min_order_qty = 1,
      priority = 1,
      notes,
    } = req.body;

    if (!product_id || !supplier_sku || !supplier_price_aed) {
      return res.status(400).json({ error: 'product_id, supplier_sku et supplier_price_aed obligatoires' });
    }

    const { rows: [mapping] } = await db.query(`
      INSERT INTO product_suppliers
        (product_id, supplier_id, supplier_sku, supplier_url,
         supplier_price_aed, min_order_qty, priority, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (product_id, supplier_id) DO UPDATE SET
        supplier_sku       = EXCLUDED.supplier_sku,
        supplier_url       = EXCLUDED.supplier_url,
        supplier_price_aed = EXCLUDED.supplier_price_aed,
        min_order_qty      = EXCLUDED.min_order_qty,
        priority           = EXCLUDED.priority,
        notes              = EXCLUDED.notes,
        is_active          = TRUE,
        updated_at         = NOW()
      RETURNING *
    `, [product_id, req.params.id, supplier_sku, supplier_url,
        supplier_price_aed, min_order_qty, priority, notes]);

    res.status(201).json(mapping);
  } catch(err) { next(err); }
});

// ─── DELETE /api/purchasing/suppliers/:id — supprimer un fournisseur ──────────

router.delete('/suppliers/:id', ...guard, async (req, res, next) => {
  try {
    const forceDelete = req.headers['x-force-delete'] === 'true';
    const result = await deleteSupplier(req.params.id, forceDelete);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   COMMANDES PAR ORDER_ID — déclaré après /suppliers pour éviter conflit Express
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/purchasing/order/:order_id/completeness [v8.2] ─────────────────

router.get('/order/:order_id/completeness', ...guard, async (req, res, next) => {
  try {
    const { order_id } = req.params;

    const { rows: pos } = await db.query(`
      SELECT
        po.id, po.status, po.supplier_id, po.qty, po.received_qty,
        s.name AS supplier_name,
        COALESCE(po.received_qty, 0)                     AS received,
        COALESCE(po.qty, 0)                              AS ordered,
        COALESCE(po.qty, 0) - COALESCE(po.received_qty, 0) AS remaining
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.order_id = $1
      ORDER BY po.created_at ASC
    `, [order_id]);

    if (!pos.length) {
      return res.status(404).json({ error: 'Aucune purchase order pour cette commande' });
    }

    const totalOrdered  = pos.reduce((s, p) => s + (p.ordered  || 0), 0);
    const totalReceived = pos.reduce((s, p) => s + (p.received || 0), 0);
    const allReceived   = pos.every(p => p.status === 'hub_received' || p.status === 'cancelled');
    const anyPending    = pos.some(p => ['pending', 'notified', 'confirmed', 'shipped'].includes(p.status));

    res.json({
      order_id,
      complete:        allReceived,
      any_pending:     anyPending,
      total_ordered:   totalOrdered,
      total_received:  totalReceived,
      total_remaining: totalOrdered - totalReceived,
      purchase_orders: pos,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/purchasing/:order_id ───────────────────────────────────────────

router.get('/:order_id', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT po.*, s.name AS supplier_name, s.platform, s.contact_phone, s.auto_order
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.order_id = $1
      ORDER BY po.created_at ASC
    `, [req.params.order_id]);

    res.json(rows);
  } catch(err) { next(err); }
});

// ─── POST /api/purchasing/:order_id/confirm ───────────────────────────────────

router.post('/:order_id/confirm', ...guard, async (req, res, next) => {
  try {
    if (!req.body.purchase_order_id) {
      return res.status(400).json({ error: 'purchase_order_id obligatoire' });
    }
    const result = await confirmPurchaseOrder(
      req.body.purchase_order_id,
      req.params.order_id,
      req.body
    );
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, current_status: err.current_status });
    next(err);
  }
});

// ─── POST /api/purchasing/:id/receive [v8.2] ─────────────────────────────────
// Délègue à services/purchasing-receive-service.js

router.post('/:id/receive', ...guard, async (req, res, next) => {
  const { id } = req.params;
  const qty_recue = req.body.qty_recue !== undefined && req.body.qty_recue !== null && req.body.qty_recue !== ''
    ? parseInt(req.body.qty_recue)
    : null;
  if (qty_recue !== null && (isNaN(qty_recue) || qty_recue < 0)) {
    return res.status(400).json({ error: 'qty_recue invalide' });
  }

  try {
    const result = await processReceive({ id, qty_recue, actor: req.user });
    if (result.httpError) {
      return res.status(result.httpError.status).json({ error: result.httpError.error });
    }
    res.json(result);
  } catch(err) { next(err); }
});

// ─── DELETE /api/purchasing/po/:po_id — annuler une purchase order ────────────

router.delete('/po/:po_id', ...guard, async (req, res, next) => {
  try {
    const forceDelete = req.headers['x-force-delete'] === 'true';
    const result = await cancelPurchaseOrder(req.params.po_id, forceDelete);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, current_status: err.current_status });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   EXPORTS — façade publique inchangée (compatibilité payments.js, pickup-secret.js)
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;
module.exports.triggerPurchasing = triggerPurchasing;
