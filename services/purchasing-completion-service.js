/**
 * @komerce-arch
 * @role          purchasing-order-completion-service
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        order_id, hub_allocations, actor
 * @outputs       order_completion_verdict, purchase_order_hub_received, order_status_preparation
 * @depends       db, services/order-status-machine.js, services/scan-operations.js, utils/alerts.js, utils/logger.js
 * @used-by       services/hub-operations.js
 * @db-read       order_items, orders, purchase_orders, v_purchase_line_progress
 * @db-write      alerts, purchase_orders
 * @db-txn        owns_transaction
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, orders, logistics
 * @version       2026-10
 */

'use strict';

/**
 * Complétude d'achat d'une commande (PR 7/8, MISSION_PURCHASE_LINES §9).
 *
 * Appelée APRÈS le commit d'une réception Hub (réception, réconciliation à l'ouverture, revalidation) pour chaque
 * commande touchée par des lignes regroupées. La réception Hub reste toujours acquise : un échec ici crée une alerte
 * et ne remonte jamais à l'appelant (le signal « réception bloquée » sert de filet).
 *
 *   - une PO regroupée dont toutes les lignes non annulées sont reçues passe en `hub_received` ;
 *   - une commande `ordered` dont chaque item non LOCAL_STOCK est couvert (Σ effectif des lignes ≥ quantité) ET
 *     entièrement reçu passe en `preparation` (machine d'états), puis SCAN 3 ;
 *   - fail-closed : une ligne soldée sans reliquat rouvert laisse l'item sous-couvert, la commande reste bloquée
 *     avant la préparation (l'expédition partielle d'une commande est hors périmètre) ;
 *   - idempotente : un second appel ne change rien (PO déjà `hub_received`, transition `noop`, pas de second SCAN 3).
 *
 * Le chemin historique (`processReceive`) n'est pas modifié : sa complétude lit la même vue de progression.
 */

const db = require('../db');
const { transitionOrderStatus } = require('./order-status-machine');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'purchasing-completion' });

let triggerScan3;
try {
  triggerScan3 = require('./scan-operations').triggerScan3;
} catch (err) {
  log.warn({ err }, '[purchasing-completion] triggerScan3 non disponible');
  triggerScan3 = async () => {};
}

const RECEIVABLE_PO_STATUSES = ['notified', 'confirmed', 'shipped'];

/** Une PO regroupée (order_id NULL) dont toutes les lignes non annulées sont reçues passe en hub_received. */
async function closeReceivedGroupedPurchaseOrders(client, poIds) {
  const closed = [];
  const ids = [...new Set(poIds)].sort();
  for (const poId of ids) {
    const { rows: [po] } = await client.query(
      'SELECT id, order_id, status FROM purchase_orders WHERE id = $1 FOR UPDATE',
      [poId]
    );
    if (!po || po.order_id !== null || !RECEIVABLE_PO_STATUSES.includes(po.status)) continue;
    const { rows: progress } = await client.query(`
      SELECT effective_quantity, received_quantity
        FROM v_purchase_line_progress
       WHERE purchase_order_id = $1 AND NOT cancelled
    `, [poId]);
    if (!progress.length) continue;
    if (!progress.every((p) => Number(p.received_quantity) >= Number(p.effective_quantity))) continue;
    await client.query(`
      UPDATE purchase_orders
         SET status = 'hub_received', hub_received_at = COALESCE(hub_received_at, NOW()), updated_at = NOW(),
             notes = CONCAT(COALESCE(notes, ''), E'\\n[GROUPED] toutes les lignes sont reçues au Hub')
       WHERE id = $1
    `, [poId]);
    closed.push(poId);
  }
  return closed;
}

/**
 * Verdict de complétude d'une commande, lu uniquement depuis la vue de progression.
 * @returns {{ items_total: number, items_complete: number, complete: boolean }}
 */
function computeCompletion(items, lines) {
  const byItem = new Map();
  for (const line of lines) {
    const entry = byItem.get(line.order_item_id) || { effective: 0, allReceived: true };
    entry.effective += Number(line.effective_quantity);
    if (Number(line.received_quantity) < Number(line.effective_quantity)) entry.allReceived = false;
    byItem.set(line.order_item_id, entry);
  }
  let complete = 0;
  for (const item of items) {
    const entry = byItem.get(item.id);
    if (entry && entry.effective >= Number(item.quantity) && entry.allReceived) complete += 1;
  }
  return { items_total: items.length, items_complete: complete, complete: items.length > 0 && complete === items.length };
}

async function evaluateOrderProcurementCompletion(orderId, { actor = null } = {}) {
  const evaluation = await db.withTransaction(async (client) => {
    const { rows: [order] } = await client.query('SELECT id, status FROM orders WHERE id = $1', [orderId]);
    if (!order) return { found: false };
    const { rows: items } = await client.query(`
      SELECT id, quantity FROM order_items
       WHERE order_id = $1 AND COALESCE(fulfillment_source, '') <> 'LOCAL_STOCK'
    `, [orderId]);
    const { rows: lines } = await client.query(`
      SELECT line_id, order_item_id, purchase_order_id, effective_quantity, received_quantity
        FROM v_purchase_line_progress
       WHERE order_id = $1 AND NOT cancelled
    `, [orderId]);
    const poIds = lines.map((l) => l.purchase_order_id).filter(Boolean);
    const closed = await closeReceivedGroupedPurchaseOrders(client, poIds);
    return { found: true, status: order.status, closed, ...computeCompletion(items, lines) };
  });

  if (!evaluation.found) return { order_id: orderId, found: false, complete: false, transition: 'skipped' };
  const verdict = {
    order_id: orderId, found: true, complete: evaluation.complete,
    items_total: evaluation.items_total, items_complete: evaluation.items_complete,
    purchase_orders_closed: evaluation.closed, transition: 'skipped',
  };
  if (!evaluation.complete || evaluation.status !== 'ordered') return verdict;

  const result = await transitionOrderStatus({
    orderId,
    newStatus: 'preparation',
    actor: { id: actor && actor.id ? actor.id : null, role: actor && actor.role ? actor.role : 'system' },
    source: 'system',
    note: 'Tous les achats fournisseur reçus au hub',
  });
  if (!result.success) {
    const err = new Error(result.error || 'Transition vers preparation refusée');
    err.code = 'ORDER_PREPARATION_TRANSITION_REFUSED';
    throw err;
  }
  if (result.noop) return { ...verdict, transition: 'noop' };

  try {
    await triggerScan3(orderId, actor && actor.id ? actor.id : null);
  } catch (err) {
    // SCAN 3 est une notification : ne jamais défaire la transition.
    log.error({ err, order_id: orderId }, '[purchasing-completion] SCAN 3 en échec');
  }
  return { ...verdict, transition: 'preparation' };
}

/** Commandes distinctes touchées par des lignes regroupées (allocation.purchase_line_id renseigné). */
function groupedOrderIdsFrom(allocations) {
  const ids = new Set();
  for (const entry of allocations || []) {
    const allocation = entry && entry.allocation ? entry.allocation : entry;
    if (allocation && allocation.purchase_line_id && allocation.order_id) ids.add(allocation.order_id);
  }
  return [...ids].sort();
}

/**
 * À appeler après COMMIT d'une réception Hub. Ne lève jamais : chaque échec devient une alerte.
 * @returns {Promise<object[]>} un verdict par commande (ou { error } si l'évaluation a échoué)
 */
async function completeOrdersAfterHubReceipt(allocations, { actor = null } = {}) {
  const results = [];
  for (const orderId of groupedOrderIdsFrom(allocations)) {
    try {
      results.push(await evaluateOrderProcurementCompletion(orderId, { actor }));
    } catch (err) {
      log.error({ err, order_id: orderId }, '[purchasing-completion] complétude en échec après réception Hub');
      results.push({ order_id: orderId, error: err.message });
      try {
        await createAlert(db, {
          type: 'purchasing_completion_failed', entityType: 'order', entityId: orderId, severity: 'high',
          title: `Complétude d'achat en échec après réception Hub — commande ${orderId}`,
          description: `error=${err.message} code=${err.code || 'n/a'}`,
        });
      } catch (alertErr) {
        log.error({ err: alertErr, order_id: orderId }, '[purchasing-completion] alerte non enregistrée');
      }
    }
  }
  return results;
}

module.exports = {
  evaluateOrderProcurementCompletion,
  completeOrdersAfterHubReceipt,
  groupedOrderIdsFrom,
  computeCompletion,
};
