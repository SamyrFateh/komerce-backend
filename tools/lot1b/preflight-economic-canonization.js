#!/usr/bin/env node
'use strict';

/**
 * LOT 1B-0 — préflight de vérité économique (READ ONLY)
 *
 * But : photographier les vérités CURRENT concurrentes avant toute correction
 * économique du fret / customs / risk. Ce script n'écrit jamais en base.
 *
 * Usage :
 *   DATABASE_URL=... node tools/lot1b/preflight-economic-canonization.js
 *   ... --require-target   # exit 2 si les POLICY nécessaires à la cible manquent
 */

const db = require('../../db');

const TARGET_RULE_KEYS = Object.freeze([
  'FREIGHT_KMF_PER_KG',
  'SEA_KMF_PER_KG_COMMERCIAL',
  'AIR_KMF_PER_KG_TAXABLE',
  'AIR_VOLUMETRIC_DIVISOR',
  // Les deux clés suivantes sont recherchées mais ne sont PAS inventées ici.
  'SEA_DENSITY_KG_PER_M3',
  'AIR_KMF_PER_KG_COST',
]);

const RESERVED_COST_CATEGORIES = Object.freeze([
  'freight',
  'customs',
  'risk_provision',
]);

function jsonRuleValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') {
    if (Object.prototype.hasOwnProperty.call(raw, 'value')) return raw.value;
    return null;
  }
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && Object.prototype.hasOwnProperty.call(parsed, 'value')
      ? parsed.value
      : null;
  } catch (_) {
    return null;
  }
}

function finitePositive(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function computeLegacySeaKmfPerM3({ fretEurPerM3, eurKmf }) {
  const freight = finitePositive(fretEurPerM3);
  const fx = finitePositive(eurKmf);
  if (freight === null || fx === null) return null;
  return freight * fx;
}

function indexRules(rows = []) {
  const out = {};
  for (const row of rows) {
    out[row.key] = {
      ...row,
      scalar_value: jsonRuleValue(row.value),
    };
  }
  return out;
}

function targetReadiness({ rules = {} } = {}) {
  const seaDensity = finitePositive(rules.SEA_DENSITY_KG_PER_M3?.scalar_value);
  const airCostRate = finitePositive(rules.AIR_KMF_PER_KG_COST?.scalar_value);
  const airDivisor = finitePositive(rules.AIR_VOLUMETRIC_DIVISOR?.scalar_value);

  const missing = [];
  if (seaDensity === null) missing.push('SEA_DENSITY_KG_PER_M3');
  if (airCostRate === null) missing.push('AIR_KMF_PER_KG_COST');
  if (airDivisor === null) missing.push('AIR_VOLUMETRIC_DIVISOR');

  return {
    ready: missing.length === 0,
    missing,
    sea_density_kg_per_m3: seaDensity,
    air_cost_kmf_per_kg: airCostRate,
    air_volumetric_divisor_cm3_per_kg: airDivisor,
  };
}

async function tableExists(name) {
  const { rows } = await db.query('SELECT to_regclass($1) AS regclass', [`public.${name}`]);
  return !!rows[0]?.regclass;
}

async function readPreflight() {
  const financeRes = await db.query(`
    SELECT id,
           taux_change_eur_kmf,
           taux_aed_kmf,
           fret_eur_per_m3
      FROM finance_config
     WHERE id = 1
  `);
  const finance = financeRes.rows[0] || {};

  const rulesRes = await db.query(`
    SELECT key, category, value, value_type, is_active, label_fr, description
      FROM business_rules
     WHERE key = ANY($1::text[])
     ORDER BY key
  `, [TARGET_RULE_KEYS]);
  const rules = indexRules(rulesRes.rows);

  const costComponentsRes = await db.query(`
    SELECT key, label, family, category, default_value, unit,
           source, confidence, scope, scope_value, allocation_method,
           channel, is_active, is_exceptional
      FROM cost_components
     WHERE category = ANY($1::text[])
     ORDER BY category, key
  `, [RESERVED_COST_CATEGORIES]);

  const riskRes = await db.query(`
    SELECT key, label, rate_pct, applies_to, is_active, notes
      FROM risk_provisions
     ORDER BY display_order, key
  `);

  let legacyPricingComponents = [];
  if (await tableExists('pricing_components')) {
    const legacyRes = await db.query(`
      SELECT key, label, category, default_value, unit, applies_to, is_active
        FROM pricing_components
       WHERE category IN ('transit', 'douane')
       ORDER BY category, key
    `);
    legacyPricingComponents = legacyRes.rows;
  }

  const readiness = targetReadiness({ rules });
  const legacySeaKmfPerM3 = computeLegacySeaKmfPerM3({
    fretEurPerM3: finance.fret_eur_per_m3,
    eurKmf: finance.taux_change_eur_kmf,
  });

  return {
    finance,
    rules,
    cost_components_reserved: costComponentsRes.rows,
    risk_provisions: riskRes.rows,
    legacy_pricing_components: legacyPricingComponents,
    current: {
      legacy_sea_cost_eur_per_m3: finitePositive(finance.fret_eur_per_m3),
      eur_kmf: finitePositive(finance.taux_change_eur_kmf),
      legacy_sea_cost_kmf_per_m3: legacySeaKmfPerM3,
      freight_cost_component_rows_active: costComponentsRes.rows.filter(
        row => row.category === 'freight' && row.is_active && !row.is_exceptional
      ),
      customs_cost_component_rows_active: costComponentsRes.rows.filter(
        row => row.category === 'customs' && row.is_active && !row.is_exceptional
      ),
      risk_cost_component_rows_active: costComponentsRes.rows.filter(
        row => row.category === 'risk_provision' && row.is_active && !row.is_exceptional
      ),
    },
    target_readiness: readiness,
  };
}

function printRow(row) {
  const parts = [
    row.key,
    `value=${row.default_value ?? row.rate_pct ?? row.scalar_value ?? '?'}`,
  ];
  if (row.unit) parts.push(`unit=${row.unit}`);
  if (row.category) parts.push(`category=${row.category}`);
  if (row.is_active !== undefined) parts.push(`active=${row.is_active}`);
  if (row.is_exceptional !== undefined) parts.push(`exceptional=${row.is_exceptional}`);
  return parts.join(' | ');
}

function printReport(report) {
  console.log('============================================================');
  console.log(' KOMERCE — LOT 1B-0 PRE-FLIGHT ECONOMIC TRUTH (READ ONLY)');
  console.log('============================================================');

  console.log('\n[finance_config CURRENT]');
  console.log(`EUR/KMF              : ${report.current.eur_kmf ?? 'ABSENT/INVALID'}`);
  console.log(`fret EUR/m3 legacy   : ${report.current.legacy_sea_cost_eur_per_m3 ?? 'ABSENT/INVALID'}`);
  console.log(`fret KMF/m3 implicite: ${report.current.legacy_sea_cost_kmf_per_m3 ?? 'NON CALCULABLE'}`);

  console.log('\n[business_rules transport]');
  for (const key of TARGET_RULE_KEYS) {
    const row = report.rules[key];
    console.log(row ? `- ${key} = ${row.scalar_value}` : `- ${key} = ABSENT`);
  }

  console.log('\n[cost_components — catégories DEDICATED encore présentes]');
  if (!report.cost_components_reserved.length) console.log('- aucune');
  for (const row of report.cost_components_reserved) console.log(`- ${printRow(row)}`);

  console.log('\n[risk_provisions — autorité DEDICATED]');
  if (!report.risk_provisions.length) console.log('- aucune');
  for (const row of report.risk_provisions) console.log(`- ${printRow(row)}`);

  console.log('\n[pricing_components legacy transit/douane]');
  if (!report.legacy_pricing_components.length) console.log('- aucune / table absente');
  for (const row of report.legacy_pricing_components) console.log(`- ${printRow(row)}`);

  console.log('\n[ratchet de cible W/M]');
  if (report.target_readiness.ready) {
    console.log('✓ TARGET POLICY COMPLETE — paramètres W/M requis présents.');
  } else {
    console.log(`✗ TARGET POLICY INCOMPLETE — ${report.target_readiness.missing.join(', ')} manquant(s).`);
    console.log('  Aucune valeur n’est inventée par ce préflight.');
  }

  const duplicates = [
    ['freight', report.current.freight_cost_component_rows_active],
    ['customs', report.current.customs_cost_component_rows_active],
    ['risk', report.current.risk_cost_component_rows_active],
  ];
  console.log('\n[writers/valorisations à retirer de cost_components en 1B]');
  for (const [name, rows] of duplicates) {
    console.log(`- ${name}: ${rows.length} ligne(s) active(s)`);
  }

  console.log('\nREAD ONLY : aucune écriture DB effectuée.');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL absent.');
    process.exit(2);
  }

  try {
    const report = await readPreflight();
    printReport(report);
    if (process.argv.includes('--json')) {
      console.log('\n' + JSON.stringify(report, null, 2));
    }
    if (process.argv.includes('--require-target') && !report.target_readiness.ready) {
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`FATAL PRE-FLIGHT: ${err.message}`);
    process.exitCode = 2;
  } finally {
    if (db.pool?.end) await db.pool.end();
  }
}

if (require.main === module) main();

module.exports = {
  TARGET_RULE_KEYS,
  RESERVED_COST_CATEGORIES,
  jsonRuleValue,
  finitePositive,
  computeLegacySeaKmfPerM3,
  indexRules,
  targetReadiness,
  readPreflight,
};
