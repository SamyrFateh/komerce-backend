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
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    const { rows: [sup] } = await client.query(
      'SELECT id, name FROM suppliers WHERE id = $1 AND deleted_at IS NULL', [id]
    );
    if (!sup) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fournisseur non trouvé' });
    }

    const isTestSupplier = sup.name.includes('[TEST]');
    const forceDelete    = req.headers['x-force-delete'] === 'true';

    const { rows: confirmedPOs } = await client.query(
      `SELECT id FROM purchase_orders WHERE supplier_id = $1 AND status = 'confirmed' LIMIT 1`,
      [id]
    );
    if (confirmedPOs.length && !(isTestSupplier && forceDelete)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Impossible de supprimer ce fournisseur : des commandes confirmées existent. Annulez-les d\'abord.',
      });
    }

    const posQuery = (isTestSupplier && forceDelete)
      ? `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE supplier_id = $1 AND status != 'cancelled'`
      : `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE supplier_id = $1 AND status IN ('pending', 'notified')`;
    const { rowCount: posCancelled } = await client.query(posQuery, [id]);

    const { rowCount: mappingsDeleted } = await client.query(
      'UPDATE product_suppliers SET deleted_at = NOW() WHERE supplier_id = $1 AND deleted_at IS NULL', [id]
    );

    await client.query('UPDATE suppliers SET deleted_at = NOW() WHERE id = $1', [id]);
    await client.query('COMMIT');

    log.info(`[PURCHASING] Fournisseur désactivé (soft-delete) : ${sup.name} (${id}) — ${mappingsDeleted} mapping(s), ${posCancelled} PO(s) annulée(s)`);
    res.json({ deleted: true, id, name: sup.name, mappings_deleted: mappingsDeleted, pos_cancelled: posCancelled });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── GET /api/purchasing/order/:order_id/completeness [v8.2] ─────────────────

router.get('/order/:order_id/completeness', ...guard, async (req, res, next) => {
  const { order_id } = req.params;
  try {
    // [B1] po.qty | [B2] po.hub_received_at | [B3] UUID → pas parseInt | [B4] JOIN via product_suppliers
    const result = await db.query(
      `SELECT
         po.id,
         p.name                                        AS product_name,
         po.qty,
         po.received_qty,
         po.status,
         (po.received_qty >= po.qty)                   AS is_complete,
         (po.qty - po.received_qty)                    AS qty_missing,
         s.name                                        AS supplier_name,
         po.hub_received_at
       FROM purchase_orders po
       JOIN product_suppliers ps ON ps.id = po.product_supplier_id
       JOIN products p ON p.id = ps.product_id
       LEFT JOIN suppliers s ON s.id = ps.supplier_id
       WHERE po.order_id = $1
         AND po.status != 'cancelled'
       ORDER BY po.id`,
      [order_id]
    );

    const items       = result.rows;
    const total       = items.length;
    const recus       = items.filter(i => i.is_complete).length;
    const is_complete = recus === total && total > 0;

    res.json({
      order_id,
      is_complete,
      items_received:   recus,
      items_total:      total,
      items_missing:    total - recus,
      pct_received:     total > 0 ? Math.round(100 * recus / total) : 0,
      items
    });

  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   COMMANDES PAR ORDER_ID — déclaré après /suppliers pour éviter conflit Express
// ═══════════════════════════════════════════════════════════════════════════════

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
    const {
      purchase_order_id,
      supplier_order_id,
      unit_price_aed,
      tracking_url,
      tracking_number,
      notes,
    } = req.body;

    if (!purchase_order_id) {
      return res.status(400).json({ error: 'purchase_order_id obligatoire' });
    }

    // A-BE-14 : vérifier le statut courant avant UPDATE
    const { rows: [currentPo] } = await db.query(
      'SELECT id, status FROM purchase_orders WHERE id = $1 AND order_id = $2',
      [purchase_order_id, req.params.order_id]
    );
    if (!currentPo) return res.status(404).json({ error: 'Purchase order introuvable' });

    const CONFIRMABLE_STATUSES = ['pending', 'notified'];
    if (!CONFIRMABLE_STATUSES.includes(currentPo.status)) {
      return res.status(409).json({
        error: `Impossible de confirmer une PO au statut "${currentPo.status}". Statuts autorisés : pending, notified.`,
        current_status: currentPo.status,
      });
    }

    const { rows: [po] } = await db.query(`
      UPDATE purchase_orders
      SET
        status            = 'confirmed',
        supplier_order_id = COALESCE($1, supplier_order_id),
        unit_price_aed    = COALESCE($2, unit_price_aed),
        tracking_url      = COALESCE($3, tracking_url),
        tracking_number   = COALESCE($4, tracking_number),
        notes             = COALESCE($5, notes),
        ordered_at        = COALESCE(ordered_at, NOW()),
        confirmed_at      = NOW(),
        updated_at        = NOW()
      WHERE id = $6 AND order_id = $7
      RETURNING *
    `, [supplier_order_id, unit_price_aed, tracking_url, tracking_number, notes, purchase_order_id, req.params.order_id]);

    if (!po) return res.status(404).json({ error: 'Purchase order introuvable' });

    const { rows: [sup] } = await db.query('SELECT name FROM suppliers WHERE id = $1', [po.supplier_id]);
    if (sup) {
      await db.query(
        'UPDATE orders SET supplier_name = $1, supplier_invoice_url = COALESCE($2, supplier_invoice_url), updated_at = NOW() WHERE id = $3',
        [sup.name, tracking_url || null, req.params.order_id]
      );
    }

    res.json({ success: true, purchase_order: po });
  } catch(err) { next(err); }
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
    const { po_id } = req.params;
    const forceDelete = req.headers['x-force-delete'] === 'true';

    const { rows: [po] } = await db.query(
      'SELECT * FROM purchase_orders WHERE id = $1', [po_id]
    );
    if (!po) return res.status(404).json({ error: 'Purchase order introuvable' });

    // A-BE-13 : bloquer l'annulation sur tous les statuts de réception
    const TERMINAL_RECEIVED = ['received', 'partially_received', 'hub_received'];
    if (TERMINAL_RECEIVED.includes(po.status) && !forceDelete) {
      return res.status(409).json({
        error: `Impossible d'annuler une PO au statut "${po.status}". Utilisez x-force-delete si l'annulation est intentionnelle.`,
        current_status: po.status,
      });
    }

    await db.query(
      `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [po_id]
    );

    log.info(`[PURCHASING] PO annulée : ${po_id} (était: ${po.status})`);
    res.json({ cancelled: true, po_id, previous_status: po.status });

  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   EXPORTS — façade publique inchangée (compatibilité payments.js, pickup-secret.js)
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;
module.exports.triggerPurchasing = triggerPurchasing;
