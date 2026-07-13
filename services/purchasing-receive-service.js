/**
 * @komerce-arch
 * @role          purchasing-receive-service
 * @domain        purchasing
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/scan-operations.js, services/order-status-machine.js, utils/logger.js
 * @used-by       routes/purchasing.js
 * @db-read       purchase_orders
 * @db-write      purchase_orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Purchasing Receive Service
 *
 * Logique de réception Hub extraite de POST /api/purchasing/:id/receive (A-BE-05).
 * Gère la réception partielle ou totale d'une purchase order au Hub Dubai.
 * Déclenche transitionOrderStatus + triggerScan3 quand la commande est complète.
 *
 * Exports publics (façade stable) :
 *   processReceive({ id, qty_recue, actor }) → Promise<ReceiveResult>
 */

const db = require('../db');
const { transitionOrderStatus } = require('./order-status-machine');
const log = require('../utils/logger').child({ module: 'purchasing-receive' });

// ─── Import triggerScan3 depuis le vrai service logistics ─────────────────────
// O7.2 (Cycle B) : importait auparavant routes/scans.js (une route, pas une
// boundary de feature) pour son ré-export de compatibilité. triggerScan3 est
// un vrai service logistics — on le prend directement. Voir
// docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
let triggerScan3;
try {
  triggerScan3 = require('./scan-operations').triggerScan3;
} catch (e) {
  log.warn({ err: e }, '[purchasing-receive] triggerScan3 non disponible:');
  triggerScan3 = async () => {};
}

/**
 * processReceive({ id, qty_recue, actor })
 *
 * @param {string}      id        - UUID de la purchase_order
 * @param {number|null} qty_recue - Quantité reçue maintenant (null = totalité restante)
 * @param {{ id, role }} actor    - Utilisateur déclencheur (req.user)
 * @returns {Promise<ReceiveResult>}
 *
 * @typedef {Object} ReceiveResult
 * @property {boolean} success
 * @property {string}  po_status
 * @property {string}  order_id
 * @property {string}  order_status
 * @property {boolean} ready_to_prepare
 * @property {number}  items_received
 * @property {number}  items_total
 * @property {number}  items_missing
 * @property {number}  qty_totale
 * @property {number}  qty_recue
 * @property {string}  message
 * @property {{ error: string, status: number }|null} httpError - présent si erreur métier
 */
async function processReceive({ id, qty_recue, actor }) {
  // 1. Récupérer la PO courante
  // [B1] qty (pas quantity) | [B2] hub_received_at (pas received_at)
  const poRes = await db.query(
    `SELECT id, order_id, qty, received_qty, status, hub_received_at
     FROM purchase_orders
     WHERE id = $1`,
    [id]
  );

  if (!poRes.rows.length) {
    return { httpError: { error: 'PO introuvable', status: 404 } };
  }

  const po = poRes.rows[0];

  // Quantité à incrémenter : celle fournie, sinon le reste non reçu
  // [B1] po.qty (pas po.quantity)
  const delta = qty_recue !== null
    ? Math.min(qty_recue, po.qty - po.received_qty)
    : po.qty - po.received_qty;

  if (delta <= 0) {
    return { httpError: { error: 'Quantité déjà reçue en totalité', status: 400 } };
  }

  const new_received = po.received_qty + delta;
  // [B1] po.qty (pas po.quantity)
  const po_complete  = new_received >= po.qty;

  // 2. Mettre à jour ce PO
  // [B2] hub_received_at (pas received_at)
  const updatedPo = await db.query(
    `UPDATE purchase_orders
     SET received_qty     = $1,
         status           = $2,
         hub_received_at  = CASE WHEN $3 THEN NOW() ELSE hub_received_at END,
         updated_at       = NOW()
     WHERE id = $4
     RETURNING *`,
    [
      new_received,
      po_complete ? 'hub_received' : 'confirmed',
      po_complete,
      id,
    ]
  );

  // 3. Vérifier si TOUS les POs de la commande sont reçus
  // [B1] qty (pas quantity) dans SUM et dans CASE
  const completenessRes = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status != 'cancelled')                             AS total,
       COUNT(*) FILTER (WHERE received_qty >= qty AND status != 'cancelled')     AS recus,
       SUM(qty)          FILTER (WHERE status != 'cancelled')                    AS qty_totale,
       SUM(received_qty) FILTER (WHERE status != 'cancelled')                    AS qty_recue
     FROM purchase_orders
     WHERE order_id = $1`,
    [po.order_id]
  );

  const { total, recus, qty_totale, qty_recue: qty_recue_total } = completenessRes.rows[0];
  const order_complete = parseInt(recus) === parseInt(total);

  // 4. Mettre à jour le statut de la commande si complète
  if (order_complete) {
    const statusResult = await transitionOrderStatus({
      orderId: po.order_id,
      newStatus: 'preparation',
      actor: { id: actor?.id || null, role: actor?.role || 'system' },
      source: 'system',
      note: 'Tous les achats fournisseur recus au hub',
    });

    if (!statusResult.success && !statusResult.noop) {
      return { httpError: { error: statusResult.error, status: 409 } };
    }

    // Déclencher SCAN 3 (notification SMS hub + client)
    try {
      await triggerScan3(po.order_id, actor?.id || null);
    } catch (smsErr) {
      // Ne pas bloquer la réception si le SMS échoue — logguer seulement
      log.error('[purchasing-receive] Erreur SMS SCAN3:', smsErr.message);
    }
  } else {
    log.info(`[PURCHASING] Réception partielle commande ${po.order_id} — ${recus}/${total} articles`);
  }

  // 5. Construire le résultat opérateur
  const items_missing = parseInt(total) - parseInt(recus);

  return {
    success:          true,
    po_status:        updatedPo.rows[0].status,
    order_id:         po.order_id,
    order_status:     order_complete ? 'preparation' : 'ordered',
    ready_to_prepare: order_complete,
    items_received:   parseInt(recus),
    items_total:      parseInt(total),
    items_missing,
    qty_totale:       parseInt(qty_totale),
    qty_recue:        parseInt(qty_recue_total),
    message: order_complete
      ? `✅ Commande complète — ${total}/${total} articles — Prête à préparer`
      : `📦 Réception partielle — ${recus}/${total} articles — ${items_missing} manquant(s)`,
  };
}

module.exports = { processReceive };
