/**
 * @komerce-arch
 * @role          orders-product-return-request-service
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        authenticated_relay_actor, order_reference, purchased_order_item_id, return_quantity, return_reason
 * @outputs       relay_scoped_eligible_lines_and_dispute_return_requests
 * @depends       db (transaction supplied), services/dispute-mutation-service.js, services/catalog-product-quality-service.js, orders, order_items, products
 * @used-by       routes/relay-dashboard.js
 * @db-read       orders, order_items, products, disputes, relay_product_return_receipts, relay_return_compensations
 * @db-write      none
 * @db-write-via:dispute-mutation-service disputes
 * @db-txn        owns_request_transaction; queries_accept_executor
 * @doctrine      return_is_dispute_not_parallel_object, relay_scope_is_server_authority, financial_authority_never_delegated
 * @impact-areas  orders, logistics, dashboard, refunds
 * @version       2026-11
 */
'use strict';

// V1 only records a REQUEST by purchased item. It NEVER attests physical receipt,
// authorizes wallet credit, refunds money or marks the returned item as sellable.
const REASONS = Object.freeze(['defective', 'damaged', 'wrong_item', 'not_as_described', 'other']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/;

class ReturnRequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, message, status) => { throw new ReturnRequestError(code, message, status); };

function relayScope(actor) {
  if (!actor || !['agent_relais', 'admin'].includes(actor.role)) {
    fail('RETURN_ROLE_FORBIDDEN', 'Rôle non autorisé pour les demandes de retour.', 403);
  }
  if (actor.role === 'agent_relais') {
    if (!actor.relais_id || !UUID.test(String(actor.relais_id))) {
      fail('RETURN_RELAY_MISSING', 'Aucun relais n’est attribué à cet agent.', 403);
    }
    return String(actor.relais_id);
  }
  return null;
}

function normalizeReference(reference) {
  const value = String(reference || '').trim();
  if (!REF.test(value)) fail('RETURN_REFERENCE_INVALID', 'Référence commande invalide.');
  return value;
}

async function findOrder(executor, reference, scope, lock = false) {
  const { rows } = await executor.query(
    `SELECT o.id, o.reference, o.status, o.payment_status, o.relais_id, o.market_id
       FROM orders o
      WHERE o.reference = $1 AND o.simulation_scope IS NULL
        AND ($2::uuid IS NULL OR o.relais_id = $2::uuid)
      ${lock ? 'FOR UPDATE OF o' : ''}`,
    [reference, scope]
  );
  if (!rows.length) fail('RETURN_ORDER_NOT_FOUND', 'Commande introuvable dans ce relais.', 404);
  return rows[0];
}

async function eligibleOrder({ actor, reference, executor }) {
  const scope = relayScope(actor);
  const order = await findOrder(executor, normalizeReference(reference), scope);
  const { rows } = await executor.query(
    `SELECT oi.id, p.name AS product_name, oi.quantity, oi.qty_collected,
            COALESCE((
              SELECT SUM(d.return_quantity)
                FROM disputes d
               WHERE d.type = 'product_return' AND d.return_order_item_id = oi.id
                 AND (d.status IN ('open','processing','resolved')
                      OR EXISTS (SELECT 1 FROM relay_return_compensations c WHERE c.request_id = d.id))
            ), 0)::int AS qty_already_requested
       FROM order_items oi JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1 AND oi.qty_collected > 0
      ORDER BY oi.created_at, oi.id`,
    [order.id]
  );
  return { order: { reference: order.reference, status: order.status }, items: rows.map(row => ({
    id: row.id,
    product_name: row.product_name,
    qty_collected: Number(row.qty_collected),
    remaining_returnable: Math.max(0, Number(row.qty_collected) - Number(row.qty_already_requested)),
  })) };
}

async function listReturnRequests({ actor, executor, limit = 50 }) {
  const scope = relayScope(actor);
  const count = Number.isInteger(Number(limit)) ? Math.max(1, Math.min(50, Number(limit))) : 50;
  const { rows } = await executor.query(
    `SELECT d.id, d.status, d.return_quantity, d.return_reason, d.description,
            d.resolution, d.created_at,
            o.reference AS order_reference, o.relais_id,
            p.name AS product_name,
            rr.id AS receipt_id, rr.quantity AS received_quantity,
            rr.condition_code AS received_condition, rr.storage_zone,
            rr.received_at
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
       JOIN order_items oi ON oi.id = d.return_order_item_id AND oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN relay_product_return_receipts rr ON rr.request_id=d.id
      WHERE d.type = 'product_return' AND o.simulation_scope IS NULL
        AND ($1::uuid IS NULL OR o.relais_id = $1::uuid)
      ORDER BY d.created_at DESC LIMIT $2`,
    [scope, count]
  );
  return { requests: rows };
}

async function addRemark({actor,reference,orderItemId,note,executor}){
  const scope=relayScope(actor);
  const ref=normalizeReference(reference);
  if(!UUID.test(String(orderItemId||'')))
    fail('RETURN_ITEM_INVALID','Article commandé invalide.');
  return require('./catalog-product-quality-service').addRelayObservation({
    actorId:actor.id,relayId:scope,reference:ref,orderItemId,note,
  },executor);
}

async function createReturnRequest({ actor, reference, orderItemId, quantity, reason, note, db }) {
  const scope = relayScope(actor);
  const ref = normalizeReference(reference);
  if (!UUID.test(String(orderItemId || ''))) fail('RETURN_ITEM_INVALID', 'Article commandé invalide.');
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 10000) {
    fail('RETURN_QUANTITY_INVALID', 'Quantité de retour invalide.');
  }
  const normalizedReason = String(reason || '').trim();
  if (!REASONS.includes(normalizedReason)) fail('RETURN_REASON_INVALID', 'Motif de retour invalide.');
  const description = String(note || '').trim();
  if (description.length > 500 || (normalizedReason === 'other' && description.length < 3)) {
    fail('RETURN_NOTE_INVALID', 'Un motif libre nécessite une explication courte (500 caractères maximum).');
  }
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const order = await findOrder(client, ref, scope, true);
    // A partial pickup may leave the parent order 'available': use authoritative
    // item-level collected quantity, never the order's projected status alone.
    const { rows: items } = await client.query(
      `SELECT oi.id, oi.qty_collected
         FROM order_items oi
        WHERE oi.id = $1 AND oi.order_id = $2 FOR UPDATE`,
      [orderItemId, order.id]
    );
    if (!items.length || Number(items[0].qty_collected) < 1) {
      fail('RETURN_ITEM_NOT_COLLECTED', 'Article non remis au client ou hors commande.', 409);
    }
    const { rows: sums } = await client.query(
      `SELECT COALESCE(SUM(return_quantity), 0)::int AS requested,
              COUNT(*) FILTER (WHERE status IN ('open','processing'))::int AS active
         FROM disputes
        WHERE return_order_item_id = $1 AND type = 'product_return'
          AND (status <> 'closed'
               OR EXISTS (SELECT 1 FROM relay_return_compensations c WHERE c.request_id = disputes.id))`,
      [orderItemId]
    );
    const existing = sums[0] || {};
    if (Number(existing.active) > 0) {
      fail('RETURN_ALREADY_OPEN', 'Une demande existe déjà pour cet article.', 409);
    }
    if (qty > Number(items[0].qty_collected) - Number(existing.requested || 0)) {
      fail('RETURN_EXCEEDS_COLLECTED', 'Quantité demandée supérieure aux unités remises et non encore réclamées.', 409);
    }
    // This mutation lives in the canonical disputes owner, not in a new returns
    // lifecycle table and not in any financial writer.
    const dispute = await require('./dispute-mutation-service').createProductReturnRequest(client, {
      orderId: order.id, orderItemId, quantity: qty, reason: normalizedReason,
      description, actorId: actor.id,
    });
    await client.query('COMMIT');
    return { request: { ...dispute, order_reference: order.reference } };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === '23505') {
      fail('RETURN_ALREADY_OPEN', 'Une demande existe déjà pour cet article.', 409);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  REASONS,
  ReturnRequestError,
  eligibleOrder,
  listReturnRequests,
  createReturnRequest,
  addRemark,
};
