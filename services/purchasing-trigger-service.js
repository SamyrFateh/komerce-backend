/**
 * @komerce-arch
 * @role          purchasing-trigger-service
 * @domain        purchasing
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/notification-service.js, services/suppliers/supplier-order-identity.js, utils/logger.js
 * @used-by       routes/cash.js, routes/purchasing.js
 * @db-read       order_items, orders, product_skus, product_suppliers, products, purchase_orders, relais, suppliers
 * @db-write      alerts, purchase_orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { notifyText } = require('../services/notification-service');
const { createAlert } = require('../utils/alerts');
const { blockedSupplierIdentity, normalizeIdentity } = require('./suppliers/supplier-order-identity');
const log = require('../utils/logger').child({ module: 'purchasing-trigger' });

const ADMIN_WA = process.env.ADMIN_WHATSAPP || process.env.WA_ADMIN;
if (!ADMIN_WA) log.warn('⚠️ ADMIN_WHATSAPP env var not configured — WhatsApp notifications disabled');

async function notifyAdminNoSupplier(order, item) {
  const msg = [
    '⚠️ KOMERCE — Sourcing requis',
    `Commande : ${order.reference}`,
    `Produit : ${item.product_name} (x${item.quantity})`,
    `Catégorie : ${item.category}`,
    '',
    'Aucun fournisseur mappé pour ce produit.',
    '→ Sourcer manuellement et mapper via /api/purchasing/suppliers/:id/map',
  ].join('\n');
  if (process.env.ADMIN_PHONE) {
    notifyText(process.env.ADMIN_PHONE, msg, 'sourcing_alert', order.id).catch(err => log.error({ err }, 'Notification sourcing_alert failed'));
  }
  log.warn('[PURCHASING] Aucun fournisseur pour produit:', item.product_name, '— commande:', order.reference);
}

async function notifyAdminManual(order, item, ps) {
  const totalAed = (ps.supplier_price_aed * item.quantity).toFixed(2);
  const msg = [
    '🛒 KOMERCE — À commander',
    `Commande client : ${order.reference}`,
    `Produit : ${item.product_name} (x${item.quantity})`,
    `Fournisseur : ${ps.supplier_name} (${ps.platform})`,
    `SKU : ${ps.supplier_sku}`,
    `Prix unitaire : ${ps.supplier_price_aed} AED`,
    `Total : ${totalAed} AED`,
    ps.supplier_url ? `Lien : ${ps.supplier_url}` : '',
    '',
    '→ Confirmer sur le dashboard ou via :',
    `POST /api/purchasing/${order.id}/confirm`,
  ].filter(Boolean).join('\n');
  if (process.env.ADMIN_PHONE) {
    notifyText(process.env.ADMIN_PHONE, msg, 'purchase_manual', order.id).catch(err => log.error({ err }, 'Notification purchase_manual failed'));
  }
  log.info('[PURCHASING] Notification admin — commande manuelle:', order.reference, ps.supplier_name);
}

async function notifySupplierWhatsApp(client, ps, order, item, purchaseOrderId) {
  const totalAed = (ps.supplier_price_aed * item.quantity).toFixed(2);
  const msg = encodeURIComponent([
    `Bonjour ${ps.supplier_name},`, '', 'Je souhaite commander :',
    `- ${item.product_name} (x${item.quantity})`, `- Ref : ${ps.supplier_sku}`,
    `- Total : ${totalAed} AED`, '', `Référence commande Komerce : ${order.reference}`,
    'Livraison au Hub Dubai.', 'Merci de confirmer la disponibilité.',
  ].join('\n'));
  const waUrl = `https://wa.me/${ps.contact_phone}?text=${msg}`;
  log.info('[PURCHASING] WhatsApp fournisseur:', waUrl);
  await client.query('UPDATE purchase_orders SET notes = $1, updated_at = NOW() WHERE id = $2', [`wa_url:${waUrl}`, purchaseOrderId]);
}

async function callSupplierAPI(ps, item) {
  switch (ps.platform) {
    case 'noon': return noonOrder(ps, item);
    case 'amazon_uae': return amazonOrder(ps, item);
    case 'aliexpress': return aliexpressOrder(ps, item);
    default: return { success: false, error: 'Plateforme sans API — mode manuel' };
  }
}
async function noonOrder(ps) { log.info('[PURCHASING] Noon API — stub (Phase 2):', ps.supplier_sku); return { success: false, error: 'Noon API non implémentée (Phase 2)' }; }
async function amazonOrder(ps) { log.info('[PURCHASING] Amazon UAE API — stub (Phase 2):', ps.supplier_sku); return { success: false, error: 'Amazon SP-API non implémentée (Phase 2)' }; }
async function aliexpressOrder(ps) { log.info('[PURCHASING] AliExpress API — stub (Phase 2):', ps.supplier_sku); return { success: false, error: 'AliExpress API non implémentée (Phase 2)' }; }

async function loadExactSoldSku(client, item) {
  if (!item.sku_id) return null;
  const { rows: [sku] } = await client.query(`
    SELECT id, product_id, supplier_sku, supplier_unit_ref, supplier_order_identity
    FROM product_skus WHERE id = $1 AND product_id = $2 LIMIT 1
  `, [item.sku_id, item.product_id]);
  if (!sku) throw blockedSupplierIdentity('product_sku vendu introuvable', { product_sku_id: item.sku_id, product_id: item.product_id });
  const supplierSku = String(sku.supplier_sku || '').trim();
  if (!supplierSku) throw blockedSupplierIdentity('supplier_sku absent sur le product_sku vendu', { product_sku_id: sku.id });
  const supplierUnitRef = String(sku.supplier_unit_ref || '').trim() || null;
  const identity = normalizeIdentity(sku.supplier_order_identity, supplierUnitRef);
  return { ...sku, supplier_sku: supplierSku, supplier_unit_ref: supplierUnitRef, supplier_order_identity: identity };
}

async function loadSupplierMapping(client, item, exactSku) {
  const params = [item.product_id];
  let providerClause = '';
  if (exactSku) {
    params.push(exactSku.supplier_order_identity.provider);
    providerClause = 'AND lower(s.platform) = lower($2)';
  }
  const { rows: [ps] } = await client.query(`
    SELECT ps.*, s.name AS supplier_name, s.platform, s.auto_order, s.contact_phone,
           s.account_id, s.api_key_enc, s.api_secret_enc, s.lead_time_days
    FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
    WHERE ps.product_id = $1 AND ps.is_active = TRUE AND s.is_active = TRUE
      AND ps.deleted_at IS NULL AND s.deleted_at IS NULL ${providerClause}
    ORDER BY ps.priority ASC LIMIT 1
  `, params);
  return ps || null;
}

async function findExistingPo(client, orderId, item, productSupplierId) {
  if (item.id) {
    const { rows: [existingPo] } = await client.query(`
      SELECT id, status FROM purchase_orders
      WHERE product_supplier_id = $1 AND status != 'cancelled'
        AND (order_item_id = $2 OR (order_item_id IS NULL AND order_id = $3))
      ORDER BY CASE WHEN order_item_id = $2 THEN 0 ELSE 1 END, created_at ASC LIMIT 1
    `, [productSupplierId, item.id, orderId]);
    return existingPo || null;
  }
  const { rows: [existingPo] } = await client.query(`
    SELECT id, status FROM purchase_orders
    WHERE order_id = $1 AND product_supplier_id = $2 AND status != 'cancelled'
    ORDER BY created_at ASC LIMIT 1
  `, [orderId, productSupplierId]);
  return existingPo || null;
}

async function alertItemFailure(client, orderId, item, savepointIdx, itemErr) {
  await client.query(`ROLLBACK TO SAVEPOINT po_item_${savepointIdx}`).catch(() => {});
  log.error(`[PURCHASING] Erreur création PO pour ${item.product_name}:`, itemErr.message);
  try {
    await client.query(`SAVEPOINT po_item_${savepointIdx}_alert`);
    await createAlert(client, {
      type: 'purchasing_po_creation_failed', entityType: 'order', entityId: orderId, severity: 'medium',
      title: `PO creation failed — order ${orderId} product ${item.product_name}`,
      description: `product_id=${item.product_id} sku_id=${item.sku_id || 'none'} error=${itemErr.message}`,
    });
    await client.query(`RELEASE SAVEPOINT po_item_${savepointIdx}_alert`);
  } catch (alertErr) {
    await client.query(`ROLLBACK TO SAVEPOINT po_item_${savepointIdx}_alert`).catch(() => {});
    log.error(`[PURCHASING] alert insert failed for ${item.product_name}:`, alertErr.message);
  }
}

async function triggerPurchasing(orderId) {
  const results = [];
  const { rows: [order] } = await db.query(`SELECT o.*, r.name AS relais_name FROM orders o LEFT JOIN relais r ON r.id = o.relais_id WHERE o.id = $1`, [orderId]);
  if (!order) throw new Error(`Commande introuvable : ${orderId}`);
  const { rows: items } = await db.query(`
    SELECT oi.*, p.name AS product_name, p.category, p.price_aed
    FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1
  `, [orderId]);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      await client.query(`SAVEPOINT po_item_${idx}`);

      if (item.fulfillment_source === 'LOCAL_STOCK') {
        results.push({ item: item.product_name, status: 'local_stock_no_purchase', purchase_order_id: null });
        await client.query(`RELEASE SAVEPOINT po_item_${idx}`);
        continue;
      }

      let exactSku = null;
      try {
        exactSku = await loadExactSoldSku(client, item);
      } catch (itemErr) {
        await alertItemFailure(client, orderId, item, idx, itemErr);
        results.push({ item: item.product_name, status: 'error', error: itemErr.message });
        continue;
      }

      const ps = await loadSupplierMapping(client, item, exactSku);
      try {
        if (!ps) {
          await notifyAdminNoSupplier(order, item);
          results.push({ item: item.product_name, status: 'no_supplier', purchase_order_id: null });
          await client.query(`RELEASE SAVEPOINT po_item_${idx}`);
          continue;
        }
        const existingPo = await findExistingPo(client, orderId, item, ps.id);
        if (existingPo) {
          results.push({ item: item.product_name, status: 'already_exists', purchase_order_id: existingPo.id, purchase_order_status: existingPo.status });
          await client.query(`RELEASE SAVEPOINT po_item_${idx}`);
          continue;
        }

        const triggerMode = ps.auto_order ? 'auto' : (ps.platform === 'whatsapp' ? 'whatsapp' : 'manual');
        const purchaseTarget = exactSku ? { ...ps, supplier_sku: exactSku.supplier_sku } : ps;
        const { rows: [po] } = await client.query(`
          INSERT INTO purchase_orders
            (order_id, order_item_id, supplier_id, product_supplier_id, product_sku_id,
             supplier_sku, supplier_unit_ref, supplier_order_identity, qty, unit_price_aed, status, trigger_mode)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'pending',$11) RETURNING *
        `, [orderId, item.id || null, ps.supplier_id, ps.id, exactSku?.id || null,
          purchaseTarget.supplier_sku, exactSku?.supplier_unit_ref || null,
          exactSku?.supplier_order_identity ? JSON.stringify(exactSku.supplier_order_identity) : null,
          item.quantity, ps.supplier_price_aed, triggerMode]);

        if (ps.auto_order) {
          const apiResult = await callSupplierAPI(purchaseTarget, item);
          if (apiResult.success) {
            await client.query(`UPDATE purchase_orders SET status='confirmed', supplier_order_id=$1, tracking_url=$2, ordered_at=NOW(), updated_at=NOW() WHERE id=$3`, [apiResult.supplier_order_id, apiResult.tracking_url || null, po.id]);
            results.push({ item: item.product_name, status: 'auto_ordered', purchase_order_id: po.id, supplier_order_id: apiResult.supplier_order_id });
          } else {
            await notifyAdminManual(order, item, purchaseTarget);
            await client.query(`UPDATE purchase_orders SET status='notified', trigger_mode='manual', updated_at=NOW() WHERE id=$1`, [po.id]);
            results.push({ item: item.product_name, status: 'api_failed_notified', purchase_order_id: po.id });
          }
        } else if (ps.platform === 'whatsapp') {
          await notifySupplierWhatsApp(client, purchaseTarget, order, item, po.id);
          await client.query(`UPDATE purchase_orders SET status='notified', ordered_at=NOW(), updated_at=NOW() WHERE id=$1`, [po.id]);
          results.push({ item: item.product_name, status: 'whatsapp_sent', purchase_order_id: po.id });
        } else {
          await notifyAdminManual(order, item, purchaseTarget);
          await client.query(`UPDATE purchase_orders SET status='notified', updated_at=NOW() WHERE id=$1`, [po.id]);
          results.push({ item: item.product_name, status: 'admin_notified', purchase_order_id: po.id });
        }
        await client.query(`RELEASE SAVEPOINT po_item_${idx}`);
      } catch (itemErr) {
        await alertItemFailure(client, orderId, item, idx, itemErr);
        results.push({ item: item.product_name, status: 'error', error: itemErr.message });
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
  if (createdPOs.length > 0) log.info(`[PURCHASING] Commande ${orderId} — ${createdPOs.length} POs créés (order stays 'ordered')`);
  return { purchase_orders: results };
}

module.exports = { triggerPurchasing };
