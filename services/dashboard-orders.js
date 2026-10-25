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
 * @db-read       orders, order_incidents, disputes, relais, users, markets, order_items, products, parcels
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, browser_never_recomputes_truth, missing_data_never_means_zero, client_market_id_never_authority
 * @impact-areas  admin-dashboard, orders
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { getOrdersPhysicalCoverage } = require('./order-physical-coverage-service');
const { ACTIVE_ORDER_STATUSES, LATE_THRESHOLDS } = require('./dashboard-metrics/_helpers');

// Séquence canonique du cycle de vie commande = chemin nominal de VALID_TRANSITIONS
// (order-status-machine.js). `cancelled` / `refunded` sont terminaux et comptés à part.
// `paid` n'est pas un statut de commande (c'est payment_status).
const LIFECYCLE = Object.freeze(['pending', 'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available', 'collected']);

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
      WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL
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
      WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL
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
        WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL
          AND o.payment_status = 'pending'
          AND o.status NOT IN ('cancelled', 'collected', 'refunded')
        ORDER BY o.created_at ASC
        LIMIT $2`,
      [mid, limit],
    ),
    db.query(
      `SELECT COUNT(*)::int AS value
         FROM orders o
        WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL
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

// L8 — « Prochaine action réelle » : la file unique « Colis à créer » devient trois files selon
// l'état physique de la commande payée (confirmed / ordered). La couverture est lue par lot
// (getOrdersPhysicalCoverage, une requête) ; aucune transition ni bouton d'écriture ici.
//   confirmed                         → À commander
//   ordered sans couverture complète  → En attente de réception Hub (n/N), sans action
//   ordered avec couverture complète  → Préparer le colis
// count_total est un compte réel de chaque file, jamais la longueur tronquée de la liste.
function pipelineItem(row, next_action) {
  return Object.freeze({
    id: row.id, reference: row.reference, status: row.status,
    total_kmf: row.total_kmf, payment_mode: row.payment_mode, next_action: Object.freeze(next_action),
  });
}

async function getParcelPipeline(mid, limit = 25) {
  const { rows } = await db.query(
    `SELECT o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.created_at
       FROM orders o
      WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL
        AND o.payment_status = 'paid'
        AND o.status IN ('confirmed', 'ordered')
      ORDER BY o.created_at ASC`,
    [mid],
  );
  const coverage = await getOrdersPhysicalCoverage(db, rows.filter(r => r.status === 'ordered').map(r => r.id));
  const toOrder = [];
  const awaiting = [];
  const ready = [];
  rows.forEach((row) => {
    if (row.status === 'confirmed') {
      toOrder.push(pipelineItem(row, { key: 'order', label: 'À commander', actionable: true }));
      return;
    }
    const cov = coverage.get(row.id);
    if (!cov || cov.covered) {
      ready.push(pipelineItem(row, { key: 'prepare_parcel', label: 'Préparer le colis', actionable: true }));
    } else {
      awaiting.push(pipelineItem(row, {
        key: 'await_hub_reception',
        label: `En attente de réception Hub (${cov.usable}/${cov.needed})`,
        actionable: false,
        received_units: cov.usable,
        needed_units: cov.needed,
      }));
    }
  });
  const queue = list => Object.freeze({ items: list.slice(0, limit), count_total: list.length });
  return Object.freeze({ to_order: queue(toOrder), awaiting_hub_reception: queue(awaiting), ready_for_parcel: queue(ready) });
}

async function getReadyForParcel(mid, limit = 25) {
  return (await getParcelPipeline(mid, limit)).ready_for_parcel;
}

// Lecture canonique des relations d'une page de commandes déjà sélectionnées :
// marché (orders.market_id → markets.code), produits (order_items → products)
// et colis (parcels.order_id). Aucune taxonomie ni calcul métier : valeurs
// brutes des relations existantes. Un lien absent reste null (« Non disponible »),
// jamais 0 inventé ; le nombre de colis est un COUNT réel de la relation.
async function getOrderRelations(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  const { rows } = await db.query(
    `SELECT o.id,
            m.code AS market_code,
            (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS product_lines,
            (SELECT pr.name FROM order_items oi JOIN products pr ON pr.id = oi.product_id
              WHERE oi.order_id = o.id ORDER BY oi.id ASC LIMIT 1) AS first_product_name,
            (SELECT COUNT(*)::int FROM parcels p WHERE p.order_id = o.id) AS parcel_count
       FROM orders o
       LEFT JOIN markets m ON m.id = o.market_id
      WHERE o.id = ANY($1::uuid[])`,
    [list],
  );
  return new Map(rows.map(r => [r.id, Object.freeze({
    market_code: r.market_code || null,
    product_lines: r.product_lines,
    first_product_name: r.first_product_name || null,
    parcel_count: r.parcel_count,
  })]));
}

function pipelineQueues(pipeline, mapItems) {
  const out = {};
  [['to_order', 'to_order'], ['awaiting_hub_reception', 'awaiting_hub_reception'], ['ready_for_parcel', 'ready_for_parcel']].forEach(([key]) => {
    out[key] = mapItems(pipeline[key].items);
    out[`${key}_shown`] = pipeline[key].items.length;
    out[`${key}_total`] = pipeline[key].count_total;
  });
  return out;
}

function withRelations(items, rel) {
  return items.map(it => Object.freeze({
    ...it,
    market_code: rel.get(it.id)?.market_code ?? null,
    product_lines: rel.get(it.id)?.product_lines ?? null,
    first_product_name: rel.get(it.id)?.first_product_name ?? null,
    parcel_count: rel.get(it.id)?.parcel_count ?? null,
  }));
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
const PAYMENT_PENDING_HOURS = LATE_THRESHOLDS.payment_pending_hours;
const RETRAIT_LATE_HOURS = LATE_THRESHOLDS.pickup_late_hours;
const STALE_HOURS = LATE_THRESHOLDS.stale_hours;

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

// Vocabulaire de type déjà établi et validé ailleurs dans le codebase
// (routes/relay-dashboard.js, routes/hub-dashboard.js — validTypes) —
// jamais une catégorisation inventée pour cette table.
const INCIDENT_TYPE_LABEL = Object.freeze({
  retard: 'Retard transport',
  blocage: 'Blocage',
  paiement: 'Paiement à régulariser',
  stock: 'Pas d’allocation stock',
  colis_endommage: 'Produit endommagé',
  colis_perdu: 'Colis perdu',
  client_absent: 'En attente client',
  autre: 'Autre incident',
});

/**
 * Commandes prioritaires — union des commandes déjà détectées par les 4
 * signaux de décision (getDecisionSignals), avec le VRAI problème associé
 * plutôt qu'une catégorie inventée : le type d'incident vient de
 * order_incidents.type (vocabulaire déjà validé côté relais/hub), le type
 * de litige de disputes.type, jamais une classification recalculée côté
 * navigateur. Une commande peut apparaître pour plusieurs raisons à la
 * fois ; seule la plus urgente est affichée en "problème" par ligne
 * (ordre : incident > litige > paiement > retrait), le tri global reste
 * par ancienneté décroissante.
 */
async function getPriorityOrders(mid, limit = 20) {
  const { rows } = await db.query(
    `WITH candidates AS (
        SELECT o.id, o.reference, o.status, o.payment_mode, o.payment_status,
               o.created_at, o.available_at, r.name AS relais_name,
               u.full_name AS client_name,
               oi.type AS incident_type, oi.description AS incident_description,
               d.type AS dispute_type,
               CASE
                 WHEN oi.id IS NOT NULL THEN oi.created_at
                 WHEN d.id IS NOT NULL THEN d.created_at
                 WHEN o.payment_status = 'pending' THEN o.created_at
                 WHEN o.status = 'available' THEN o.available_at
               END AS since_at,
               CASE
                 WHEN oi.id IS NOT NULL THEN 1
                 WHEN d.id IS NOT NULL THEN 2
                 WHEN o.payment_status = 'pending' THEN 3
                 WHEN o.status = 'available' THEN 4
               END AS priority_rank
          FROM orders o
          LEFT JOIN relais r ON r.id = o.relais_id
          LEFT JOIN users u ON u.id = o.user_id
          LEFT JOIN LATERAL (
            SELECT id, type, description, created_at FROM order_incidents
             WHERE order_id = o.id AND status IN ('open', 'in_progress')
             ORDER BY created_at DESC LIMIT 1
          ) oi ON TRUE
          LEFT JOIN LATERAL (
            SELECT id, type, created_at FROM disputes
             WHERE order_id = o.id AND status IN ('open', 'processing')
             ORDER BY created_at DESC LIMIT 1
          ) d ON TRUE
         WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL
           AND o.status NOT IN ('cancelled', 'refunded')
           AND (
             oi.id IS NOT NULL
             OR d.id IS NOT NULL
             OR (o.status NOT IN ('collected') AND o.payment_status = 'pending' AND o.created_at < NOW() - INTERVAL '${PAYMENT_PENDING_HOURS} hours')
             OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '${RETRAIT_LATE_HOURS} hours')
           )
     )
     SELECT * FROM candidates
     WHERE priority_rank IS NOT NULL
     ORDER BY priority_rank ASC, since_at ASC
     LIMIT $2`,
    [mid, limit]
  );

  return rows.map(row => {
    const problem = row.incident_type
      ? (INCIDENT_TYPE_LABEL[row.incident_type] || row.incident_type)
      : row.dispute_type
        ? `Litige : ${row.dispute_type}`
        : row.payment_status === 'pending'
          ? 'Paiement non finalisé'
          : 'Retrait relais en retard';
    const days = Math.floor((Date.now() - new Date(row.since_at).getTime()) / 86400000);
    return Object.freeze({
      id: row.id,
      reference: row.reference,
      client_name: row.client_name,
      status: row.status,
      payment_status: row.payment_status,
      relais_name: row.relais_name,
      since_days: days,
      problem,
    });
  });
}

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
      WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL`,
    [mid]
  );

  const { rows: [blockedRow] } = await db.query(
    `SELECT COUNT(DISTINCT oi.order_id)::int AS n
       FROM order_incidents oi
       JOIN orders o ON o.id = oi.order_id
      WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL
        AND oi.status IN ('open', 'in_progress')`,
    [mid]
  );

  const { rows: [disputesRow] } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL
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
      WHERE ($1::uuid IS NULL OR o.market_id = $1) AND o.simulation_scope IS NULL`,
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

// Files de travail « Cash à confirmer » / « Colis à créer » : source unique, réutilisée par
// l'écran Opérations (qui a absorbé le suivi des commandes) — aucune requête dupliquée.
async function getWorkQueues(market) {
  const mid = marketId(market || null);
  const [pendingCash, pipeline] = await Promise.all([getPendingCash(mid), getParcelPipeline(mid)]);
  return Object.freeze({
    pending_cash: pendingCash.items,
    pending_cash_shown: pendingCash.items.length,
    pending_cash_total: pendingCash.count_total,
    ...pipelineQueues(pipeline, items => items),
  });
}

async function buildOrders(options = {}) {
  const market = options.market || null;
  const mid = marketId(market);

  const [byStatus, paymentMix, pendingCash, pipeline, signals, funnel, priorityOrders] = await Promise.all([
    getStatusCounts(mid),
    getPaymentMix(mid),
    getPendingCash(mid),
    getParcelPipeline(mid),
    getDecisionSignals(mid),
    getBusinessFunnel(mid),
    getPriorityOrders(mid),
  ]);

  const rel = await getOrderRelations([
    ...pendingCash.items.map(i => i.id), ...pipeline.to_order.items.map(i => i.id), ...pipeline.awaiting_hub_reception.items.map(i => i.id), ...pipeline.ready_for_parcel.items.map(i => i.id), ...priorityOrders.map(i => i.id),
  ]);
  const pendingCashItems = withRelations(pendingCash.items, rel);
  const readyForParcel = pipeline.ready_for_parcel;
  const priorityItems = withRelations(priorityOrders, rel);

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  // « Commandes actives » = définition unique partagée avec le Pilotage (ACTIVE_ORDER_STATUSES).
  const active = ACTIVE_ORDER_STATUSES.reduce((a, s) => a + (byStatus[s] || 0), 0);

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
      orders_to_order: pipeline.to_order.count_total,
      awaiting_hub_reception: pipeline.awaiting_hub_reception.count_total,
    }),
    signals,
    funnel,
    priority_orders: Object.freeze(priorityItems),
    kpis: Object.freeze([
      kpi('total_orders', 'Commandes', total),
      kpi('active_orders', 'Commandes actives', active),
      kpi('cash_to_confirm', 'Cash à confirmer', pendingCash.count_total),
      kpi('orders_to_order', 'À commander', pipeline.to_order.count_total),
      kpi('awaiting_hub_reception', 'En attente de réception Hub', pipeline.awaiting_hub_reception.count_total),
      kpi('parcels_to_create', 'Colis à préparer', readyForParcel.count_total),
      kpi('cancelled', 'Annulées', byStatus.cancelled || 0),
    ]),
    lifecycle: Object.freeze(lifecycle),
    payment_mix: Object.freeze(paymentMix),
    work_queues: Object.freeze({
      pending_cash: pendingCashItems,
      pending_cash_shown: pendingCash.items.length,
      pending_cash_total: pendingCash.count_total,
      ...pipelineQueues(pipeline, items => withRelations(items, rel)),
    }),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_mode: market ? 'market' : 'global',
      source_tables: Object.freeze(['orders', 'order_incidents', 'disputes', 'markets', 'order_items', 'products', 'parcels']),
    }),
  });
}

module.exports = {
  LIFECYCLE,
  publicScope,
  buildOrders,
  getWorkQueues,
};
