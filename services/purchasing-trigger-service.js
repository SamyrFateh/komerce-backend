/**
 * @komerce-arch
 * @role          purchasing-trigger-service
 * @domain        purchasing
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/notification-service.js, services/hub-reference.js, services/purchase-line-snapshot.js, services/supplier-execution-persistence.js, services/suppliers/supplier-order-identity.js, services/suppliers/canonical-unit-purchasing-gate.js, services/suppliers/procurement-execution-boundary.js, services/suppliers/execution-adapter-registry.js, utils/logger.js
 * @used-by       routes/cash.js, routes/purchasing.js
 * @db-read       order_items, orders, product_skus, product_suppliers, products, purchase_lines, suppliers
 * @db-write      alerts, purchase_lines
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md, docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  purchasing, supplier-integration
 */

'use strict';

const db = require('../db');
const { notifyText } = require('../services/notification-service');
const { createAlert } = require('../utils/alerts');
const {
  requireSupplierMoney,
  loadExactSoldSku,
  resolveExactSkuProcurementReadiness,
  buildPurchaseTarget,
  insertOpenPurchaseLine,
  findItemCoverage,
  resolveProcurementHubRef,
} = require('./purchase-line-snapshot');
const log = require('../utils/logger').child({ module: 'purchasing-trigger' });

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
      AND ps.deleted_at IS NULL AND s.deleted_at IS NULL AND s.owner_scope IS NULL ${providerClause}
    ORDER BY ps.priority ASC LIMIT 1
  `, params);
  return ps || null;
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

/**
 * Besoin d'achat (P0-5) : un seul chemin. Chaque article IMPORT payé devient exactement UNE ligne d'achat
 * OUVERTE (sans PO), regroupée ensuite par le Hub. Aucune PO par commande, aucun appel fournisseur,
 * aucune notification d'achat : l'engagement passe par les PO regroupées (préparation → validation → envoi).
 * SKU exact (id vendu) : identité + prix canoniques figés. Sinon : mapping fournisseur manuel (prix éventuellement
 * inconnu, exigé à la confirmation). Rejeu idempotent : un article déjà couvert n'est jamais racheté.
 */
function buildOpenSnapshot(ps, exactSku, canonicalMoney) {
  if (exactSku && canonicalMoney) {
    return { ...buildPurchaseTarget(ps, exactSku, canonicalMoney), productSkuId: exactSku.id };
  }
  let money = null;
  try { money = requireSupplierMoney({ supplier_unit_price: Number(ps.supplier_price_aed), supplier_currency: 'AED' }); } catch { money = null; }
  return {
    purchaseTarget: ps, money, unitPriceAed: money ? money.amount : null,
    supplierUnitRef: null, supplierOrderIdentity: null, productSkuId: null,
  };
}

/**
 * @param {string} orderId
 * @param {object} [options]
 * @param {object} [options.context] Transmis à la readiness du SKU exact (seam de test). Vide par défaut.
 */
async function triggerPurchasing(orderId, options = {}) {
  const readinessContext = options.context || {};
  const results = [];
  const { rows: [order] } = await db.query(`SELECT o.* FROM orders o WHERE o.id = $1`, [orderId]);
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
      let canonicalMoney = null;
      try {
        exactSku = await loadExactSoldSku(client, item);
        canonicalMoney = exactSku ? await resolveExactSkuProcurementReadiness(client, exactSku, item.quantity, readinessContext) : null;
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
        const coverage = await findItemCoverage(client, item);
        if (coverage) {
          results.push({ item: item.product_name, status: 'already_exists', purchase_order_id: coverage.id || null, purchase_order_status: coverage.status || null });
          await client.query(`RELEASE SAVEPOINT po_item_${idx}`);
          continue;
        }
        const snapshot = buildOpenSnapshot(ps, exactSku, canonicalMoney);
        const line = await insertOpenPurchaseLine(client, { item, ps, snapshot, quantity: item.quantity });
        results.push({ item: item.product_name, status: 'line_opened', purchase_order_id: null, purchase_line_id: line.id });
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

  const opened = results.filter((r) => r.status === 'line_opened');
  if (opened.length > 0) log.info(`[PURCHASING] Commande ${orderId} — ${opened.length} besoin(s) d'achat ouvert(s)`);
  return { purchase_orders: results };
}

module.exports = { triggerPurchasing, _requireSupplierMoney: requireSupplierMoney };
