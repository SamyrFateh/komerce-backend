'use strict';

/**
 * KOMERCE — services/cash-operations.js  (R5)
 *
 * Logique métier de collecte cash extraite de routes/cash.js.
 * La route reste une façade : auth + validate + appel service + réponse.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Invariants respectés                                               ║
 * ║  I-01 : toute transition passe par order-status-machine            ║
 * ║  I-02 : confirmPaymentCycle = seul point d'entrée paiement→stock   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Exports :
 *   collectCash({ orderId, agentUser, dbClient })
 */

const { confirmPaymentCycle } = require('./order-payment-confirmation');
const log = require('../utils/logger').child({ module: 'cash-operations' });

// ─── collectCash ──────────────────────────────────────────────────────────────
/**
 * Confirme l'encaissement cash d'une commande par un agent relais.
 * Appelée dans une transaction fournie par la route (dbClient).
 *
 * Chemins de sortie (la route construit la réponse HTTP) :
 *   { order_not_found }          — 404
 *   { invalid_payment_mode }     — 400
 *   { invalid_payment_status, payment_status } — 409 (déjà 'paid'/'refunded'/etc.)
 *   { invalid_status, status }   — 409
 *   { cross_relais_blocked }     — 403 + alerte insérée
 *   { agent_config_error }       — 403 + alerte insérée
 *   { already_collected, id }    — 409
 *   { stock_blocked, items }     — 409, ROLLBACK effectué
 *   { success, collection, noop }— 201
 *
 * @param {object} opts
 * @param {string}  opts.orderId     — UUID commande
 * @param {object}  opts.agentUser   — { id, role, relais_id? } depuis req.user
 * @param {object}  opts.dbClient    — client pg déjà dans BEGIN par la route
 * @returns {object}
 */
async function collectCash({ orderId, agentUser, dbClient }) {
  const client  = dbClient;
  const agentId = agentUser.id;

  // 1. Vérifier la commande (FOR UPDATE — race condition protection)
  const { rows: [order] } = await client.query(`
    SELECT id, total_kmf, payment_mode, payment_status, status, relais_id
    FROM orders WHERE id = $1 FOR UPDATE
  `, [orderId]);

  if (!order) return { order_not_found: true };

  if (order.payment_mode !== 'cash_relais') {
    return { invalid_payment_mode: true };
  }

  if (order.payment_status !== 'pending') {
    return { invalid_payment_status: true, payment_status: order.payment_status };
  }

  const INVALID_COLLECT_STATUSES = ['cancelled', 'refunded', 'collected'];
  if (INVALID_COLLECT_STATUSES.includes(order.status)) {
    return { invalid_status: true, status: order.status };
  }

  // 2. Cross-relais check : l'agent_relais ne peut encaisser qu'au relais où il est affecté
  if (agentUser.role === 'agent_relais') {
    let agentRelaisId = null;
    let checkPossible = true;
    try {
      const { rows: [agent] } = await client.query(
        'SELECT relais_id FROM users WHERE id = $1', [agentId]
      );
      agentRelaisId = agent?.relais_id || null;
    } catch (e) {
      checkPossible = false;
      log.warn(`[CASH-COLLECT] users.relais_id query failed: ${e.message}`);
    }

    if (!checkPossible || !agentRelaisId) {
      // Alert fire-and-forget hors transaction principale (on est dans BEGIN)
      _insertAlertAsync(client, 'elevated', 'cash_collect',
        `agent_relais sans relais_id tente cash_collect: user=${agentId}`,
        { order_id: orderId, user_id: agentId }
      );
      return { agent_config_error: true };
    }

    if (String(agentRelaisId) !== String(order.relais_id)) {
      log.warn(`[CASH-COLLECT] ⛔ Cross-relais refusé — agent ${agentId} (relais ${agentRelaisId}) tentait commande ${orderId} (relais ${order.relais_id})`);
      _insertAlertAsync(client, 'elevated', 'cash_collect',
        `Cross-relais refusé — order ${orderId}`,
        { user_id: agentId, agent_relais_id: agentRelaisId, order_relais_id: order.relais_id }
      );
      return { cross_relais_blocked: true };
    }
  }

  // 3. Vérifier doublon
  const { rows: existing } = await client.query(
    'SELECT id FROM cash_collections WHERE order_id = $1', [orderId]
  );
  if (existing.length > 0) {
    return { already_collected: true, collection_id: existing[0].id };
  }

  // 4. Option C : montant = order.total_kmf (anti-fraude, pas de saisie manuelle)
  const amountKmf = Number(order.total_kmf);

  const { rows: [collection] } = await client.query(`
    INSERT INTO cash_collections (order_id, amount_kmf, collected_by, relais_id)
    VALUES ($1, $2, $3, $4) RETURNING *
  `, [orderId, amountKmf, agentId, order.relais_id]);

  // 5. Hub I-02 : cycle paiement → stock
  const cycleResult = await confirmPaymentCycle({
    orderId,
    actor:    { id: agentId, role: agentUser.role },
    source:   'cash_confirm',
    dbClient: client,
  });

  if (cycleResult.stockBlocked) {
    // La route fera ROLLBACK après ce retour
    return { stock_blocked: true, insufficient_items: cycleResult.insufficientItems };
  }

  return {
    success:    true,
    collection,
    noop:       cycleResult.noop,
    amount_kmf: amountKmf,
  };
}

// ─── Helper interne ───────────────────────────────────────────────────────────

/**
 * Insère une alerte de façon non-bloquante.
 * Utilise le pool directement pour ne pas polluer la transaction appelante.
 */
function _insertAlertAsync(client, level, source, message, payload) {
  // On insère dans la tx courante car on n'a pas accès au pool ici.
  // L'alerte sera commitée ou rollbackée avec la transaction de la route.
  client.query(
    `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)`,
    [level, source, message, JSON.stringify(payload)]
  ).catch(e => log.error({ err: e.message }, '[CASH-COLLECT] alert insert failed'));
}

module.exports = {
  collectCash,
};
