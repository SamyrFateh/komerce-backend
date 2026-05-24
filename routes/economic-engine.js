/**
 * Economic Engine — Komerce Control Tower
 * Routes: /api/admin/economic/*
 */

var express = require('express');
var router = express.Router();
var db = require('../db');
var { authenticate, requireAdmin } = require('../middleware/auth');
var ecoBridge = require('../utils/eco-bridge');

router.use(authenticate, requireAdmin);

// ─── Constants ───────────────────────────────────────────────────────

var CATEGORY_META = {
  cost:     { label: 'Coûts', icon: '💰' },
  revenue:  { label: 'Revenus', icon: '📈' },
  margin:   { label: 'Marges', icon: '📊' },
  mix:      { label: 'Mix CA', icon: '🎯' },
  exchange: { label: 'Change', icon: '💱' },
  pricing:  { label: 'Pricing', icon: '🏷️' },
  health:   { label: 'Santé', icon: '🏥' }
};

var FAMILY_META = {
  demarrage:       { label: 'Démarrage', emoji: '🚀' },
  croisiere:       { label: 'Croisière', emoji: '⛵' },
  operationnelle:  { label: 'Opérationnelle', emoji: '⚙️' },
  exceptionnelle:  { label: 'Exceptionnelle', emoji: '⚡' },
  incident:        { label: 'Incident / Rattrapage', emoji: '🔧' }
};

var STATUS_MAP = {
  stable:    { label: 'Stable', emoji: '🟢' },
  surveiller:{ label: 'À surveiller', emoji: '🟡' },
  tension:   { label: 'Sous tension', emoji: '🟠' },
  blocking:  { label: 'Bloquant', emoji: '🔴' }
};

// ─── Seed ────────────────────────────────────────────────────────────

async function seedEconomicData() {
  // ── Migration fixes (idempotent) ──────────────────────────────────
  // Fix historical charge names and periods
  try {
    await db.query("UPDATE charges SET name = 'Hub Dubai' WHERE name = 'Hub France'");
    await db.query("UPDATE charges SET recurrence_period = 'monthly' WHERE name IN ('Hub Dubai', 'Relais Comores', 'Sourcing Dubai', 'Support client') AND recurrence_period = 'per_order'");
  } catch(e) { /* ignore if charges table doesn't exist yet */ }

  // Fix cost_hub label
  try {
    await db.query("UPDATE economic_variables SET label = 'Hub (Dubai)' WHERE key = 'cost_hub' AND label = 'Hub (France)'");
  } catch(e) { /* ignore if economic_variables table doesn't exist yet */ }

  // Seed economic_variables
  var variables = [
    // cost
    { category: 'cost', key: 'cost_sourcing', label: 'Sourcing (Dubai/Chine)', unit: 'KMF', value_supposed: 1000, is_critical: true, is_computed: false },
    { category: 'cost', key: 'cost_transit', label: 'Transit (vers Comores)', unit: 'KMF', value_supposed: 500, is_critical: true, is_computed: false },
    { category: 'cost', key: 'cost_hub', label: 'Hub (Dubai)', unit: 'KMF', value_supposed: 400, is_critical: false, is_computed: false },
    { category: 'cost', key: 'cost_relais', label: 'Relais (Comores)', unit: 'KMF', value_supposed: 300, is_critical: false, is_computed: false },
    { category: 'cost', key: 'cost_support', label: 'Support client', unit: 'KMF', value_supposed: 200, is_critical: false, is_computed: false },
    { category: 'cost', key: 'total_cost_per_order', label: 'Coût total par commande', unit: 'KMF', value_supposed: 2400, is_critical: true, is_computed: true },
    // revenue
    { category: 'revenue', key: 'target_basket_avg', label: 'Panier moyen cible', unit: 'KMF', value_supposed: 15000, is_critical: true, is_computed: false },
    { category: 'revenue', key: 'seuil_rentabilite', label: 'Seuil de rentabilité', unit: 'KMF', value_supposed: 6234, is_critical: true, is_computed: true },
    { category: 'revenue', key: 'orders_per_month', label: 'Commandes / mois', unit: 'count', value_supposed: 100, is_critical: true, is_computed: false },
    // margin
    { category: 'margin', key: 'margin_rail_a', label: 'Marge Rail A (Essentiels)', unit: '%', value_supposed: 45, is_critical: true, is_computed: false },
    { category: 'margin', key: 'margin_rail_b', label: 'Marge Rail B (Hero)', unit: '%', value_supposed: 18, is_critical: true, is_computed: false },
    { category: 'margin', key: 'margin_rail_c', label: 'Marge Rail C (Sur-mesure)', unit: '%', value_supposed: 35, is_critical: false, is_computed: false },
    { category: 'margin', key: 'margin_rail_d', label: 'Marge Rail D (Impulsifs)', unit: '%', value_supposed: 70, is_critical: false, is_computed: false },
    { category: 'margin', key: 'margin_weighted_avg', label: 'Marge pondérée moyenne', unit: '%', value_supposed: 38.5, is_critical: true, is_computed: true },
    // mix
    { category: 'mix', key: 'mix_rail_a', label: 'Mix CA Rail A', unit: '%', value_supposed: 60, is_critical: true, is_computed: false },
    { category: 'mix', key: 'mix_rail_b', label: 'Mix CA Rail B', unit: '%', value_supposed: 25, is_critical: false, is_computed: false },
    { category: 'mix', key: 'mix_rail_c', label: 'Mix CA Rail C', unit: '%', value_supposed: 10, is_critical: false, is_computed: false },
    { category: 'mix', key: 'mix_rail_d', label: 'Mix CA Rail D', unit: '%', value_supposed: 5, is_critical: false, is_computed: false },
    // exchange
    { category: 'exchange', key: 'eur_kmf', label: 'Taux EUR → KMF', unit: 'ratio', value_supposed: 492, is_critical: true, is_computed: false },
    { category: 'exchange', key: 'aed_kmf', label: 'Taux AED → KMF', unit: 'ratio', value_supposed: 138, is_critical: false, is_computed: false },
    // pricing (paramètres du moteur CDR 16 étapes)
    { category: 'pricing', key: 'commission_agent_pct', label: 'Commission agent (%)', unit: '%', value_supposed: 5, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'transport_dxb_kmf', label: 'Transport Deira → Hub', unit: 'KMF', value_supposed: 500, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'transitaire_pct', label: 'Commission transitaire (%)', unit: '%', value_supposed: 2, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'transitaire_fixed_kmf', label: 'Frais fixes transitaire', unit: 'KMF', value_supposed: 450, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'portuaires_kmf', label: 'Frais portuaires', unit: 'KMF', value_supposed: 1200, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'transport_relais_kmf', label: 'Transport → relais', unit: 'KMF', value_supposed: 840, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'commission_relais_standard_kmf', label: 'Commission relais standard', unit: 'KMF', value_supposed: 500, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'commission_relais_showroom_kmf', label: 'Commission relais showroom', unit: 'KMF', value_supposed: 750, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'frais_stripe_pct', label: 'Frais Stripe (%)', unit: '%', value_supposed: 2.5, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'marge_cible_pct', label: 'Marge cible (%)', unit: '%', value_supposed: 12, is_critical: true, is_computed: false },
    { category: 'pricing', key: 'fret_eur_m3', label: 'Fret maritime EUR/m³', unit: 'EUR', value_supposed: 180, is_critical: true, is_computed: false },
    { category: 'pricing', key: 'freight_kmf_per_kg', label: 'Fret KMF/kg', unit: 'KMF', value_supposed: 65, is_critical: false, is_computed: false },
    { category: 'pricing', key: 'hub_monthly_cost_aed', label: 'Coût Hub mensuel', unit: 'AED', value_supposed: 7000, is_critical: true, is_computed: false },
    { category: 'pricing', key: 'customs_rate_default_pct', label: 'Taux douane terrain défaut', unit: '%', value_supposed: 42, is_critical: true, is_computed: false },
    // health (all computed)
    { category: 'health', key: 'safety_ratio', label: 'Marge de sécurité', unit: '%', value_supposed: 0, is_critical: true, is_computed: true },
    { category: 'health', key: 'margin_pressure', label: 'Pression charges', unit: '%', value_supposed: 0, is_critical: true, is_computed: true },
    { category: 'health', key: 'monthly_breakeven_orders', label: 'Commandes équilibre/mois', unit: 'count', value_supposed: 0, is_critical: true, is_computed: true },
    { category: 'health', key: 'net_profit_per_order', label: 'Profit net par commande', unit: 'KMF', value_supposed: 0, is_critical: true, is_computed: true }
  ];

  for (var i = 0; i < variables.length; i++) {
    var v = variables[i];
    await db.query(
      `INSERT INTO economic_variables (category, key, label, unit, value_supposed, is_critical, is_computed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO NOTHING`,
      [v.category, v.key, v.label, v.unit, v.value_supposed, v.is_critical, v.is_computed]
    );
  }

  // Seed charges
  var charges = [
    { family: 'operationnelle', name: 'Hub Dubai', amount_kmf: 400, is_recurring: true, recurrence_period: 'monthly' },
    { family: 'operationnelle', name: 'Relais Comores', amount_kmf: 300, is_recurring: true, recurrence_period: 'monthly' },
    { family: 'operationnelle', name: 'Sourcing Dubai', amount_kmf: 1000, is_recurring: true, recurrence_period: 'monthly' },
    { family: 'operationnelle', name: 'Support client', amount_kmf: 200, is_recurring: true, recurrence_period: 'monthly' },
    { family: 'operationnelle', name: 'Transit Comores', amount_kmf: 500, is_recurring: true, recurrence_period: 'per_order' }
  ];

  for (var j = 0; j < charges.length; j++) {
    var c = charges[j];
    await db.query(
      `INSERT INTO charges (family, name, amount_kmf, is_recurring, recurrence_period)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (SELECT 1 FROM charges WHERE name = $2 AND family = $1)`,
      [c.family, c.name, c.amount_kmf, c.is_recurring, c.recurrence_period]
    );
  }
}

// Run seed on load
seedEconomicData().catch(function(err) {
  log.error('[Economic] Seed error:', err.message);
});

// ─── Helpers ─────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString('fr-FR');
}

async function getVar(key, fallback) {
  var result = await db.query(
    'SELECT value_used, value_supposed FROM economic_variables WHERE key = $1 AND is_active = TRUE',
    [key]
  );
  if (!result.rows[0]) return fallback;
  var v = result.rows[0].value_used != null ? result.rows[0].value_used : result.rows[0].value_supposed;
  return v !== null ? Number(v) : fallback;
}

async function setComputed(key, value) {
  await db.query(
    "UPDATE economic_variables SET value_used = $1, value_supposed = $1, source_used = 'computed', updated_at = NOW() WHERE key = $2 AND is_computed = TRUE",
    [value, key]
  );
}

// ─── Coherence Checks ───────────────────────────────────────────────

function checkCoherence(data) {
  var alerts = [];

  // 1. Break-even > target basket → BLOCKING
  if (data.breakEven > data.targetBasket) {
    alerts.push({
      severity: 'blocking',
      category: 'rentabilite',
      message: 'Seuil de rentabilité (' + fmt(data.breakEven) + ' KMF) dépasse le panier moyen cible (' + fmt(data.targetBasket) + ' KMF)',
      detail: 'Le modèle ne peut pas être rentable avec la structure de coûts actuelle'
    });
  }

  // 2-3. Safety ratio checks
  if (data.safetyRatio < 5 && data.safetyRatio >= 0) {
    alerts.push({
      severity: 'critical',
      category: 'securite',
      message: 'Marge de sécurité dangereusement basse : ' + data.safetyRatio + '%',
      detail: 'Moins de 5% de marge entre le seuil et le panier cible'
    });
  } else if (data.safetyRatio < 15) {
    alerts.push({
      severity: 'warning',
      category: 'securite',
      message: 'Marge de sécurité faible : ' + data.safetyRatio + '%',
      detail: 'Recommandé : > 15%'
    });
  }

  // 4. Mix doesn't sum to 100
  var mixSum = data.mixA + data.mixB + data.mixC + data.mixD;
  if (Math.abs(mixSum - 100) > 0.5) {
    alerts.push({
      severity: 'critical',
      category: 'coherence',
      message: 'Mix CA ne totalise pas 100% (actuellement ' + mixSum + '%)',
      detail: 'Corrigez la répartition du chiffre d\'affaires par rail'
    });
  }

  // 5. Negative net profit
  if (data.netProfit < 0) {
    alerts.push({
      severity: 'critical',
      category: 'rentabilite',
      message: 'Profit net négatif : ' + fmt(data.netProfit) + ' KMF par commande',
      detail: 'Chaque commande génère une perte'
    });
  }

  // 6. Margin pressure > 25%
  if (data.marginPressure > 25) {
    alerts.push({
      severity: 'warning',
      category: 'charges',
      message: 'Pression charges élevée : ' + data.marginPressure + '% du panier',
      detail: 'Les charges représentent plus d\'un quart du panier moyen'
    });
  }

  return alerts;
}

async function checkSOVDrift() {
  var result = await db.query(
    "SELECT key, label, value_supposed, value_observed FROM economic_variables WHERE is_active = TRUE AND value_supposed IS NOT NULL AND value_observed IS NOT NULL AND value_supposed != 0 AND ABS(value_observed - value_supposed) / ABS(value_supposed) > 0.20"
  );
  return result.rows.map(function(r) {
    return {
      severity: 'warning',
      category: 'derive',
      message: 'Dérive détectée sur "' + r.label + '" : supposé ' + r.value_supposed + ', observé ' + r.value_observed,
      detail: 'Écart de ' + Math.round(Math.abs(r.value_observed - r.value_supposed) / Math.abs(r.value_supposed) * 100) + '%'
    };
  });
}

function determineStatus(alerts) {
  if (alerts.some(function(a) { return a.severity === 'blocking'; })) return 'blocking';
  if (alerts.some(function(a) { return a.severity === 'critical'; })) return 'tension';
  if (alerts.some(function(a) { return a.severity === 'warning'; })) return 'surveiller';
  return 'stable';
}

function generateRecommendation(status, alerts, data) {
  if (status === 'blocking') {
    return { text: 'Réduire les charges ou augmenter le panier moyen cible. Le modèle n\'est pas viable en l\'état.', priority: 'high' };
  }
  if (alerts.some(function(a) { return a.category === 'rentabilite'; })) {
    return { text: 'Revoir le mix produits : privilégier les Rails A et D (marges hautes) pour consolider la rentabilité.', priority: 'high' };
  }
  if (alerts.some(function(a) { return a.category === 'derive'; })) {
    return { text: 'Mettre à jour les valeurs observées pour valider ou corriger les hypothèses.', priority: 'medium' };
  }
  if (alerts.some(function(a) { return a.category === 'charges'; })) {
    return { text: 'Optimiser les charges opérationnelles : renégocier transit, mutualiser hub.', priority: 'medium' };
  }
  return { text: 'Modèle équilibré — continuer le suivi mensuel et affiner les valeurs observées.', priority: 'low' };
}

// ─── Redistribution Engine ──────────────────────────────────────────

async function redistribute(triggerEvent) {
  // 1. Get all active charges
  var chargesResult = await db.query("SELECT * FROM charges WHERE is_active = TRUE");
  var charges = chargesResult.rows;

  // 2. Calculate costs
  var perOrderCost = charges
    .filter(function(c) { return c.recurrence_period === 'per_order'; })
    .reduce(function(s, c) { return s + Number(c.amount_kmf); }, 0);

  var monthlyCost = charges
    .filter(function(c) { return c.recurrence_period === 'monthly'; })
    .reduce(function(s, c) { return s + Number(c.amount_kmf); }, 0);

  var weeklyCost = charges
    .filter(function(c) { return c.recurrence_period === 'weekly'; })
    .reduce(function(s, c) { return s + Number(c.amount_kmf); }, 0);

  // Add weekly costs as monthly equivalent
  var totalMonthlyCost = monthlyCost + Math.round(weeklyCost * 4.33);

  var ordersPerMonth = await getVar('orders_per_month', 100);

  var monthlyPerOrder = ordersPerMonth > 0
    ? Math.round(totalMonthlyCost / ordersPerMonth)
    : 0;

  var totalCostPerOrder = perOrderCost + monthlyPerOrder;

  // 3. Calculate weighted margin
  var mixA = await getVar('mix_rail_a', 60);
  var mixB = await getVar('mix_rail_b', 25);
  var mixC = await getVar('mix_rail_c', 10);
  var mixD = await getVar('mix_rail_d', 5);
  var margA = await getVar('margin_rail_a', 45);
  var margB = await getVar('margin_rail_b', 18);
  var margC = await getVar('margin_rail_c', 35);
  var margD = await getVar('margin_rail_d', 70);

  var weightedMargin = (mixA * margA + mixB * margB + mixC * margC + mixD * margD) / 100;

  // 4. Break-even
  var breakEven = weightedMargin > 0
    ? Math.round(totalCostPerOrder / (weightedMargin / 100))
    : 999999;

  // 5. Target basket
  var targetBasket = await getVar('target_basket_avg', 15000);

  // 6. Safety ratio
  var safetyRatio = targetBasket > 0
    ? Number(((targetBasket - breakEven) / targetBasket * 100).toFixed(1))
    : 0;

  // 7. Margin pressure
  var marginPressure = targetBasket > 0
    ? Number((totalCostPerOrder / targetBasket * 100).toFixed(1))
    : 100;

  // 8. Net profit per order
  var grossProfit = Math.round(targetBasket * weightedMargin / 100);
  var netProfit = grossProfit - totalCostPerOrder;

  // 9. Monthly break-even orders
  var monthlyBreakevenOrders = netProfit > 0
    ? Math.ceil(totalMonthlyCost / netProfit)
    : 999;

  // 10. Update computed variables
  await setComputed('total_cost_per_order', totalCostPerOrder);
  await setComputed('margin_weighted_avg', Number(weightedMargin.toFixed(1)));
  await setComputed('seuil_rentabilite', breakEven);
  await setComputed('safety_ratio', safetyRatio);
  await setComputed('margin_pressure', marginPressure);
  await setComputed('net_profit_per_order', netProfit);
  await setComputed('monthly_breakeven_orders', monthlyBreakevenOrders);

  // 11. Coherence checks
  var alerts = checkCoherence({
    totalCostPerOrder: totalCostPerOrder,
    breakEven: breakEven,
    targetBasket: targetBasket,
    safetyRatio: safetyRatio,
    marginPressure: marginPressure,
    weightedMargin: weightedMargin,
    netProfit: netProfit,
    mixA: mixA,
    mixB: mixB,
    mixC: mixC,
    mixD: mixD
  });

  // Add SOV drift alerts
  var driftAlerts = await checkSOVDrift();
  alerts = alerts.concat(driftAlerts);

  // 12. Determine status
  var status = determineStatus(alerts);

  // 13. Save snapshot — PATCH P2-6 : debounce 15 min pour éviter la croissance
  // non bornée de economic_snapshots (chaque appel /executive insérait une ligne).
  var shouldInsertSnapshot = true;
  try {
    var lastSnap = await db.query(
      'SELECT created_at FROM economic_snapshots ORDER BY created_at DESC LIMIT 1'
    );
    if (lastSnap.rows.length > 0) {
      var ageMs = Date.now() - new Date(lastSnap.rows[0].created_at).getTime();
      if (ageMs < 15 * 60 * 1000) shouldInsertSnapshot = false; // < 15 min
    }
  } catch (_) { /* Si la table n'existe pas encore, on insère quand même */ }

  if (shouldInsertSnapshot) {
    await db.query(
      'INSERT INTO economic_snapshots (snapshot_data, model_status, trigger_event) VALUES ($1, $2, $3)',
      [JSON.stringify({
        totalCostPerOrder: totalCostPerOrder,
        breakEven: breakEven,
        targetBasket: targetBasket,
        safetyRatio: safetyRatio,
        marginPressure: marginPressure,
        weightedMargin: weightedMargin,
        netProfit: netProfit,
        monthlyBreakevenOrders: monthlyBreakevenOrders,
        charges_per_order: perOrderCost,
        charges_monthly: totalMonthlyCost,
        charges_count: charges.length
      }), status, triggerEvent || 'manual']
    );
  }

  return {
    status: status,
    totalCostPerOrder: totalCostPerOrder,
    breakEven: breakEven,
    safetyRatio: safetyRatio,
    marginPressure: marginPressure,
    netProfit: netProfit,
    weightedMargin: weightedMargin,
    monthlyBreakevenOrders: monthlyBreakevenOrders,
    alerts: alerts
  };
}

// ─── Build Executive Summary ─────────────────────────────────────────

async function buildExecutiveSummary() {
  var result = await redistribute('executive_view');

  var statusInfo = STATUS_MAP[result.status] || STATUS_MAP.stable;

  // Charges summary
  var chargesResult = await db.query("SELECT * FROM charges WHERE is_active = TRUE");
  var charges = chargesResult.rows;

  var byFamily = {};
  var totalPerOrder = 0;
  var totalMonthly = 0;

  charges.forEach(function(c) {
    if (!byFamily[c.family]) byFamily[c.family] = 0;
    byFamily[c.family] += Number(c.amount_kmf);
    if (c.recurrence_period === 'per_order') totalPerOrder += Number(c.amount_kmf);
    if (c.recurrence_period === 'monthly') totalMonthly += Number(c.amount_kmf);
    if (c.recurrence_period === 'weekly') totalMonthly += Math.round(Number(c.amount_kmf) * 4.33);
  });

  var recommendation = generateRecommendation(result.status, result.alerts, result);

  // Sort alerts by severity
  var severityOrder = { blocking: 0, critical: 1, warning: 2, info: 3 };
  var sortedAlerts = result.alerts.sort(function(a, b) {
    return (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9);
  }).slice(0, 3);

  return {
    status: result.status,
    status_label: statusInfo.label,
    status_emoji: statusInfo.emoji,
    kpis: [
      { key: 'total_cost_per_order', label: 'Coût / commande', value: result.totalCostPerOrder, unit: 'KMF', icon: '💰' },
      { key: 'seuil_rentabilite', label: 'Seuil rentabilité', value: result.breakEven, unit: 'KMF', icon: '📊' },
      { key: 'safety_ratio', label: 'Marge de sécurité', value: result.safetyRatio, unit: '%', icon: '🛡️' },
      { key: 'margin_pressure', label: 'Pression charges', value: result.marginPressure, unit: '%', icon: '⚡' },
      { key: 'net_profit_per_order', label: 'Profit net / commande', value: result.netProfit, unit: 'KMF', icon: '💎' }
    ],
    alerts: sortedAlerts,
    recommendation: recommendation,
    charges_summary: {
      total_per_order: totalPerOrder,
      total_monthly: totalMonthly,
      count_active: charges.length,
      by_family: byFamily
    },
    generated_at: new Date().toISOString()
  };
}

// ─── Routes ──────────────────────────────────────────────────────────

// GET /executive
router.get('/executive', async function(req, res) {
  try {
    var summary = await buildExecutiveSummary();
    res.json(summary);
  } catch (err) {
    log.error('[Economic] Executive error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /variables
router.get('/variables', async function(req, res) {
  try {
    var result = await db.query(
      'SELECT * FROM economic_variables WHERE is_active = TRUE ORDER BY category, key'
    );

    var categories = {};
    result.rows.forEach(function(v) {
      var cat = v.category;
      if (!categories[cat]) {
        var meta = CATEGORY_META[cat] || { label: cat, icon: '📦' };
        categories[cat] = { label: meta.label, icon: meta.icon, variables: [] };
      }
      categories[cat].variables.push(v);
    });

    res.json({ categories: categories });
  } catch (err) {
    log.error('[Economic] Variables error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /variables/:key
router.put('/variables/:key', async function(req, res) {
  try {
    var key = req.params.key;

    // Validate variable exists and is not computed
    var check = await db.query(
      'SELECT * FROM economic_variables WHERE key = $1',
      [key]
    );
    if (!check.rows[0]) {
      return res.status(404).json({ error: 'Variable non trouvée: ' + key });
    }
    if (check.rows[0].is_computed) {
      return res.status(400).json({ error: 'Impossible de modifier une variable calculée' });
    }

    var updates = [];
    var params = [];
    var idx = 1;

    if (req.body.value_supposed !== undefined) {
      updates.push('value_supposed = $' + idx);
      params.push(req.body.value_supposed);
      idx++;
    }
    if (req.body.value_observed !== undefined) {
      updates.push('value_observed = $' + idx);
      params.push(req.body.value_observed);
      idx++;
    }
    if (req.body.value_used !== undefined) {
      updates.push('value_used = $' + idx);
      params.push(req.body.value_used);
      idx++;
    }
    if (req.body.source_used !== undefined) {
      updates.push('source_used = $' + idx);
      params.push(req.body.source_used);
      idx++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updates.push('updated_at = NOW()');
    params.push(key);

    var sql = 'UPDATE economic_variables SET ' + updates.join(', ') + ' WHERE key = $' + idx + ' RETURNING *';
    var result = await db.query(sql, params);

    // If source_used changed, update value_used accordingly
    var row = result.rows[0];
    if (row.source_used === 'supposed' && row.value_supposed !== null) {
      await db.query('UPDATE economic_variables SET value_used = value_supposed WHERE key = $1', [key]);
    } else if (row.source_used === 'observed' && row.value_observed !== null) {
      await db.query('UPDATE economic_variables SET value_used = value_observed WHERE key = $1', [key]);
    }

    // Re-fetch after potential value_used update
    var updated = await db.query('SELECT * FROM economic_variables WHERE key = $1', [key]);

    // Redistribute
    await redistribute('variable_update:' + key);

    // Invalidate eco-bridge cache after variable update
    ecoBridge.invalidateEcoCache();

    // Return updated variable + new executive summary
    var summary = await buildExecutiveSummary();

    res.json({
      variable: updated.rows[0],
      executive: summary
    });
  } catch (err) {
    log.error('[Economic] Update variable error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /charges
router.get('/charges', async function(req, res) {
  try {
    var result = await db.query('SELECT * FROM charges ORDER BY family, name');

    var families = {};
    var totals = { per_order: 0, monthly: 0, weekly: 0, one_time: 0 };

    result.rows.forEach(function(c) {
      var fam = c.family;
      if (!families[fam]) {
        var meta = FAMILY_META[fam] || { label: fam, emoji: '📦' };
        families[fam] = { label: meta.label, emoji: meta.emoji, charges: [], total_kmf: 0 };
      }
      families[fam].charges.push(c);
      if (c.is_active) {
        families[fam].total_kmf += Number(c.amount_kmf);
        if (c.recurrence_period === 'per_order') totals.per_order += Number(c.amount_kmf);
        else if (c.recurrence_period === 'monthly') totals.monthly += Number(c.amount_kmf);
        else if (c.recurrence_period === 'weekly') totals.weekly += Number(c.amount_kmf);
        else totals.one_time += Number(c.amount_kmf);
      }
    });

    res.json({ families: families, totals: totals });
  } catch (err) {
    log.error('[Economic] Charges error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /charges
router.post('/charges', async function(req, res) {
  try {
    var body = req.body;
    if (!body.family || !body.name || body.amount_kmf === undefined) {
      return res.status(400).json({ error: 'Champs requis: family, name, amount_kmf' });
    }

    var validFamilies = ['demarrage', 'croisiere', 'operationnelle', 'exceptionnelle', 'incident'];
    if (validFamilies.indexOf(body.family) === -1) {
      return res.status(400).json({ error: 'Famille invalide: ' + body.family });
    }

    var result = await db.query(
      'INSERT INTO charges (family, name, amount_kmf, is_recurring, recurrence_period, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [body.family, body.name, body.amount_kmf, body.is_recurring || false, body.recurrence_period || null, body.notes || null]
    );

    await redistribute('charge_created:' + result.rows[0].id);

    // Invalidate eco-bridge caches after charge creation
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();

    var summary = await buildExecutiveSummary();

    res.json({ charge: result.rows[0], executive: summary });
  } catch (err) {
    log.error('[Economic] Create charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /charges/:id
router.put('/charges/:id', async function(req, res) {
  try {
    var id = req.params.id;
    var body = req.body;

    var check = await db.query('SELECT * FROM charges WHERE id = $1', [id]);
    if (!check.rows[0]) {
      return res.status(404).json({ error: 'Charge non trouvée' });
    }

    var updates = [];
    var params = [];
    var idx = 1;

    ['name', 'amount_kmf', 'family', 'is_recurring', 'recurrence_period', 'notes'].forEach(function(field) {
      if (body[field] !== undefined) {
        updates.push(field + ' = $' + idx);
        params.push(body[field]);
        idx++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    var sql = 'UPDATE charges SET ' + updates.join(', ') + ' WHERE id = $' + idx + ' RETURNING *';
    var result = await db.query(sql, params);

    await redistribute('charge_updated:' + id);

    // Invalidate eco-bridge caches after charge update
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();

    var summary = await buildExecutiveSummary();

    res.json({ charge: result.rows[0], executive: summary });
  } catch (err) {
    log.error('[Economic] Update charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /charges/:id/toggle
router.put('/charges/:id/toggle', async function(req, res) {
  try {
    var id = req.params.id;

    var result = await db.query(
      'UPDATE charges SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Charge non trouvée' });
    }

    await redistribute('charge_toggled:' + id);

    // Invalidate eco-bridge caches after charge toggle
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();

    var summary = await buildExecutiveSummary();

    res.json({ charge: result.rows[0], executive: summary });
  } catch (err) {
    log.error('[Economic] Toggle charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /charges/:id  (ADR-011 — soft delete par défaut, hard via ?force=true)
router.delete('/charges/:id', async function(req, res) {
  try {
    var id = req.params.id;
    var force = req.query.force === 'true' || req.query.force === '1';

    var existing = await db.query('SELECT * FROM charges WHERE id = $1', [id]);
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Charge non trouvée' });
    }

    if (force) {
      // Vérifier si la colonne is_deletable existe et l'appliquer
      var canDelete = existing.rows[0].is_deletable !== false; // true ou null = OK
      if (!canDelete) {
        return res.status(403).json({
          error: 'Charge système : suppression définitive interdite',
          hint: 'Tu peux la désactiver via toggle'
        });
      }
      await db.query('DELETE FROM charges WHERE id = $1', [id]);
      await redistribute('charge_deleted:' + id);
      ecoBridge.invalidateEcoCache();
      ecoBridge.invalidateChargesCache();
      return res.json({ deleted: true, id: id, mode: 'hard' });
    }

    // Soft delete
    var result = await db.query(
      'UPDATE charges SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    await redistribute('charge_soft_deleted:' + id);
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();

    res.json({
      deleted: true,
      id: id,
      mode: 'soft',
      hint: 'Charge désactivée. Pour suppression définitive : DELETE ?force=true',
      charge: result.rows[0]
    });
  } catch (err) {
    log.error('[Economic] Delete charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /coherence
router.get('/coherence', async function(req, res) {
  try {
    var result = await redistribute('coherence_check');

    var driftAlerts = await checkSOVDrift();
    var allAlerts = result.alerts.concat(driftAlerts);

    var status = determineStatus(allAlerts);
    var statusInfo = STATUS_MAP[status] || STATUS_MAP.stable;

    res.json({
      status: status,
      status_label: statusInfo.label,
      alerts: allAlerts,
      checked_at: new Date().toISOString()
    });
  } catch (err) {
    log.error('[Economic] Coherence error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /history
router.get('/history', async function(req, res) {
  try {
    var result = await db.query(
      'SELECT * FROM economic_snapshots ORDER BY created_at DESC LIMIT 20'
    );
    res.json({ snapshots: result.rows });
  } catch (err) {
    log.error('[Economic] History error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /redistribute
router.post('/redistribute', async function(req, res) {
  try {
    await redistribute('manual_force');
    var summary = await buildExecutiveSummary();
    res.json(summary);
  } catch (err) {
    log.error('[Economic] Redistribute error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
