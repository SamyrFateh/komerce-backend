/**
 * @komerce-arch
 * @role          economic-engine-dashboard-finance-metrics
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * services/dashboard-finance-metrics.js
 * Extrait de routes/dashboard-finance.js — lot GOD-FILES-3 (2026-05-25)
 *
 * Expose une fonction par endpoint GET du dashboard finance.
 * Chaque fonction reçoit les req.query du handler et retourne les données brutes.
 * Le SQL est copié à l'identique depuis l'original — zéro réécriture.
 *
 * NE PAS fusionner avec services/dashboard-metrics.js dans ce lot.
 * (cf. GOD-FILES-PROMPTS.md §GOD-FILES-3 — changement architectural différé)
 */

const db           = require('../db');
const { cached, setCache, getEurKmf, loadDashConfig } = require('../routes/dashboard-shared');
const log          = require('../utils/logger').child({ module: 'dashboard-finance-metrics' });

// ─── getFinanceSummary ─────────────────────────────────────────────
// Données pour GET /finance
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
async function getAnnulationsParcels(query) {
  const hit = cached('annulations-parcels');
  if (hit) return hit;

  const period = Math.max(1, Math.min(365, parseInt(query.period) || 30));

  // ── Annulations ─────────────────────────────────────────────────────────
  const { rows: [annulKpi] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'cancelled'
        AND created_at >= NOW() - INTERVAL '1 day' * $1)                  AS nb_annulees,
      COUNT(*) FILTER (WHERE status != 'cancelled'
        AND created_at >= NOW() - INTERVAL '1 day' * $1)                  AS nb_actives,
      COUNT(*) FILTER (WHERE status = 'cancelled'
        AND cancelled_at >= NOW() - INTERVAL '7 days')                    AS annulees_7j,
      COUNT(*) FILTER (WHERE status = 'cancelled'
        AND cancelled_at >= NOW() - INTERVAL '30 days')                   AS annulees_30j,
      COUNT(*) FILTER (WHERE status = 'refunded'
        AND created_at >= NOW() - INTERVAL '1 day' * $1)                  AS nb_refunded
    FROM orders
  `, [period]);

  const nbAnnulees = Number(annulKpi.nb_annulees);
  const nbActives  = Number(annulKpi.nb_actives);
  const total      = nbAnnulees + nbActives;
  const tauxAnnulation = total > 0 ? +(nbAnnulees / total * 100).toFixed(1) : 0;

  // ── Remboursements ──────────────────────────────────────────────────────
  const { rows: [remb] } = await db.query(`
    SELECT
      COALESCE(SUM(amount_kmf), 0)                                           AS total_kmf,
      COALESCE(SUM(amount_eur), 0)                                           AS total_eur,
      COALESCE(SUM(amount_kmf) FILTER (WHERE refund_method = 'stripe'), 0)   AS stripe_kmf,
      COALESCE(SUM(amount_eur) FILTER (WHERE refund_method = 'stripe'), 0)   AS stripe_eur,
      COALESCE(SUM(amount_kmf) FILTER (WHERE refund_method = 'store_credit'), 0) AS credit_kmf,
      COUNT(*)                                                               AS nb_refunds,
      COUNT(*) FILTER (WHERE refund_method = 'stripe')                       AS nb_stripe,
      COUNT(*) FILTER (WHERE refund_method = 'store_credit')                 AS nb_credit
    FROM refunds
    WHERE completed_at >= NOW() - INTERVAL '1 day' * $1
  `, [period]);

  // ── Crédits boutique actifs ─────────────────────────────────────────────
  const { rows: [credits] } = await db.query(`
    SELECT
      COALESCE(SUM(remaining_kmf), 0) AS total_actif_kmf,
      COUNT(*)                        AS nb_credits_actifs
    FROM store_credits
    WHERE remaining_kmf > 0 AND (expires_at IS NULL OR expires_at > NOW())
  `);

  // ── Raisons d'annulation ────────────────────────────────────────────────
  const { rows: raisonsRows } = await db.query(`
    SELECT COALESCE(cancel_reason, 'Non spécifiée') AS raison, COUNT(*) AS nb
    FROM orders
    WHERE status = 'cancelled' AND cancelled_at >= NOW() - INTERVAL '1 day' * $1
    GROUP BY cancel_reason ORDER BY nb DESC LIMIT 5
  `, [period]);

  // ── Annulations récentes ────────────────────────────────────────────────
  const { rows: recentCancel } = await db.query(`
    SELECT o.reference, o.total_kmf, o.cancelled_at, o.cancel_reason,
      o.payment_mode,
      r.amount_kmf AS refund_kmf, r.refund_method
    FROM orders o
    LEFT JOIN refunds r ON r.order_id = o.id AND r.status = 'completed'
    WHERE o.status = 'cancelled'
    ORDER BY o.cancelled_at DESC NULLS LAST
    LIMIT 10
  `);

  // ── Expéditions partielles (Parcels) ────────────────────────────────────
  const { rows: [parcelKpi] } = await db.query(`
    SELECT
      COUNT(*)                                                                   AS total_parcels,
      COUNT(*) FILTER (WHERE type = 'partial')                                   AS nb_partial,
      COUNT(*) FILTER (WHERE type = 'backorder')                                 AS nb_backorder,
      COUNT(*) FILTER (WHERE status NOT IN ('collected', 'cancelled'))            AS en_cours,
      COUNT(*) FILTER (WHERE type = 'backorder'
                         AND status NOT IN ('collected', 'cancelled'))            AS backorder_actifs,
      COUNT(*) FILTER (WHERE status = 'collected')                               AS collected,
      COUNT(*) FILTER (WHERE status = 'cancelled')                               AS cancelled
    FROM parcels
  `);

  const totalParcels    = Number(parcelKpi.total_parcels);
  const parcelCollected = Number(parcelKpi.collected);
  const tauxCompletion  = totalParcels > 0
    ? +((parcelCollected / totalParcels) * 100).toFixed(1) : 0;

  // ── Colis par statut ────────────────────────────────────────────────────
  const { rows: parcelStatuts } = await db.query(`
    SELECT status, type, COUNT(*) AS nb
    FROM parcels WHERE status != 'cancelled'
    GROUP BY status, type ORDER BY nb DESC
  `);

  // ── Colis récents ───────────────────────────────────────────────────────
  const { rows: recentParcels } = await db.query(`
    SELECT p.reference, p.type, p.status, p.created_at,
      o.reference AS order_reference,
      (SELECT COUNT(*) FROM parcel_items WHERE parcel_id = p.id) AS nb_items
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    ORDER BY p.created_at DESC LIMIT 10
  `);

  // ── Commandes avec expéditions partielles ───────────────────────────────
  const { rows: [partialOrders] } = await db.query(`
    SELECT COUNT(DISTINCT order_id) AS nb FROM parcels WHERE type = 'partial'
  `);

  const result = {
    period,
    annulations: {
      total:    nbAnnulees,
      refunded: Number(annulKpi.nb_refunded),
      taux_pct: tauxAnnulation,
      par_periode: {
        '7j':  Number(annulKpi.annulees_7j),
        '30j': Number(annulKpi.annulees_30j),
      },
      remboursements: {
        total_kmf: Math.round(Number(remb.total_kmf)),
        total_eur: +Number(remb.total_eur).toFixed(2),
        stripe: {
          count: Number(remb.nb_stripe),
          kmf:   Math.round(Number(remb.stripe_kmf)),
          eur:   +Number(remb.stripe_eur).toFixed(2),
        },
        credit_boutique: {
          count: Number(remb.nb_credit),
          kmf:   Math.round(Number(remb.credit_kmf)),
        },
      },
      credits_actifs: {
        total_kmf: Math.round(Number(credits.total_actif_kmf)),
        nb:        Number(credits.nb_credits_actifs),
      },
      raisons: raisonsRows.map(r => ({
        raison: r.raison,
        count:  Number(r.nb),
      })),
      recentes: recentCancel.map(o => ({
        reference:     o.reference,
        total_kmf:     Number(o.total_kmf),
        cancelled_at:  o.cancelled_at,
        reason:        o.cancel_reason,
        payment_mode:  o.payment_mode,
        refund_kmf:    o.refund_kmf ? Number(o.refund_kmf) : null,
        refund_method: o.refund_method,
      })),
    },
    parcels: {
      total:               totalParcels,
      partial:             Number(parcelKpi.nb_partial),
      backorder:           Number(parcelKpi.nb_backorder),
      en_cours:            Number(parcelKpi.en_cours),
      backorder_actifs:    Number(parcelKpi.backorder_actifs),
      taux_completion_pct: tauxCompletion,
      par_statut: parcelStatuts.reduce((acc, r) => {
        acc[`${r.type}_${r.status}`] = Number(r.nb);
        return acc;
      }, {}),
      nb_orders_with_parcels: Number(partialOrders.nb),
      recents: recentParcels.map(p => ({
        reference:       p.reference,
        type:            p.type,
        status:          p.status,
        order_reference: p.order_reference,
        nb_items:        Number(p.nb_items),
        created_at:      p.created_at,
      })),
    },
  };

  setCache('annulations-parcels', result);
  return result;
}

// ─── getPaymentsDetail ─────────────────────────────────────────────
// Données pour GET /payments
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

module.exports = { getFinanceSummary, getAnnulationsParcels, getPaymentsDetail, getSalesAnalysis };
