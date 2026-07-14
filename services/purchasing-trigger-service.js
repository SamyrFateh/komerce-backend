/**
 * @komerce-arch
 * @role          purchasing-trigger-service
 * @domain        purchasing
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/notification-service.js, utils/logger.js
 * @used-by       routes/cash.js, routes/purchasing.js
 * @db-read       order_items, orders, product_suppliers, products, purchase_orders, relais, suppliers
 * @db-write      alerts, purchase_orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Purchasing Trigger Service
 *
 * Moteur de déclenchement des purchase orders, extrait de routes/purchasing.js (A-BE-05).
 * Appelé en fire-and-forget depuis payments.js, pickup-secret.js,
 * repair-ordered-without-purchase-orders.js — JAMAIS awaité dans une transaction active.
 *
 * Exports publics (façade stable) :
 *   triggerPurchasing(orderId) → Promise<{ purchase_orders: Array }>
 */

const db  = require('../db');
const { notifyText } = require('../services/notification-service'); // ZG-1: remplace sendSMS
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'purchasing-trigger' });

// ─── Numéro WhatsApp admin (notifications manuelles) ──────────────────────────
const ADMIN_WA = process.env.ADMIN_WHATSAPP || process.env.WA_ADMIN;
if (!ADMIN_WA) log.warn('⚠️ ADMIN_WHATSAPP env var not configured — WhatsApp notifications disabled');

// ═══════════════════════════════════════════════════════════════════════════════
//   NOTIFICATION HELPERS (privés — non exportés)
// ═══════════════════════════════════════════════════════════════════════════════

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

  if (process.env.ADMIN_PHONE) {
    notifyText(process.env.ADMIN_PHONE, msg, 'sourcing_alert', order.id).catch(err => log.error({ err }, 'Notification sourcing_alert failed'));
  }
  log.warn('[PURCHASING] Aucun fournisseur pour produit:', item.product_name, '— commande:', order.reference);
}

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
    notifyText(process.env.ADMIN_PHONE, msg, 'purchase_manual', order.id).catch(err => log.error({ err }, 'Notification purchase_manual failed'));
  }
  log.info('[PURCHASING] Notification admin — commande manuelle:', order.reference, ps.supplier_name);
}

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
  log.info('[PURCHASING] WhatsApp fournisseur:', waUrl);

  await db.query(`
    UPDATE purchase_orders SET notes = $1, updated_at = NOW() WHERE id = $2
  `, [`wa_url:${waUrl}`, purchaseOrderId]);
}

// ─── Appel API fournisseur (Phase 2) ─────────────────────────────────────────

async function callSupplierAPI(ps, item, purchaseOrderId) {
  switch (ps.platform) {
    case 'noon':      return await noonOrder(ps, item);
    case 'amazon_uae': return await amazonOrder(ps, item);
    case 'aliexpress': return await aliexpressOrder(ps, item);
    default:          return { success: false, error: 'Plateforme sans API — mode manuel' };
  }
}

async function noonOrder(ps, item) {
  log.info('[PURCHASING] Noon API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'Noon API non implémentée (Phase 2)' };
}

async function amazonOrder(ps, item) {
  log.info('[PURCHASING] Amazon UAE API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'Amazon SP-API non implémentée (Phase 2)' };
}

async function aliexpressOrder(ps, item) {
  log.info('[PURCHASING] AliExpress API — stub (Phase 2):', ps.supplier_sku);
  return { success: false, error: 'AliExpress API non implémentée (Phase 2)' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//   PURCHASING ENGINE
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

  // PATCH P2-7 : savepoint par item — si la création d'une PO échoue,
  // les POs déjà créées restent commitées et une alerte est insérée.
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    for (const item of items) {
      await client.query(`SAVEPOINT po_item_${items.indexOf(item)}`);
      const { rows: [ps] } = await client.query(`
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

      let poSavepointIdx = items.indexOf(item);
      try {
        if (!ps) {
          await notifyAdminNoSupplier(order, item);
          results.push({ item: item.product_name, status: 'no_supplier', purchase_order_id: null });
          await client.query(`RELEASE SAVEPOINT po_item_${poSavepointIdx}`);
          continue;
        }

        // I-SWEEP-3B : idempotence applicative anti-replay.
        const { rows: [existingPo] } = await client.query(`
          SELECT id, status
          FROM purchase_orders
          WHERE order_id = $1
            AND product_supplier_id = $2
            AND status != 'cancelled'
          ORDER BY created_at ASC
          LIMIT 1
        `, [orderId, ps.id]);

        if (existingPo) {
          results.push({
            item: item.product_name,
            status: 'already_exists',
            purchase_order_id: existingPo.id,
            purchase_order_status: existingPo.status,
          });
          continue;
        }

        // Créer la purchase_order
        const triggerMode = ps.auto_order ? 'auto' : (ps.platform === 'whatsapp' ? 'whatsapp' : 'manual');

        const { rows: [po] } = await client.query(`
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
          const apiResult = await callSupplierAPI(ps, item, po.id);
          if (apiResult.success) {
            await client.query(`
              UPDATE purchase_orders
              SET status = 'confirmed', supplier_order_id = $1,
                  tracking_url = $2, ordered_at = NOW(), updated_at = NOW()
              WHERE id = $3
            `, [apiResult.supplier_order_id, apiResult.tracking_url || null, po.id]);
            results.push({ item: item.product_name, status: 'auto_ordered', purchase_order_id: po.id, supplier_order_id: apiResult.supplier_order_id });
          } else {
            await notifyAdminManual(order, item, ps, po.id);
            await client.query(`
              UPDATE purchase_orders SET status = 'notified', trigger_mode = 'manual', updated_at = NOW() WHERE id = $1
            `, [po.id]);
            results.push({ item: item.product_name, status: 'api_failed_notified', purchase_order_id: po.id });
          }
        } else if (ps.platform === 'whatsapp') {
          await notifySupplierWhatsApp(ps, order, item, po.id);
          await client.query(`
            UPDATE purchase_orders SET status = 'notified', ordered_at = NOW(), updated_at = NOW() WHERE id = $1
          `, [po.id]);
          results.push({ item: item.product_name, status: 'whatsapp_sent', purchase_order_id: po.id });
        } else {
          await notifyAdminManual(order, item, ps, po.id);
          await client.query(`
            UPDATE purchase_orders SET status = 'notified', updated_at = NOW() WHERE id = $1
          `, [po.id]);
          results.push({ item: item.product_name, status: 'admin_notified', purchase_order_id: po.id });
        }

        await client.query(`RELEASE SAVEPOINT po_item_${poSavepointIdx}`);

      } catch (itemErr) {
        // PATCH P2-7 : rollback au savepoint de cet item uniquement
        await client.query(`ROLLBACK TO SAVEPOINT po_item_${poSavepointIdx}`).catch(() => {});
        log.error(`[PURCHASING] Erreur création PO pour ${item.product_name}:`, itemErr.message);
        results.push({ item: item.product_name, status: 'error', error: itemErr.message });
        // P0-E : l'alerte vit sous SON PROPRE savepoint, distinct de
        // po_item_${poSavepointIdx} (déjà consommé par le ROLLBACK TO
        // SAVEPOINT ci-dessus). Sans ce second savepoint, un échec de
        // l'INSERT alerts remettait TOUTE la transaction en état "aborted"
        // (preuve RED-2) : les items suivants échouaient en cascade et le
        // COMMIT final devenait un ROLLBACK silencieux (preuve RED-2b),
        // perdant même les PO déjà créées pour les items précédents.
        try {
          await client.query(`SAVEPOINT po_item_${poSavepointIdx}_alert`);
          await createAlert(client, {
            type: 'purchasing_po_creation_failed',
            entityType: 'order',
            entityId: orderId,
            severity: 'medium',
            title: `PO creation failed — order ${orderId} product ${item.product_name}`,
            description: `product_id=${item.product_id} error=${itemErr.message}`,
          });
          await client.query(`RELEASE SAVEPOINT po_item_${poSavepointIdx}_alert`);
        } catch (alertErr) {
          await client.query(`ROLLBACK TO SAVEPOINT po_item_${poSavepointIdx}_alert`).catch(() => {});
          log.error(`[PURCHASING] alert insert failed for ${item.product_name}:`, alertErr.message);
        }
      }
    }

    await client.query('COMMIT');
  } catch (globalErr) {
    await client.query('ROLLBACK').catch(() => {});
    throw globalErr;
  } finally {
    client.release();
  }

  const createdPOs = results.filter(r => r.purchase_order_id != null && r.status !== 'already_exists');
  if (createdPOs.length > 0) {
    log.info(`[PURCHASING] Commande ${orderId} — ${createdPOs.length} POs créés (order stays 'ordered')`);
  }

  return { purchase_orders: results };
}

// ═══════════════════════════════════════════════════════════════════════════════
//   EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { triggerPurchasing };
