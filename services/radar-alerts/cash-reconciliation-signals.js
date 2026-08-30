/**
 * @komerce-arch
 * @role          radar-cash-reconciliation-signals
 * @domain        decision-signals
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context
 * @outputs       response_or_domain_result
 * @depends       db.js
 * @used-by       services/radar-queries.js
 * @db-read       orders, cash_collections, cash_deposits, users
 * @db-write      none
 * @db-txn        none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  decision-signals
 * @version       2026-08
 */

'use strict';

/**
 * services/radar-alerts/cash-reconciliation-signals.js
 *
 * Alertes Radar liées à la réconciliation cash (agents relais).
 * Extrait de services/radar-queries.js::getAlerts() (checks K, L, M, N).
 * Les tables cash_collections / cash_deposits pouvant ne pas encore
 * exister sur certains environnements, chaque check reste défensif
 * (try/catch silencieux → pas d'alerte plutôt qu'une erreur).
 */

async function checkCashNotCollected(db, cashNotCollectedHrs) {
  try {
    const { rows: [uncollected] } = await db.query(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.total_kmf), 0) AS total_kmf
      FROM orders o
      WHERE o.payment_mode = 'cash_relais'
        AND o.status IN ('available', 'collected')
        AND o.created_at < NOW() - ($1 * INTERVAL '1 hour')
        AND NOT EXISTS (
          SELECT 1 FROM cash_collections cc WHERE cc.order_id = o.id
        )
    `, [cashNotCollectedHrs]);

    if (Number(uncollected.cnt) <= 0) return null;

    return {
      level: 'critical',
      icon: '🕳️',
      code: 'CASH_NOT_COLLECTED',
      title: `${uncollected.cnt} commande(s) cash livrée(s) > ${cashNotCollectedHrs}h sans encaissement déclaré`,
      value_kmf: Number(uncollected.total_kmf),
      count: Number(uncollected.cnt),
      action: 'Vérifier avec les agents relais',
      target_view: 'cash',
      target_filter: { type: 'uncollected' },
    };
  } catch (_) {
    // cash_collections table may not exist yet
    return null;
  }
}

async function checkCashNotDeposited(db, cashNotDepositedHrs) {
  try {
    const { rows: [undeposited] } = await db.query(`
      SELECT
        COUNT(DISTINCT cc.collected_by) AS agent_count,
        COALESCE(SUM(cc.amount_kmf), 0) AS total_kmf
      FROM cash_collections cc
      WHERE cc.confirmed_at < NOW() - ($1 * INTERVAL '1 hour')
        AND NOT EXISTS (
          SELECT 1 FROM cash_deposits cd
          WHERE cd.agent_id = cc.collected_by
            AND cd.period_start <= cc.confirmed_at::date
            AND cd.period_end >= cc.confirmed_at::date
        )
    `, [cashNotDepositedHrs]);

    if (Number(undeposited.total_kmf) <= 0) return null;

    return {
      level: 'critical',
      icon: '🏦',
      code: 'CASH_NOT_DEPOSITED',
      title: `${Number(undeposited.total_kmf).toLocaleString('fr-FR')} KMF encaissés non déposés (${undeposited.agent_count} agent(s))`,
      value_kmf: Number(undeposited.total_kmf),
      count: Number(undeposited.agent_count),
      action: 'Demander les versements',
      target_view: 'cash',
      target_filter: { type: 'undeposited' },
    };
  } catch (_) {
    // table may not exist yet
    return null;
  }
}

async function checkDepositsPendingReview(db) {
  try {
    const { rows: [pendingDeposits] } = await db.query(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_kmf), 0) AS total_kmf
      FROM cash_deposits
      WHERE status = 'pending'
    `);

    if (Number(pendingDeposits.cnt) <= 0) return null;

    return {
      level: 'signal',
      icon: '📋',
      code: 'DEPOSITS_PENDING_REVIEW',
      title: `${pendingDeposits.cnt} dépôt(s) en attente de vérification (${Number(pendingDeposits.total_kmf).toLocaleString('fr-FR')} KMF)`,
      value_kmf: Number(pendingDeposits.total_kmf),
      count: Number(pendingDeposits.cnt),
      action: 'Vérifier les justificatifs',
      target_view: 'cash',
      target_filter: { type: 'pending_deposits' },
    };
  } catch (_) {
    // table may not exist yet
    return null;
  }
}

async function checkSuspectCashPattern(db) {
  try {
    const { rows: suspectAgents } = await db.query(`
      WITH cc_aligned AS (
        SELECT
          cc.collected_by,
          cc.amount_kmf,
          DATE_TRUNC('week', cc.confirmed_at) AS week_start
        FROM cash_collections cc
        WHERE cc.confirmed_at > NOW() - INTERVAL '4 weeks'
      ),
      weekly_gaps AS (
        SELECT
          cca.collected_by AS agent_id,
          cca.week_start,
          SUM(cca.amount_kmf) AS declared_kmf,
          COALESCE((
            SELECT SUM(cd.amount_kmf)
            FROM cash_deposits cd
            WHERE cd.agent_id = cca.collected_by
              AND cd.period_start <= (cca.week_start + INTERVAL '6 days')::date
              AND cd.period_end >= cca.week_start::date
          ), 0) AS deposited_kmf
        FROM cc_aligned cca
        GROUP BY cca.collected_by, cca.week_start
      ),
      agent_gaps AS (
        SELECT
          agent_id,
          COUNT(*) FILTER (WHERE declared_kmf - deposited_kmf > 0) AS weeks_with_gap,
          SUM(declared_kmf - deposited_kmf) AS total_gap_kmf
        FROM weekly_gaps
        GROUP BY agent_id
        HAVING COUNT(*) FILTER (WHERE declared_kmf - deposited_kmf > 0) >= 3
      )
      SELECT ag.agent_id, u.full_name, ag.weeks_with_gap, ag.total_gap_kmf
      FROM agent_gaps ag
      LEFT JOIN users u ON u.id = ag.agent_id
    `);

    if (suspectAgents.length === 0) return null;

    const names = suspectAgents.map(a => a.full_name || 'Inconnu').join(', ');
    const totalGap = suspectAgents.reduce((s, a) => s + Number(a.total_gap_kmf), 0);

    return {
      level: 'critical',
      icon: '🚩',
      code: 'CASH_SUSPECT_PATTERN',
      title: `Pattern suspect : ${suspectAgents.length} agent(s) avec écart cash > 3 semaines`,
      value_kmf: totalGap,
      count: suspectAgents.length,
      detail: names,
      action: 'Investigation requise',
      target_view: 'cash',
      target_filter: { type: 'suspect' },
    };
  } catch (_) {
    // tables may not exist yet
    return null;
  }
}

module.exports = {
  checkCashNotCollected,
  checkCashNotDeposited,
  checkDepositsPendingReview,
  checkSuspectCashPattern,
};
