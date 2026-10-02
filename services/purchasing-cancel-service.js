/**
 * @komerce-arch
 * @role          purchasing-cancel-service
 * @domain        purchasing
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/alerts.js, utils/logger.js
 * @used-by       services/cancel-order-purchase-orders.js
 * @db-read       order_items, purchase_lines, purchase_orders
 * @db-write      alerts, purchase_lines, purchase_orders
 * @db-txn        caller_managed
 * @doctrine      writer_not_owner_campaign_2026_08
 * @impact-areas  orders, purchasing, cancellation
 * @version       2026-08
 */

'use strict';

/**
 * LOT1 WRITER-NOT-OWNER — frontière propriétaire de purchase_orders.
 *
 * La commande déclenche l'intention d'annulation, mais seul le domaine
 * purchasing manipule le lifecycle des bons de commande. Le client `q` est
 * fourni par orders afin de conserver exactement la transaction existante.
 *
 * Doctrine prudente :
 * - POs pending/notified : annulées automatiquement avec la commande.
 * - POs confirmed/received/partially_received : pas de forçage, alerte opérationnelle.
 * - POs déjà cancelled : ignorées.
 */

const db = require('../db');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'purchasing-cancel-service' });

const AUTO_CANCEL_STATUSES = ['pending', 'notified'];
const BLOCKING_STATUSES = ['confirmed', 'received', 'partially_received', 'hub_received'];

async function syncPurchaseOrdersOnOrderCancel(q = db, { orderId, orderReference = null, actor = null, reason = null } = {}) {
  if (!orderId) throw new Error('[syncPurchaseOrdersOnOrderCancel] orderId requis');

  const historical = await syncHistoricalPurchaseOrders(q, { orderId, orderReference, actor, reason });
  const groupedResult = await syncGroupedLinesOnOrderCancel(q, { orderId, orderReference, actor, reason });

  return {
    total: historical.total + groupedResult.total,
    auto_cancelled: historical.auto_cancelled + groupedResult.auto_cancelled,
    blocking: historical.blocking + groupedResult.blocking,
    blocking_pos: [...historical.blocking_pos, ...groupedResult.blocking_pos],
    lines_cancelled: groupedResult.lines_cancelled,
  };
}

async function syncHistoricalPurchaseOrders(q, { orderId, orderReference, actor, reason }) {

  const { rows: purchaseOrders } = await q.query(
    `SELECT id, status, supplier_id, supplier_order_id
       FROM purchase_orders
      WHERE order_id = $1
        AND status != 'cancelled'
      FOR UPDATE`,
    [orderId]
  );

  if (!purchaseOrders.length) {
    return { total: 0, auto_cancelled: 0, blocking: 0, blocking_pos: [] };
  }

  const autoIds = purchaseOrders
    .filter(po => AUTO_CANCEL_STATUSES.includes(po.status))
    .map(po => po.id);

  const blockingPos = purchaseOrders
    .filter(po => !AUTO_CANCEL_STATUSES.includes(po.status))
    .map(po => ({
      id: po.id,
      status: po.status,
      supplier_id: po.supplier_id,
      supplier_order_id: po.supplier_order_id || null,
    }));

  if (autoIds.length) {
    await q.query(
      `UPDATE purchase_orders
          SET status = 'cancelled',
              updated_at = NOW(),
              notes = CONCAT(COALESCE(notes, ''), $2::text)
        WHERE id = ANY($1::uuid[])`,
      [
        autoIds,
        `\n[I-SWEEP-5A] Annulée automatiquement avec la commande${reason ? ` — ${reason}` : ''}`,
      ]
    );
  }

  if (blockingPos.length) {
    await insertBlockingAlert(q, {
      orderId,
      orderReference,
      actor,
      reason,
      blockingPos,
    });
  }

  return {
    total: purchaseOrders.length,
    auto_cancelled: autoIds.length,
    blocking: blockingPos.length,
    blocking_pos: blockingPos,
  };
}

/**
 * Forme regroupée (PR 4) : une commande annulée ne doit jamais laisser une ligne vivante côté achats.
 *   - ligne ouverte (sans PO)              → annulée (cancel_reason='order_cancelled') ;
 *   - ligne d'une PO regroupée en `draft`  → détachée puis annulée ; une PO brouillon vidée passe en `cancelled` ;
 *   - ligne d'une PO regroupée déjà soumise (notified/confirmed/reçue…) → RIEN d'automatique : le fournisseur est
 *     sollicité, alerte `order_cancel_purchasing_blocked` avec purchase_line_ids, l'humain décide.
 * Ordre de verrouillage commun avec purchasing-grouped-service : PO d'abord, lignes ensuite (identifiants triés).
 */
async function syncGroupedLinesOnOrderCancel(q, { orderId, orderReference, actor, reason }) {
  const lineScope = `
      FROM purchase_lines pl
      JOIN order_items oi ON oi.id = pl.order_item_id
      LEFT JOIN purchase_orders po ON po.id = pl.purchase_order_id
     WHERE oi.order_id = $1 AND pl.cancelled_at IS NULL AND po.order_id IS NULL`;

  const { rows: peeked } = await q.query(
    `SELECT DISTINCT pl.purchase_order_id AS id ${lineScope} AND pl.purchase_order_id IS NOT NULL ORDER BY 1`,
    [orderId]
  );
  const poIds = peeked.map((r) => r.id);
  const { rows: poRows } = poIds.length
    ? await q.query(
      'SELECT id, status, supplier_id, supplier_order_id FROM purchase_orders WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [poIds]
    )
    : { rows: [] };
  const poById = new Map(poRows.map((po) => [po.id, po]));

  const { rows: lines } = await q.query(
    `SELECT pl.id, pl.purchase_order_id ${lineScope} ORDER BY pl.id FOR UPDATE OF pl`,
    [orderId]
  );
  if (!lines.length) {
    return { total: 0, auto_cancelled: 0, blocking: 0, blocking_pos: [], lines_cancelled: 0 };
  }

  const cancellableIds = [];
  const detachIds = [];
  const touchedDraftPos = new Set();
  const blockingByPo = new Map();
  for (const line of lines) {
    const po = line.purchase_order_id ? poById.get(line.purchase_order_id) : null;
    if (!line.purchase_order_id) {
      cancellableIds.push(line.id);
    } else if (po && po.status === 'draft') {
      detachIds.push(line.id);
      cancellableIds.push(line.id);
      touchedDraftPos.add(po.id);
    } else if (po && po.status !== 'cancelled') {
      const entry = blockingByPo.get(po.id) || {
        id: po.id, status: po.status, supplier_id: po.supplier_id,
        supplier_order_id: po.supplier_order_id || null, purchase_line_ids: [],
      };
      entry.purchase_line_ids.push(line.id);
      blockingByPo.set(po.id, entry);
    }
  }

  if (detachIds.length) {
    await q.query('UPDATE purchase_lines SET purchase_order_id = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])', [detachIds]);
  }
  if (cancellableIds.length) {
    await q.query(
      `UPDATE purchase_lines SET cancelled_at = NOW(), cancel_reason = 'order_cancelled', updated_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [cancellableIds]
    );
  }

  let emptied = 0;
  for (const poId of touchedDraftPos) {
    const { rows: [rest] } = await q.query(
      'SELECT count(*)::int AS n FROM purchase_lines WHERE purchase_order_id = $1 AND cancelled_at IS NULL',
      [poId]
    );
    if (rest.n === 0) {
      await q.query(
        `UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW(),
                notes = CONCAT(COALESCE(notes, ''), $2::text)
          WHERE id = $1`,
        [poId, `\n[GROUPED] brouillon vidé par l'annulation de la commande${reason ? ` — ${reason}` : ''}`]
      );
      emptied += 1;
    }
  }

  const blockingPos = [...blockingByPo.values()];
  if (blockingPos.length) {
    await insertBlockingAlert(q, { orderId, orderReference, actor, reason, blockingPos });
  }

  return {
    total: touchedDraftPos.size + blockingPos.length,
    auto_cancelled: emptied,
    blocking: blockingPos.length,
    blocking_pos: blockingPos,
    lines_cancelled: cancellableIds.length,
  };
}

async function insertBlockingAlert(q, { orderId, orderReference, actor, reason, blockingPos }) {
  // `q` peut être le pool `db` (appel autonome) OU le client transactionnel
  // de la machine de statut. Un échec d'alerte ne doit pas empoisonner la
  // transaction d'annulation ; le SAVEPOINT conserve ce contrat historique.
  let savepointActive = false;
  try {
    await q.query('SAVEPOINT cancel_order_po_alert');
    savepointActive = true;
  } catch (_e) { /* q hors transaction (pool) — pas de savepoint nécessaire */ }

  try {
    await createAlert(q, {
      type: 'order_cancel_purchasing_blocked',
      entityType: 'order',
      entityId: orderId,
      severity: 'medium',
      title: `Commande annulée avec PO fournisseur déjà engagée${orderReference ? ` — ${orderReference}` : ''}`,
      description: `actor=${JSON.stringify(actor)} reason=${reason || 'n/a'} ` +
        `blocking_purchase_orders=${JSON.stringify(blockingPos)} ` +
        `doctrine=pending/notified auto-cancelled; engaged POs require manual handling`,
    });
    if (savepointActive) await q.query('RELEASE SAVEPOINT cancel_order_po_alert').catch(() => {});
  } catch (err) {
    if (savepointActive) await q.query('ROLLBACK TO SAVEPOINT cancel_order_po_alert').catch(() => {});
    log.error({ err }, '[I-SWEEP-5A] failed to insert purchasing cancel alert:');
  }
}

module.exports = {
  syncPurchaseOrdersOnOrderCancel,
  AUTO_CANCEL_STATUSES,
  BLOCKING_STATUSES,
};
