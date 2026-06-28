/**
 * @komerce-arch
 * @role          economic-engine-sales-analysis
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db.js, routes/dashboard-shared.js
 * @used-by       services/finance-metrics/index.js
 * @db-read       finance_config, order_items, orders, parcels, products, recipients, relais, users
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

async function getSalesAnalysis(query) {
  const period = parseInt(query.period) || 30;
  const since = new Date();
  since.setDate(since.getDate() - period);
  const sinceStr = since.toISOString();

  const prevSince = new Date(since);
  prevSince.setDate(prevSince.getDate() - period);
  const prevSinceStr = prevSince.toISOString();

  // ═══ 1. KPIs principaux + MARGE RÉELLE ═══
  const kpiQ = await db.query(`
    SELECT
      COUNT(*)                                                          AS nb_commandes,
      COALESCE(SUM(total_kmf), 0)                                       AS ca_kmf,
      COALESCE(AVG(total_kmf), 0)                                       AS panier_moyen,
      COALESCE(SUM(CASE WHEN payment_mode = 'stripe_eur' THEN total_eur ELSE 0 END), 0) AS ca_eur,
      COALESCE(SUM(cost_real_kmf) FILTER (WHERE cost_real_kmf IS NOT NULL), 0) AS couts_reels_kmf,
      COUNT(*)             FILTER (WHERE cost_real_kmf IS NOT NULL)     AS nb_avec_cost,
      COUNT(*)             FILTER (WHERE cost_real_kmf IS NULL)         AS nb_sans_cost,
      COALESCE(AVG(margin_real_pct) FILTER (WHERE margin_real_pct IS NOT NULL), 0) AS marge_moy_pct
    FROM orders
    WHERE created_at >= $1 AND status NOT IN ('cancelled')
  `, [sinceStr]);

  const prevKpiQ = await db.query(`
    SELECT COUNT(*) AS nb, COALESCE(SUM(total_kmf),0) AS ca
    FROM orders
    WHERE created_at >= $1 AND created_at < $2 AND status NOT IN ('cancelled')
  `, [prevSinceStr, sinceStr]);

  // ═══ 2. Répartition par île ═══
  const byIsland = await db.query(`
    SELECT COALESCE(r.island, 'Inconnue') AS island,
           COUNT(*)                       AS nb,
           COALESCE(SUM(o.total_kmf), 0)  AS ca
    FROM orders o
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.created_at >= $1 AND o.status NOT IN ('cancelled')
    GROUP BY COALESCE(r.island, 'Inconnue')
    ORDER BY ca DESC
  `, [sinceStr]);

  // ═══ 3. Répartition par mode paiement ═══
  const byPayment = await db.query(`
    SELECT payment_mode,
           COUNT(*)                   AS nb,
           COALESCE(SUM(total_kmf),0) AS ca
    FROM orders
    WHERE created_at >= $1 AND status NOT IN ('cancelled')
    GROUP BY payment_mode
    ORDER BY ca DESC
  `, [sinceStr]);

  // ═══ 4. Top produits ═══
  const topProducts = await db.query(`
    SELECT p.name, p.category,
           COUNT(*)                                        AS nb_sold,
           COALESCE(SUM(oi.price_kmf * oi.quantity),0)     AS revenue
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o   ON o.id = oi.order_id
    WHERE o.created_at >= $1 AND o.status NOT IN ('cancelled')
    GROUP BY p.name, p.category
    ORDER BY revenue DESC LIMIT 10
  `, [sinceStr]);

  // ═══ 5. Répartition par catégorie avec marge ═══
  const byCategory = await db.query(`
    SELECT
      p.category                                          AS categorie,
      COUNT(DISTINCT o.id)                                AS nb_commandes,
      COALESCE(SUM(oi.price_kmf * oi.quantity), 0)        AS ca_kmf,
      COALESCE(SUM(
        (oi.price_kmf * oi.quantity) *
        COALESCE(o.margin_real_pct, 0) / 100
      ), 0)                                               AS marge_kmf,
      COALESCE(AVG(o.margin_real_pct) FILTER (
        WHERE o.margin_real_pct IS NOT NULL), 0)          AS taux_marge_pct
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o   ON o.id = oi.order_id
    WHERE o.created_at >= $1 AND o.status NOT IN ('cancelled')
    GROUP BY p.category
    ORDER BY ca_kmf DESC
  `, [sinceStr]);

  // ═══ 6. Évolution journalière ═══
  const bucket = period <= 31 ? 'day' : 'week';
  const evolution = await db.query(`
    SELECT
      date_trunc($2, created_at)::date   AS bucket_date,
      COUNT(*)                            AS nb_commandes,
      COALESCE(SUM(total_kmf),0)          AS ca_kmf
    FROM orders
    WHERE created_at >= $1 AND status NOT IN ('cancelled')
    GROUP BY bucket_date
    ORDER BY bucket_date ASC
  `, [sinceStr, bucket]);

  // ═══ 7. Funnel commandes ═══
  const funnelQ = await db.query(`
    SELECT
      COUNT(*)                                                                AS nb_creees,
      COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded'))         AS nb_confirmees,
      COUNT(*) FILTER (WHERE status IN ('shipped','available','collected'))   AS nb_expediees,
      COUNT(*) FILTER (WHERE status = 'collected')                            AS nb_livrees,
      COUNT(*) FILTER (WHERE
        status = 'collected'
        OR (payment_mode = 'stripe_eur' AND payment_status = 'paid')
      )                                                                        AS nb_payees,
      COUNT(*) FILTER (WHERE status IN ('cancelled', 'refunded'))             AS nb_perdues
    FROM orders
    WHERE created_at >= $1
  `, [sinceStr]);

  // ═══ 8. Cohortes ═══
  const cohortLimitMonths = 6;
  const cohortsQ = await db.query(`
    WITH orders_with_phone AS (
      SELECT o.id,
             o.created_at,
             o.status,
             COALESCE(u.phone, r.phone) AS client_phone
      FROM orders o
      LEFT JOIN users u      ON u.id = o.user_id
      LEFT JOIN recipients r ON r.id = o.recipient_id
    ),
    first_orders AS (
      SELECT client_phone,
             date_trunc('month', MIN(created_at))::date AS cohort_month
      FROM orders_with_phone
      WHERE client_phone IS NOT NULL
        AND status NOT IN ('cancelled')
      GROUP BY client_phone
      HAVING MIN(created_at) >= (CURRENT_DATE - ($1 || ' months')::interval)
    ),
    orders_flagged AS (
      SELECT o.client_phone,
             fo.cohort_month,
             date_trunc('month', o.created_at)::date AS order_month,
             EXTRACT(YEAR FROM age(date_trunc('month', o.created_at), fo.cohort_month))*12
             + EXTRACT(MONTH FROM age(date_trunc('month', o.created_at), fo.cohort_month)) AS offset_months
      FROM orders_with_phone o
      JOIN first_orders fo ON fo.client_phone = o.client_phone
      WHERE o.status NOT IN ('cancelled')
    )
    SELECT cohort_month,
           offset_months::int AS offset_months,
           COUNT(DISTINCT client_phone) AS nb_clients
    FROM orders_flagged
    WHERE offset_months <= $2
    GROUP BY cohort_month, offset_months
    ORDER BY cohort_month ASC, offset_months ASC
  `, [cohortLimitMonths, cohortLimitMonths]).catch(err => {
    log.warn({ err }, '[dashboard-finance-metrics/sales] cohortes failed:');
    return { rows: [] };
  });

  // ═══ Assemblage ═══
  const k = kpiQ.rows[0];
  const pk = prevKpiQ.rows[0];
  const evoCa  = Number(pk.ca) > 0 ? +(((Number(k.ca_kmf) - Number(pk.ca)) / Number(pk.ca)) * 100).toFixed(1) : null;
  const evoCmd = Number(pk.nb) > 0 ? +(((Number(k.nb_commandes) - Number(pk.nb)) / Number(pk.nb)) * 100).toFixed(1) : null;
  const margeKmf = Number(k.ca_kmf) * Number(k.marge_moy_pct) / 100;
  const f = funnelQ.rows[0];
  const nbCreees = Number(f.nb_creees);

  let targetMargePct = 40;
  try {
    const { rows: fc } = await db.query('SELECT target_marge_brute_pct FROM finance_config WHERE id = 1');
    if (fc[0]?.target_marge_brute_pct) targetMargePct = Number(fc[0].target_marge_brute_pct);
  } catch (_) { /* fallback sur 40 */ }
  const margeReellePct = Number(k.marge_moy_pct);
  const ecartCiblePct = +(margeReellePct - targetMargePct).toFixed(1);

  return {
    period,
    kpi: {
      ca_kmf:       Number(k.ca_kmf),
      ca_eur:       Number(k.ca_eur),
      nb_commandes: Number(k.nb_commandes),
      panier_moyen: Math.round(Number(k.panier_moyen)),
      evolution: { ca_pct: evoCa, commandes_pct: evoCmd },
    },
    marges: {
      marge_reelle_kmf: Math.round(margeKmf),
      taux_marge_pct:   +margeReellePct.toFixed(1),
      cible_marge_pct:  targetMargePct,
      ecart_cible_pct:  ecartCiblePct,
      nb_avec_cost:     Number(k.nb_avec_cost),
      nb_sans_cost:     Number(k.nb_sans_cost),
      couverture_pct:   (Number(k.nb_avec_cost) + Number(k.nb_sans_cost)) > 0
        ? +(Number(k.nb_avec_cost) / (Number(k.nb_avec_cost) + Number(k.nb_sans_cost)) * 100).toFixed(0)
        : 0,
    },
    by_island:    byIsland.rows,
    by_payment:   byPayment.rows,
    top_products: topProducts.rows,
    by_category: byCategory.rows.map(r => ({
      categorie:      r.categorie,
      nb_commandes:   Number(r.nb_commandes),
      ca_kmf:         Math.round(Number(r.ca_kmf)),
      marge_kmf:      Math.round(Number(r.marge_kmf)),
      taux_marge_pct: +Number(r.taux_marge_pct).toFixed(1),
    })),
    evolution: {
      bucket,
      points: evolution.rows.map(r => ({
        date:         r.bucket_date,
        nb_commandes: Number(r.nb_commandes),
        ca_kmf:       Math.round(Number(r.ca_kmf)),
      })),
    },
    funnel: {
      etapes: [
        { id: 'creees',     label: 'Commandes créées',  count: nbCreees,                pct: 100 },
        { id: 'confirmees', label: 'Confirmées',        count: Number(f.nb_confirmees), pct: nbCreees > 0 ? +(Number(f.nb_confirmees)/nbCreees*100).toFixed(1) : 0 },
        { id: 'expediees',  label: 'Expédiées',         count: Number(f.nb_expediees),  pct: nbCreees > 0 ? +(Number(f.nb_expediees)/nbCreees*100).toFixed(1) : 0 },
        { id: 'livrees',    label: 'Livrées',           count: Number(f.nb_livrees),    pct: nbCreees > 0 ? +(Number(f.nb_livrees)/nbCreees*100).toFixed(1) : 0 },
        { id: 'payees',     label: 'Payées',            count: Number(f.nb_payees),     pct: nbCreees > 0 ? +(Number(f.nb_payees)/nbCreees*100).toFixed(1) : 0 },
      ],
      perdues: Number(f.nb_perdues),
    },
    cohorts: {
      limit_months: cohortLimitMonths,
      rows: cohortsQ.rows.map(r => ({
        cohort_month:  r.cohort_month,
        offset_months: Number(r.offset_months),
        nb_clients:    Number(r.nb_clients),
      })),
    },
  };
}


module.exports = { getSalesAnalysis };
