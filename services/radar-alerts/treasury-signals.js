/**
 * @komerce-arch
 * @role          radar-treasury-signals
 * @domain        decision-signals
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context
 * @outputs       response_or_domain_result
 * @depends       db.js
 * @used-by       services/radar-queries.js
 * @db-read       wallets
 * @db-write      none
 * @db-txn        none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  decision-signals
 * @version       2026-08
 */

'use strict';

/**
 * services/radar-alerts/treasury-signals.js
 *
 * Alerte Radar liée à l'encours de trésorerie interne (wallets).
 * Extrait de services/radar-queries.js::getAlerts() (check E).
 */

async function checkWalletTotalHigh(db, walletTotalKmf) {
  const { rows: wallets } = await db.query(`
    SELECT COALESCE(SUM(balance_kmf), 0) AS total
    FROM wallets
    WHERE balance_kmf > 0
  `);

  const walletTotal = Number(wallets[0].total);
  if (walletTotal < walletTotalKmf) return null;

  return {
    level: 'signal',
    icon: '💼',
    code: 'WALLET_TOTAL_HIGH',
    title: `Encours wallets: ${walletTotal.toLocaleString('fr-FR')} KMF`,
    value_kmf: walletTotal,
    action: 'Encourager utilisation',
    target_view: 'finances',
    target_filter: {},
  };
}

module.exports = {
  checkWalletTotalHigh,
};
