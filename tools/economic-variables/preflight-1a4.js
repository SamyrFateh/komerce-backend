#!/usr/bin/env node
'use strict';

/**
 * LOT 1A-4 — Preflight DB avant migration economic_variables -> finance_config.
 *
 * Aucune écriture. Le script refuse la migration si une variable déjà canonisée
 * dans finance_config n'est pas égale à la valeur CURRENT lue par l'ancien moteur.
 * Les variables sans colonne canonique sont seulement capturées : la migration 119
 * devra les copier à l'identique avant de basculer redistribute/Ops.
 */

require('dotenv').config();
const db = require('../../db');

const EXISTING_CANONICAL = Object.freeze([
  { legacy: 'orders_per_month', canonical: 'objectif_commandes_mois', fallback: 100 },
  { legacy: 'target_basket_avg', canonical: 'target_panier_moyen_kmf', fallback: 15000 },
  { legacy: 'hub_monthly_cost_aed', canonical: 'hub_monthly_cost_aed', fallback: 7000 },
]);

const TO_MIGRATE = Object.freeze([
  { legacy: 'customs_rate_default_pct', canonical: 'customs_rate_default_pct', fallback: 42 },
  { legacy: 'mix_rail_a', canonical: 'mix_rail_a', fallback: 60 },
  { legacy: 'mix_rail_b', canonical: 'mix_rail_b', fallback: 25 },
  { legacy: 'mix_rail_c', canonical: 'mix_rail_c', fallback: 10 },
  { legacy: 'mix_rail_d', canonical: 'mix_rail_d', fallback: 5 },
  { legacy: 'margin_rail_a', canonical: 'margin_rail_a', fallback: 45 },
  { legacy: 'margin_rail_b', canonical: 'margin_rail_b', fallback: 18 },
  { legacy: 'margin_rail_c', canonical: 'margin_rail_c', fallback: 35 },
  { legacy: 'margin_rail_d', canonical: 'margin_rail_d', fallback: 70 },
]);

function usedValue(row, fallback) {
  if (!row) return Number(fallback);
  const raw = row.value_used ?? row.value_supposed ?? fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number(fallback);
}

function analyze(finance, rows) {
  const byKey = new Map((rows || []).map((r) => [r.key, r]));

  const existing = EXISTING_CANONICAL.map((spec) => {
    const legacyRow = byKey.get(spec.legacy);
    const legacyValue = usedValue(legacyRow, spec.fallback);
    const canonicalRaw = finance?.[spec.canonical];
    const canonicalValue = canonicalRaw == null ? null : Number(canonicalRaw);
    return {
      ...spec,
      legacy_present: Boolean(legacyRow),
      legacy_value: legacyValue,
      canonical_value: Number.isFinite(canonicalValue) ? canonicalValue : null,
      equal: Number.isFinite(canonicalValue) && canonicalValue === legacyValue,
    };
  });

  const migrate = TO_MIGRATE.map((spec) => {
    const legacyRow = byKey.get(spec.legacy);
    return {
      ...spec,
      legacy_present: Boolean(legacyRow),
      value_to_copy: usedValue(legacyRow, spec.fallback),
      source: legacyRow ? (legacyRow.value_used != null ? 'value_used' : 'value_supposed') : 'CURRENT_fallback',
    };
  });

  return {
    existing,
    migrate,
    blockers: existing.filter((x) => !x.equal),
    missing_legacy_to_migrate: migrate.filter((x) => !x.legacy_present),
  };
}

async function loadRealState() {
  const [fcRes, varsRes] = await Promise.all([
    db.query('SELECT * FROM finance_config WHERE id = 1'),
    db.query(`
      SELECT key, value_used, value_supposed, value_observed, source_used, is_computed
      FROM economic_variables
      WHERE is_active = TRUE
    `),
  ]);
  return { finance: fcRes.rows[0] || {}, rows: varsRes.rows };
}

function printHuman(result) {
  console.log('LOT 1A-4 — preflight economic_variables -> finance_config');
  console.log('');
  console.log('Correspondances déjà canonisées :');
  for (const x of result.existing) {
    console.log(`  ${x.legacy} -> ${x.canonical}: legacy=${x.legacy_value} canonical=${x.canonical_value} ${x.equal ? '✓' : '✗'}`);
  }

  console.log('');
  console.log('Valeurs CURRENT à copier dans migration 119 :');
  for (const x of result.migrate) {
    console.log(`  ${x.legacy} -> ${x.canonical}: ${x.value_to_copy} (${x.source})`);
  }

  if (result.missing_legacy_to_migrate.length) {
    console.log('');
    console.log('⚠ Legacy absent — fallback CURRENT serait utilisé :');
    for (const x of result.missing_legacy_to_migrate) console.log(`  - ${x.legacy}: ${x.fallback}`);
  }

  console.log('');
  if (result.blockers.length) {
    console.error('✗ PRE-FLIGHT REFUSÉ — divergence entre legacy CURRENT et finance_config existant :');
    for (const x of result.blockers) {
      console.error(`  - ${x.legacy}: legacy=${x.legacy_value}, ${x.canonical}=${x.canonical_value}`);
    }
    console.error('Aucune migration 1A-4 ne doit être appliquée tant que ce delta n’est pas traité explicitement.');
  } else {
    console.log('✓ PRE-FLIGHT OK — les colonnes déjà canonisées sont iso-CURRENT.');
  }
}

async function main() {
  const json = process.argv.includes('--json');
  const { finance, rows } = await loadRealState();
  const result = analyze(finance, rows);
  if (json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  process.exit(result.blockers.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('✗ Preflight 1A-4 impossible :', err.message);
    process.exit(2);
  });
}

module.exports = { EXISTING_CANONICAL, TO_MIGRATE, usedValue, analyze };
