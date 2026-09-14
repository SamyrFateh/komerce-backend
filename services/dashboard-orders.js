/**
 * @komerce-arch
 * @role          dashboard-orders-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        authenticated dashboard reader, optional resolved market scope
 * @outputs       canonical decision-first orders payload (files de travail, cycle de vie, mix paiement)
 * @depends       db, services/dashboard-operations.js (publicScope helper via re-export)
 * @used-by       routes/admin-dashboard.js, routes/admin-dashboard-market.js
 * @db-read       orders
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, browser_never_recomputes_truth, missing_data_never_means_zero, client_market_id_never_authority
 * @impact-areas  admin-dashboard, orders
 * @version       2026-09
 */
'use strict';

const db = require('../db');

// Séquence canonique du cycle de vie commande (order-status-machine.js).
// L'état `cancelled` est terminal et compté à part (hors funnel de progression).
const LIFECYCLE = Object.freeze(['pending', 'confirmed', 'paid', 'ordered', 'available', 'collected', 'in_transit']);

function publicScope(market) {
  if (!market) return Object.freeze({ mode: 'global', market: null });
  return Object.freeze({
    mode: 'market',
    market: Object.freeze({ code: market.code, name: market.name, currency: market.currency }),
  });
}

// Filtre marché résolu SERVEUR uniquement. `market.id` provient de la résolution
// serveur (req.dashboardMarket), jamais d'un market_id fourni par le client.
function marketId(market) {
  return market && market.id ? market.id : null;
}

async function getStatusCounts(mid) {
  const { rows } = await db.query(
    `SELECT o.status, COUNT(*)::int AS n
       FROM orders o
      WHERE ($1::uuid IS NULL OR o.market_id = $1)
      GROUP BY o.status`,
    [mid],
  );
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = r.n;
  return byStatus;
}

async function getPaymentMix(mid) {
  const { rows } = await db.query(
    `SELECT o.payment_mode AS mode, COUNT(*)::int AS n
       FROM orders o
      WHERE ($1::uuid IS NULL OR o.market_id = $1)
        AND o.payment_mode IS NOT NULL
      GROUP BY o.payment_mode
      ORDER BY n DESC`,
    [mid],
  );
  return rows.map(r => Object.freeze({ mode: r.mode, count: r.n }));
}

// File « cash à confirmer » — requête identique au contrat order-api-v2 /pending-cash.
async function getPendingCash(mid, limit = 25) {
  const { rows } = await db.query(
    `SELECT o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.cash_ref_code, o.created_at
       FROM orders o
      WHERE ($1::uuid IS NULL OR o.market_id = $1)
        AND o.payment_status = 'pending'
        AND o.status NOT IN ('cancelled', 'collected', 'refunded')
      ORDER BY o.created_at ASC
      LIMIT $2`,
    [mid, limit],
  );
  return rows.map(r => Object.freeze({
    id: r.id, reference: r.reference, status: r.status,
    total_kmf: r.total_kmf, payment_mode: r.payment_mode, cash_ref_code: r.cash_ref_code,
  }));
}

// File « colis à créer » — requête identique au contrat order-api-v2 /ready-for-parcel.
async function getReadyForParcel(mid, limit = 25) {
  const { rows } = await db.query(
    `SELECT o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.created_at
       FROM orders o
      WHERE ($1::uuid IS NULL OR o.market_id = $1)
        AND o.payment_status = 'paid'
        AND o.status IN ('confirmed', 'ordered')
      ORDER BY o.created_at ASC
      LIMIT $2`,
    [mid, limit],
  );
  return rows.map(r => Object.freeze({
    id: r.id, reference: r.reference, status: r.status,
    total_kmf: r.total_kmf, payment_mode: r.payment_mode,
  }));
}

function kpi(key, label, value) {
  return Object.freeze({ key, label, value });
}

async function buildOrders(options = {}) {
  const market = options.market || null;
  const mid = marketId(market);

  const [byStatus, paymentMix, pendingCash, readyForParcel] = await Promise.all([
    getStatusCounts(mid),
    getPaymentMix(mid),
    getPendingCash(mid),
    getReadyForParcel(mid),
  ]);

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const active = LIFECYCLE.reduce((a, s) => a + (byStatus[s] || 0), 0);

  // Funnel du cycle de vie : comptes serveur par étape, ordre canonique conservé.
  const lifecycle = LIFECYCLE.map(status => Object.freeze({ status, count: byStatus[status] || 0 }));

  return Object.freeze({
    scope: publicScope(market),
    summary: Object.freeze({
      total_orders: total,
      active_orders: active,
      cancelled: byStatus.cancelled || 0,
      cash_to_confirm: pendingCash.length,
      parcels_to_create: readyForParcel.length,
    }),
    kpis: Object.freeze([
      kpi('total_orders', 'Commandes', total),
      kpi('active_orders', 'Commandes actives', active),
      kpi('cash_to_confirm', 'Cash à confirmer', pendingCash.length),
      kpi('parcels_to_create', 'Colis à créer', readyForParcel.length),
      kpi('cancelled', 'Annulées', byStatus.cancelled || 0),
    ]),
    lifecycle: Object.freeze(lifecycle),
    payment_mix: Object.freeze(paymentMix),
    work_queues: Object.freeze({
      pending_cash: Object.freeze(pendingCash),
      ready_for_parcel: Object.freeze(readyForParcel),
    }),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_mode: market ? 'market' : 'global',
      source_tables: Object.freeze(['orders']),
    }),
  });
}

module.exports = {
  LIFECYCLE,
  publicScope,
  buildOrders,
};
