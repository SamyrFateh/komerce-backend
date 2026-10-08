/**
 * @komerce-arch
 * @role          dashboard-pilotage-alert-aggregation
 * @domain        dashboard
 * @layer         service
 * @criticality   medium
 * @inputs        canonical_system_alerts, logistics_control_chain_projection
 * @outputs       deduplicated_pilotage_alerts
 * @depends       none
 * @used-by       services/dashboard-pilotage-market.js, routes/admin-dashboard.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, DOCTRINE_LOGISTICS_CONTROL_CHAIN
 * @impact-areas  dashboard, admin-dashboard, logistics
 * @version       2026-10
 */
'use strict';

function levelRank(level) {
  if (level === 'urgent' || level === 'critical') return 0;
  if (level === 'warning') return 1;
  return 2;
}

function structuralAlertsFromChain(chain) {
  const rows = Array.isArray(chain && chain.structural_alerts) ? chain.structural_alerts : [];
  return rows.map(row => Object.freeze({
    id: `structural:${row.stage || 'UNKNOWN'}:${row.reason_code || 'exception'}:${row.owner_role || ''}`,
    level: row.health === 'RED' ? 'critical' : 'warning',
    source: row.owner_role || 'operations',
    title: row.summary || row.reason_code || 'Cause structurelle',
    message: `${Number(row.order_count) || 0} commande(s) impactée(s) · ${row.stage || 'Étape inconnue'}`,
    action_url: '/admin/operations#operations-control-chain',
    action_label: 'Voir la chaîne →',
    structural: true,
    reason_code: row.reason_code || null,
    order_references: Object.freeze(Array.isArray(row.order_references) ? [...row.order_references] : []),
    order_count: Number(row.order_count) || 0,
  }));
}


function summarizeControlChain(chain) {
  const stages = Array.isArray(chain && chain.stages) ? chain.stages : [];
  const byStage = chain && chain.by_stage && typeof chain.by_stage === 'object' ? chain.by_stage : {};
  const structural = Array.isArray(chain && chain.structural_alerts) ? chain.structural_alerts : [];

  const stage_health = stages.map(stage => {
    const orders = Array.isArray(byStage[stage.key]) ? byStage[stage.key] : [];
    const counts = { GREEN: 0, ORANGE: 0, RED: 0, UNKNOWN: 0 };
    orders.forEach(order => {
      const health = ['GREEN', 'ORANGE', 'RED', 'UNKNOWN'].includes(order && order.health) ? order.health : 'UNKNOWN';
      counts[health] += 1;
    });
    const health = counts.RED > 0 ? 'RED'
      : (counts.ORANGE > 0 ? 'ORANGE' : (counts.UNKNOWN > 0 ? 'UNKNOWN' : 'GREEN'));
    return Object.freeze({
      key: stage.key,
      label: stage.label,
      health,
      order_count: orders.length,
      health_counts: Object.freeze(counts),
    });
  });

  return Object.freeze({
    stages: Object.freeze(stage_health),
    structural_alerts: Object.freeze(structural.map(row => Object.freeze({
      stage: row.stage || 'UNKNOWN',
      health: ['GREEN', 'ORANGE', 'RED', 'UNKNOWN'].includes(row.health) ? row.health : 'UNKNOWN',
      reason_code: row.reason_code || 'exception',
      summary: row.summary || row.reason_code || 'Cause structurelle',
      owner_role: row.owner_role || null,
      order_count: Number(row.order_count) || 0,
      order_references: Object.freeze(Array.isArray(row.order_references) ? [...row.order_references] : []),
      href: '/admin/operations#operations-control-chain',
    }))),
  });
}

function publicRawAlert(row) {
  return Object.freeze({
    id: row.id,
    level: row.level,
    source: row.source,
    ...(row.title ? { title: row.title } : {}),
    message: row.message,
    created_at: row.created_at,
  });
}

function mergePilotageAlerts(rawAlerts, chain, limit = 10) {
  const structural = structuralAlertsFromChain(chain);
  const covered = new Set();
  structural.forEach(cause => {
    cause.order_references.forEach(reference => {
      if (cause.reason_code && reference) covered.add(`${cause.reason_code}|${reference}`);
    });
  });

  const residual = (Array.isArray(rawAlerts) ? rawAlerts : [])
    .filter(row => !covered.has(`${row.signal_type || ''}|${row.order_reference || ''}`))
    .map(publicRawAlert);

  return Object.freeze([...structural, ...residual]
    .sort((a, b) => (
      levelRank(a.level) - levelRank(b.level)
      || Number(Boolean(b.structural)) - Number(Boolean(a.structural))
      || Number(b.order_count || 0) - Number(a.order_count || 0)
      || String(b.created_at || '').localeCompare(String(a.created_at || ''))
    ))
    .slice(0, Math.max(0, Number(limit) || 0)));
}

module.exports = {
  levelRank,
  structuralAlertsFromChain,
  mergePilotageAlerts,
  summarizeControlChain,
};
