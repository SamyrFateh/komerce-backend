/**
 * @komerce-arch
 * @role          economic-engine-finance-summary
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db.js, routes/dashboard-shared.js
 * @used-by       services/finance-metrics/index.js
 * @db-read       finance_config, order_items, orders, products, refunds
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */
'use strict';
const db = require('../../db');
const { cached, setCache, getEurKmf, loadDashConfig } = require('../../routes/dashboard-shared');
const log = require('../../utils/logger').child({ module: 'dashboard-finance-metrics' });

async function getFinanceSummary(query) {
  const period = Math.max(1, Math.min(365, parseInt(query.period) || 30));
  const rates  = await getEurKmf();

  // ── CA + volumes ────────────────────────────────────────────────────────
  const { rows: [kpi] } = await db.query(`
    SELECT
      -- Période courante
      COALESCE(SUM(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1), 0)    AS ca_kmf,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status != 'cancelled')  AS nb_commandes,
      COALESCE(AVG(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status != 'cancelled'), 0) AS panier_moyen_kmf,
      -- Paiements
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND payment_mode = 'cash_relais' AND status != 'cancelled') AS nb_cash,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND payment_mode = 'stripe_eur' AND status != 'cancelled') AS nb_stripe,
      COALESCE(SUM(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND payment_mode = 'cash_relais' AND status != 'cancelled'), 0) AS ca_cash_kmf,
      COALESCE(SUM(total_eur) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND payment_mode = 'stripe_eur' AND status != 'cancelled'), 0)  AS ca_stripe_eur,
      -- Coûts & marges (colonnes renseignées après groupage)
      COALESCE(SUM(cost_transport_kmf + cost_douane_kmf) FILTER (
        WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
      ), 0) AS cout_logistique_kmf,
      COALESCE(SUM(total_kmf - cost_transport_kmf - cost_douane_kmf) FILTER (
        WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
      ), 0) AS marge_reelle_kmf,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled') AS nb_avec_cost,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND cost_transport_kmf = 0 AND cost_douane_kmf = 0 AND status != 'cancelled') AS nb_sans_cost,
      -- Période précédente
      COALESCE(SUM(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $2 AND created_at < NOW() - INTERVAL '1 day' * $1), 0) AS ca_prev_kmf,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $2 AND created_at < NOW() - INTERVAL '1 day' * $1 AND status != 'cancelled') AS nb_prev,
      -- Statuts
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status = 'collected') AS nb_livrees,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status = 'cancelled') AS nb_annulees
    FROM orders
  `, [period, period * 2]);

  const ca       = Number(kpi.ca_kmf);
  const caPrev   = Number(kpi.ca_prev_kmf);
  const nbCmd    = Number(kpi.nb_commandes);
  const nbPrev   = Number(kpi.nb_prev);
  const marge    = Number(kpi.marge_reelle_kmf);
  const eur_kmf  = rates.eur_kmf;

  // ── Alertes vente à perte ───────────────────────────────────────────────
  const { rows: perteRows } = await db.query(`
    SELECT reference FROM orders
    WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0)
      AND total_kmf < (cost_transport_kmf + cost_douane_kmf)
      AND status != 'cancelled'
    LIMIT 10
  `, [period]);

  // ── Marge par catégorie ─────────────────────────────────────────────────
  const { rows: catRows } = await db.query(`
    SELECT p.category,
      COUNT(o.id) AS nb_commandes,
      COALESCE(SUM(o.total_kmf), 0) AS ca_kmf,
      COALESCE(SUM(o.total_kmf - o.cost_transport_kmf - o.cost_douane_kmf), 0) AS marge_kmf,
      ROUND(CASE WHEN SUM(o.total_kmf) > 0
        THEN 100.0 * SUM(o.total_kmf - o.cost_transport_kmf - o.cost_douane_kmf)::numeric / SUM(o.total_kmf)
        ELSE 0 END, 1) AS taux_marge_pct
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE o.created_at >= NOW() - INTERVAL '1 day' * $1 AND o.status != 'cancelled'
    GROUP BY p.category ORDER BY ca_kmf DESC
  `, [period]);

  // ── Top 10 produits ─────────────────────────────────────────────────────
  const { rows: topProds } = await db.query(`
    SELECT p.name, p.category,
      SUM(oi.quantity) AS qty_vendue,
      SUM(oi.price_kmf * oi.quantity) AS revenue_kmf
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE o.created_at >= NOW() - INTERVAL '1 day' * $1 AND o.status != 'cancelled'
    GROUP BY p.id, p.name, p.category
    ORDER BY revenue_kmf DESC LIMIT 10
  `, [period]);

  return {
    period,
    taux: rates,
    kpi: {
      ca_kmf:          Math.round(ca),
      ca_eur:          Math.round(ca / eur_kmf),
      nb_commandes:    nbCmd,
      nb_livrees:      Number(kpi.nb_livrees),
      nb_annulees:     Number(kpi.nb_annulees),
      panier_moyen_kmf: Math.round(Number(kpi.panier_moyen_kmf)),
      evolution: {
        ca_pct:  caPrev > 0 ? +((ca - caPrev) / caPrev * 100).toFixed(1) : null,
        cmd_pct: nbPrev > 0 ? +((nbCmd - nbPrev) / nbPrev * 100).toFixed(1) : null,
      },
    },
    paiements: {
      cash:  { count: Number(kpi.nb_cash),   total_kmf: Math.round(Number(kpi.ca_cash_kmf)) },
      stripe: { count: Number(kpi.nb_stripe), total_eur: +Number(kpi.ca_stripe_eur).toFixed(2) },
    },
    marges: {
      marge_reelle_kmf:    Math.round(marge),
      cout_logistique_kmf: Math.round(Number(kpi.cout_logistique_kmf)),
      taux_marge_pct:      ca > 0 && Number(kpi.nb_avec_cost) > 0 ? +(marge / ca * 100).toFixed(1) : null,
      nb_avec_cost:        Number(kpi.nb_avec_cost),
      nb_sans_cost:        Number(kpi.nb_sans_cost),
      alertes_perte:       perteRows.length > 0 ? { count: perteRows.length, refs: perteRows.map(r => r.reference) } : null,
    },
    par_categorie: catRows.map(r => ({
      categorie:    r.category,
      nb_commandes: Number(r.nb_commandes),
      ca_kmf:       Math.round(Number(r.ca_kmf)),
      marge_kmf:    Math.round(Number(r.marge_kmf)),
      taux_marge:   +Number(r.taux_marge_pct),
    })),
    top_produits: topProds.map(p => ({
      nom:       p.name,
      categorie: p.category,
      qty:       Number(p.qty_vendue),
      ca_kmf:    Math.round(Number(p.revenue_kmf)),
    })),
  };
}

// ─── getAnnulationsParcels ─────────────────────────────────────────
// Données pour GET /annulations-parcels

module.exports = { getFinanceSummary };
