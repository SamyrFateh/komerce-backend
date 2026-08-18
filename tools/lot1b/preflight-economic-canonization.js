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
 *   ... --require-target       # exit 2 si la cible CURRENT (SEA) n'est pas prête
 *   ... --require-air-target   # exit 2 si AIR ne peut pas être activé économiquement
 */

const db = require('../../db');

const TARGET_RULE_KEYS = Object.freeze([
  'FREIGHT_KMF_PER_KG',
  'SEA_WM_KG_PER_M3',
  'SEA_KMF_PER_KG_COMMERCIAL',
  'AIR_KMF_PER_KG_TAXABLE',
  'AIR_VOLUMETRIC_DIVISOR',
  // Le coût AIR distinct du prix commercial doit venir d'une calibration réelle.
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

/**
 * La cible CURRENT ne doit pas être bloquée par AIR : AIR_EXPRESS est encore
 * INTERNAL/PENDING/DISABLED. SEA est prêt si sa règle W/M canonique existe.
 * AIR possède son gate d'activation séparé : W/M + coût distinct du prix.
 */
function targetReadiness({ rules = {} } = {}) {
  const seaWmKgPerM3 = finitePositive(rules.SEA_WM_KG_PER_M3?.scalar_value);
  const seaCommercialRate = finitePositive(rules.SEA_KMF_PER_KG_COMMERCIAL?.scalar_value);
  const airCostRate = finitePositive(rules.AIR_KMF_PER_KG_COST?.scalar_value);
  const airCommercialRate = finitePositive(rules.AIR_KMF_PER_KG_TAXABLE?.scalar_value);
  const airDivisor = finitePositive(rules.AIR_VOLUMETRIC_DIVISOR?.scalar_value);

  const currentMissing = [];
  if (seaWmKgPerM3 === null) currentMissing.push('SEA_WM_KG_PER_M3');
  if (seaCommercialRate === null) currentMissing.push('SEA_KMF_PER_KG_COMMERCIAL');

  const airMissing = [];
  if (airDivisor === null) airMissing.push('AIR_VOLUMETRIC_DIVISOR');
  if (airCostRate === null) airMissing.push('AIR_KMF_PER_KG_COST');
  if (airCommercialRate === null) airMissing.push('AIR_KMF_PER_KG_TAXABLE');

  return {
    current_ready: currentMissing.length === 0,
    current_missing: currentMissing,
    air_activation_ready: airMissing.length === 0,
    air_activation_missing: airMissing,
    sea_wm_kg_per_m3: seaWmKgPerM3,
    sea_commercial_kmf_per_kg: seaCommercialRate,
    air_cost_kmf_per_kg: airCostRate,
    air_commercial_kmf_per_kg: airCommercialRate,
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

  console.log('\n[ratchet cible CURRENT — SEA]');
  if (report.target_readiness.current_ready) {
    console.log(`✓ SEA TARGET READY — W/M ${report.target_readiness.sea_wm_kg_per_m3} kg/m3.`);
  } else {
    console.log(`✗ SEA TARGET INCOMPLETE — ${report.target_readiness.current_missing.join(', ')} manquant(s).`);
  }

  console.log('\n[gate activation AIR]');
  if (report.target_readiness.air_activation_ready) {
    console.log('✓ AIR ECONOMIC TARGET READY — coût et W/M distincts présents.');
  } else {
    console.log(`○ AIR RESTE NON ACTIVABLE — ${report.target_readiness.air_activation_missing.join(', ')} manquant(s).`);
    console.log('  C’est attendu tant que AIR_EXPRESS reste INTERNAL/PENDING/DISABLED.');
  }

  const duplicates = [
    ['freight', report.current.freight_cost_component_rows_active],
    ['customs', report.current.customs_cost_component_rows_active],
    ['risk', report.current.risk_cost_component_rows_active],
  ];
  console.log('\n[valorisations à retirer de cost_components en 1B]');
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
    if (process.argv.includes('--require-target') && !report.target_readiness.current_ready) {
      process.exitCode = 2;
    }
    if (process.argv.includes('--require-air-target') && !report.target_readiness.air_activation_ready) {
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
