/**
 * @komerce-arch
 * @role          order-financial-close-pending-signal-producer
 * @domain        orders
 * @layer         service
 * @criticality   medium
 * @inputs        orders_collected_and_paid, reconcileOrderFinancialClose_verdict
 * @outputs       decision_signal_financial_close_economic_facts_pending
 * @depends       db.js, services/order-financial-closure-reconciliation.js, services/signal-service.js
 * @used-by       bootstrap/crons.js
 * @db-read       orders, signals
 * @db-write-via:signal-service signals
 * @db-txn        none
 * @doctrine      verdict_comes_from_reconcileOrderFinancialClose, producer_pushes_to_decision_signals_sink, bounded_evaluation_never_silent, fail_closed_on_evaluation_error
 * @impact-areas  orders, decision-signals, finance
 * @version       2026-10
 */

'use strict';

const db = require('../db');
const log = require('../utils/logger').child({ module: 'order-financial-closure-signal' });
const { reconcileOrderFinancialClose, VERDICT } = require('./order-financial-closure-reconciliation');
const { upsertSignal } = require('./signal-service');

const SIGNAL_TYPE = 'financial_close_economic_facts_pending';
const PENDING_REASON = 'FINANCIAL_CLOSE_ECONOMIC_FACTS_PENDING';

// Fenêtre et plafond bornent le coût (≈5 requêtes par commande évaluée). Un plafond atteint est
// rapporté (`truncated`) et journalisé : jamais silencieux.
const WINDOW_DAYS = 60;
const MAX_EVALUATIONS = 200;

/**
 * Commande encaissée et payée dont les faits économiques ne sont pas mûrs.
 * Le verdict vient de reconcileOrderFinancialClose (seule autorité) ; rien n'est recalculé ici.
 * Une évaluation en échec ne résout rien (fail-closed). Un signal n'est résolu que si sa commande
 * a été réévaluée et n'est plus en attente, ou si elle n'est plus candidate.
 */
async function generateFinancialCloseSignals() {
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.reference
         FROM orders o
        WHERE o.status::text = 'collected'
          AND o.payment_status::text = 'paid'
          AND o.updated_at > NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY o.updated_at ASC
        LIMIT $2`,
      [WINDOW_DAYS, MAX_EVALUATIONS + 1]
    );
    const truncated = rows.length > MAX_EVALUATIONS;
    const evaluated = rows.slice(0, MAX_EVALUATIONS);

    let generated = 0;
    const notPendingIds = [];
    for (const r of evaluated) {
      let verdict;
      try {
        verdict = await reconcileOrderFinancialClose(db, { orderId: r.id });
      } catch (error) {
        log.warn({ err: error, order_id: r.id }, 'financial_close evaluation failed');
        continue;
      }
      if (verdict.verdict === VERDICT.PENDING && verdict.reason === PENDING_REASON) {
        await upsertSignal({
          signal_type: SIGNAL_TYPE,
          severity: 'warning',
          title: r.reference
            ? 'Clôture financière en attente des faits économiques — ' + r.reference
            : 'Clôture financière en attente des faits économiques',
          summary: 'Commande encaissée et payée, mais les faits économiques ne sont pas mûrs : la clôture financière ne peut pas être prononcée.',
          source_module: 'order-financial-closure-signal',
          target_shell: 'bo',
          target_view: 'orders',
          target_filters: { status: 'collected' },
          owner_role: 'finance',
          entity_type: 'order',
          entity_id: r.id,
          recommendation: 'Compléter les faits économiques de la commande (imputations de coûts, disposition) puis relancer la clôture',
          confidence: 'high',
          meta: { reason: verdict.reason },
        });
        generated++;
      } else {
        notPendingIds.push(r.id);
      }
    }

    await db.query(
      `UPDATE signals s
          SET status = 'resolved', resolved_at = NOW(), snoozed_until = NULL, updated_at = NOW()
        WHERE s.signal_type = $3
          AND s.status IN ('open','acknowledged','snoozed')
          AND s.entity_id IS NOT NULL
          AND (
            s.entity_id::text = ANY($1::text[])
            OR NOT EXISTS (
              SELECT 1 FROM orders o
               WHERE o.id::text = s.entity_id::text
                 AND o.status::text = 'collected'
                 AND o.payment_status::text = 'paid'
                 AND o.updated_at > NOW() - ($2::int * INTERVAL '1 day')
            )
          )`,
      [notPendingIds.map(String), WINDOW_DAYS, SIGNAL_TYPE]
    );

    if (truncated) log.warn({ max: MAX_EVALUATIONS }, 'financial_close candidates truncated');
    return { generated, evaluated: evaluated.length, truncated };
  } catch (error) {
    log.warn({ err: error }, 'financial_close_economic_facts_pending error');
    return { generated: 0, error: error.message };
  }
}

module.exports = { SIGNAL_TYPE, PENDING_REASON, WINDOW_DAYS, MAX_EVALUATIONS, generateFinancialCloseSignals };
