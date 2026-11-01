/**
 * @komerce-arch
 * @role          logistics-parcel-item-mutation-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        db_or_transaction_executor, parcel item mutation payload
 * @outputs       query result / parcel item row
 * @depends       none (executor fourni par l'appelant)
 * @used-by       routes/hub-dashboard.js, services/inventory-service.js
 * @db-read       order_items, orders, parcels
 * @db-write      parcel_events, parcel_items
 * @db-txn        caller_transaction_preserved
 * @doctrine      writer_not_owner_boundary
 * @impact-areas  logistics, dashboard, inventory
 * @version       2026-08
 */

'use strict';

function assertExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('parcel-item-mutation-service requires an executor exposing query(sql, params)');
  }
}

/**
 * Assigne l'intégralité d'un order_item à un colis après validation de son
 * appartenance à la commande. Sémantique historique de hub-dashboard/create-parcel.
 */
async function assignWholeOrderItemToParcel(executor, {
  parcelId,
  orderItemId,
  orderId,
}) {
  assertExecutor(executor);

  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     SELECT $1, oi.id, oi.product_id, oi.quantity
     FROM order_items oi WHERE oi.id = $2 AND oi.order_id = $3
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, orderId]
  );
}

/**
 * Assigne un article déjà résolu (product_id + quantity connus) à un colis.
 * Sémantique historique de hub-dashboard/auto-prepare.
 */
async function assignParcelItem(executor, {
  parcelId,
  orderItemId,
  productId,
  quantity,
}) {
  assertExecutor(executor);

  // Orders owns product identity and maximum quantity. Validate both in
  // the INSERT itself: the caller must not redefine canonical order-item facts.
  // A mismatched product/quantity produces rowCount=0 for the caller to reject.
  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     SELECT $1, oi.id, oi.product_id, $4::integer
       FROM order_items oi
      WHERE oi.id = $2
        AND oi.product_id = $3
        AND $4::integer > 0
        AND $4::integer <= oi.quantity
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, productId, quantity]
  );
}

/**
 * Ajoute un article résolu et retourne la ligne créée si elle existe.
 * Sémantique historique de POST /hub-dash/parcels/:id/add-item.
 */
async function addParcelItem(executor, {
  parcelId,
  orderItemId,
  productId,
  quantity,
}) {
  assertExecutor(executor);

  const { rows: [row] } = await executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [parcelId, orderItemId, productId, quantity]
  );

  return row || null;
}

/**
 * Retire un article d'un colis et retourne la ligne supprimée si elle existe.
 */
async function removeParcelItem(executor, {
  parcelId,
  orderItemId,
}) {
  assertExecutor(executor);

  const { rows: [row] } = await executor.query(
    'DELETE FROM parcel_items WHERE parcel_id = $1 AND order_item_id = $2 RETURNING *',
    [parcelId, orderItemId]
  );

  return row || null;
}

const MUTABLE_PARCEL_STATUSES = ['draft', 'preparation'];

function mutationError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/** Trace stricte (même transaction que la mutation) : jamais avalée. */
async function traceItemEvent(executor, { parcelId, eventType, actorId, notes, metadata }) {
  await executor.query(
    `INSERT INTO parcel_events (parcel_id, event_type, actor_id, notes, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [parcelId, eventType, actorId || null, notes || null, JSON.stringify(metadata || {})]
  );
}

/**
 * Verrouille un colis et vérifie qu'il est modifiable (HUB-A).
 * À appeler dans la transaction de l'appelant.
 */
async function lockMutableParcel(executor, parcelId) {
  const { rows: [parcel] } = await executor.query(
    'SELECT id, order_id, reference, status, relais_id FROM parcels WHERE id = $1 FOR UPDATE',
    [parcelId]
  );
  if (!parcel) throw mutationError('PARCEL_NOT_FOUND', 404, 'Colis introuvable');
  if (!MUTABLE_PARCEL_STATUSES.includes(parcel.status)) {
    throw mutationError('PARCEL_NOT_MUTABLE', 409,
      `Colis ${parcel.reference} au statut ${parcel.status} : affectations figées (traçabilité physique)`);
  }
  return parcel;
}

/**
 * Un colis ne mélange que des lignes de même destination (relais) : l'unité
 * physique suit son destinataire, jamais l'inverse.
 */
function assertSameDestination(parcel, itemRelaisId) {
  if (parcel.relais_id && itemRelaisId && parcel.relais_id !== itemRelaisId) {
    throw mutationError('DESTINATION_MISMATCH', 409,
      'Article destiné à un autre relais que ce colis');
  }
}

/**
 * Un colis ne mélange que des lignes du MÊME marché (marché de la commande
 * porteuse du colis = marché de la commande de la ligne). Vaut aussi quand
 * relais_id est NULL (la garde de destination est alors sautée) et quand les
 * relais ne portent aucun marché. Marché inconnu d'un côté ⇒ refus (jamais
 * traité comme « même marché »). Même commande ⇒ toujours autorisé.
 * Ne touche à aucune donnée existante : les violations historiques sont
 * seulement signalées (findParcelMarketViolations).
 */
async function assertSameMarket(executor, parcel, itemOrderId) {
  if (!parcel.order_id || parcel.order_id === itemOrderId) return;
  const { rows } = await executor.query(
    'SELECT id, market_id FROM orders WHERE id = ANY($1::uuid[])',
    [[parcel.order_id, itemOrderId]]
  );
  const carrier = rows.find((r) => r.id === parcel.order_id);
  const line = rows.find((r) => r.id === itemOrderId);
  if (!carrier || !line || !carrier.market_id || !line.market_id) {
    throw mutationError('MARKET_UNKNOWN', 409,
      'Marché inconnu pour le colis ou la commande : groupage refusé tant que le marché n’est pas renseigné');
  }
  if (carrier.market_id !== line.market_id) {
    throw mutationError('MARKET_MISMATCH', 409,
      'Article d’un autre marché que ce colis : groupage entre marchés interdit');
  }
}

/** Signalement lecture seule des colis existants mélangeant des marchés (aucune modification). */
const PARCEL_MARKET_VIOLATIONS_SQL = `
  SELECT p.id AS parcel_id, p.reference, p.relais_id, p.order_id AS carrier_order_id,
         co.market_id AS carrier_market_id,
         ARRAY_AGG(DISTINCT lo.market_id::text) FILTER (WHERE lo.market_id IS NOT NULL) AS line_markets,
         BOOL_OR(lo.market_id IS NULL) AS has_unknown_market,
         COUNT(*) AS lines
    FROM parcels p
    JOIN parcel_items pi ON pi.parcel_id = p.id
    JOIN order_items oi ON oi.id = pi.order_item_id
    JOIN orders lo ON lo.id = oi.order_id
    LEFT JOIN orders co ON co.id = p.order_id
   WHERE oi.order_id IS DISTINCT FROM p.order_id
     AND (co.market_id IS NULL OR lo.market_id IS NULL OR lo.market_id <> co.market_id)
   GROUP BY p.id, p.reference, p.relais_id, p.order_id, co.market_id
   ORDER BY p.reference`;

async function findParcelMarketViolations(executor) {
  assertExecutor(executor);
  const { rows } = await executor.query(PARCEL_MARKET_VIOLATIONS_SQL);
  return rows;
}

/**
 * Ajoute un article d'une commande quelconque (multi-commandes) avec trace.
 * Refuse un article déjà affecté à un autre colis (→ réaffectation explicite).
 */
async function addParcelItemTraced(executor, { parcelId, orderItemId, quantity, actorId }) {
  assertExecutor(executor);
  const parcel = await lockMutableParcel(executor, parcelId);

  const { rows: [item] } = await executor.query(
    `SELECT oi.id, oi.quantity, oi.product_id, oi.order_id, o.relais_id
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.id = $1 FOR UPDATE OF oi`,
    [orderItemId]
  );
  if (!item) throw mutationError('ORDER_ITEM_NOT_FOUND', 404, 'Article introuvable');
  assertSameDestination(parcel, item.relais_id);
  await assertSameMarket(executor, parcel, item.order_id);

  const qty = quantity || item.quantity;
  if (qty > item.quantity) {
    throw mutationError('QUANTITY_EXCEEDS_ORDER_LINE', 400, 'Quantité supérieure à la ligne de commande');
  }

  const { rows: [existing] } = await executor.query(
    `SELECT pi.parcel_id FROM parcel_items pi JOIN parcels p ON p.id = pi.parcel_id
     WHERE pi.order_item_id = $1`, [orderItemId]
  );
  if (existing) {
    if (existing.parcel_id === parcel.id) return { row: null, order_id: item.order_id, already_assigned: true };
    throw mutationError('ITEM_ALREADY_IN_OTHER_PARCEL', 409,
      'Article déjà affecté à un autre colis : utiliser la réaffectation tracée');
  }

  const row = await addParcelItem(executor, { parcelId: parcel.id, orderItemId, productId: item.product_id, quantity: qty });
  await traceItemEvent(executor, {
    parcelId: parcel.id, eventType: 'item_assigned', actorId,
    notes: `Article ${orderItemId} affecté`,
    metadata: { order_item_id: orderItemId, order_id: item.order_id, product_id: item.product_id, quantity: qty,
                carrier_order_id: parcel.order_id, cross_order: item.order_id !== parcel.order_id },
  });
  return { row, order_id: item.order_id, already_assigned: false };
}

/** Retire un article avec garde de statut et trace (aucun effacement silencieux). */
async function removeParcelItemTraced(executor, { parcelId, orderItemId, actorId }) {
  assertExecutor(executor);
  const parcel = await lockMutableParcel(executor, parcelId);
  const deleted = await removeParcelItem(executor, { parcelId: parcel.id, orderItemId });
  if (!deleted) return null;
  await traceItemEvent(executor, {
    parcelId: parcel.id, eventType: 'item_removed', actorId,
    notes: `Article ${orderItemId} retiré`,
    metadata: { order_item_id: orderItemId, product_id: deleted.product_id, quantity: deleted.quantity,
                carrier_order_id: parcel.order_id },
  });
  return deleted;
}

/**
 * Réaffecte une ligne d'un colis à un autre en conservant strictement
 * identité (order_item_id, product_id), quantité et compteurs qty_*.
 * Verrouillage des deux colis dans l'ordre des ids (anti-deadlock).
 */
async function reassignParcelItem(executor, { fromParcelId, toParcelId, orderItemId, actorId, reason }) {
  assertExecutor(executor);
  if (fromParcelId === toParcelId) throw mutationError('SAME_PARCEL', 400, 'Colis source et destination identiques');

  const [firstId, secondId] = [fromParcelId, toParcelId].sort();
  const first = await lockMutableParcel(executor, firstId);
  const second = await lockMutableParcel(executor, secondId);
  const from = first.id === fromParcelId ? first : second;
  const to = first.id === toParcelId ? first : second;

  const { rows: [item] } = await executor.query(
    `SELECT oi.id, oi.order_id, o.relais_id
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = $1`, [orderItemId]
  );
  if (!item) throw mutationError('ORDER_ITEM_NOT_FOUND', 404, 'Article introuvable');
  assertSameDestination(to, item.relais_id);
  await assertSameMarket(executor, to, item.order_id);

  const { rows: [moved] } = await executor.query(
    `UPDATE parcel_items SET parcel_id = $1
     WHERE parcel_id = $2 AND order_item_id = $3 RETURNING *`,
    [to.id, from.id, orderItemId]
  );
  if (!moved) throw mutationError('ITEM_NOT_IN_SOURCE_PARCEL', 404, 'Article absent du colis source');

  const metadata = {
    order_item_id: orderItemId, order_id: item.order_id, product_id: moved.product_id,
    quantity: moved.quantity, from_parcel_id: from.id, to_parcel_id: to.id, reason: reason || null,
  };
  await traceItemEvent(executor, { parcelId: from.id, eventType: 'item_reassigned_out', actorId, notes: `Article ${orderItemId} → ${to.reference}`, metadata });
  await traceItemEvent(executor, { parcelId: to.id, eventType: 'item_reassigned_in', actorId, notes: `Article ${orderItemId} ← ${from.reference}`, metadata });
  return { moved, from, to, order_id: item.order_id };
}

/**
 * Assigne une unité d'un order_item à un colis lors du scan inventory.
 * La quantité reste volontairement fixée à 1, comme avant extraction.
 */
async function assignSingleOrderItemToParcel(executor, {
  parcelId,
  orderItemId,
}) {
  assertExecutor(executor);

  return executor.query(
    `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
     SELECT $1, $2, oi.product_id, 1
     FROM order_items oi WHERE oi.id = $3
     ON CONFLICT DO NOTHING`,
    [parcelId, orderItemId, orderItemId]
  );
}

module.exports = {
  assertSameMarket,
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
  assignSingleOrderItemToParcel,
  addParcelItemTraced,
  removeParcelItemTraced,
  reassignParcelItem,
  assertSameMarket,
  findParcelMarketViolations,
  PARCEL_MARKET_VIOLATIONS_SQL,
  MUTABLE_PARCEL_STATUSES,
};
