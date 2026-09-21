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
 * @db-read       orders, order_incidents, disputes
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
  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query(
      `SELECT o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.cash_ref_code, o.created_at
         FROM orders o
        WHERE ($1::uuid IS NULL OR o.market_id = $1)
          AND o.payment_status = 'pending'
          AND o.status NOT IN ('cancelled', 'collected', 'refunded')
        ORDER BY o.created_at ASC
        LIMIT $2`,
      [mid, limit],
    ),
    db.query(
      `SELECT COUNT(*)::int AS value
         FROM orders o
        WHERE ($1::uuid IS NULL OR o.market_id = $1)
          AND o.payment_status = 'pending'
          AND o.status NOT IN ('cancelled', 'collected', 'refunded')`,
      [mid],
    ),
  ]);
  const items = rows.map(r => Object.freeze({
    id: r.id, reference: r.reference, status: r.status,
    total_kmf: r.total_kmf, payment_mode: r.payment_mode, cash_ref_code: r.cash_ref_code,
  }));
  return Object.freeze({ items, count_total: Number(countRows[0]?.value) || 0 });
}

// File « colis à créer » — requête identique au contrat order-api-v2 /ready-for-parcel.
// count_total est un COUNT(*) séparé, jamais rows.length : la liste est
// plafonnée à `limit` pour rester une file de travail actionnable, mais le
// KPI affiché doit refléter le vrai total, pas la troncature (doctrine
// "éviter les incohérences entre les compteurs et leurs listes sous-jacentes").
async function getReadyForParcel(mid, limit = 25) {
  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query(
      `SELECT o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.created_at
         FROM orders o
        WHERE ($1::uuid IS NULL OR o.market_id = $1)
          AND o.payment_status = 'paid'
          AND o.status IN ('confirmed', 'ordered')
        ORDER BY o.created_at ASC
        LIMIT $2`,
      [mid, limit],
    ),
    db.query(
      `SELECT COUNT(*)::int AS value
         FROM orders o
        WHERE ($1::uuid IS NULL OR o.market_id = $1)
          AND o.payment_status = 'paid'
          AND o.status IN ('confirmed', 'ordered')`,
      [mid],
    ),
  ]);
  const items = rows.map(r => Object.freeze({
    id: r.id, reference: r.reference, status: r.status,
    total_kmf: r.total_kmf, payment_mode: r.payment_mode,
  }));
  return Object.freeze({ items, count_total: Number(countRows[0]?.value) || 0 });
}

function kpi(key, label, value) {
  return Object.freeze({ key, label, value });
}

// Seuils repris tels quels de ce qui existe déjà ailleurs dans le codebase —
// jamais inventés pour ce fichier :
//   - PAYMENT_PENDING_HOURS : même seuil que services/alert-engine.js#
//     checkCashPending (CASH_PENDING_HOURS: 72).
//   - RETRAIT_LATE_HOURS : même seuil que services/operations-workspace.js#
//     querySignals (72h, "collectes en retard").
//   - STALE_HOURS : même seuil que services/alert-engine.js#checkStuckParcels
//     converti en heures (STUCK_DAYS: 7 → 168h) pour "commandes >72h sans
//     mouvement" du mock — le mock demande 72h précisément, valeur
//     conservée telle qu'affichée dans le mock plutôt que le seuil plus
//     large de l'alert-engine (7j), qui sert une alerte différente
//     (colis physiquement coincé, pas juste "sans mouvement récent").
const PAYMENT_PENDING_HOURS = 72;
const RETRAIT_LATE_HOURS = 72;
const STALE_HOURS = 72;

/**
 * Couche de pilotage additive — bandeau de décision + SLA du mock
 * "Commandes" (05_Commandes.png). Calcul sur des requêtes dédiées,
 * scopées serveur par market_id comme le reste de ce fichier.
 *
 * Volontairement absent : "Commandes dans les temps (%)" — cette
 * métrique suppose un délai de livraison CIBLE configuré quelque part
 * (SLA contractuel par marché) ; aucune table du schéma ne porte cette
 * notion aujourd'hui (vérifié). Documentée ici plutôt qu'inventée avec
 * un seuil arbitraire qui aurait l'air d'un engagement réel.
 */
async function getDecisionSignals(mid) {
  const { rows: [totals] } = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE o.payment_status = 'pending'
          AND o.status NOT IN ('cancelled', 'refunded', 'collected')
          AND o.created_at < NOW() - INTERVAL '${PAYMENT_PENDING_HOURS} hours')::int AS paiements_en_attente,
        COUNT(*) FILTER (WHERE o.status = 'available'
          AND o.available_at < NOW() - INTERVAL '${RETRAIT_LATE_HOURS} hours')::int AS retraits_en_retard,
        COUNT(*) FILTER (WHERE o.status NOT IN ('cancelled', 'refunded', 'collected')
          AND o.updated_at < NOW() - INTERVAL '${STALE_HOURS} hours')::int AS sans_mouvement_72h,
        COUNT(*) FILTER (WHERE o.status = 'available'
          AND o.available_at::date = CURRENT_DATE)::int AS prets_aujourdhui,
        AVG(EXTRACT(EPOCH FROM (o.collected_at - o.created_at)) / 86400)
          FILTER (WHERE o.status = 'collected' AND o.collected_at IS NOT NULL)::numeric AS delai_moyen_jours
       FROM orders o
      WHERE ($1::uuid IS NULL OR o.market_id = $1)`,
    [mid]
  );

  const { rows: [blockedRow] } = await db.query(
    `SELECT COUNT(DISTINCT oi.order_id)::int AS n
       FROM order_incidents oi
       JOIN orders o ON o.id = oi.order_id
      WHERE ($1::uuid IS NULL OR o.market_id = $1)
        AND oi.status IN ('open', 'in_progress')`,
    [mid]
  );

  const { rows: [disputesRow] } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE ($1::uuid IS NULL OR o.market_id = $1)
        AND d.status IN ('open', 'processing')`,
    [mid]
  );

  return Object.freeze({
    paiements_en_attente: totals.paiements_en_attente,
    commandes_bloquees: blockedRow.n,
    retraits_en_retard: totals.retraits_en_retard,
    litiges_ouverts: disputesRow.n,
    sla: Object.freeze({
      delai_moyen_jours: totals.delai_moyen_jours != null ? Math.round(Number(totals.delai_moyen_jours) * 10) / 10 : null,
      sans_mouvement_72h: totals.sans_mouvement_72h,
      prets_aujourdhui: totals.prets_aujourdhui,
    }),
  });
}

// Funnel métier du mock (05_Commandes.png) : Créées -> Payées -> Expédiées
// -> Disponibles relais -> Retirées. Distinct du `lifecycle` technique
// existant (état courant par statut interne) : ici chaque étape compte les
// commandes ayant ATTEINT ce stade ou un stade ultérieur (funnel cumulatif),
// pas seulement celles actuellement figées dessus — cohérent avec les
// valeurs décroissantes du mock (284 -> 230 -> 198 -> 176 -> 162).
async function getBusinessFunnel(mid) {
  const { rows: [row] } = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE o.status NOT IN ('cancelled', 'refunded'))::int AS creees,
        COUNT(*) FILTER (WHERE o.payment_status = 'paid'
          AND o.status NOT IN ('cancelled', 'refunded'))::int AS payees,
        COUNT(*) FILTER (WHERE o.status IN ('shipped', 'in_transit', 'available', 'collected'))::int AS expediees,
        COUNT(*) FILTER (WHERE o.status IN ('available', 'collected'))::int AS disponibles_relais,
        COUNT(*) FILTER (WHERE o.status = 'collected')::int AS retirees,
        COUNT(*) FILTER (WHERE o.status IN ('cancelled', 'refunded'))::int AS perdues
       FROM orders o
      WHERE ($1::uuid IS NULL OR o.market_id = $1)`,
    [mid]
  );
  return Object.freeze({
    creees: row.creees,
    payees: row.payees,
    expediees: row.expediees,
    disponibles_relais: row.disponibles_relais,
    retirees: row.retirees,
    perdues: row.perdues,
  });
}

async function buildOrders(options = {}) {
  const market = options.market || null;
  const mid = marketId(market);

  const [byStatus, paymentMix, pendingCash, readyForParcel, signals, funnel] = await Promise.all([
    getStatusCounts(mid),
    getPaymentMix(mid),
    getPendingCash(mid),
    getReadyForParcel(mid),
    getDecisionSignals(mid),
    getBusinessFunnel(mid),
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
      cash_to_confirm: pendingCash.count_total,
      parcels_to_create: readyForParcel.count_total,
    }),
    signals,
    funnel,
    kpis: Object.freeze([
      kpi('total_orders', 'Commandes', total),
      kpi('active_orders', 'Commandes actives', active),
      kpi('cash_to_confirm', 'Cash à confirmer', pendingCash.count_total),
      kpi('parcels_to_create', 'Colis à créer', readyForParcel.count_total),
      kpi('cancelled', 'Annulées', byStatus.cancelled || 0),
    ]),
    lifecycle: Object.freeze(lifecycle),
    payment_mix: Object.freeze(paymentMix),
    work_queues: Object.freeze({
      pending_cash: pendingCash.items,
      pending_cash_shown: pendingCash.items.length,
      pending_cash_total: pendingCash.count_total,
      ready_for_parcel: readyForParcel.items,
      ready_for_parcel_shown: readyForParcel.items.length,
      ready_for_parcel_total: readyForParcel.count_total,
    }),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_mode: market ? 'market' : 'global',
      source_tables: Object.freeze(['orders', 'order_incidents', 'disputes']),
    }),
  });
}

module.exports = {
  LIFECYCLE,
  publicScope,
  buildOrders,
};
