/**
 * @komerce-arch-lite
 * @role          rct1-orders-readonly-projection
 * @domain        admin-dashboard
 * @owner         backend-core
 * @layer         service
 * @purpose       Liste exhaustive des commandes fictives RCT1, jamais les files opérationnelles réelles.
 * @db-read       orders, markets
 * @db-write      none
 * @db-txn        none
 */
'use strict';
const db = require('../db');

async function listRct1Orders({ marketCode = null } = {}) {
  if (marketCode != null && !/^(KM|CM|CG|DJ)$/.test(marketCode)) {
    const error = new Error('Marché de recette non autorisé');
    error.status = 400;
    throw error;
  }
  const { rows } = await db.query(
    `SELECT o.reference, o.status, o.payment_status, o.total_kmf,
            o.simulation_scope, m.code AS market_code
       FROM orders o
       JOIN markets m ON m.id = o.market_id
      WHERE o.simulation_scope = $1
        AND ($2::text IS NULL OR m.code = $2)
      ORDER BY o.created_at ASC, o.reference ASC`,
    ['RCT1', marketCode],
  );
  return Object.freeze({
    mode: 'RCT1',
    simulation_scope: 'RCT1',
    data_quality: { warnings: ['Données fictives — RCT1 : exclues de l’activité réelle.'] },
    total: rows.length,
    orders: rows,
  });
}

// RCT1 utilise le même CONTRAT de projection que le dashboard canonique.
// Les totaux et le funnel sont dérivés côté serveur des statuts réellement présents.
// Les files/signes non certifiables avec cette lecture restent null (pas zéro fictif).
const { LIFECYCLE } = require('./dashboard-orders');
const { ACTIVE_ORDER_STATUSES } = require('./dashboard-metrics/_helpers');

function projectCanonicalRct1(result) {
  const rows = result.orders || [];
  const statusCount = status => rows.filter(row => row.status === status).length;
  const active = rows.filter(row => ACTIVE_ORDER_STATUSES.includes(row.status)).length;
  const known = (key, label, value) => ({ key, label, value });
  const unknown = (key, label) => known(key, label, null);
  const eligible = rows.filter(row => !['cancelled', 'refunded'].includes(row.status));
  const at = statuses => rows.filter(row => statuses.includes(row.status)).length;
  const priority = rows.map(row => ({
    ...row,
    // Champs facultatifs absents de la projection RCT1 : non disponibles, jamais inventés.
    client_name: null, product_lines: null, parcel_count: null, relais_name: null,
    problem: 'Consultation RCT1', actionable: false,
  }));
  return Object.freeze({
    mode: 'RCT1',
    simulation_scope: 'RCT1',
    scope: { mode: 'global', market: null },
    summary: {
      total_orders: rows.length,
      active_orders: active,
      cancelled: statusCount('cancelled'),
      cash_to_confirm: null,
      orders_to_order: null,
      awaiting_hub_reception: null,
      parcels_to_create: null,
    },
    signals: { paiements_en_attente: null, commandes_bloquees: null, retraits_en_retard: null, litiges_ouverts: null },
    funnel: {
      creees: eligible.length,
      payees: eligible.filter(row => row.payment_status === 'paid').length,
      expediees: at(['shipped', 'in_transit', 'available', 'collected']),
      disponibles_relais: at(['available', 'collected']),
      retirees: statusCount('collected'),
      perdues: at(['cancelled', 'refunded']),
    },
    priority_orders: priority,
    kpis: [
      known('total_orders', 'Commandes', rows.length),
      known('active_orders', 'Commandes actives', active),
      unknown('cash_to_confirm', 'Cash à confirmer'),
      unknown('orders_to_order', 'À commander'),
      unknown('awaiting_hub_reception', 'En attente de réception Hub'),
      unknown('parcels_to_create', 'Colis à préparer'),
      known('cancelled', 'Annulées', statusCount('cancelled')),
    ],
    lifecycle: LIFECYCLE.map(status => ({ status, count: statusCount(status) })),
    payment_mix: [],
    work_queues: {
      pending_cash: [], pending_cash_total: null, pending_cash_shown: 0,
      to_order: [], to_order_total: null, to_order_shown: 0,
      awaiting_hub_reception: [], awaiting_hub_reception_total: null, awaiting_hub_reception_shown: 0,
      ready_for_parcel: [], ready_for_parcel_total: null, ready_for_parcel_shown: 0,
    },
    data_quality: {
      scope_mode: result.mode,
      simulation_scope: 'RCT1',
      warnings: ['Données fictives — RCT1 : exclues de l’activité réelle.', 'Files opérationnelles, relations et signaux non calculés pour RCT1 : non disponibles.'],
    },
  });
}

async function buildRct1Orders(options = {}) {
  const result = await listRct1Orders(options);
  return projectCanonicalRct1(result);
}

module.exports = { listRct1Orders, buildRct1Orders, projectCanonicalRct1 };
