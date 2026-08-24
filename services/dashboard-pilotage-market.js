/**
 * @komerce-arch
 * @role          dashboard-pilotage-market-aggregate
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, dashboard_filters
 * @outputs       market_scoped_pilotage_projection
 * @depends       db, services/dashboard-metrics, services/dashboard-metrics/_helpers
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       cash_collections, order_item_cost_imputations, order_item_real_cost_allocations, orders, parcels, scan_events, signals
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority, dashboard_no_business_recompute
 * @impact-areas  dashboard, admin-dashboard, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const metrics = require('./dashboard-metrics');
const { buildSignalMarketClause } = require('./dashboard-metrics/_helpers');
const log = require('../utils/logger').child({ module: 'dashboard-pilotage-market' });

function publicFilters(filters) {
  const { market_id: _internalMarketId, ...safe } = filters || {};
  return safe;
}

async function fetchTopAlerts(filters, limit = 10) {
  const marketScope = buildSignalMarketClause(filters, 's', 1);
  const params = [...marketScope.params, limit];
  const limitParam = `$${params.length}`;
  const sql = `
    SELECT s.id,
           s.severity      AS level,
           s.source_module AS source,
           s.title         AS message,
           s.created_at
    FROM signals s
    WHERE s.status IN ('open', 'acknowledged', 'snoozed')
      AND s.severity IN ('critical', 'urgent')
      AND ${marketScope.where}
    ORDER BY
      CASE s.severity WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 ELSE 3 END,
      s.created_at DESC
    LIMIT ${limitParam}
  `;

  try {
    const r = await db.query(sql, params);
    return r.rows.map(row => ({
      id: row.id,
      level: row.level,
      source: row.source,
      message: row.message,
      created_at: row.created_at,
    }));
  } catch (err) {
    log.warn({ err }, '[dashboard-pilotage-market] scoped alerts non-fatal');
    return [];
  }
}

async function buildMarketPilotage(filters, market) {
  if (!market || !market.id || !market.code) {
    throw new Error('dashboard_market_not_resolved');
  }
  if (!filters || filters.market_id !== market.id) {
    throw new Error('dashboard_market_filter_not_server_bound');
  }

  const [
    ca, cmdsActives, margeConsolidee, alertesCritiques, tauxCouts,
    coutReel, cmdsCoutIncomplet, coutMoyParCmd,
    cmdsAujourdhui, colisEnTransit, disponiblesRelais, retardsCritiques, tauxCompletudeScans,
    topAlerts,
  ] = await Promise.all([
    metrics.getCAEncaisse(filters),
    metrics.getCmdsActives(filters),
    metrics.getMargeConsolidee(filters),
    metrics.getAlertesCritiques(filters),
    metrics.getTauxCompletudeCouts(filters),
    metrics.getCoutReel(filters),
    metrics.getCmdsCoutIncompletCount(filters),
    metrics.getCoutMoyParCmd(filters),
    metrics.getCmdsAujourdhui(filters),
    metrics.getColisEnTransit(filters),
    metrics.getDisponiblesRelais(filters),
    metrics.getRetardsCritiques(filters),
    metrics.getTauxCompletudeScans(filters),
    fetchTopAlerts(filters, 10),
  ]);

  const view_blocks = [
    {
      view: 'control_tower',
      title: 'Tour de contrôle',
      subtitle: 'Voir, comprendre, décider',
      url: '/admin/control-tower',
      kpis_summary: [ca, cmdsActives, alertesCritiques, margeConsolidee, tauxCouts],
    },
    {
      view: 'costing',
      title: 'Coût rendu relais',
      subtitle: 'Dire la vérité économique',
      url: '/admin/costing',
      kpis_summary: [ca, coutReel, margeConsolidee, cmdsCoutIncomplet, coutMoyParCmd],
    },
    {
      view: 'orders_logistics',
      title: 'Commandes & logistique',
      subtitle: 'Exécuter sans friction',
      url: '/admin/orders-logistics',
      kpis_summary: [cmdsAujourdhui, colisEnTransit, disponiblesRelais, retardsCritiques, tauxCompletudeScans],
    },
  ];

  return {
    scope: {
      mode: 'market',
      market: {
        code: market.code,
        name: market.name,
        currency: market.currency,
      },
    },
    kpis_global: [ca, cmdsActives, margeConsolidee, alertesCritiques, tauxCouts],
    view_blocks,
    economic_flow: {
      stages: [
        { key: 'estimated_price', label: 'Prix estimé', url: '/admin/pricing' },
        { key: 'order', label: 'Commande', url: '/admin/orders-logistics' },
        { key: 'payment', label: 'Paiement', url: '/admin/orders-logistics?payment_status=paid' },
        { key: 'parcels_scans', label: 'Colis & scans', url: '/admin/orders-logistics?parcel_status=in_transit' },
        { key: 'real_cost', label: 'Coût réel reventilé', url: '/admin/costing' },
        { key: 'real_margin', label: 'Marge consolidée', url: '/admin/costing?cost_status=actual' },
        { key: 'recalibration', label: 'Recalibrage pricing', url: '/admin/costing/recalibration' },
      ],
    },
    principles: [
      'Une seule source de vérité par KPI',
      'Pas de coût manquant à 0',
      'Pas de commande sans paiement sécurisé',
      'cost_status visible : estimated, partial_real, actual, incomplete',
      'Le dashboard doit aider à décider',
    ],
    system_alerts: topAlerts,
    data_quality: {
      generated_at: new Date().toISOString(),
      filters: publicFilters(filters),
      warnings: [],
      incomplete_fields: [],
      source_tables: [
        'orders', 'parcels', 'scan_events', 'signals',
        'order_item_cost_imputations', 'order_item_real_cost_allocations',
      ],
      scope_enforced: true,
    },
  };
}

module.exports = {
  publicFilters,
  fetchTopAlerts,
  buildMarketPilotage,
};
