/**
 * @komerce-arch
 * @role          economic-engine-payments-detail
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db.js, routes/dashboard-shared.js
 * @used-by       services/finance-metrics/index.js
 * @db-read       age, orders, parcels, recipients, refunds, relais, users
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */
'use strict';
const db = require('../../db');
const { cached, setCache, getEurKmf, loadDashConfig } = require('../../routes/dashboard-shared');
const log = require('../../utils/logger').child({ module: 'dashboard-finance-metrics' });

async function getPaymentsDetail(query) {
  const cfg    = await loadDashConfig();
  const period = Math.max(1, Math.min(365, parseInt(query.period) || 30));
  const rates  = await getEurKmf();

  // ── Agrégats globaux ─────────────────────────────────────────────────────
  const { rows: [agg] } = await db.query(`
    SELECT
      -- Cash relais — pending (tous actifs)
      COUNT(*) FILTER (
        WHERE payment_mode = 'cash_relais'
          AND payment_status = 'pending'
          AND status NOT IN ('cancelled')
      ) AS cash_pending_count,
      COALESCE(SUM(total_kmf) FILTER (
        WHERE payment_mode = 'cash_relais'
          AND payment_status = 'pending'
          AND status NOT IN ('cancelled')
      ), 0) AS cash_pending_kmf,

      -- Cash relais — retards
      COUNT(*) FILTER (
        WHERE payment_mode = 'cash_relais'
          AND payment_status = 'pending'
          AND status NOT IN ('cancelled')
          AND created_at <= NOW() - INTERVAL '12 hours'
      ) AS cash_overdue_12h,
      COUNT(*) FILTER (
        WHERE payment_mode = 'cash_relais'
          AND payment_status = 'pending'
          AND status NOT IN ('cancelled')
          AND created_at <= NOW() - INTERVAL '36 hours'
      ) AS cash_overdue_36h,

      -- Cash relais — confirmés sur la période
      COUNT(*) FILTER (
        WHERE payment_mode = 'cash_relais'
          AND payment_status = 'paid'
          AND created_at >= NOW() - INTERVAL '1 day' * $1
      ) AS cash_paid_count,
      COALESCE(SUM(total_kmf) FILTER (
        WHERE payment_mode = 'cash_relais'
          AND payment_status = 'paid'
          AND created_at >= NOW() - INTERVAL '1 day' * $1
      ), 0) AS cash_paid_kmf,

      -- Stripe — pending (tous actifs)
      COUNT(*) FILTER (
        WHERE payment_mode = 'stripe_eur'
          AND payment_status = 'pending'
          AND status NOT IN ('cancelled')
      ) AS stripe_pending_count,
      COALESCE(SUM(total_eur) FILTER (
        WHERE payment_mode = 'stripe_eur'
          AND payment_status = 'pending'
          AND status NOT IN ('cancelled')
      ), 0) AS stripe_pending_eur,

      -- Stripe — payés sur la période
      COUNT(*) FILTER (
        WHERE payment_mode = 'stripe_eur'
          AND payment_status = 'paid'
          AND created_at >= NOW() - INTERVAL '1 day' * $1
      ) AS stripe_paid_count,
      COALESCE(SUM(total_eur) FILTER (
        WHERE payment_mode = 'stripe_eur'
          AND payment_status = 'paid'
          AND created_at >= NOW() - INTERVAL '1 day' * $1
      ), 0) AS stripe_paid_eur,

      -- Stripe — échoués sur la période
      COUNT(*) FILTER (
        WHERE payment_mode = 'stripe_eur'
          AND payment_status = 'failed'
          AND created_at >= NOW() - INTERVAL '1 day' * $1
      ) AS stripe_failed_count,
      COALESCE(SUM(total_eur) FILTER (
        WHERE payment_mode = 'stripe_eur'
          AND payment_status = 'failed'
          AND created_at >= NOW() - INTERVAL '1 day' * $1
      ), 0) AS stripe_failed_eur

    FROM orders
  `, [period]);

  // ── Liste commandes en attente de paiement (cash + stripe, max 40) ───────
  const { rows: pendingOrders } = await db.query(`
    SELECT
      o.id, o.reference, o.payment_mode, o.payment_status,
      o.status         AS order_status,
      o.total_kmf, o.total_eur, o.cash_ref_code, o.created_at,
      EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 3600.0 AS age_hours,
      u.full_name  AS client_name,
      u.phone      AS client_phone,
      r.name       AS relais_name
    FROM orders o
    LEFT JOIN users  u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.payment_status = 'pending'
      AND o.status NOT IN ('cancelled')
    ORDER BY o.created_at ASC
    LIMIT 40
  `);

  // ── Stripe failed récents ───────────────────────────────────────────────
  const { rows: failedOrders } = await db.query(`
    SELECT
      o.reference, o.stripe_payment_id, o.total_eur, o.created_at,
      u.full_name  AS client_name,
      u.phone      AS client_phone
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.payment_mode   = 'stripe_eur'
      AND o.payment_status = 'failed'
      AND o.created_at    >= NOW() - INTERVAL '1 day' * $1
    ORDER BY o.created_at DESC
    LIMIT 10
  `, [period]);

  // ── Réconciliation ──────────────────────────────────────────────────────

  // GAP 1 — Livré sans encaissé
  const { rows: deliveredUnpaid } = await db.query(`
    SELECT
      o.reference, o.payment_mode, o.payment_status,
      o.status        AS order_status,
      o.total_kmf, o.total_eur, o.created_at,
      u.full_name     AS client_name,
      u.phone         AS client_phone,
      r.name          AS relais_name
    FROM orders o
    LEFT JOIN users  u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.status          IN ('available', 'collected')
      AND o.payment_status  != 'paid'
      AND o.status          != 'cancelled'
    ORDER BY o.created_at ASC
  `);

  // GAP 2 — Sourcé sans payé
  const { rows: sourcedUnpaid } = await db.query(`
    SELECT
      o.reference, o.payment_mode, o.payment_status,
      o.total_kmf, o.total_eur, o.cost_real_kmf, o.created_at,
      COUNT(p.id)             AS nb_parcels_actifs,
      ARRAY_AGG(p.status)     AS parcel_statuses,
      u.full_name             AS client_name,
      u.phone                 AS client_phone
    FROM orders o
    JOIN parcels p  ON p.order_id = o.id
                   AND p.status NOT IN ('draft', 'cancelled')
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.payment_status = 'pending'
      AND o.status NOT IN ('cancelled')
    GROUP BY o.id, u.full_name, u.phone
    ORDER BY o.created_at ASC
  `);

  // GAP 3a — Stripe : payé sans stripe_payment_id
  const { rows: stripeNoproof } = await db.query(`
    SELECT o.reference, o.total_eur, o.total_kmf, o.created_at,
           u.full_name AS client_name
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.payment_mode   = 'stripe_eur'
      AND o.payment_status = 'paid'
      AND (o.stripe_payment_id IS NULL OR o.stripe_payment_id = '')
    ORDER BY o.created_at DESC
  `);

  // GAP 3b — Cash : payé sans cash_paid_at
  const { rows: cashNoproof } = await db.query(`
    SELECT o.reference, o.total_kmf, o.created_at,
           o.cash_ref_code,
           u.full_name AS client_name
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.payment_mode   = 'cash_relais'
      AND o.payment_status = 'paid'
      AND o.cash_paid_at   IS NULL
    ORDER BY o.created_at DESC
  `);

  // GAP 4 — Écart global commandé vs encaissé
  const { rows: [ecart] } = await db.query(`
    SELECT
      COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS total_commande_kmf,
      COALESCE(SUM(total_kmf) FILTER (WHERE payment_status = 'paid'), 0) AS total_encaisse_kmf,
      COALESCE(SUM(cost_real_kmf) FILTER (WHERE cost_real_kmf IS NOT NULL AND status NOT IN ('cancelled')), 0) AS total_source_kmf,
      COALESCE(SUM(total_kmf) FILTER (WHERE payment_status != 'paid' AND status NOT IN ('cancelled')), 0) AS gap_non_encaisse_kmf
    FROM orders
  `);

  // ── Anti-fraude relais cash ─────────────────────────────────────────────

  // FRAUDE 1 — Collected sans reverse
  const { rows: fraudCollectedUnpaid } = await db.query(`
    SELECT
      o.id, o.reference, o.total_kmf, o.cash_ref_code,
      o.collected_at, o.available_at, o.payment_status,
      EXTRACT(EPOCH FROM (NOW() - o.collected_at)) / 3600  AS heures_depuis_collected,
      u.full_name   AS client_name,
      u.phone       AS client_phone,
      r.id          AS relais_id,
      r.name        AS relais_name,
      r.agent_name,
      r.phone       AS relais_phone,
      r.island
    FROM orders o
    LEFT JOIN users  u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.payment_mode   = 'cash_relais'
      AND o.status         = 'collected'
      AND o.payment_status != 'paid'
      AND o.collected_at   IS NOT NULL
    ORDER BY o.collected_at ASC
  `);

  // FRAUDE 2 — Délai de reverse anormal (> 3 jours)
  const { rows: fraudDelayedReverse } = await db.query(`
    SELECT
      o.reference, o.total_kmf, o.cash_ref_code,
      o.collected_at, o.cash_paid_at,
      EXTRACT(DAY FROM (o.cash_paid_at - o.collected_at))  AS jours_delai_reverse,
      r.id          AS relais_id,
      r.name        AS relais_name,
      r.agent_name,
      r.phone       AS relais_phone,
      r.island,
      u.full_name   AS client_name
    FROM orders o
    LEFT JOIN users  u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.payment_mode   = 'cash_relais'
      AND o.payment_status = 'paid'
      AND o.collected_at   IS NOT NULL
      AND o.cash_paid_at   IS NOT NULL
      AND (o.cash_paid_at - o.collected_at) > INTERVAL '3 days'
    ORDER BY (o.cash_paid_at - o.collected_at) DESC
  `);

  // FRAUDE 3 — Colis bloqué au relais depuis > 14 jours
  const { rows: fraudStaleParcels } = await db.query(`
    SELECT
      o.reference, o.total_kmf, o.cash_ref_code, o.available_at,
      EXTRACT(DAY FROM (NOW() - o.available_at))  AS jours_au_relais,
      r.id          AS relais_id,
      r.name        AS relais_name,
      r.agent_name,
      r.phone       AS relais_phone,
      r.island,
      u.full_name   AS client_name,
      u.phone       AS client_phone
    FROM orders o
    LEFT JOIN users  u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.payment_mode = 'cash_relais'
      AND o.status       = 'available'
      AND o.available_at < NOW() - INTERVAL '14 days'
    ORDER BY o.available_at ASC
  `);

  // SCORE PAR RELAIS
  const relaisRiskMap = {};
  const addRelaisAnomaly = (row, type, weight) => {
    if (!row.relais_id) return;
    const key = row.relais_id;
    if (!relaisRiskMap[key]) {
      relaisRiskMap[key] = {
        relais_id:    row.relais_id,
        relais_name:  row.relais_name,
        agent_name:   row.agent_name,
        relais_phone: row.relais_phone,
        island:       row.island,
        risk_score:   0,
        collected_unpaid_count:  0,
        delayed_reverse_count:   0,
        stale_parcels_count:     0,
        total_kmf_at_risk:       0,
      };
    }
    relaisRiskMap[key].risk_score         += weight;
    relaisRiskMap[key][type + '_count']   += 1;
    relaisRiskMap[key].total_kmf_at_risk  += Math.round(Number(row.total_kmf || 0));
  };

  fraudCollectedUnpaid.forEach(r => addRelaisAnomaly(r, 'collected_unpaid',  3));
  fraudDelayedReverse.forEach(r  => addRelaisAnomaly(r, 'delayed_reverse',   2));
  fraudStaleParcels.forEach(r    => addRelaisAnomaly(r, 'stale_parcels',     1));

  const relaisRiskList = Object.values(relaisRiskMap)
    .map(r => ({
      ...r,
      risk_level: r.risk_score >= 6 ? 'critical' : r.risk_score >= 2 ? 'warning' : 'ok',
    }))
    .sort((a, b) => b.risk_score - a.risk_score);

  // ── Calculs résumé ────────────────────────────────────────────────────────
  const cashPendingKmf   = Math.round(Number(agg.cash_pending_kmf));
  const stripePendingEur = +Number(agg.stripe_pending_eur).toFixed(2);
  const totalPendingKmf  = cashPendingKmf + Math.round(stripePendingEur * rates.eur_kmf);
  const reconciAlerts    = deliveredUnpaid.length + stripeNoproof.length;
  const alertCount       = Number(agg.cash_overdue_36h) + Number(agg.stripe_failed_count) + reconciAlerts;

  return {
    period,
    taux: rates,
    cash: {
      pending: { count: Number(agg.cash_pending_count), total_kmf: cashPendingKmf },
      paid:    { count: Number(agg.cash_paid_count),    total_kmf: Math.round(Number(agg.cash_paid_kmf)) },
      overdue_12h: Number(agg.cash_overdue_12h),
      overdue_36h: Number(agg.cash_overdue_36h),
    },
    stripe: {
      pending: { count: Number(agg.stripe_pending_count), total_eur: stripePendingEur },
      paid:    { count: Number(agg.stripe_paid_count),    total_eur: +Number(agg.stripe_paid_eur).toFixed(2) },
      failed: {
        count:     Number(agg.stripe_failed_count),
        total_eur: +Number(agg.stripe_failed_eur).toFixed(2),
        orders: failedOrders.map(f => ({
          reference:         f.reference,
          stripe_payment_id: f.stripe_payment_id,
          total_eur:         +Number(f.total_eur).toFixed(2),
          client:            f.client_name,
          phone:             f.client_phone,
          created_at:        f.created_at,
        })),
      },
    },
    summary: {
      total_pending_kmf: totalPendingKmf,
      alert_count:       alertCount,
      needs_action:      alertCount > 0,
    },
    reconciliation: {
      ecart_global: {
        total_commande_kmf:   Math.round(Number(ecart.total_commande_kmf)),
        total_encaisse_kmf:   Math.round(Number(ecart.total_encaisse_kmf)),
        total_source_kmf:     Math.round(Number(ecart.total_source_kmf)),
        gap_non_encaisse_kmf: Math.round(Number(ecart.gap_non_encaisse_kmf)),
        has_gap:              Number(ecart.gap_non_encaisse_kmf) > 0,
      },
      delivered_unpaid: {
        count:     deliveredUnpaid.length,
        total_kmf: Math.round(deliveredUnpaid.reduce((s, o) => s + Number(o.total_kmf), 0)),
        orders: deliveredUnpaid.map(o => ({
          reference:      o.reference,
          mode:           o.payment_mode === 'cash_relais' ? 'cash' : 'stripe',
          order_status:   o.order_status,
          payment_status: o.payment_status,
          total_kmf:      Math.round(Number(o.total_kmf)),
          total_eur:      o.total_eur ? +Number(o.total_eur).toFixed(2) : null,
          client:         o.client_name,
          phone:          o.client_phone,
          relais:         o.relais_name,
          created_at:     o.created_at,
        })),
      },
      sourced_unpaid: {
        count:           sourcedUnpaid.length,
        total_kmf:       Math.round(sourcedUnpaid.reduce((s, o) => s + Number(o.total_kmf || 0), 0)),
        cost_source_kmf: Math.round(sourcedUnpaid.reduce((s, o) => s + Number(o.cost_real_kmf || 0), 0)),
        orders: sourcedUnpaid.map(o => ({
          reference:       o.reference,
          mode:            o.payment_mode === 'cash_relais' ? 'cash' : 'stripe',
          payment_status:  o.payment_status,
          total_kmf:       Math.round(Number(o.total_kmf || 0)),
          cost_real_kmf:   o.cost_real_kmf ? Math.round(Number(o.cost_real_kmf)) : null,
          nb_parcels:      Number(o.nb_parcels_actifs),
          parcel_statuses: o.parcel_statuses,
          client:          o.client_name,
          phone:           o.client_phone,
          created_at:      o.created_at,
        })),
      },
      paid_no_proof: {
        stripe_no_payment_id: {
          count:  stripeNoproof.length,
          orders: stripeNoproof.map(o => ({
            reference:  o.reference,
            total_eur:  +Number(o.total_eur).toFixed(2),
            total_kmf:  Math.round(Number(o.total_kmf)),
            client:     o.client_name,
            created_at: o.created_at,
          })),
        },
        cash_no_timestamp: {
          count:  cashNoproof.length,
          orders: cashNoproof.map(o => ({
            reference:     o.reference,
            cash_ref_code: o.cash_ref_code,
            total_kmf:     Math.round(Number(o.total_kmf)),
            client:        o.client_name,
            created_at:    o.created_at,
          })),
        },
      },
      alert_level: deliveredUnpaid.length > 0 || stripeNoproof.length > 0
        ? 'critical'
        : sourcedUnpaid.length > 0
          ? 'warning'
          : 'ok',
    },
    fraud_relais: {
      collected_unpaid: {
        count:     fraudCollectedUnpaid.length,
        total_kmf: Math.round(fraudCollectedUnpaid.reduce((s, o) => s + Number(o.total_kmf || 0), 0)),
        orders: fraudCollectedUnpaid.map(o => ({
          reference:              o.reference,
          relais:                 o.relais_name,
          agent:                  o.agent_name,
          relais_phone:           o.relais_phone,
          island:                 o.island,
          client:                 o.client_name,
          client_phone:           o.client_phone,
          total_kmf:              Math.round(Number(o.total_kmf)),
          cash_ref_code:          o.cash_ref_code,
          collected_at:           o.collected_at,
          heures_depuis_collected: o.heures_depuis_collected != null
            ? Math.round(Number(o.heures_depuis_collected)) : null,
        })),
      },
      delayed_reverse: {
        count: fraudDelayedReverse.length,
        orders: fraudDelayedReverse.map(o => ({
          reference:           o.reference,
          relais:              o.relais_name,
          agent:               o.agent_name,
          relais_phone:        o.relais_phone,
          island:              o.island,
          client:              o.client_name,
          total_kmf:           Math.round(Number(o.total_kmf)),
          collected_at:        o.collected_at,
          cash_paid_at:        o.cash_paid_at,
          jours_delai_reverse: Math.round(Number(o.jours_delai_reverse)),
          urgency:             Number(o.jours_delai_reverse) >= cfg.FRAUD_REVERSE_CRIT_DAYS ? 'critical' : 'warning',
        })),
      },
      stale_parcels: {
        count: fraudStaleParcels.length,
        orders: fraudStaleParcels.map(o => ({
          reference:       o.reference,
          relais:          o.relais_name,
          agent:           o.agent_name,
          relais_phone:    o.relais_phone,
          island:          o.island,
          client:          o.client_name,
          client_phone:    o.client_phone,
          total_kmf:       Math.round(Number(o.total_kmf)),
          available_at:    o.available_at,
          jours_au_relais: Math.round(Number(o.jours_au_relais)),
        })),
      },
      relais_risk_scores: relaisRiskList,
      alert_level: fraudCollectedUnpaid.length > 0
        ? 'critical'
        : fraudDelayedReverse.length > 0 || fraudStaleParcels.length > 0
          ? 'warning'
          : 'ok',
    },
    pending_orders: pendingOrders.map(o => {
      const ageH = +Number(o.age_hours).toFixed(1);
      return {
        id:            o.id,
        reference:     o.reference,
        mode:          o.payment_mode === 'cash_relais' ? 'cash' : 'stripe',
        order_status:  o.order_status,
        total_kmf:     Math.round(Number(o.total_kmf)),
        total_eur:     o.total_eur ? +Number(o.total_eur).toFixed(2) : null,
        cash_ref_code: o.cash_ref_code || null,
        client:        o.client_name,
        phone:         o.client_phone,
        relais:        o.relais_name,
        created_at:    o.created_at,
        age_hours:     ageH,
        urgency: ageH >= cfg.FRAUD_PENDING_CRIT_H ? 'critical' : ageH >= cfg.FRAUD_PENDING_WARN_H ? 'warning' : 'ok',
      };
    }),
  };
}

// ─── getSalesAnalysis ──────────────────────────────────────────────
// Données pour GET /sales

module.exports = { getPaymentsDetail };
