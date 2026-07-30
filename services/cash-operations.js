/**
 * @komerce-arch
 * @role          payment-cash-operations
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/order-payment-confirmation.js, utils/logger.js
 * @used-by       routes/cash.js
 * @db-read       cash_collections, orders, users
 * @db-write      alerts, cash_collections
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  payment
 * @version       2026-06
 */

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
const { ensureSecretGenerated } = require('./pickup-secret-service');
const { createAlert } = require('../utils/alerts');
const db = require('../db');
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
      // Persistée hors transaction (pool), attendue avant retour — cf. P0-D.
      await _insertSecurityAlert(
        'cash_collect_agent_config_error',
        orderId,
        `agent_relais sans relais_id tente cash_collect — user=${agentId}`,
        `order_id=${orderId} user_id=${agentId}`
      );
      return { agent_config_error: true };
    }

    if (String(agentRelaisId) !== String(order.relais_id)) {
      log.warn(`[CASH-COLLECT] ⛔ Cross-relais refusé — agent ${agentId} (relais ${agentRelaisId}) tentait commande ${orderId} (relais ${order.relais_id})`);
      await _insertSecurityAlert(
        'cash_collect_cross_relais_blocked',
        orderId,
        `Cross-relais refusé — order ${orderId}`,
        `user_id=${agentId} agent_relais_id=${agentRelaisId} order_relais_id=${order.relais_id}`
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

  // Code de retrait canonique — généré ici, à la confirmation du paiement.
  // Idempotent : no-op si déjà généré. Le clair (une seule fois) est renvoyé
  // à la route pour cacheCodeForReveal() APRÈS COMMIT.
  const secretResult = await ensureSecretGenerated({
    orderId,
    relaisId: order.relais_id || null,
    channel:  'cash_confirm',
    dbClient: client,
  });

  return {
    success:    true,
    collection,
    noop:       cycleResult.noop,
    amount_kmf: amountKmf,
    pickupCodeToCache: secretResult.code || null,
  };
}

// ─── Helper interne ───────────────────────────────────────────────────────────

/**
 * Persiste une alerte de sécurité (tentative cross-relais / agent mal
 * configuré) HORS de la transaction métier de la route appelante.
 *
 * Décision transactionnelle (P0-D) : ces alertes doivent survivre à un
 * ROLLBACK de la commande — un ROLLBACK n'annule pas la réalité de la
 * tentative de fraude/mauvaise config, qui reste opérationnellement
 * pertinente pour le triage sécurité. Elles sont donc écrites via le POOL
 * (`db`), jamais via le `client` transactionnel de la route (qui peut être
 * rollback juste après ce retour), et ATTENDUES séquentiellement — jamais
 * deux queries concurrentes non séquencées sur le même PoolClient (c'était
 * le bug : l'ancien code utilisait `client.query(...)` sans `await`, en
 * pleine transaction que la route s'apprêtait à ROLLBACK).
 * Non-bloquant : un échec de persistance de CETTE alerte ne doit jamais
 * faire échouer la réponse 403 déjà décidée.
 */
async function _insertSecurityAlert(type, entityId, title, description) {
  try {
    await createAlert(db, {
      type,
      entityType: 'order',
      entityId,
      severity: 'high',
      title,
      description,
    });
  } catch (e) {
    log.error({ err: e.message }, '[CASH-COLLECT] alert insert failed');
  }
}

module.exports = {
  collectCash,
};
