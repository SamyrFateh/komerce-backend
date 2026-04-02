/**
 * KOMERCE — Purchasing Service v1.0
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
 *   GET  /api/purchasing                    → pipeline sourcing en cours
 *   GET  /api/purchasing/:order_id          → achats liés à une commande
 *   POST /api/purchasing/:order_id/confirm  → confirmer manuellement un achat
 *   POST /api/purchasing/:order_id/receive  → marquer reçu au Hub Dubai
 *   GET  /api/purchasing/suppliers          → liste fournisseurs actifs
 *   POST /api/purchasing/suppliers          → créer un fournisseur
 *   POST /api/purchasing/suppliers/:id/map  → mapper un produit → fournisseur
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS } = require('../utils/sms');

const guard = [authenticate, requireRole(['admin'])];

// ─── Numéro WhatsApp admin (notifications manuelles) ──────────────────────────
const ADMIN_WA = process.env.ADMIN_WHATSAPP || process.env.WA_ADMIN || '33699272526';
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
        AND ps.is_active = TRUE
        AND s.is_active  = TRUE
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
// Actuellement : stub qui retourne toujours success: false → fallback manuel
// En Phase 2 : implémenter Noon API, Amazon SP-API, AliExpress Open Platform

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

// Noon UAE — stub Phase 2
async function noonOrder(ps, item) {
  // TODO Phase 2 : implémenter Noon Seller API
  // https://sell.noon.com/api/
  console.log('[PURCHASING] Noon API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'Noon API non implémentée (Phase 2)' };
}

// Amazon UAE — stub Phase 2
async function amazonOrder(ps, item) {
  // TODO Phase 2 : implémenter Amazon SP-API
  // https://developer-docs.amazon.com/sp-api/
  console.log('[PURCHASING] Amazon UAE API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'Amazon SP-API non implémentée (Phase 2)' };
}

// AliExpress — stub Phase 2
async function aliexpressOrder(ps, item) {
  // TODO Phase 2 : implémenter AliExpress Open Platform
  console.log('[PURCHASING] AliExpress API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'AliExpress API non implémentée (Phase 2)' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//   ROUTES HTTP — Dashboard admin
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/purchasing — pipeline sourcing en cours ────────────────────────

router.get('/', ...guard, async (req, res) => {
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
  } catch (err) {
    console.error('Purchasing list error:', err.message);
    res.status(500).json({ error: 'Erreur pipeline sourcing' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   GESTION FOURNISSEURS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/purchasing/suppliers ───────────────────────────────────────────

router.get('/suppliers', ...guard, async (req, res) => {
  try {
    const { platform, active } = req.query;
    const conditions = ['1=1'];
    const params     = [];

    if (platform) { conditions.push(`platform = $${params.length + 1}`); params.push(platform); }
    if (active !== undefined) { conditions.push(`is_active = $${params.length + 1}`); params.push(active === 'true'); }

    const { rows } = await db.query(`
      SELECT
        s.*,
        COUNT(DISTINCT ps.product_id) AS products_mapped,
        COUNT(DISTINCT po.id)         AS purchase_orders_total
      FROM suppliers s
      LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.is_active = TRUE
      LEFT JOIN purchase_orders   po ON po.supplier_id = s.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.id
      ORDER BY s.name
    `, params);

    // Masquer les clés API en réponse
    const safe = rows.map(({ api_key_enc, api_secret_enc, ...s }) => ({
      ...s,
      has_api_key: !!api_key_enc,
    }));

    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Erreur liste fournisseurs' });
  }
});

// ─── POST /api/purchasing/suppliers — créer un fournisseur ───────────────────

router.post('/suppliers', ...guard, async (req, res) => {
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
  } catch (err) {
    console.error('Create supplier error:', err.message);
    res.status(500).json({ error: 'Erreur création fournisseur' });
  }
});

// ─── POST /api/purchasing/suppliers/:id/map — mapper produit → fournisseur ───

router.post('/suppliers/:id/map', ...guard, async (req, res) => {
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
  } catch (err) {
    console.error('Map supplier error:', err.message);
    res.status(500).json({ error: 'Erreur mapping fournisseur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   COMMANDES PAR ORDER_ID — déclaré après /suppliers pour éviter conflit Express
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/purchasing/:order_id — achats d'une commande ───────────────────

router.get('/:order_id', ...guard, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT po.*, s.name AS supplier_name, s.platform, s.contact_phone, s.auto_order
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.order_id = $1
      ORDER BY po.created_at ASC
    `, [req.params.order_id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur achats commande' });
  }
});

// ─── POST /api/purchasing/:order_id/confirm ───────────────────────────────────
// Admin confirme manuellement qu'il a passé la commande chez le fournisseur

router.post('/:order_id/confirm', ...guard, async (req, res) => {
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

    // Mettre à jour supplier_name sur la commande parent pour traçabilité
    // (toujours — pas de condition sur unit_price_aed)
    const { rows: [sup] } = await db.query('SELECT name FROM suppliers WHERE id = $1', [po.supplier_id]);
    if (sup) {
      await db.query(
        'UPDATE orders SET supplier_name = $1, supplier_invoice_url = COALESCE($2, supplier_invoice_url), updated_at = NOW() WHERE id = $3',
        [sup.name, tracking_url || null, req.params.order_id]
      );
    }

    res.json({ success: true, purchase_order: po });
  } catch (err) {
    console.error('Confirm purchase error:', err.message);
    res.status(500).json({ error: 'Erreur confirmation achat' });
  }
});

// ─── POST /api/purchasing/:order_id/receive ───────────────────────────────────
// Agent Hub confirme réception de la marchandise — déclenche le SCAN 3 (preparation)

router.post('/:order_id/receive', ...guard, async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { purchase_order_id, quality_ok = true, quality_notes } = req.body;

    if (!purchase_order_id) {
      return res.status(400).json({ error: 'purchase_order_id obligatoire' });
    }

    // Marquer reçu au Hub
    const { rows: [po] } = await client.query(`
      UPDATE purchase_orders
      SET status = 'hub_received', hub_received_at = NOW(),
          quality_ok = $1, quality_notes = $2, updated_at = NOW()
      WHERE id = $3 AND order_id = $4
      RETURNING *
    `, [quality_ok, quality_notes || null, purchase_order_id, req.params.order_id]);

    if (!po) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase order introuvable' });
    }

    // Si qualité OK → passer la commande client à 'preparation' (SCAN 3)
    let scan3_triggered = false;
    if (quality_ok) {
      // Vérifier que toutes les purchase_orders de cette commande sont hub_received
      const { rows: pending } = await client.query(`
        SELECT id FROM purchase_orders
        WHERE order_id = $1 AND status NOT IN ('hub_received', 'cancelled')
      `, [req.params.order_id]);

      if (pending.length === 0) {
        scan3_triggered = true;
        // Tous les articles sont arrivés → SCAN 3
        await client.query(`
          UPDATE orders
          SET status = 'preparation', preparation_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status IN ('ordered', 'purchasing')
        `, [req.params.order_id]);

        await client.query(`
          INSERT INTO order_status_history (order_id, status, note, changed_by)
          VALUES ($1, 'preparation', 'Tous articles reçus au Hub — SCAN 3 auto', $2)
        `, [req.params.order_id, req.user.id]);

        // SMS client
        const { rows: [order] } = await client.query(
          'SELECT reference, (SELECT phone FROM users WHERE id = orders.user_id) AS phone FROM orders WHERE id = $1',
          [req.params.order_id]
        );
        if (order?.phone) {
          sendSMS(
            order.phone,
            `Komerce : Commande ${order.reference} — colis reçu au Hub Dubai, contrôle qualité en cours.`,
            'preparation', req.params.order_id
          ).catch(console.error);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, purchase_order: po, scan3_triggered });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Receive purchase error:', err.message);
    res.status(500).json({ error: 'Erreur réception Hub' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   GESTION FOURNISSEURS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── DELETE /api/purchasing/suppliers/:id — supprimer un fournisseur ──────────

router.delete('/suppliers/:id', ...guard, async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Vérifier que le fournisseur existe
    const { rows: [sup] } = await client.query(
      'SELECT id, name FROM suppliers WHERE id = $1', [id]
    );
    if (!sup) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Fournisseur non trouvé' });
    }

    // Bloquer si des PO confirmed existent — traçabilité comptable
    const { rows: confirmedPOs } = await client.query(
      `SELECT id FROM purchase_orders WHERE supplier_id = $1 AND status = 'confirmed' LIMIT 1`,
      [id]
    );
    if (confirmedPOs.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Impossible de supprimer ce fournisseur : des commandes confirmées existent. Annulez-les d\'abord.',
      });
    }

    // Supprimer les purchase_orders liées (seulement celles [TEST] — statut notified/pending)
    const { rowCount: posDeleted } = await client.query(`
      DELETE FROM purchase_orders
      WHERE supplier_id = $1
        AND status IN ('pending', 'notified')
    `, [id]);

    // Supprimer les mappings produit→fournisseur liés
    const { rowCount: mappingsDeleted } = await client.query(
      'DELETE FROM product_suppliers WHERE supplier_id = $1', [id]
    );

    // Supprimer le fournisseur
    await client.query('DELETE FROM suppliers WHERE id = $1', [id]);

    await client.query('COMMIT');

    console.log(`[PURCHASING] Fournisseur supprimé : ${sup.name} (${id}) — ${mappingsDeleted} mapping(s), ${posDeleted} PO(s) supprimé(s)`);
    res.json({ deleted: true, id, name: sup.name, mappings_deleted: mappingsDeleted, pos_deleted: posDeleted });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete supplier error:', err.message);
    res.status(500).json({ error: 'Erreur suppression fournisseur' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//   EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;
module.exports.triggerPurchasing = triggerPurchasing;
