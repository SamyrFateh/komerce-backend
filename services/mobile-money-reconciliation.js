/**
 * @komerce-arch
 * @role          mobile-money-reconciliation
 * @domain        payment
 * @layer         service
 * @criticality   high
 * @inputs        pending_mobile_money_transactions
 * @outputs       provider_reconciliation_attempts
 * @depends       db.js, services/payment-mobile-money.js
 * @used-by       bootstrap/crons.js
 * @db-read       mobile_money_transactions
 * @db-write      none
 * @db-txn        provider_http_outside_db_tx
 * @doctrine      callback_not_required, bounded_reconciliation, idempotent_provider_refresh
 * @impact-areas  payment, operations
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'mobile-money-reconciliation' });
const { reconcileMobileMoneyTransaction } = require('./payment-mobile-money');

/**
 * Reprend un nombre borné de transactions encore actives.
 *
 * Aucune transaction DB n'est ouverte autour de l'appel provider : la query
 * ne fait que sélectionner des IDs, puis chaque réconciliation suit le contrat
 * de payment-mobile-money (HTTP externe hors transaction, finalisation atomique).
 */
async function reconcilePendingMobileMoney({ limit = 25 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const { rows } = await db.query(
    `SELECT id
       FROM mobile_money_transactions
      WHERE status IN ('initiated', 'pending')
        AND updated_at < NOW() - INTERVAL '20 seconds'
      ORDER BY updated_at ASC
      LIMIT $1`,
    [safeLimit]
  );

  const result = { scanned: rows.length, reconciled: 0, succeeded: 0, failed: 0 };

  // Séquentiel volontaire : pas de rafale vers les APIs opérateurs lorsqu'un
  // runtime redémarre avec plusieurs transactions à reprendre.
  for (const row of rows) {
    try {
      const refreshed = await reconcileMobileMoneyTransaction(row.id);
      result.reconciled += 1;
      if (refreshed?.transaction?.status === 'succeeded') result.succeeded += 1;
    } catch (err) {
      result.failed += 1;
      log.warn({ err, transaction_id: row.id }, '[MOBILE-MONEY] periodic reconciliation failed');
    }
  }

  return result;
}

module.exports = { reconcilePendingMobileMoney };
