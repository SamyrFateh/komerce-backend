/**
 * @komerce-arch
 * @role          logistics-auto-parcel
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/reference.js
 * @used-by       routes/auto-distribute-api.js
 * @db-read       order_items, orders, parcel_items, parcels, purchase_lines, v_purchase_line_progress, relais, users, scan_events, scans, hub_box_bags, customs_shipment_parcels, incidents, invoices, order_item_real_cost_allocations
 * @db-write      parcel_items, parcels
 * @db-txn        distributeOrder verrouille la commande (FOR UPDATE) ; transaction propre sans client fourni
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Auto-Parcel Distribution Engine v3 (FIXED)
 *
 * Grouping by relais_id (reliable FK) instead of destination_island text.
 * Uses actual existing parcel columns only.
 *
 * Rules:
 *   - MAX 3 open parcels per relay
 *   - MAX 30 articles / 10 orders per parcel
 *   - Queued orders when saturated
 *   - Cleanup endpoint for ghost parcels
 */

'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'auto-parcel' });
const { generateParcelRef } = require('../utils/reference');

// ── Config ──────────────────────────────────────────────────────
const MAX_ITEMS_PER_PARCEL = 30;
const MAX_ORDERS_PER_PARCEL = 10;
const MAX_OPEN_PARCELS_PER_DEST = 3;

// ── Generate parcel reference ───────────────────────────────────
// Source unique : utils/reference.generateParcelRef (séquence parcel_ref_seq), sur le client de la transaction.
async function nextParcelRef(client) {
  return generateParcelRef(client || db);
}

// ── Core: distribute one order ──────────────────────────────────
async function distributeOrder(orderId, dbClient) {
  // H2 / HB-04 : la répartition d'une commande est sérialisée par un verrou de ligne sur la commande. Sans client fourni,
  // on ouvre notre propre transaction (le verrou tient jusqu'au COMMIT) ; avec un client, l'appelant porte la transaction.
  // Le second appelant concurrent attend, relit les lignes déjà colisées et sort en `already_assigned`.
  if (!dbClient) return db.withTransaction((client) => distributeOrderLocked(orderId, client));
  return distributeOrderLocked(orderId, dbClient);
}

async function distributeOrderLocked(orderId, dbClient) {
  const client = dbClient;
  await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);

  // Get order + relais info
  const { rows: [order] } = await client.query(`
    SELECT o.id, o.reference, o.status, o.relais_id, o.total_kmf,
           u.full_name AS customer_name, u.phone AS customer_phone,
           r.name AS relais_name, r.island AS relais_island
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.id = $1
  `, [orderId]);

  if (!order) return { success: false, error: 'Order not found' };

  // Deja entierement reparti ? (toutes les lignes ont un colis actif). Une repartition partielle laisse les lignes restantes
  // eligibles a un passage ulterieur (ex. article importe recu apres coup).
  const { rows: existingItems } = await client.query(`
    SELECT 1 AS assigned
     WHERE EXISTS (
             SELECT 1 FROM parcel_items pi
               JOIN order_items oi ON oi.id = pi.order_item_id
               JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
              WHERE oi.order_id = $1)
       AND NOT EXISTS (
             SELECT 1 FROM order_items oi
              WHERE oi.order_id = $1
                AND NOT EXISTS (SELECT 1 FROM parcel_items pi
                                  JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
                                 WHERE pi.order_item_id = oi.id))
  `, [orderId]);

  if (existingItems.length > 0) {
    return { success: true, already_assigned: true, order_ref: order.reference };
  }

  // Lignes SANS colis actif, avec leur circuit : LOCAL (hors import) ou IMPORT (recu / non recu au Hub).
  const { rows: allItems } = await client.query(`
    SELECT oi.id, oi.quantity, oi.product_id, oi.fulfillment_source,
           COALESCE((SELECT SUM(v.received_quantity)::int FROM v_purchase_line_progress v
                      WHERE v.order_item_id = oi.id AND NOT v.cancelled), 0) AS received,
           -- H1 / HB-02 : rupture définitive = au moins une ligne soldée, plus aucune ligne en attente de réception.
           (EXISTS (SELECT 1 FROM purchase_lines pl WHERE pl.order_item_id = oi.id AND pl.cancelled_at IS NULL AND pl.settled_at IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM v_purchase_line_progress v
                             WHERE v.order_item_id = oi.id AND NOT v.cancelled AND v.received_quantity < v.effective_quantity)) AS closed_short
      FROM order_items oi
     WHERE oi.order_id = $1
       AND NOT EXISTS (SELECT 1 FROM parcel_items pi JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
                        WHERE pi.order_item_id = oi.id)
  `, [orderId]);
  if (allItems.length === 0) return { success: false, error: 'No items in order' };

  // Doctrine d'eligibilite : un colis ne contient que des articles du MEME circuit et PRETS. Jamais de melange local/import,
  // jamais d'article non approvisionne ou non recu avec des articles prets : ceux-la restent sans colis jusqu'a reception.
  // Rupture définitive : le colis part avec la quantité reçue (le manquant est remboursé en amont).
  const shortReceived = (item) => item.closed_short === true && Number(item.received) > 0 && Number(item.received) < Number(item.quantity || 1);
  // LOCAL_STOCK n'a aucune étape Hub : réception physique et création du
  // seul colis local sont du ressort de local-relay-receipt-service.
  // Une commande mixte garde ses lignes locales en attente au relais tandis
  // que ses lignes IMPORT reçues peuvent être réparties au Hub.
  // Provenance inconnue = refus, jamais requalifiée implicitement en local.
  const laneOf = (item) => {
    if (item.fulfillment_source === 'LOCAL_STOCK') return 'local_direct';
    if (item.fulfillment_source === 'IMPORT') {
      return (Number(item.received) >= Number(item.quantity || 1) || shortReceived(item))
        ? 'import' : 'import_pending';
    }
    throw new Error('AUTO_PARCEL_FULFILLMENT_SOURCE_UNKNOWN');
  };
  const groups = new Map();
  const deferred = [];
  let directLocalItems = 0;
  for (const item of allItems) {
    const lane = laneOf(item);
    if (lane === 'local_direct') { directLocalItems++; continue; }
    if (lane === 'import' && shortReceived(item)) item.quantity = Number(item.received);
    if (lane === 'import_pending') { deferred.push(item.id); continue; }
    if (!groups.has(lane)) groups.set(lane, []);
    groups.get(lane).push(item);
  }
  if (groups.size === 0) {
    return { success: true, order_ref: order.reference, nothing_eligible: true, deferred_items: deferred.length,
      local_direct_items: directLocalItems,
      reason: directLocalItems && !deferred.length
        ? 'LOCAL_STOCK : réception attestée directement au relais, aucun colis Hub'
        : 'Aucun article IMPORT reçu au Hub : aucun colis créé' };
  }

  const relaisId = order.relais_id;
  const destLabel = (order.relais_island || 'inconnue').toUpperCase();
  const outcomes = [];
  for (const [lane, items] of groups) {
    const outcome = await assignLane({ client, order, orderId, relaisId, destLabel, lane, items });
    if (outcome.queued) return outcome;
    outcomes.push({ ...outcome, lane });
  }
  const { lane: _lane, ...first } = outcomes[0];
  const extra = { ...(deferred.length ? { deferred_items: deferred.length } : {}),
    ...(directLocalItems ? { local_direct_items: directLocalItems } : {}) };
  return outcomes.length === 1
    ? { ...first, ...extra }
    : { ...first, parcels: outcomes.map(o => ({ parcel_ref: o.parcel_ref, lane: o.lane, items_assigned: o.items_assigned })), ...extra };
}

async function assignLane({ client, order, orderId, relaisId, destLabel, lane, items }) {
  const totalQty = items.reduce((s, i) => s + (i.quantity || 1), 0);
  const laneKind = lane === 'local' ? 'local' : 'import';
  // Colis ouverts du meme relais ET du meme circuit (un colis vide convient a tout circuit).
  const laneFilter = `AND (agg.lanes IS NULL OR agg.lanes = ARRAY['${laneKind}']::text[])`;
  // Import : un colis par commande. Le lien sac->KOM-BOX (trigger migration 394) exige parcel.order_id = sac.order_id ;
  // un colis import multi-commandes ne peut donc pas etre range en KOM-BOX. Le circuit local garde le groupage par relais.
  const perOrder = laneKind === 'import' || !relaisId;
  const scope = perOrder ? 'p.order_id = $1' : 'p.relais_id = $1';
  const openQuery = `
      SELECT p.id, p.reference,
             COALESCE(agg.item_count, 0)::int AS item_count,
             COALESCE(agg.order_count, 0)::int AS order_count
      FROM parcels p
      LEFT JOIN LATERAL (
        SELECT COUNT(pi.id) AS item_count,
               COUNT(DISTINCT oi.order_id) AS order_count,
               ARRAY_AGG(DISTINCT CASE WHEN oi.fulfillment_source = 'IMPORT' THEN 'import' ELSE 'local' END) AS lanes
        FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        WHERE pi.parcel_id = p.id
      ) agg ON true
      WHERE p.status IN ('draft', 'preparation')
        AND ${scope}
        ${laneFilter}
      ORDER BY p.created_at ASC
    `;
  const openParams = [perOrder ? orderId : relaisId];

  const { rows: openParcels } = await client.query(openQuery, openParams);

  // Try to find parcel with room
  const suitable = openParcels.find(p =>
    p.item_count + totalQty <= MAX_ITEMS_PER_PARCEL &&
    p.order_count < MAX_ORDERS_PER_PARCEL
  );

  let parcelId, parcelRef, created = false;

  if (suitable) {
    parcelId = suitable.id;
    parcelRef = suitable.reference;
  } else if (openParcels.length < MAX_OPEN_PARCELS_PER_DEST) {
    // Create new parcel — using ONLY columns that exist
    const ref = await nextParcelRef(client);
    const { rows: [newP] } = await client.query(`
      INSERT INTO parcels (reference, order_id, relais_id, status, type, label)
      VALUES ($1, $2, $3, 'preparation', 'standard', $4)
      RETURNING id, reference
    `, [ref, orderId, relaisId, `Auto-${destLabel}`]);

    parcelId = newP.id;
    parcelRef = newP.reference;
    created = true;
    log.info(`[AUTO-PARCEL] New parcel ${parcelRef} → ${destLabel} (${laneKind}, ${openParcels.length + 1}/${MAX_OPEN_PARCELS_PER_DEST})`);
  } else {
    // SATURATED — queue the order
    log.info(`[AUTO-PARCEL] ⚠️ ${destLabel}: ${openParcels.length} colis ouverts (max ${MAX_OPEN_PARCELS_PER_DEST}) — ${order.reference} en file`);
    return {
      success: true,
      queued: true,
      order_ref: order.reference,
      destination: destLabel,
      reason: `${openParcels.length} colis ouverts vers ${destLabel} (max ${MAX_OPEN_PARCELS_PER_DEST}). Expédiez !`,
      open_parcels: openParcels.map(p => ({
        ref: p.reference,
        items: p.item_count,
        orders: p.order_count,
        full: p.item_count >= MAX_ITEMS_PER_PARCEL || p.order_count >= MAX_ORDERS_PER_PARCEL
      }))
    };
  }

  // Assign items — use ONLY columns that exist in parcel_items
  let assigned = 0;
  for (const item of items) {
    try {
      // parcel_items has: parcel_id, order_item_id, quantity, product_id
      await client.query(`
        INSERT INTO parcel_items (parcel_id, order_item_id, quantity, product_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [parcelId, item.id, item.quantity || 1, item.product_id || null]);
      assigned++;
    } catch (e) {
      // Minimal fallback — just core columns
      try {
        await client.query(`
          INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `, [parcelId, item.id, item.quantity || 1]);
        assigned++;
      } catch (e2) {
        log.warn(`[AUTO-PARCEL] Failed to assign item ${item.id}: ${e2.message}`);
      }
    }
  }

  log.info(`[AUTO-PARCEL] ${order.reference} → ${parcelRef} (${assigned}/${items.length} items, ${laneKind}, ${created ? 'new' : 'existing'})`);

  return {
    success: true,
    order_ref: order.reference,
    parcel_ref: parcelRef,
    parcel_id: parcelId,
    items_assigned: assigned,
    parcel_created: created,
    destination: destLabel,
  };
}


// ── Batch: distribute all unassigned ────────────────────────────
async function distributeAll() {
  const { rows: unassigned } = await db.query(`
    SELECT o.id, o.reference
    FROM orders o
    WHERE o.status IN ('ordered', 'preparation')
      AND EXISTS (
        SELECT 1 FROM order_items oi
         WHERE oi.order_id = o.id
           AND oi.fulfillment_source = 'IMPORT'
           AND NOT EXISTS (SELECT 1 FROM parcel_items pi JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
                            WHERE pi.order_item_id = oi.id)
      )
    ORDER BY o.created_at ASC
  `);

  const results = [];
  for (const order of unassigned) {
    try {
      const r = await distributeOrder(order.id);
      results.push(r);
    } catch (e) {
      results.push({ success: false, order_ref: order.reference, error: e.message });
    }
  }

  return {
    distributed: results.filter(r => r.success && !r.already_assigned && !r.queued).length,
    queued: results.filter(r => r.queued).length,
    already_assigned: results.filter(r => r.already_assigned).length,
    errors: results.filter(r => !r.success).length,
    details: results
  };
}


// ── Get distribution overview (for dashboard) ───────────────────
async function getDistribution() {
  // Open parcels with their orders
  const { rows: parcels } = await db.query(`
    SELECT
      p.id, p.reference, p.status, p.label,
      p.relais_id, r.name AS relais_name, r.island AS relais_island,
      p.created_at,
      COALESCE(agg.orders_count, 0)::int AS orders_count,
      COALESCE(agg.items_count, 0)::int AS items_count,
      COALESCE(agg.total_qty, 0)::int AS total_qty,
      COALESCE(agg.total_kmf, 0)::int AS total_kmf,
      COALESCE(agg.orders_json, '[]'::json) AS orders
    FROM parcels p
    LEFT JOIN relais r ON r.id = p.relais_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT oi.order_id) AS orders_count,
        COUNT(pi.id) AS items_count,
        SUM(COALESCE(pi.quantity, 1)) AS total_qty,
        COALESCE(SUM(DISTINCT sub_o.total_kmf), 0) AS total_kmf,
        json_agg(DISTINCT jsonb_build_object(
          'id', sub_o.id,
          'ref', sub_o.reference,
          'customer', sub_u.full_name,
          'status', sub_o.status,
          'items_count', (SELECT COUNT(*) FROM order_items x WHERE x.order_id = sub_o.id),
          'total_kmf', sub_o.total_kmf
        )) AS orders_json
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      JOIN orders sub_o ON sub_o.id = oi.order_id
      LEFT JOIN users sub_u ON sub_u.id = sub_o.user_id
      WHERE pi.parcel_id = p.id
    ) agg ON true
    WHERE p.status IN ('draft', 'preparation')
    ORDER BY r.island, p.created_at
  `);

  // Unassigned orders
  const { rows: unassigned } = await db.query(`
    SELECT o.id, o.reference, o.status, o.relais_id,
           o.total_kmf, o.created_at,
           u.full_name AS customer_name,
           r.name AS relais_name, r.island AS relais_island,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)::int AS items_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.status IN ('ordered', 'preparation')
      AND EXISTS (SELECT 1 FROM order_items oi
                   WHERE oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT')
      AND NOT EXISTS (
        SELECT 1 FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
        WHERE oi.order_id = o.id
      )
    ORDER BY o.created_at ASC
  `);

  // Saturation
  const destCounts = {};
  for (const p of parcels) {
    const d = p.relais_island || 'UNKNOWN';
    if (!destCounts[d]) destCounts[d] = { open: 0, full: 0 };
    destCounts[d].open++;
    if (p.items_count >= MAX_ITEMS_PER_PARCEL || p.orders_count >= MAX_ORDERS_PER_PARCEL) {
      destCounts[d].full++;
    }
  }

  const saturated = [];
  for (const [dest, counts] of Object.entries(destCounts)) {
    if (counts.open >= MAX_OPEN_PARCELS_PER_DEST) {
      const queued = unassigned.filter(o =>
        (o.relais_island || '').toUpperCase() === dest.toUpperCase()
      ).length;
      if (queued > 0) {
        saturated.push({
          destination: dest,
          open_parcels: counts.open,
          full_parcels: counts.full,
          queued_orders: queued,
          message: `🚨 ${dest}: ${counts.open} colis ouverts (max ${MAX_OPEN_PARCELS_PER_DEST}), ${queued} commande(s) en file`
        });
      }
    }
  }

  return {
    parcels, unassigned, saturated,
    limits: { MAX_ITEMS_PER_PARCEL, MAX_ORDERS_PER_PARCEL, MAX_OPEN_PARCELS_PER_DEST }
  };
}


// ── Cleanup: annule les colis fantômes (auto-créés, vides, anciens, sans preuve) ─────
// Jamais de DELETE (trigger trg_no_delete_parcels) : transition vers « cancelled » par le SSOT
// parcel-operations.transitionParcelStatus. Seul critère de ciblage : label « Auto-% » (colis créés par
// distributeOrder), draft/preparation, sans parcel_items, âgés de plus de GHOST_MIN_AGE_HOURS, et sans aucune
// preuve physique ou documentaire qui référence le colis.
const GHOST_MIN_AGE_HOURS = 24;
async function cleanupGhostParcels() {
  const { transitionParcelStatus } = require('./parcel-operations');
  const { rows: ghosts } = await db.query(`
    SELECT p.id, p.reference
    FROM parcels p
    WHERE p.status IN ('draft', 'preparation')
      AND p.label LIKE 'Auto-%'
      AND p.created_at < NOW() - make_interval(hours => $1::int)
      AND NOT EXISTS (SELECT 1 FROM parcel_items pi WHERE pi.parcel_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM scan_events se WHERE se.parcel_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM scans sc WHERE sc.parcel_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM hub_box_bags hb WHERE hb.parcel_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM customs_shipment_parcels cp WHERE cp.parcel_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.parcel_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM invoices inv WHERE inv.parcel_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM order_item_real_cost_allocations a WHERE a.parcel_id = p.id)
    ORDER BY p.created_at
  `, [GHOST_MIN_AGE_HOURS]);

  const references = [];
  for (const g of ghosts) {
    const result = await transitionParcelStatus(db, g.id, 'cancelled', { cancelReason: 'ghost_auto_parcel_cleanup' });
    if (result && result.ok) references.push(g.reference);
  }

  log.info(`[AUTO-PARCEL] Cleanup: ${references.length} ghost parcels cancelled`);
  return { cancelled: references.length, references };
}


module.exports = {
  distributeOrder,
  distributeAll,
  getDistribution,
  cleanupGhostParcels,
  MAX_ITEMS_PER_PARCEL,
  MAX_ORDERS_PER_PARCEL,
  MAX_OPEN_PARCELS_PER_DEST,
};
