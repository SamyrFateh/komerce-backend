/**
 * @komerce-arch
 * @role          dashboard-pilotage-market-aggregate
 * @domain        admin-dashboard
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
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const metrics = require('./dashboard-metrics');
const controlChain = require('./logistics-control-chain-projection');
const { mergePilotageAlerts, summarizeControlChain, pilotageStockFilters, pilotageDecisionClocks } = require('./dashboard-pilotage-alert-aggregation');
const { buildSignalMarketClause } = require('./dashboard-metrics/_helpers');
const { EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL } = require('./signal-simulation-scope');
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
           s.signal_type,
           so.reference    AS order_reference,
           s.created_at
    FROM signals s
    LEFT JOIN orders so
      ON s.entity_type = 'order'
     AND so.id::text = s.entity_id::text
    WHERE s.status IN ('open', 'acknowledged', 'snoozed')
      AND s.severity IN ('critical', 'urgent')
      AND ${EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL}
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
      signal_type: row.signal_type || null,
      order_reference: row.order_reference || null,
      created_at: row.created_at,
    }));
  } catch (err) {
    log.warn({ err }, '[dashboard-pilotage-market] scoped alerts non-fatal');
    return [];
  }
}

async function buildMarketPilotage(filters, market, actor=null) {
  if (!market || !market.id || !market.code) {
    throw new Error('dashboard_market_not_resolved');
  }
  if (!filters || filters.market_id !== market.id) {
    throw new Error('dashboard_market_filter_not_server_bound');
  }

  const [
    ca, cmdsActives, alertesCritiques, tauxCouts,
    coutReel, cmdsCoutIncomplet, coutMoyParCmd,
    cmdsAujourdhui, colisEnTransit, disponiblesRelais, retardsCritiques, tauxCompletudeScans,
    topAlerts,
    controlChainProjection,
  ] = await Promise.all([
    metrics.getCAEncaisse(filters),
    metrics.getCmdsActives(pilotageStockFilters(filters)),
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
    controlChain.getControlChain({ market }),
  ]);

  const periodStart=new Date().toISOString().slice(0,7)+'-01';
  const economicResult={key:'economic_period_result',label:'Résultat économique marché — '+periodStart.slice(0,7)+' UTC',
    value:null,unit:market.currency,delta:null,drill_to:'/admin/workspaces/pricing',
    data_quality:{metric_id:'eco.period_result',period_start:periodStart,status:filters.simulation_scope?'SIMULATION_EXCLUDED':'MARKET_RESULT_NOT_RECONCILED',completeness:'provisional'}};
  if(actor?.id&&!filters.simulation_scope){
    try{
      const result=await require('./economic-cost-center-read-model').readMarketPeriodDecision(actor,market.code,periodStart);
      economicResult.value=result.display.result;
      economicResult.data_quality={...economicResult.data_quality,status:result.status,reasons:result.reasons,fx_status:result.display.fxStatus};
    }catch(err){
      // A dashboard reader without pricing.read does not gain access to ECO.
      economicResult.data_quality.status=err.status===403?'UNAVAILABLE':'MARKET_RESULT_NOT_RECONCILED';
      log.warn({err},'[dashboard-pilotage-market] economic period result unavailable');
    }
  }
  const view_blocks = [
    {
      view: 'control_tower',
      title: 'Tour de contrôle',
      subtitle: 'Voir, comprendre, décider',
      url: '/admin/pilotage',
      kpis_summary: [ca, cmdsActives, alertesCritiques, economicResult, tauxCouts],
    },
    {
      view: 'costing',
      title: 'Coûts & marge',
      subtitle: 'Résultat ECO marché du mois UTC ; diagnostics de coûts',
      url: '/admin/finance',
      kpis_summary: [ca, coutReel, economicResult, cmdsCoutIncomplet, coutMoyParCmd],
    },
    {
      view: 'orders_logistics',
      title: 'Commandes & logistique',
      subtitle: 'Exécuter sans friction',
      url: '/admin/operations',
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
    decision_clocks: pilotageDecisionClocks(filters,economicResult,new Date().toISOString()),
    kpis_global: [ca, cmdsActives, economicResult, alertesCritiques, tauxCouts],
    view_blocks,
    economic_flow: {
      stages: [
        { key: 'estimated_price', label: 'Prix estimé', url: '/admin/workspaces/pricing' },
        { key: 'order', label: 'Commande', url: '/admin/operations' },
        { key: 'payment', label: 'Paiement', url: '/admin/operations' },
        { key: 'parcels_scans', label: 'Colis & scans', url: '/admin/operations#operations-control-chain' },
        { key: 'real_cost', label: 'Coût réel reventilé', url: '/admin/costing' },
        { key: 'real_margin', label: 'Résultat économique mensuel', url: '/admin/workspaces/pricing' },
        { key: 'recalibration', label: 'Recalibrage pricing', url: '/admin/workspaces/pricing' },
      ],
    },
    principles: [
      'Une seule source de vérité par KPI',
      'Pas de coût manquant à 0',
      'Pas de commande sans paiement sécurisé',
      'cost_status visible : estimated, partial_real, actual, incomplete',
      'Le dashboard doit aider à décider',
    ],
    control_chain: summarizeControlChain(controlChainProjection),
    system_alerts: mergePilotageAlerts(topAlerts, controlChainProjection, 10),
    data_quality: {
      generated_at: new Date().toISOString(),
      filters: publicFilters(filters),
      warnings: [],
      incomplete_fields: [],
      source_tables: [
        'orders', 'parcels', 'scan_events', 'signals',
        'purchase_lines', 'purchase_orders', 'hub_purchase_allocations',
        'hub_physical_units', 'customs_shipments',
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
