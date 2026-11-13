/**
 * @komerce-arch
 * @role          purchasing-order-completion-service
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        order_id, hub_allocations, actor
 * @outputs       order_completion_verdict, purchase_order_hub_received, order_status_preparation
 * @depends       db, services/auto-parcel.js, services/supplier-shortage-service.js, services/order-status-machine.js, services/scan-operations.js, utils/alerts.js, utils/logger.js
 * @used-by       services/hub-operations.js, bootstrap/crons.js
 * @db-read       order_items, purchase_lines, hub_physical_unit_placements, hub_purchase_allocations, parcel_items, orders, purchase_orders, v_purchase_line_progress
 * @db-write      alerts, incidents, purchase_orders, parcels, parcel_items
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
 * Le chemin historique de réception déclarative est supprimé : seul le reçu physique sert la complétude.
 */

const db = require('../db');
const { transitionOrderStatus } = require('./order-status-machine');
const { createAlert } = require('../utils/alerts');
const { openSupplierShortage } = require('./supplier-shortage-service');
const log = require('../utils/logger').child({ module: 'purchasing-completion' });

let triggerScan3;
try {
  triggerScan3 = require('./scan-operations').triggerScan3;
} catch (err) {
  log.warn({ err }, '[purchasing-completion] triggerScan3 non disponible');
  triggerScan3 = async () => {};
}

const RECEIVABLE_PO_STATUSES = ['notified', 'confirmed', 'shipped'];

/**
 * Une PO (regroupée OU historique) dont toutes les lignes non annulées sont physiquement reçues (vue = custody)
 * passe en hub_received. Seule la réception physique ferme une PO : plus de compteur déclaratif.
 */
async function closeReceivedGroupedPurchaseOrders(client, poIds) {
  const closed = [];
  const ids = [...new Set(poIds)].sort();
  for (const poId of ids) {
    const { rows: [po] } = await client.query(
      'SELECT id, order_id, status FROM purchase_orders WHERE id = $1 FOR UPDATE',
      [poId]
    );
    if (!po || !RECEIVABLE_PO_STATUSES.includes(po.status)) continue;
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
             notes = CONCAT(COALESCE(notes, ''), CASE WHEN order_id IS NULL
                                                       THEN E'\\n[GROUPED] toutes les lignes sont reçues au Hub'
                                                       ELSE E'\\n[HUB] réception physique complète (custody)' END)
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
function computeCompletion(items, lines, settledLineIds = new Set()) {
  const byItem = new Map();
  for (const line of lines) {
    const entry = byItem.get(line.order_item_id) || { effective: 0, received: 0, allReceived: true, settled: false };
    entry.effective += Number(line.effective_quantity);
    entry.received += Number(line.received_quantity);
    if (Number(line.received_quantity) < Number(line.effective_quantity)) entry.allReceived = false;
    if (settledLineIds.has(line.line_id)) entry.settled = true;
    byItem.set(line.order_item_id, entry);
  }
  let complete = 0;
  let receivedTotal = 0;
  const shortages = [];
  for (const item of items) {
    const entry = byItem.get(item.id);
    if (!entry || !entry.allReceived) continue;
    if (entry.effective >= Number(item.quantity)) { complete += 1; receivedTotal += entry.received; continue; }
    // H1 / HB-02 : rupture définitive (ligne soldée sans reliquat) : la quantité soldée vaut couverture.
    // Le manquant est remboursé (décision 1), la commande part avec ce qui a été reçu.
    if (entry.settled) {
      complete += 1;
      receivedTotal += entry.received;
      shortages.push({ order_item_id: item.id, missing_quantity: Number(item.quantity) - entry.received, received_quantity: entry.received });
    }
  }
  // Une commande dont rien n'a été reçu ne part pas : elle relève du remboursement, pas de la préparation.
  const allCovered = items.length > 0 && complete === items.length;
  return { items_total: items.length, items_complete: complete, complete: allCovered && receivedTotal > 0, shortages };
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
    const lineIds = lines.map((l) => l.line_id).filter(Boolean);
    const { rows: settledRows } = lineIds.length
      ? await client.query('SELECT id FROM purchase_lines WHERE id = ANY($1::uuid[]) AND settled_at IS NOT NULL', [lineIds])
      : { rows: [] };
    const poIds = lines.map((l) => l.purchase_order_id).filter(Boolean);
    const closed = await closeReceivedGroupedPurchaseOrders(client, poIds);
    return { found: true, status: order.status, closed, ...computeCompletion(items, lines, new Set(settledRows.map((r) => r.id))) };
  });

  if (!evaluation.found) return { order_id: orderId, found: false, complete: false, transition: 'skipped' };
  // HB-02 : chaque rupture définitive ouvre (une fois) une demande de remboursement de ligne visible en alerte.
  for (const shortage of evaluation.shortages) await openShortageRefundRequest(orderId, shortage);
  const verdict = {
    order_id: orderId, found: true, complete: evaluation.complete, shortages: evaluation.shortages,
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
  const distribution = await autoDistribute(orderId);
  return { ...verdict, transition: 'preparation', distribution };
}

/**
 * H1 / HB-03 : répartition automatique en colis au passage en `preparation`. Ne lève jamais : un échec devient une
 * alerte, le bouton « Répartir » et le balayage restent la reprise. distributeOrder est idempotent et verrouillé (H2).
 */
async function autoDistribute(orderId) {
  try {
    const { distributeOrder } = require('./auto-parcel');
    const outcome = await distributeOrder(orderId);
    if (outcome && outcome.success === false) throw new Error(outcome.error || 'répartition refusée');
    return outcome;
  } catch (err) {
    log.error({ err, order_id: orderId }, '[purchasing-completion] répartition automatique en échec');
    try {
      await createAlert(db, {
        type: 'purchasing_distribution_failed', entityType: 'order', entityId: orderId, severity: 'medium',
        title: `Répartition automatique en échec — commande ${orderId}`,
        description: `error=${err.message} ; reprise manuelle : bouton « Répartir »`,
      });
    } catch (alertErr) {
      log.error({ err: alertErr, order_id: orderId }, '[purchasing-completion] alerte non enregistrée');
    }
    return { success: false, error: err.message };
  }
}

/**
 * Demande de remboursement de ligne (décision 1). Normalement ouverte à la clôture (settleLine) ; ce rattrapage couvre
 * les clôtures antérieures : toute ligne soldée sans reliquat de l'article reçoit son incident « rupture fournisseur »
 * et son alerte. Idempotent par ligne (aucun doublon d'incident). Ne lève jamais.
 */
async function openShortageRefundRequest(orderId, shortage) {
  try {
    const { rows: lines } = await db.query(`
      SELECT pl.id, COALESCE(pl.confirmed_quantity, pl.quantity) - pl.settled_quantity AS missing, pl.settle_reason
        FROM purchase_lines pl
       WHERE pl.order_item_id = $1 AND pl.settled_at IS NOT NULL AND pl.cancelled_at IS NULL
         AND COALESCE(pl.confirmed_quantity, pl.quantity) - pl.settled_quantity > 0
         AND NOT EXISTS (SELECT 1 FROM purchase_lines c WHERE c.parent_line_id = pl.id AND c.cancelled_at IS NULL)
    `, [shortage.order_item_id]);
    let opened = false;
    for (const l of lines) {
      const r = await openSupplierShortage(db, {
        purchaseLineId: l.id, orderItemId: shortage.order_item_id, missingQuantity: Number(l.missing),
        receivedQuantity: shortage.received_quantity, reason: l.settle_reason, actorId: null,
      });
      opened = opened || r.created || r.alert_created;
    }
    return opened;
  } catch (err) {
    log.error({ err, order_id: orderId }, '[purchasing-completion] incident de rupture fournisseur non enregistré');
    return false;
  }
}

/** Réception rejouée : on recalcule la complétude des commandes de l'unité (HB-01). Ne lève jamais. */
async function completeOrdersForPhysicalUnit(unitId, { actor = null } = {}) {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT a.order_id FROM hub_physical_unit_placements p
         JOIN hub_purchase_allocations a ON a.id = p.allocation_id
        WHERE p.physical_unit_id = $1 AND a.order_id IS NOT NULL`, [unitId]
    );
    return await completeOrdersAfterHubReceipt(rows.map((r) => ({ order_id: r.order_id })), { actor });
  } catch (err) {
    log.error({ err, unit_id: unitId }, '[purchasing-completion] complétude après rejeu en échec');
    return [];
  }
}

/**
 * Balayage périodique (invariant H1) : commandes `ordered` dont tout est reçu, et commandes `preparation` restées sans
 * ligne de colis (arrêt entre transition et répartition). Idempotent ; ne lève jamais.
 */
async function sweepStalledOrders({ limit = 50 } = {}) {
  const swept = { ordered: 0, distributed: 0, errors: 0 };
  try {
    const { rows: ordered } = await db.query(`
      SELECT o.id FROM orders o
       WHERE o.status = 'ordered'
         AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT')
         AND NOT EXISTS (SELECT 1 FROM v_purchase_line_progress v
                          WHERE v.order_id = o.id AND NOT v.cancelled AND v.received_quantity < v.effective_quantity)
       ORDER BY o.created_at ASC LIMIT $1`, [limit]);
    for (const { id } of ordered) {
      try {
        const verdict = await evaluateOrderProcurementCompletion(id, { actor: null });
        if (verdict.transition === 'preparation') swept.ordered += 1;
      } catch (err) {
        swept.errors += 1;
        log.error({ err, order_id: id }, '[purchasing-completion] balayage : complétude en échec');
      }
    }
    const { rows: undistributed } = await db.query(`
      SELECT o.id FROM orders o
       WHERE o.status = 'preparation'
         AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT')
         AND NOT EXISTS (SELECT 1 FROM parcel_items pi JOIN order_items oi ON oi.id = pi.order_item_id
                           JOIN parcels p ON p.id = pi.parcel_id AND p.status NOT IN ('cancelled')
                          WHERE oi.order_id = o.id)
       ORDER BY o.created_at ASC LIMIT $1`, [limit]);
    for (const { id } of undistributed) {
      const outcome = await autoDistribute(id);
      if (outcome && outcome.success !== false) swept.distributed += 1; else swept.errors += 1;
    }
  } catch (err) {
    swept.errors += 1;
    log.error({ err }, '[purchasing-completion] balayage en échec');
  }
  return swept;
}

/** Commandes distinctes touchées par une réception (allocations regroupées et historiques). */
function groupedOrderIdsFrom(allocations) {
  const ids = new Set();
  for (const entry of allocations || []) {
    const allocation = entry && entry.allocation ? entry.allocation : entry;
    // Formes regroupée ET historique (purchase_line_id NULL) : la vue lit la custody pour les deux.
    if (allocation && allocation.order_id) ids.add(allocation.order_id);
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
  completeOrdersForPhysicalUnit,
  sweepStalledOrders,
  autoDistribute,
};
