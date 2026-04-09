/**
 * KOMERCE — Purchasing Service v8.2
 *
 * Gère le processus semi-automatisé d'achat fournisseur.
 *
 * Déclenché automatiquement quand une commande passe à status = 'ordered'
 * (appelé depuis routes/orders.js après le PATCH /status)
 *
 * Deux modes selon le fournisseur :
 *   auto     → appel API fournisseur (Noon, Amazon UAE...) — Phase 2+
 *   manual   → notification WhatsApp admin avec tous les détails
 *   whatsapp → message WA pré-rempli vers le fournisseur local
 *
 * Routes exposées (admin uniquement) :
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
 *
 * v8.2 — Bugs corrigés :
 *   [B1] quantity → qty          (vraie colonne purchase_orders)
 *   [B2] received_at → hub_received_at  (vraie colonne purchase_orders)
 *   [B3] parseInt(order_id) → supprimé  (order_id est UUID, pas integer)
 *   [B4] JOIN products via product_supplier_id → product_suppliers → products
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS } = require('../utils/sms');

const guard = [authenticate, requireRole(['admin'])];

// ─── Import triggerScan3 depuis scans.js ──────────────────────────────────────
// Déclenche le SCAN 3 (notification SMS hub + client) quand tous les articles
// d'une commande sont reçus au Hub Dubai.
let triggerScan3;
try {
  triggerScan3 = require('./scans').triggerScan3;
} catch (e) {
  console.warn('[purchasing] triggerScan3 non disponible:', e.message);
  triggerScan3 = async () => {};
}

// ─── Numéro WhatsApp admin (notifications manuelles) ──────────────────────────
const ADMIN_WA = process.env.ADMIN_WHATSAPP || process.env.WA_ADMIN;
if (!ADMIN_WA) console.warn('⚠️ ADMIN_WHATSAPP env var not configured — WhatsApp notifications disabled');
const WA_API   = 'https://api.whatsapp.com/send';

// ═══════════════════════════════════════════════════════════════════════════════
//   PURCHASING ENGINE — appelé depuis orders.js (pas une route HTTP)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * triggerPurchasing(orderId)
 *
 * Appelé automatiquement quand order.status → 'ordered'.
 * Pour chaque item de la commande :
 *   1. Trouve le meilleur fournisseur (product_suppliers priority ASC)
 *   2. Crée une purchase_order en base
 *   3. Selon supplier.auto_order :
 *      - true  → tente l'appel API fournisseur
 *      - false → envoie notification WhatsApp à l'admin
 *
 * @param {string} orderId - UUID de la commande
 * @returns {Promise<{ purchase_orders: Array }>}
 */
async function triggerPurchasing(orderId) {
  const results = [];

  // Charger la commande + ses items + le relais
  const { rows: [order] } = await db.query(`
    SELECT o.*, r.name AS relais_name
    FROM orders o
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.id = $1
  `, [orderId]);

  if (!order) throw new Error(`Commande introuvable : ${orderId}`);

  const { rows: items } = await db.query(`
    SELECT oi.*, p.name AS product_name, p.category, p.price_aed
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
  `, [orderId]);

  for (const item of items) {
    // Chercher le meilleur fournisseur actif pour ce produit
    const { rows: [ps] } = await db.query(`
      SELECT ps.*, s.name AS supplier_name, s.platform,
             s.auto_order, s.contact_phone, s.account_id,
             s.api_key_enc, s.api_secret_enc, s.lead_time_days
      FROM product_suppliers ps
      JOIN suppliers s ON s.id = ps.supplier_id
      WHERE ps.product_id = $1
        AND ps.is_active   = TRUE
        AND s.is_active    = TRUE
        AND ps.deleted_at  IS NULL
        AND s.deleted_at   IS NULL
      ORDER BY ps.priority ASC
      LIMIT 1
    `, [item.product_id]);

    if (!ps) {
      // Aucun fournisseur mappé — notifier admin pour sourcing manuel
      await notifyAdminNoSupplier(order, item);
      results.push({ item: item.product_name, status: 'no_supplier', purchase_order_id: null });
      continue;
    }

    // Créer la purchase_order
    const triggerMode = ps.auto_order ? 'auto' : (ps.platform === 'whatsapp' ? 'whatsapp' : 'manual');

    const { rows: [po] } = await db.query(`
      INSERT INTO purchase_orders
        (order_id, supplier_id, product_supplier_id, supplier_sku,
         qty, unit_price_aed, status, trigger_mode)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
      RETURNING *
    `, [
      orderId,
      ps.supplier_id,
      ps.id,
      ps.supplier_sku,
      item.quantity,
      ps.supplier_price_aed,
      triggerMode,
    ]);

    if (ps.auto_order) {
      // Mode AUTO — appel API fournisseur
      const apiResult = await callSupplierAPI(ps, item, po.id);
      if (apiResult.success) {
        await db.query(`
          UPDATE purchase_orders
          SET status = 'confirmed', supplier_order_id = $1,
              tracking_url = $2, ordered_at = NOW(), updated_at = NOW()
          WHERE id = $3
        `, [apiResult.supplier_order_id, apiResult.tracking_url || null, po.id]);

        results.push({ item: item.product_name, status: 'auto_ordered', purchase_order_id: po.id, supplier_order_id: apiResult.supplier_order_id });
      } else {
        // Échec API → fallback notification manuelle
        await notifyAdminManual(order, item, ps, po.id);
        await db.query(`
          UPDATE purchase_orders SET status = 'notified', trigger_mode = 'manual', updated_at = NOW() WHERE id = $1
        `, [po.id]);
        results.push({ item: item.product_name, status: 'api_failed_notified', purchase_order_id: po.id });
      }
    } else if (ps.platform === 'whatsapp') {
      // Mode WHATSAPP — message pré-rempli vers le fournisseur local
      await notifySupplierWhatsApp(ps, order, item, po.id);
      await db.query(`
        UPDATE purchase_orders SET status = 'notified', ordered_at = NOW(), updated_at = NOW() WHERE id = $1
      `, [po.id]);
      results.push({ item: item.product_name, status: 'whatsapp_sent', purchase_order_id: po.id });
    } else {
      // Mode MANUAL — notification admin dashboard
      await notifyAdminManual(order, item, ps, po.id);
      await db.query(`
        UPDATE purchase_orders SET status = 'notified', updated_at = NOW() WHERE id = $1
      `, [po.id]);
      results.push({ item: item.product_name, status: 'admin_notified', purchase_order_id: po.id });
    }
  }

  // Phase 5.1: purchasing state tracked in purchase_orders, not orders.status
  // Order stays 'ordered' until full reception → 'preparation'
  const createdPOs = results.filter(r => r.purchase_order_id != null);
  if (createdPOs.length > 0) {
    console.log(`[PURCHASING] Commande ${orderId} — ${createdPOs.length} POs créés (order stays 'ordered')`);
  }

  return { purchase_orders: results };
}

// ─── Notification admin — aucun fournisseur mappé ────────────────────────────

async function notifyAdminNoSupplier(order, item) {
  const msg = [
    `⚠️ KOMERCE — Sourcing requis`,
    `Commande : ${order.reference}`,
    `Produit : ${item.product_name} (x${item.quantity})`,
    `Catégorie : ${item.category}`,
    ``,
    `Aucun fournisseur mappé pour ce produit.`,
    `→ Sourcer manuellement et mapper via /api/purchasing/suppliers/:id/map`,
  ].join('\n');

  // SMS admin
  if (process.env.ADMIN_PHONE) {
    sendSMS(process.env.ADMIN_PHONE, msg, 'sourcing_alert', order.id).catch(console.error);
  }
  console.warn('[PURCHASING] Aucun fournisseur pour produit:', item.product_name, '— commande:', order.reference);
}

// ─── Notification admin — commande manuelle à passer ─────────────────────────

async function notifyAdminManual(order, item, ps, purchaseOrderId) {
  const totalAed = (ps.supplier_price_aed * item.quantity).toFixed(2);
  const msg = [
    `🛒 KOMERCE — À commander`,
    `Commande client : ${order.reference}`,
    `Produit : ${item.product_name} (x${item.quantity})`,
    `Fournisseur : ${ps.supplier_name} (${ps.platform})`,
    `SKU : ${ps.supplier_sku}`,
    `Prix unitaire : ${ps.supplier_price_aed} AED`,
    `Total : ${totalAed} AED`,
    ps.supplier_url ? `Lien : ${ps.supplier_url}` : '',
    ``,
    `→ Confirmer sur le dashboard ou via :`,
    `POST /api/purchasing/${order.id}/confirm`,
  ].filter(Boolean).join('\n');

  if (process.env.ADMIN_PHONE) {
    sendSMS(process.env.ADMIN_PHONE, msg, 'purchase_manual', order.id).catch(console.error);
  }
  console.log('[PURCHASING] Notification admin — commande manuelle:', order.reference, ps.supplier_name);
}

// ─── Notification WhatsApp fournisseur local ──────────────────────────────────

async function notifySupplierWhatsApp(ps, order, item, purchaseOrderId) {
  const totalAed = (ps.supplier_price_aed * item.quantity).toFixed(2);
  const msg = encodeURIComponent([
    `Bonjour ${ps.supplier_name},`,
    ``,
    `Je souhaite commander :`,
    `- ${item.product_name} (x${item.quantity})`,
    `- Ref : ${ps.supplier_sku}`,
    `- Total : ${totalAed} AED`,
    ``,
    `Référence commande Komerce : ${order.reference}`,
    `Livraison au Hub Dubai.`,
    `Merci de confirmer la disponibilité.`,
  ].join('\n'));

  const waUrl = `https://wa.me/${ps.contact_phone}?text=${msg}`;
  console.log('[PURCHASING] WhatsApp fournisseur:', waUrl);

  // Stocker l'URL pour que l'admin puisse l'ouvrir depuis le dashboard
  await db.query(`
    UPDATE purchase_orders SET notes = $1, updated_at = NOW() WHERE id = $2
  `, [`wa_url:${waUrl}`, purchaseOrderId]);
}

// ─── Appel API fournisseur (Phase 2) ─────────────────────────────────────────

async function callSupplierAPI(ps, item, purchaseOrderId) {
  switch (ps.platform) {
    case 'noon':
      return await noonOrder(ps, item);
    case 'amazon_uae':
      return await amazonOrder(ps, item);
    case 'aliexpress':
      return await aliexpressOrder(ps, item);
    default:
      return { success: false, error: 'Plateforme sans API — mode manuel' };
  }
}

async function noonOrder(ps, item) {
  console.log('[PURCHASING] Noon API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'Noon API non implémentée (Phase 2)' };
}

async function amazonOrder(ps, item) {
  console.log('[PURCHASING] Amazon UAE API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'Amazon SP-API non implémentée (Phase 2)' };
}

async function aliexpressOrder(ps, item) {
  console.log('[PURCHASING] AliExpress API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'AliExpress API non implémentée (Phase 2)' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//   ROUTES HTTP — Dashboard admin
// ═══════════════════════════════════════════════════════════════════════════════

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

    console.log(`[PURCHASING] Fournisseur désactivé (soft-delete) : ${sup.name} (${id}) — ${mappingsDeleted} mapping(s), ${posCancelled} PO(s) annulée(s)`);
    res.json({ deleted: true, id, name: sup.name, mappings_deleted: mappingsDeleted, pos_cancelled: posCancelled });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── GET /api/purchasing/order/:order_id/completeness [v8.2] ─────────────────
// État de réception d'une commande — combien de POs reçues vs total

router.get('/order/:order_id/completeness', ...guard, async (req, res, next) => {
  const { order_id } = req.params;
  try {
    // [B1] po.qty (pas po.quantity)
    // [B2] po.hub_received_at (pas po.received_at)
    // [B3] order_id est UUID → pas de parseInt
    // [B4] JOIN via product_suppliers (purchase_orders n'a pas product_id)
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

// ─── GET /api/purchasing/:order_id — achats d'une commande ───────────────────

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
// Agent Hub confirme réception de la marchandise (partielle ou totale)
// Déclenche le SCAN 3 (preparation) quand tous les articles sont reçus
//
// Body : { qty_recue?: number }
// Si qty_recue absent → reçoit tout le reste commandé

router.post('/:id/receive', ...guard, async (req, res, next) => {
  const { id } = req.params;
  // qty_recue : quantité reçue maintenant. Défaut = totalité commandée.
  const qty_recue = req.body.qty_recue !== undefined && req.body.qty_recue !== null && req.body.qty_recue !== ''
    ? parseInt(req.body.qty_recue)
    : null;
  if (qty_recue !== null && (isNaN(qty_recue) || qty_recue < 0)) {
    return res.status(400).json({ error: 'qty_recue invalide' });
  }

  try {
    // 1. Récupérer le PO actuel
    // [B1] qty (pas quantity) | [B2] hub_received_at (pas received_at)
    const poRes = await db.query(
      `SELECT id, order_id, qty, received_qty, status, hub_received_at
       FROM purchase_orders
       WHERE id = $1`,
      [id]
    );
    if (!poRes.rows.length) {
      return res.status(404).json({ error: 'PO introuvable' });
    }
    const po = poRes.rows[0];

    // Quantité à incrémenter : celle fournie, sinon le reste non reçu
    // [B1] po.qty (pas po.quantity)
    const delta = qty_recue !== null
      ? Math.min(qty_recue, po.qty - po.received_qty)
      : po.qty - po.received_qty;

    if (delta <= 0) {
      return res.status(400).json({ error: 'Quantité déjà reçue en totalité' });
    }

    const new_received = po.received_qty + delta;
    // [B1] po.qty (pas po.quantity)
    const po_complete  = new_received >= po.qty;

    // 2. Mettre à jour ce PO
    // [B2] hub_received_at (pas received_at)
    const updatedPo = await db.query(
      `UPDATE purchase_orders
       SET received_qty     = $1,
           status           = $2,
           hub_received_at  = CASE WHEN $3 THEN NOW() ELSE hub_received_at END,
           updated_at       = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        new_received,
        po_complete ? 'received' : 'partially_received',
        po_complete,   // hub_received_at seulement quand complet
        id
      ]
    );

    // 3. Vérifier si TOUS les POs de la commande sont reçus
    // [B1] qty (pas quantity) dans SUM et dans CASE
    const completenessRes = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'cancelled')                             AS total,
         COUNT(*) FILTER (WHERE received_qty >= qty AND status != 'cancelled')     AS recus,
         SUM(qty)          FILTER (WHERE status != 'cancelled')                    AS qty_totale,
         SUM(received_qty) FILTER (WHERE status != 'cancelled')                    AS qty_recue
       FROM purchase_orders
       WHERE order_id = $1`,
      [po.order_id]
    );

    const { total, recus, qty_totale, qty_recue: qty_recue_total } = completenessRes.rows[0];
    const order_complete = parseInt(recus) === parseInt(total);

    // 4. Mettre à jour le statut de la commande
    if (order_complete) {
      // Tous les articles sont là → preparation + SMS
      await db.query(
        `UPDATE orders SET status = 'preparation', preparation_at = NOW()
         WHERE id = $1`,
        [po.order_id]
      );

      // Déclencher SCAN 3 (notification SMS hub + client)
      try {
        await triggerScan3(po.order_id, req.user?.id || null);
      } catch (smsErr) {
        // Ne pas bloquer la réception si le SMS échoue — logguer seulement
        console.error('[purchasing/receive] Erreur SMS SCAN3:', smsErr.message);
      }

    } else {
      // Phase 5.1: partial reception tracked in purchase_orders, order stays 'ordered'
      console.log(`[PURCHASING] Réception partielle commande ${po.order_id} — ${recus}/${total} articles`);
    }

    // 5. Construire la réponse opérateur
    const items_missing = parseInt(total) - parseInt(recus);

    res.json({
      success:          true,
      po_status:        updatedPo.rows[0].status,
      order_id:         po.order_id,
      order_status:     order_complete ? 'preparation' : 'ordered',
      ready_to_prepare: order_complete,
      items_received:   parseInt(recus),
      items_total:      parseInt(total),
      items_missing,
      qty_totale:       parseInt(qty_totale),
      qty_recue:        parseInt(qty_recue_total),
      message: order_complete
        ? `✅ Commande complète — ${total}/${total} articles — Prête à préparer`
        : `📦 Réception partielle — ${recus}/${total} articles — ${items_missing} manquant(s)`
    });

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

    if (po.status === 'hub_received' && !forceDelete) {
      return res.status(409).json({
        error: 'Impossible d\'annuler une PO déjà reçue au Hub.',
      });
    }

    await db.query(
      `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [po_id]
    );

    console.log(`[PURCHASING] PO annulée : ${po_id} (était: ${po.status})`);
    res.json({ cancelled: true, po_id, previous_status: po.status });

  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;
module.exports.triggerPurchasing = triggerPurchasing;
