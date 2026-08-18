/**
 * @komerce-arch
 * @role          economic-engine-calculation-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        finance_config, charges, trigger_event
 * @outputs       computed_variables, alerts, snapshots, executive_summary
 * @depends       db.js, services/economic-config.js, utils/eco-bridge.js
 * @used-by       routes/economic-engine.js, admin-dashboards
 * @db-read       charges, economic_snapshots, economic_variables, finance_config
 * @db-write      charges, economic_snapshots, finance_config
 * @db-txn        snapshot_debounce, coherence_model_recalculation
 * @doctrine      couts_repartis_par_commande, coherence_model_economique, snapshot_debounce, finance_config_single_runtime_truth, economic_variables_read_only
 * @impact-areas  pricing, margin, dashboard, admin-economic, finance-config
 * @version       2026-06
 */

'use strict';

/**
 * services/economic-engine-queries.js
 *
 * Extrait de routes/economic-engine.js — R9 (2026-06-14)
 *
 * Expose :
 *   seedEconomicData()                          — seed idempotent au démarrage
 *   getVar(key, fallback)                       — lecture variable éco
 *   setComputed(key, value)                     — mise à jour variable calculée
 *   checkSOVDrift()                             — alertes dérive SOV
 *   redistribute(triggerEvent)                  — recalcul moteur + snapshot
 *   buildExecutiveSummary()                     — résumé exécutif complet
 *   getVariables()                              — GET /variables
 *   getCharges()                                — GET /charges
 *   getCoherence()                              — GET /coherence
 *   getHistory()                                — GET /history
 *   createCharge(body)                          — POST /charges
 *   updateCharge(id, body)                      — PUT /charges/:id
 *   toggleCharge(id)                            — PUT /charges/:id/toggle
 *   deleteCharge(id, force)                     — DELETE /charges/:id
 *   updateVariable(key, body)                   — PUT /variables/:key
 *   CONSTANTS : CATEGORY_META, FAMILY_META, STATUS_MAP
 *
 * Aucune logique métier modifiée — extraction pure iso-comportement.
 * Bug pré-existant : 'log' était utilisé dans la route sans import —
 * corrigé ici (import ajouté).
 */

const db             = require('../db');
const ecoBridge      = require('../utils/eco-bridge');
const economicConfig = require('./economic-config');
const log            = require('../utils/logger').child({ module: 'economic-engine-queries' });

// ─── Constants ───────────────────────────────────────────────────────

const CATEGORY_META = {
  cost:     { label: 'Coûts', icon: '💰' },
  revenue:  { label: 'Revenus', icon: '📈' },
  margin:   { label: 'Marges', icon: '📊' },
  mix:      { label: 'Mix CA', icon: '🎯' },
  exchange: { label: 'Change', icon: '💱' },
  pricing:  { label: 'Pricing', icon: '🏷️' },
  health:   { label: 'Santé', icon: '🏥' },
};

const FAMILY_META = {
  demarrage:      { label: 'Démarrage', emoji: '🚀' },
  croisiere:      { label: 'Croisière', emoji: '⛵' },
  operationnelle: { label: 'Opérationnelle', emoji: '⚙️' },
  exceptionnelle: { label: 'Exceptionnelle', emoji: '⚡' },
  incident:       { label: 'Incident / Rattrapage', emoji: '🔧' },
};

const STATUS_MAP = {
  stable:     { label: 'Stable', emoji: '🟢' },
  surveiller: { label: 'À surveiller', emoji: '🟡' },
  tension:    { label: 'Sous tension', emoji: '🟠' },
  blocking:   { label: 'Bloquant', emoji: '🔴' },
};

// ─── Seed ────────────────────────────────────────────────────────────

async function seedEconomicData() {
  try {
    await db.query("UPDATE charges SET name = 'Hub Dubai' WHERE name = 'Hub France'");
    await db.query("UPDATE charges SET recurrence_period = 'monthly' WHERE name IN ('Hub Dubai', 'Relais Comores', 'Sourcing Dubai', 'Support client') AND recurrence_period = 'per_order'");
  } catch(e) { /* ignore if charges table doesn't exist yet */ }

  // LOT 1A-4 : economic_variables est legacy read-only. Les métadonnées
  // historiques restent en DB pour compat/forensic, sans seed runtime.

  const charges = [
    { family: 'operationnelle', name: 'Hub Dubai',       amount_kmf: 400,  is_recurring: true, recurrence_period: 'monthly'   },
    { family: 'operationnelle', name: 'Relais Comores',  amount_kmf: 300,  is_recurring: true, recurrence_period: 'monthly'   },
    { family: 'operationnelle', name: 'Sourcing Dubai',  amount_kmf: 1000, is_recurring: true, recurrence_period: 'monthly'   },
    { family: 'operationnelle', name: 'Support client',  amount_kmf: 200,  is_recurring: true, recurrence_period: 'monthly'   },
    { family: 'operationnelle', name: 'Transit Comores', amount_kmf: 500,  is_recurring: true, recurrence_period: 'per_order' },
  ];

  for (const c of charges) {
    await db.query(
      `INSERT INTO charges (family, name, amount_kmf, is_recurring, recurrence_period)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (SELECT 1 FROM charges WHERE name = $2 AND family = $1)`,
      [c.family, c.name, c.amount_kmf, c.is_recurring, c.recurrence_period]
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString('fr-FR');
}

async function getVar(key, fallback) {
  const config = await economicConfig.loadFinanceConfig();
  const value = economicConfig.resolveLegacyInput(config, key);
  return value !== undefined ? value : fallback;
}

// Compat export : les computed ne sont plus persistés dans economic_variables.
async function setComputed(key, value) {
  return { key, value, persisted: false, source: 'computed_projection' };
}

// ─── Coherence Checks ────────────────────────────────────────────────

function checkCoherence(data) {
  const alerts = [];

  if (data.breakEven > data.targetBasket) {
    alerts.push({
      severity: 'blocking',
      category: 'rentabilite',
      message: 'Seuil de rentabilité (' + fmt(data.breakEven) + ' KMF) dépasse le panier moyen cible (' + fmt(data.targetBasket) + ' KMF)',
      detail: 'Le modèle ne peut pas être rentable avec la structure de coûts actuelle',
    });
  }

  if (data.safetyRatio < 5 && data.safetyRatio >= 0) {
    alerts.push({ severity: 'critical', category: 'securite',
      message: 'Marge de sécurité dangereusement basse : ' + data.safetyRatio + '%',
      detail: 'Moins de 5% de marge entre le seuil et le panier cible' });
  } else if (data.safetyRatio < 15) {
    alerts.push({ severity: 'warning', category: 'securite',
      message: 'Marge de sécurité faible : ' + data.safetyRatio + '%',
      detail: 'Recommandé : > 15%' });
  }

  const mixSum = data.mixA + data.mixB + data.mixC + data.mixD;
  if (Math.abs(mixSum - 100) > 0.5) {
    alerts.push({ severity: 'critical', category: 'coherence',
      message: 'Mix CA ne totalise pas 100% (actuellement ' + mixSum + '%)',
      detail: "Corrigez la répartition du chiffre d'affaires par rail" });
  }

  if (data.netProfit < 0) {
    alerts.push({ severity: 'critical', category: 'rentabilite',
      message: 'Profit net négatif : ' + fmt(data.netProfit) + ' KMF par commande',
      detail: 'Chaque commande génère une perte' });
  }

  if (data.marginPressure > 25) {
    alerts.push({ severity: 'warning', category: 'charges',
      message: 'Pression charges élevée : ' + data.marginPressure + '% du panier',
      detail: "Les charges représentent plus d'un quart du panier moyen" });
  }

  return alerts;
}

async function checkSOVDrift() {
  const result = await db.query(
    'SELECT key, label, value_supposed, value_observed FROM economic_variables WHERE is_active = TRUE AND value_supposed IS NOT NULL AND value_observed IS NOT NULL AND value_supposed != 0 AND ABS(value_observed - value_supposed) / ABS(value_supposed) > 0.20'
  );
  return result.rows.map(r => ({
    severity: 'warning',
    category: 'derive',
    message: 'Dérive détectée sur "' + r.label + '" : supposé ' + r.value_supposed + ', observé ' + r.value_observed,
    detail: 'Écart de ' + Math.round(Math.abs(r.value_observed - r.value_supposed) / Math.abs(r.value_supposed) * 100) + '%',
  }));
}

function determineStatus(alerts) {
  if (alerts.some(a => a.severity === 'blocking')) return 'blocking';
  if (alerts.some(a => a.severity === 'critical')) return 'tension';
  if (alerts.some(a => a.severity === 'warning'))  return 'surveiller';
  return 'stable';
}

function generateRecommendation(status, alerts) {
  if (status === 'blocking') {
    return { text: "Réduire les charges ou augmenter le panier moyen cible. Le modèle n'est pas viable en l'état.", priority: 'high' };
  }
  if (alerts.some(a => a.category === 'rentabilite')) {
    return { text: 'Revoir le mix produits : privilégier les Rails A et D (marges hautes) pour consolider la rentabilité.', priority: 'high' };
  }
  if (alerts.some(a => a.category === 'derive')) {
    return { text: 'Mettre à jour les valeurs observées pour valider ou corriger les hypothèses.', priority: 'medium' };
  }
  if (alerts.some(a => a.category === 'charges')) {
    return { text: 'Optimiser les charges opérationnelles : renégocier transit, mutualiser hub.', priority: 'medium' };
  }
  return { text: 'Modèle équilibré — continuer le suivi mensuel et affiner les valeurs observées.', priority: 'low' };
}

// ─── Redistribution Engine ────────────────────────────────────────────

function computeModel(charges, inputs) {
  const perOrderCost = charges
    .filter(c => c.recurrence_period === 'per_order')
    .reduce((s, c) => s + Number(c.amount_kmf), 0);

  const monthlyCost = charges
    .filter(c => c.recurrence_period === 'monthly')
    .reduce((s, c) => s + Number(c.amount_kmf), 0);

  const weeklyCost = charges
    .filter(c => c.recurrence_period === 'weekly')
    .reduce((s, c) => s + Number(c.amount_kmf), 0);

  const totalMonthlyCost = monthlyCost + Math.round(weeklyCost * 4.33);
  const { ordersPerMonth, targetBasket, mixA, mixB, mixC, mixD, margA, margB, margC, margD } = inputs;
  const monthlyPerOrder = ordersPerMonth > 0 ? Math.round(totalMonthlyCost / ordersPerMonth) : 0;
  const totalCostPerOrder = perOrderCost + monthlyPerOrder;
  const weightedMargin = (mixA * margA + mixB * margB + mixC * margC + mixD * margD) / 100;
  const breakEven = weightedMargin > 0 ? Math.round(totalCostPerOrder / (weightedMargin / 100)) : 999999;
  const safetyRatio = targetBasket > 0
    ? Number(((targetBasket - breakEven) / targetBasket * 100).toFixed(1))
    : 0;
  const marginPressure = targetBasket > 0
    ? Number((totalCostPerOrder / targetBasket * 100).toFixed(1))
    : 100;
  const grossProfit = Math.round(targetBasket * weightedMargin / 100);
  const netProfit = grossProfit - totalCostPerOrder;
  const monthlyBreakevenOrders = netProfit > 0 ? Math.ceil(totalMonthlyCost / netProfit) : 999;

  return {
    perOrderCost, totalMonthlyCost, totalCostPerOrder, breakEven, targetBasket,
    safetyRatio, marginPressure, weightedMargin, netProfit, monthlyBreakevenOrders,
    mixA, mixB, mixC, mixD,
  };
}

async function redistribute(triggerEvent) {
  const [chargesResult, config] = await Promise.all([
    db.query('SELECT * FROM charges WHERE is_active = TRUE'),
    economicConfig.loadFinanceConfig(),
  ]);
  const charges = chargesResult.rows;
  const model = computeModel(charges, economicConfig.buildModelInputs(config));

  let alerts = checkCoherence({
    totalCostPerOrder: model.totalCostPerOrder,
    breakEven: model.breakEven,
    targetBasket: model.targetBasket,
    safetyRatio: model.safetyRatio,
    marginPressure: model.marginPressure,
    weightedMargin: model.weightedMargin,
    netProfit: model.netProfit,
    mixA: model.mixA, mixB: model.mixB, mixC: model.mixC, mixD: model.mixD,
  });

  const driftAlerts = await checkSOVDrift();
  alerts = alerts.concat(driftAlerts);
  const status = determineStatus(alerts);

  let shouldInsertSnapshot = true;
  try {
    const lastSnap = await db.query('SELECT created_at FROM economic_snapshots ORDER BY created_at DESC LIMIT 1');
    if (lastSnap.rows.length > 0) {
      const ageMs = Date.now() - new Date(lastSnap.rows[0].created_at).getTime();
      if (ageMs < 15 * 60 * 1000) shouldInsertSnapshot = false;
    }
  } catch (_) { /* table may not exist yet */ }

  if (shouldInsertSnapshot) {
    await db.query(
      'INSERT INTO economic_snapshots (snapshot_data, model_status, trigger_event) VALUES ($1, $2, $3)',
      [JSON.stringify({
        totalCostPerOrder: model.totalCostPerOrder,
        breakEven: model.breakEven,
        targetBasket: model.targetBasket,
        safetyRatio: model.safetyRatio,
        marginPressure: model.marginPressure,
        weightedMargin: model.weightedMargin,
        netProfit: model.netProfit,
        monthlyBreakevenOrders: model.monthlyBreakevenOrders,
        charges_per_order: model.perOrderCost,
        charges_monthly: model.totalMonthlyCost,
        charges_count: charges.length,
      }), status, triggerEvent || 'manual']
    );
  }

  return {
    status,
    totalCostPerOrder: model.totalCostPerOrder,
    breakEven: model.breakEven,
    safetyRatio: model.safetyRatio,
    marginPressure: model.marginPressure,
    netProfit: model.netProfit,
    weightedMargin: model.weightedMargin,
    monthlyBreakevenOrders: model.monthlyBreakevenOrders,
    alerts,
  };
}

// ─── Executive Summary ────────────────────────────────────────────────

async function buildExecutiveSummary() {
  const result = await redistribute('executive_view');
  const statusInfo = STATUS_MAP[result.status] || STATUS_MAP.stable;

  const chargesResult = await db.query('SELECT * FROM charges WHERE is_active = TRUE');
  const charges = chargesResult.rows;

  const byFamily = {};
  let totalPerOrder = 0;
  let totalMonthly = 0;

  charges.forEach(c => {
    if (!byFamily[c.family]) byFamily[c.family] = 0;
    byFamily[c.family] += Number(c.amount_kmf);
    if (c.is_active) {
      if (c.recurrence_period === 'per_order') totalPerOrder += Number(c.amount_kmf);
      if (c.recurrence_period === 'monthly')   totalMonthly  += Number(c.amount_kmf);
      if (c.recurrence_period === 'weekly')    totalMonthly  += Math.round(Number(c.amount_kmf) * 4.33);
    }
  });

  const recommendation = generateRecommendation(result.status, result.alerts);

  const severityOrder = { blocking: 0, critical: 1, warning: 2, info: 3 };
  const sortedAlerts = result.alerts
    .sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9))
    .slice(0, 3);

  return {
    status: result.status,
    status_label: statusInfo.label,
    status_emoji: statusInfo.emoji,
    kpis: [
      { key: 'total_cost_per_order', label: 'Coût / commande',     value: result.totalCostPerOrder, unit: 'KMF', icon: '💰' },
      { key: 'seuil_rentabilite',    label: 'Seuil rentabilité',   value: result.breakEven,         unit: 'KMF', icon: '📊' },
      { key: 'safety_ratio',         label: 'Marge de sécurité',   value: result.safetyRatio,       unit: '%',   icon: '🛡️' },
      { key: 'margin_pressure',      label: 'Pression charges',    value: result.marginPressure,    unit: '%',   icon: '⚡' },
      { key: 'net_profit_per_order', label: 'Profit net / commande', value: result.netProfit,       unit: 'KMF', icon: '💎' },
    ],
    alerts: sortedAlerts,
    recommendation,
    charges_summary: {
      total_per_order: totalPerOrder,
      total_monthly:   totalMonthly,
      count_active:    charges.length,
      by_family:       byFamily,
    },
    generated_at: new Date().toISOString(),
  };
}

// ─── Read Queries ─────────────────────────────────────────────────────

async function getVariables() {
  const [varsResult, chargesResult, config] = await Promise.all([
    db.query('SELECT * FROM economic_variables WHERE is_active = TRUE ORDER BY category, key'),
    db.query('SELECT * FROM charges WHERE is_active = TRUE'),
    economicConfig.loadFinanceConfig(),
  ]);
  const model = computeModel(chargesResult.rows, economicConfig.buildModelInputs(config));
  const rows = economicConfig.projectLegacyRows(varsResult.rows, config, model);

  const categories = {};
  rows.forEach(v => {
    const cat = v.category;
    if (!categories[cat]) {
      const meta = CATEGORY_META[cat] || { label: cat, icon: '📦' };
      categories[cat] = { label: meta.label, icon: meta.icon, variables: [] };
    }
    categories[cat].variables.push(v);
  });
  return { categories, source_of_truth: 'finance_config', legacy_storage: 'read_only' };
}

async function getCharges() {
  const result = await db.query('SELECT * FROM charges ORDER BY family, name');
  const families = {};
  const totals = { per_order: 0, monthly: 0, weekly: 0, one_time: 0 };

  result.rows.forEach(c => {
    const fam = c.family;
    if (!families[fam]) {
      const meta = FAMILY_META[fam] || { label: fam, emoji: '📦' };
      families[fam] = { label: meta.label, emoji: meta.emoji, charges: [], total_kmf: 0 };
    }
    families[fam].charges.push(c);
    if (c.is_active) {
      families[fam].total_kmf += Number(c.amount_kmf);
      if (c.recurrence_period === 'per_order') totals.per_order += Number(c.amount_kmf);
      else if (c.recurrence_period === 'monthly') totals.monthly += Number(c.amount_kmf);
      else if (c.recurrence_period === 'weekly')  totals.weekly  += Number(c.amount_kmf);
      else totals.one_time += Number(c.amount_kmf);
    }
  });

  return { families, totals };
}

async function getCoherence() {
  const result = await redistribute('coherence_check');
  const driftAlerts = await checkSOVDrift();
  const allAlerts = result.alerts.concat(driftAlerts);
  const status = determineStatus(allAlerts);
  const statusInfo = STATUS_MAP[status] || STATUS_MAP.stable;
  return { status, status_label: statusInfo.label, alerts: allAlerts, checked_at: new Date().toISOString() };
}

async function getHistory() {
  const result = await db.query(
    'SELECT * FROM economic_snapshots ORDER BY created_at DESC LIMIT 20'
  );
  return { snapshots: result.rows };
}

// ─── Mutation Services ────────────────────────────────────────────────

async function updateVariable(key, body, updatedBy) {
  const check = await db.query('SELECT * FROM economic_variables WHERE key = $1', [key]);
  if (!check.rows[0]) return { error: 'variable_not_found', status: 404, key };
  if (check.rows[0].is_computed) {
    return { error: 'computed_variable_read_only', status: 410, key, source_of_truth: 'computed_projection' };
  }

  const write = await economicConfig.writeThroughLegacyInput(key, body, updatedBy);
  if (write.error) return write;

  ecoBridge.invalidateEcoCache();
  ecoBridge.invalidateChargesCache();

  const [variable] = economicConfig.projectLegacyRows([check.rows[0]], write.finance_config, null);
  await redistribute('variable_update:' + key);
  const summary = await buildExecutiveSummary();
  return {
    variable,
    canonical_field: write.canonical_field,
    source_of_truth: 'finance_config',
    executive: summary,
  };
}

async function createCharge(body) {
  const validFamilies = ['demarrage', 'croisiere', 'operationnelle', 'exceptionnelle', 'incident'];
  if (!body.family || !body.name || body.amount_kmf === undefined) return { missingFields: true };
  if (!validFamilies.includes(body.family)) return { invalidFamily: true };

  const result = await db.query(
    'INSERT INTO charges (family, name, amount_kmf, is_recurring, recurrence_period, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [body.family, body.name, body.amount_kmf, body.is_recurring || false, body.recurrence_period || null, body.notes || null]
  );

  await redistribute('charge_created:' + result.rows[0].id);
  ecoBridge.invalidateEcoCache();
  ecoBridge.invalidateChargesCache();

  const summary = await buildExecutiveSummary();
  return { charge: result.rows[0], executive: summary };
}

async function updateCharge(id, body) {
  const check = await db.query('SELECT * FROM charges WHERE id = $1', [id]);
  if (!check.rows[0]) return { notFound: true };

  const updates = [];
  const params = [];
  let idx = 1;

  for (const field of ['name', 'amount_kmf', 'family', 'is_recurring', 'recurrence_period', 'notes']) {
    if (body[field] !== undefined) {
      updates.push(field + ' = $' + idx);
      params.push(body[field]);
      idx++;
    }
  }

  if (updates.length === 0) return { noFields: true };

  updates.push('updated_at = NOW()');
  params.push(id);

  const result = await db.query('UPDATE charges SET ' + updates.join(', ') + ' WHERE id = $' + idx + ' RETURNING *', params);

  await redistribute('charge_updated:' + id);
  ecoBridge.invalidateEcoCache();
  ecoBridge.invalidateChargesCache();

  const summary = await buildExecutiveSummary();
  return { charge: result.rows[0], executive: summary };
}

async function toggleCharge(id) {
  const result = await db.query(
    'UPDATE charges SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id]
  );
  if (!result.rows[0]) return { notFound: true };

  await redistribute('charge_toggled:' + id);
  ecoBridge.invalidateEcoCache();
  ecoBridge.invalidateChargesCache();

  const summary = await buildExecutiveSummary();
  return { charge: result.rows[0], executive: summary };
}

async function deleteCharge(id, force) {
  const existing = await db.query('SELECT * FROM charges WHERE id = $1', [id]);
  if (!existing.rows[0]) return { notFound: true };

  if (force) {
    const canDelete = existing.rows[0].is_deletable !== false;
    if (!canDelete) return { forbidden: true };
    await db.query('DELETE FROM charges WHERE id = $1', [id]);
    await redistribute('charge_deleted:' + id);
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    return { deleted: true, id, mode: 'hard' };
  }

  const result = await db.query(
    'UPDATE charges SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id]
  );
  await redistribute('charge_soft_deleted:' + id);
  ecoBridge.invalidateEcoCache();
  ecoBridge.invalidateChargesCache();

  return {
    deleted: true, id, mode: 'soft',
    hint: 'Charge désactivée. Pour suppression définitive : DELETE ?force=true',
    charge: result.rows[0],
  };
}

module.exports = {
  CATEGORY_META, FAMILY_META, STATUS_MAP,
  seedEconomicData,
  getVar, setComputed,
  checkCoherence, checkSOVDrift, determineStatus, generateRecommendation, computeModel,
  redistribute, buildExecutiveSummary,
  getVariables, getCharges, getCoherence, getHistory,
  updateVariable, createCharge, updateCharge, toggleCharge, deleteCharge,
};
