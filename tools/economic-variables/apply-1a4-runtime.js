#!/usr/bin/env node
'use strict';

const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }

function replaceOnce(path, from, to) {
  const src = read(path);
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected exactly one literal match, got ${count}`);
  write(path, src.replace(from, to));
}

function replaceRegexOnce(path, regex, to) {
  const src = read(path);
  const matches = src.match(regex);
  if (!matches || matches.length !== 1) throw new Error(`${path}: regex match missing/ambiguous: ${regex}`);
  write(path, src.replace(regex, to));
}

// ── services/economic-engine-queries.js ──────────────────────────────────────
const engine = 'services/economic-engine-queries.js';
replaceOnce(engine,
  ' * @inputs        economic_variables, charges, trigger_event\n * @outputs       computed_variables, alerts, snapshots, executive_summary\n * @depends       db.js, utils/eco-bridge.js\n * @used-by       routes/economic-engine.js, admin-dashboards\n * @db-read       charges, economic_snapshots, economic_variables\n * @db-write      charges, economic_snapshots, economic_variables\n * @db-txn        snapshot_debounce, coherence_model_recalculation\n * @doctrine      couts_repartis_par_commande, coherence_model_economique, snapshot_debounce, sov_drift',
  ' * @inputs        finance_config, charges, trigger_event\n * @outputs       computed_variables, alerts, snapshots, executive_summary\n * @depends       db.js, services/economic-config.js, utils/eco-bridge.js\n * @used-by       routes/economic-engine.js, admin-dashboards\n * @db-read       charges, economic_snapshots, economic_variables, finance_config\n * @db-write      charges, economic_snapshots, finance_config\n * @db-txn        snapshot_debounce, coherence_model_recalculation\n * @doctrine      couts_repartis_par_commande, coherence_model_economique, snapshot_debounce, finance_config_single_runtime_truth, economic_variables_read_only');

replaceOnce(engine,
  "const db        = require('../db');\nconst ecoBridge = require('../utils/eco-bridge');\nconst log       = require('../utils/logger').child({ module: 'economic-engine-queries' });",
  "const db             = require('../db');\nconst ecoBridge      = require('../utils/eco-bridge');\nconst economicConfig = require('./economic-config');\nconst log            = require('../utils/logger').child({ module: 'economic-engine-queries' });");

replaceRegexOnce(engine,
  /\n  try \{\n    await db\.query\("UPDATE economic_variables SET label = 'Hub \(Dubai\)'[\s\S]*?\n  const charges = \[/,
  "\n  // LOT 1A-4 : economic_variables est legacy read-only. Les métadonnées\n  // historiques restent en DB pour compat/forensic, sans seed runtime.\n\n  const charges = [");

replaceRegexOnce(engine,
  /async function getVar\(key, fallback\) \{[\s\S]*?\n\}\n\nasync function setComputed\(key, value\) \{[\s\S]*?\n\}\n\n\/\/ ─── Coherence Checks/,
  `async function getVar(key, fallback) {
  const config = await economicConfig.loadFinanceConfig();
  const value = economicConfig.resolveLegacyInput(config, key);
  return value !== undefined ? value : fallback;
}

// Compat export : les computed ne sont plus persistés dans economic_variables.
async function setComputed(key, value) {
  return { key, value, persisted: false, source: 'computed_projection' };
}

// ─── Coherence Checks`);

replaceRegexOnce(engine,
  /async function redistribute\(triggerEvent\) \{[\s\S]*?\n\}\n\n\/\/ ─── Executive Summary/,
  `function computeModel(charges, inputs) {
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

// ─── Executive Summary`);

replaceRegexOnce(engine,
  /async function getVariables\(\) \{[\s\S]*?\n\}\n\nasync function getCharges/,
  `async function getVariables() {
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

async function getCharges`);

replaceRegexOnce(engine,
  /async function updateVariable\(key, body\) \{[\s\S]*?\n\}\n\nasync function createCharge/,
  `async function updateVariable(key, body, updatedBy) {
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

async function createCharge`);

replaceOnce(engine,
  '  checkCoherence, checkSOVDrift, determineStatus, generateRecommendation,\n  redistribute, buildExecutiveSummary,',
  '  checkCoherence, checkSOVDrift, determineStatus, generateRecommendation, computeModel,\n  redistribute, buildExecutiveSummary,');

// ── services/dashboard-ops-queries.js ────────────────────────────────────────
const ops = 'services/dashboard-ops-queries.js';
replaceOnce(ops,
  ' * @depends       db, routes/dashboard-shared.js, services/economic-engine-queries.js, utils/logger.js',
  ' * @depends       db, routes/dashboard-shared.js, services/economic-config.js, utils/logger.js');
replaceOnce(ops,
  ' * @db-read       customs_effective_rates, exchange_rates, incidents, invoices, order_items, orders, parcels, products, recipients, relais, scan_events, users',
  ' * @db-read       customs_effective_rates, exchange_rates, finance_config, incidents, invoices, order_items, orders, parcels, products, recipients, relais, scan_events, users');
replaceRegexOnce(ops,
  /\/\/ FIX : getEcoVar était undefined[\s\S]*?const \{ getVar: getEcoVar \} = require\('\.\/economic-engine-queries'\);/,
  "// LOT 1A-4 : Ops consomme directement la SOV finance_config.\nconst economicConfig = require('./economic-config');");
replaceOnce(ops,
  "  const customsDefault = await getEcoVar('customs_rate_default_pct', 42);\n  const TAUX_TERRAIN = douaneEffectif ? douaneEffectif / 100 : customsDefault / 100;\n  const hubCostAed = await getEcoVar('hub_monthly_cost_aed', 7000);",
  "  const financeConfig = await economicConfig.loadFinanceConfig();\n  const customsDefault = economicConfig.resolveLegacyInput(financeConfig, 'customs_rate_default_pct');\n  const TAUX_TERRAIN = douaneEffectif ? douaneEffectif / 100 : customsDefault / 100;\n  const hubCostAed = economicConfig.resolveLegacyInput(financeConfig, 'hub_monthly_cost_aed');");

// ── utils/eco-bridge.js ──────────────────────────────────────────────────────
const bridge = 'utils/eco-bridge.js';
replaceOnce(bridge,
  ' * @depends       db, utils/logger.js\n * @db-write      none\n * @db-read      charges, economic_variables',
  ' * @depends       db, services/economic-config.js, utils/logger.js\n * @db-write      none\n * @db-read      charges, finance_config');
replaceOnce(bridge,
  "const db = require('../db');\nconst log = require('../utils/logger').child({ module: 'eco-bridge' });",
  "const db = require('../db');\nconst economicConfig = require('../services/economic-config');\nconst log = require('../utils/logger').child({ module: 'eco-bridge' });");
replaceRegexOnce(bridge,
  /async function loadEcoVars\(\) \{[\s\S]*?\n\}\n\n\/\*\*\n \* Get a single economic variable/,
  `async function loadEcoVars() {
  if (_varsCache && Date.now() - _varsCacheAt < CACHE_TTL_MS) {
    return _varsCache;
  }
  try {
    const config = await economicConfig.loadFinanceConfig();
    const map = {};
    for (const key of Object.keys(economicConfig.LEGACY_RUNTIME_INPUTS)) {
      map[key] = economicConfig.resolveLegacyInput(config, key);
    }
    _varsCache = map;
    _varsCacheAt = Date.now();
    return map;
  } catch (err) {
    log.error({ err }, '[ECO-BRIDGE] loadEcoVars error:');
    return _varsCache || {};
  }
}

/**
 * Get a single economic variable`);

replaceOnce(bridge,
  ' * KOMERCE — Economic Bridge v1.0\n * ═══════════════════════════════\n * Source unique de lecture pour TOUS les paramètres économiques.\n *\n * Lit depuis `economic_variables` (table SOV — Supposé/Observé/Utilisé).',
  ' * KOMERCE — Economic Bridge v1.1\n * ═══════════════════════════════\n * Bridge de compatibilité pour les anciennes clés économiques runtime.\n *\n * LOT 1A-4 : lit depuis `finance_config`; `economic_variables` est forensic read-only.');
replaceOnce(bridge,
  ' * Cache mémoire 60s — invalidé après chaque PUT /variables/:key',
  ' * Cache mémoire 60s — invalidé après chaque write-through canonique');

// ── routes/economic.js ────────────────────────────────────────────────────────
replaceOnce('routes/economic.js',
  '    const result = await updateVariable(key, req.body);',
  '    const result = await updateVariable(key, req.body, req.user && req.user.id);');

// ── routes/admin-finance-config.js ───────────────────────────────────────────
const financeRoute = 'routes/admin-finance-config.js';
replaceOnce(financeRoute,
  "  objectif_ca_mensuel_kmf:     { type: 'int',     group: 'targets',  label: 'Objectif CA mensuel',       unit: 'KMF', min: 0 },",
  "  objectif_ca_mensuel_kmf:     { type: 'int',     group: 'targets',  label: 'Objectif CA mensuel',       unit: 'KMF', min: 0 },\n\n  // — Modèle économique canonique (LOT 1A-4) —\n  hub_monthly_cost_aed:           { type: 'int',     group: 'model',    label: 'Coût Hub mensuel',          unit: 'AED', min: 0 },\n  customs_rate_default_pct:       { type: 'decimal', group: 'model',    label: 'Douane terrain défaut',     unit: '%', min: 0, max: 100 },\n  mix_rail_a:                     { type: 'decimal', group: 'model',    label: 'Mix CA Rail A',             unit: '%', min: 0, max: 100 },\n  mix_rail_b:                     { type: 'decimal', group: 'model',    label: 'Mix CA Rail B',             unit: '%', min: 0, max: 100 },\n  mix_rail_c:                     { type: 'decimal', group: 'model',    label: 'Mix CA Rail C',             unit: '%', min: 0, max: 100 },\n  mix_rail_d:                     { type: 'decimal', group: 'model',    label: 'Mix CA Rail D',             unit: '%', min: 0, max: 100 },\n  margin_rail_a:                  { type: 'decimal', group: 'model',    label: 'Marge Rail A',              unit: '%', min: 0, max: 100 },\n  margin_rail_b:                  { type: 'decimal', group: 'model',    label: 'Marge Rail B',              unit: '%', min: 0, max: 100 },\n  margin_rail_c:                  { type: 'decimal', group: 'model',    label: 'Marge Rail C',              unit: '%', min: 0, max: 100 },\n  margin_rail_d:                  { type: 'decimal', group: 'model',    label: 'Marge Rail D',              unit: '%', min: 0, max: 100 },");

console.log('LOT 1A-4 runtime patch applied with all assertions satisfied.');
