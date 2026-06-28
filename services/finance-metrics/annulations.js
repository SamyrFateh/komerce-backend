/**
 * @komerce-arch
 * @role          economic-engine-annulations-parcels
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       db.js, routes/dashboard-shared.js
 * @used-by       services/finance-metrics/index.js
 * @db-read       order_items, orders, parcel_items, parcels, refunds, relais, store_credits
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

module.exports = { getAnnulationsParcels };
