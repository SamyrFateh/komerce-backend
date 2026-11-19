/**
 * @komerce-arch
 * @role          staging-reset-stock-restoration
 * @domain        infrastructure
 * @layer         script
 * @criticality   critical
 * @inputs        client PostgreSQL (lecture : orders, order_items, parcel_items, parcels, local_stock_allocations)
 * @outputs       apercu (lecture seule) et remise en etat des compteurs de stock avant la purge des commandes (portee activity)
 * @depends       aucun (SQL pur ; miroir inverse de services/product-stock-service.js et services/local-stock-service.js)
 * @used-by       scripts/controlled-business-purge.js
 * @db-read       orders, order_items, parcels, parcel_items, products, local_stock_allocations
 * @db-write      product_skus.stock, products.stock, product_variants.stock, local_stock.qty_physical (transaction de l'appelant)
 * @db-txn        caller-owned
 * @doctrine      staging_reset_activity_scope_restore_stock_counters_decremented_by_purged_orders
 * @impact-areas  database, staging, catalog, orders
 * @version       2026-11
 */
'use strict';

/**
 * Pourquoi : en portee `activity` le catalogue est conserve mais les commandes sont purgees. Or une commande confirmee
 * DECREMENTE le stock (adjustStock 'decrement', order-payment-confirmation) et sa consommation d'allocation locale
 * decremente local_stock.qty_physical (consumeAllocationsForOrder). Purger les commandes sans restituer laisserait un
 * stock « fantome » negatif. On applique donc l'inverse EXACT des decrements encore en vigueur, AVANT le TRUNCATE.
 *
 * Regle : commandes au statut confirmed..collected (pending : jamais decremente ; cancelled/refunded : deja restitue par
 * order-status-machine). Les quantites d'un reliquat (parcels.type='backorder', status cancelled) deja restituees par
 * parcel-operations sont retranchees. Dispatch identique a adjustStock : inventory_model='SKU' -> product_skus.stock,
 * sinon products.stock + product_variants.stock par (type, valeur) de variant_combo. Les allocations locales consommees
 * (consumed_at non nul) sont rendues a local_stock.qty_physical.
 * Limite connue : une commande stripe payee mais bloquee par stock insuffisant (jamais decrementee) serait sur-restituee ;
 * l'apercu du dry-run (stock_restoration) permet de le verifier avant execute.
 */

const NET_ITEMS = `
  net AS (
    SELECT oi.product_id, oi.sku_id, oi.variant_combo, p.has_variants, p.inventory_model,
           GREATEST(oi.quantity - COALESCE((
             SELECT SUM(pi.quantity) FROM parcel_items pi JOIN parcels pc ON pc.id = pi.parcel_id
              WHERE pi.order_item_id = oi.id AND pc.type = 'backorder' AND pc.status::text = 'cancelled'), 0), 0)::int AS qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
     WHERE o.status::text IN ('confirmed','ordered','preparation','shipped','in_transit','available','collected')
  )`;

const CONSUMED_ALLOCATIONS = `SELECT local_stock_id, SUM(quantity)::int AS qty FROM local_stock_allocations
   WHERE consumed_at IS NOT NULL AND released_at IS NULL GROUP BY local_stock_id`;

/** Lecture seule : ce qui serait restitue. */
async function previewStockRestoration(q) {
  const { rows } = await q.query(
    `WITH ${NET_ITEMS}
     SELECT COALESCE(inventory_model, 'LEGACY_VARIANTS') AS model, COUNT(*)::int AS items, COALESCE(SUM(qty), 0)::int AS units
       FROM net GROUP BY 1`);
  const { rows: [alloc] } = await q.query(
    `SELECT COUNT(*)::int AS local_stock_rows, COALESCE(SUM(qty), 0)::int AS units FROM (${CONSUMED_ALLOCATIONS}) a`);
  return {
    order_items_by_inventory_model: Object.fromEntries(rows.map((r) => [r.model, { items: r.items, units: r.units }])),
    local_stock: alloc,
  };
}

/** A appeler DANS la transaction de purge, avant le TRUNCATE des commandes. */
async function applyStockRestoration(client) {
  const sku = await client.query(
    `WITH ${NET_ITEMS}
     UPDATE product_skus s SET stock = s.stock + a.qty
       FROM (SELECT sku_id, SUM(qty)::int AS qty FROM net WHERE inventory_model = 'SKU' AND sku_id IS NOT NULL GROUP BY sku_id) a
      WHERE s.id = a.sku_id`);
  const prod = await client.query(
    `WITH ${NET_ITEMS}
     UPDATE products p SET stock = p.stock + a.qty
       FROM (SELECT product_id, SUM(qty)::int AS qty FROM net WHERE inventory_model IS DISTINCT FROM 'SKU' GROUP BY product_id) a
      WHERE p.id = a.product_id`);
  const variants = await client.query(
    `WITH ${NET_ITEMS}
     UPDATE product_variants v SET stock = v.stock + a.qty
       FROM (SELECT n.product_id, kv.key AS vtype, kv.value AS vvalue, SUM(n.qty)::int AS qty
               FROM net n CROSS JOIN LATERAL jsonb_each_text(n.variant_combo) kv
              WHERE n.inventory_model IS DISTINCT FROM 'SKU' AND n.has_variants
                AND n.variant_combo IS NOT NULL AND jsonb_typeof(n.variant_combo) = 'object'
              GROUP BY n.product_id, kv.key, kv.value) a
      WHERE v.product_id = a.product_id AND v.variant_type = a.vtype AND v.variant_value = a.vvalue AND v.stock IS NOT NULL`);
  const local = await client.query(
    `UPDATE local_stock ls SET qty_physical = ls.qty_physical + a.qty, updated_at = now()
       FROM (${CONSUMED_ALLOCATIONS}) a WHERE ls.id = a.local_stock_id`);
  return { product_skus: sku.rowCount, products: prod.rowCount, product_variants: variants.rowCount, local_stock: local.rowCount };
}

module.exports = { previewStockRestoration, applyStockRestoration };
