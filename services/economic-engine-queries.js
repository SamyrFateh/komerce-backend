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

const db        = require('../db');
const ecoBridge = require('../utils/eco-bridge');
const log       = require('../utils/logger').child({ module: 'economic-engine-queries' });

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

  try {
    await db.query("UPDATE economic_variables SET label = 'Hub (Dubai)' WHERE key = 'cost_hub' AND label = 'Hub (France)'");
  } catch(e) { /* ignore if economic_variables table doesn't exist yet */ }

  const variables = [
    { category: 'cost',    key: 'cost_sourcing',        label: 'Sourcing (Dubai/Chine)',        unit: 'KMF', value_supposed: 1000,  is_critical: true,  is_computed: false },
    { category: 'cost',    key: 'cost_transit',         label: 'Transit (vers Comores)',         unit: 'KMF', value_supposed: 500,   is_critical: true,  is_computed: false },
    { category: 'cost',    key: 'cost_hub',             label: 'Hub (Dubai)',                   unit: 'KMF', value_supposed: 400,   is_critical: false, is_computed: false },
    { category: 'cost',    key: 'cost_relais',          label: 'Relais (Comores)',               unit: 'KMF', value_supposed: 300,   is_critical: false, is_computed: false },
    { category: 'cost',    key: 'cost_support',         label: 'Support client',                unit: 'KMF', value_supposed: 200,   is_critical: false, is_computed: false },
    { category: 'cost',    key: 'total_cost_per_order', label: 'Coût total par commande',       unit: 'KMF', value_supposed: 2400,  is_critical: true,  is_computed: true  },
    { category: 'revenue', key: 'target_basket_avg',    label: 'Panier moyen cible',            unit: 'KMF', value_supposed: 15000, is_critical: true,  is_computed: false },
    { category: 'revenue', key: 'seuil_rentabilite',    label: 'Seuil de rentabilité',          unit: 'KMF', value_supposed: 6234,  is_critical: true,  is_computed: true  },
    { category: 'revenue', key: 'orders_per_month',     label: 'Commandes / mois',              unit: 'count', value_supposed: 100, is_critical: true,  is_computed: false },
    { category: 'margin',  key: 'margin_rail_a',        label: 'Marge Rail A (Essentiels)',     unit: '%',   value_supposed: 45,    is_critical: true,  is_computed: false },
    { category: 'margin',  key: 'margin_rail_b',        label: 'Marge Rail B (Hero)',           unit: '%',   value_supposed: 18,    is_critical: true,  is_computed: false },
    { category: 'margin',  key: 'margin_rail_c',        label: 'Marge Rail C (Sur-mesure)',     unit: '%',   value_supposed: 35,    is_critical: false, is_computed: false },
    { category: 'margin',  key: 'margin_rail_d',        label: 'Marge Rail D (Impulsifs)',      unit: '%',   value_supposed: 70,    is_critical: false, is_computed: false },
    { category: 'margin',  key: 'margin_weighted_avg',  label: 'Marge pondérée moyenne',       unit: '%',   value_supposed: 38.5,  is_critical: true,  is_computed: true  },
    { category: 'mix',     key: 'mix_rail_a',           label: 'Mix CA Rail A',                 unit: '%',   value_supposed: 60,    is_critical: true,  is_computed: false },
    { category: 'mix',     key: 'mix_rail_b',           label: 'Mix CA Rail B',                 unit: '%',   value_supposed: 25,    is_critical: false, is_computed: false },
    { category: 'mix',     key: 'mix_rail_c',           label: 'Mix CA Rail C',                 unit: '%',   value_supposed: 10,    is_critical: false, is_computed: false },
    { category: 'mix',     key: 'mix_rail_d',           label: 'Mix CA Rail D',                 unit: '%',   value_supposed: 5,     is_critical: false, is_computed: false },
    { category: 'exchange', key: 'eur_kmf',             label: 'Taux EUR → KMF',               unit: 'ratio', value_supposed: 492, is_critical: true,  is_computed: false },
    { category: 'exchange', key: 'aed_kmf',             label: 'Taux AED → KMF',               unit: 'ratio', value_supposed: 138, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'commission_agent_pct',            label: 'Commission agent (%)',          unit: '%',   value_supposed: 5,     is_critical: false, is_computed: false },
    { category: 'pricing', key: 'transport_dxb_kmf',               label: 'Transport Deira → Hub',         unit: 'KMF', value_supposed: 500,   is_critical: false, is_computed: false },
    { category: 'pricing', key: 'transitaire_pct',                 label: 'Commission transitaire (%)',    unit: '%',   value_supposed: 2,     is_critical: false, is_computed: false },
    { category: 'pricing', key: 'transitaire_fixed_kmf',           label: 'Frais fixes transitaire',       unit: 'KMF', value_supposed: 450,   is_critical: false, is_computed: false },
    { category: 'pricing', key: 'portuaires_kmf',                  label: 'Frais portuaires',              unit: 'KMF', value_supposed: 1200,  is_critical: false, is_computed: false },
    { category: 'pricing', key: 'transport_relais_kmf',            label: 'Transport → relais',            unit: 'KMF', value_supposed: 840,   is_critical: false, is_computed: false },
    { category: 'pricing', key: 'commission_relais_standard_kmf',  label: 'Commission relais standard',    unit: 'KMF', value_supposed: 500,   is_critical: false, is_computed: false },
    { category: 'pricing', key: 'commission_relais_showroom_kmf',  label: 'Commission relais showroom',    unit: 'KMF', value_supposed: 750,   is_critical: false, is_computed: false },
    { category: 'pricing', key: 'frais_stripe_pct',                label: 'Frais Stripe (%)',              unit: '%',   value_supposed: 2.5,   is_critical: false, is_computed: false },
    { category: 'pricing', key: 'marge_cible_pct',                 label: 'Marge cible (%)',               unit: '%',   value_supposed: 12,    is_critical: true,  is_computed: false },
    { category: 'pricing', key: 'fret_eur_m3',                     label: 'Fret maritime EUR/m³',          unit: 'EUR', value_supposed: 180,   is_critical: true,  is_computed: false },
    { category: 'pricing', key: 'freight_kmf_per_kg',              label: 'Fret KMF/kg',                  unit: 'KMF', value_supposed: 65,    is_critical: false, is_computed: false },
    { category: 'pricing', key: 'hub_monthly_cost_aed',            label: 'Coût Hub mensuel',              unit: 'AED', value_supposed: 7000,  is_critical: true,  is_computed: false },
    { category: 'pricing', key: 'customs_rate_default_pct',        label: 'Taux douane terrain défaut',   unit: '%',   value_supposed: 42,    is_critical: true,  is_computed: false },
    { category: 'health',  key: 'safety_ratio',                    label: 'Marge de sécurité',             unit: '%',   value_supposed: 0,     is_critical: true,  is_computed: true  },
    { category: 'health',  key: 'margin_pressure',                 label: 'Pression charges',              unit: '%',   value_supposed: 0,     is_critical: true,  is_computed: true  },
    { category: 'health',  key: 'monthly_breakeven_orders',        label: 'Commandes équilibre/mois',     unit: 'count', value_supposed: 0,   is_critical: true,  is_computed: true  },
    { category: 'health',  key: 'net_profit_per_order',            label: 'Profit net par commande',       unit: 'KMF', value_supposed: 0,     is_critical: true,  is_computed: true  },
  ];

  for (const v of variables) {
    await db.query(
      `INSERT INTO economic_variables (category, key, label, unit, value_supposed, is_critical, is_computed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO NOTHING`,
      [v.category, v.key, v.label, v.unit, v.value_supposed, v.is_critical, v.is_computed]
    );
  }

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
  const result = await db.query(
    'SELECT value_used, value_supposed FROM economic_variables WHERE key = $1 AND is_active = TRUE',
    [key]
  );
  if (!result.rows[0]) return fallback;
  const v = result.rows[0].value_used != null ? result.rows[0].value_used : result.rows[0].value_supposed;
  return v !== null ? Number(v) : fallback;
}

async function setComputed(key, value) {
  await db.query(
    "UPDATE economic_variables SET value_used = $1, value_supposed = $1, source_used = 'computed', updated_at = NOW() WHERE key = $2 AND is_computed = TRUE",
    [value, key]
  );
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

async function redistribute(triggerEvent) {
  const chargesResult = await db.query('SELECT * FROM charges WHERE is_active = TRUE');
  const charges = chargesResult.rows;

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

  const ordersPerMonth = await getVar('orders_per_month', 100);
  const monthlyPerOrder = ordersPerMonth > 0 ? Math.round(totalMonthlyCost / ordersPerMonth) : 0;
  const totalCostPerOrder = perOrderCost + monthlyPerOrder;

  const mixA = await getVar('mix_rail_a', 60);
  const mixB = await getVar('mix_rail_b', 25);
  const mixC = await getVar('mix_rail_c', 10);
  const mixD = await getVar('mix_rail_d', 5);
  const margA = await getVar('margin_rail_a', 45);
  const margB = await getVar('margin_rail_b', 18);
  const margC = await getVar('margin_rail_c', 35);
  const margD = await getVar('margin_rail_d', 70);

  const weightedMargin = (mixA * margA + mixB * margB + mixC * margC + mixD * margD) / 100;

  const breakEven = weightedMargin > 0
    ? Math.round(totalCostPerOrder / (weightedMargin / 100))
    : 999999;

  const targetBasket = await getVar('target_basket_avg', 15000);

  const safetyRatio = targetBasket > 0
    ? Number(((targetBasket - breakEven) / targetBasket * 100).toFixed(1))
    : 0;

  const marginPressure = targetBasket > 0
    ? Number((totalCostPerOrder / targetBasket * 100).toFixed(1))
    : 100;

  const grossProfit = Math.round(targetBasket * weightedMargin / 100);
  const netProfit = grossProfit - totalCostPerOrder;

  const monthlyBreakevenOrders = netProfit > 0 ? Math.ceil(totalMonthlyCost / netProfit) : 999;

  await setComputed('total_cost_per_order', totalCostPerOrder);
  await setComputed('margin_weighted_avg', Number(weightedMargin.toFixed(1)));
  await setComputed('seuil_rentabilite', breakEven);
  await setComputed('safety_ratio', safetyRatio);
  await setComputed('margin_pressure', marginPressure);
  await setComputed('net_profit_per_order', netProfit);
  await setComputed('monthly_breakeven_orders', monthlyBreakevenOrders);

  let alerts = checkCoherence({ totalCostPerOrder, breakEven, targetBasket, safetyRatio,
    marginPressure, weightedMargin, netProfit, mixA, mixB, mixC, mixD });

  const driftAlerts = await checkSOVDrift();
  alerts = alerts.concat(driftAlerts);

  const status = determineStatus(alerts);

  // Debounce 15 min snapshot
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
      [JSON.stringify({ totalCostPerOrder, breakEven, targetBasket, safetyRatio, marginPressure,
        weightedMargin, netProfit, monthlyBreakevenOrders,
        charges_per_order: perOrderCost, charges_monthly: totalMonthlyCost, charges_count: charges.length }),
       status, triggerEvent || 'manual']
    );
  }

  return { status, totalCostPerOrder, breakEven, safetyRatio, marginPressure, netProfit,
    weightedMargin, monthlyBreakevenOrders, alerts };
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
  const result = await db.query(
    'SELECT * FROM economic_variables WHERE is_active = TRUE ORDER BY category, key'
  );
  const categories = {};
  result.rows.forEach(v => {
    const cat = v.category;
    if (!categories[cat]) {
      const meta = CATEGORY_META[cat] || { label: cat, icon: '📦' };
      categories[cat] = { label: meta.label, icon: meta.icon, variables: [] };
    }
    categories[cat].variables.push(v);
  });
  return { categories };
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

async function updateVariable(key, body) {
  const check = await db.query('SELECT * FROM economic_variables WHERE key = $1', [key]);
  if (!check.rows[0]) return { notFound: true };
  if (check.rows[0].is_computed) return { computed: true };

  const updates = [];
  const params = [];
  let idx = 1;

  if (body.value_supposed !== undefined) { updates.push('value_supposed = $' + idx); params.push(body.value_supposed); idx++; }
  if (body.value_observed !== undefined) { updates.push('value_observed = $' + idx); params.push(body.value_observed); idx++; }
  if (body.value_used     !== undefined) { updates.push('value_used = $'     + idx); params.push(body.value_used);     idx++; }
  if (body.source_used    !== undefined) { updates.push('source_used = $'    + idx); params.push(body.source_used);    idx++; }

  if (updates.length === 0) return { noFields: true };

  updates.push('updated_at = NOW()');
  params.push(key);

  const sql = 'UPDATE economic_variables SET ' + updates.join(', ') + ' WHERE key = $' + idx + ' RETURNING *';
  const result = await db.query(sql, params);

  const row = result.rows[0];
  if (row.source_used === 'supposed' && row.value_supposed !== null) {
    await db.query('UPDATE economic_variables SET value_used = value_supposed WHERE key = $1', [key]);
  } else if (row.source_used === 'observed' && row.value_observed !== null) {
    await db.query('UPDATE economic_variables SET value_used = value_observed WHERE key = $1', [key]);
  }

  const updated = await db.query('SELECT * FROM economic_variables WHERE key = $1', [key]);

  await redistribute('variable_update:' + key);
  ecoBridge.invalidateEcoCache();
  ecoBridge.invalidateChargesCache();

  const summary = await buildExecutiveSummary();
  return { variable: updated.rows[0], executive: summary };
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
  checkCoherence, checkSOVDrift, determineStatus, generateRecommendation,
  redistribute, buildExecutiveSummary,
  getVariables, getCharges, getCoherence, getHistory,
  updateVariable, createCharge, updateCharge, toggleCharge, deleteCharge,
};
