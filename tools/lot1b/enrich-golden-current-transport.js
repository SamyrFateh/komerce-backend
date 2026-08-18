#!/usr/bin/env node
'use strict';

/**
 * LOT 1B-0 — enrichissement structurel du Golden CURRENT.
 *
 * Ajoute à frozen_config les policies transport déjà prouvées par Railway,
 * SANS recalculer ni modifier les snapshots économiques. Le but est que le
 * futur diff 1B soit imputable au calcul W/M et non à une config absente.
 *
 * Usage :
 *   DATABASE_URL=... node tools/lot1b/enrich-golden-current-transport.js --check
 *   DATABASE_URL=... node tools/lot1b/enrich-golden-current-transport.js --write
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readPreflight } = require('./preflight-economic-canonization');

const GOLDEN_PATH = path.resolve(__dirname, '../golden-cdr/golden/cdr.golden.json');

function sortKeys(o) {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === 'object') {
    return Object.keys(o).sort().reduce((acc, k) => {
      acc[k] = sortKeys(o[k]);
      return acc;
    }, {});
  }
  return o;
}

function stableJSON(o) {
  return JSON.stringify(sortKeys(o), null, 2);
}

function fingerprint(o) {
  return crypto.createHash('sha256').update(stableJSON(o)).digest('hex').slice(0, 16);
}

function buildTransportPolicies(report) {
  const r = report.target_readiness;
  if (!r.sea_migration_ready) {
    throw new Error(`SEA non migrable sans invention: ${r.sea_migration_missing.join(', ')}`);
  }
  if (!(report.current.eur_kmf > 0)) {
    throw new Error('EUR/KMF CURRENT absent ou invalide');
  }

  const seaCost = r.sea_cost_eur_per_m3 || r.sea_legacy_cost_eur_per_m3;
  const policies = {
    SEA_WM_KG_PER_M3: r.sea_wm_kg_per_m3,
    SEA_EUR_PER_M3_COST: seaCost,
    SEA_KMF_PER_KG_COMMERCIAL: r.sea_commercial_kmf_per_kg,
    AIR_KMF_PER_KG_TAXABLE: r.air_commercial_kmf_per_kg,
    AIR_VOLUMETRIC_DIVISOR: r.air_volumetric_divisor_cm3_per_kg,
    EUR_KMF: report.current.eur_kmf,
  };
  if (r.air_cost_kmf_per_kg > 0) policies.AIR_KMF_PER_KG_COST = r.air_cost_kmf_per_kg;

  return {
    policies,
    sources: {
      SEA_WM_KG_PER_M3: 'business_rules.SEA_WM_KG_PER_M3',
      SEA_EUR_PER_M3_COST: r.sea_cost_eur_per_m3
        ? 'business_rules.SEA_EUR_PER_M3_COST'
        : 'finance_config.fret_eur_per_m3:legacy_fallback',
      SEA_KMF_PER_KG_COMMERCIAL: 'business_rules.SEA_KMF_PER_KG_COMMERCIAL',
      AIR_KMF_PER_KG_TAXABLE: 'business_rules.AIR_KMF_PER_KG_TAXABLE',
      AIR_VOLUMETRIC_DIVISOR: 'business_rules.AIR_VOLUMETRIC_DIVISOR',
      EUR_KMF: 'finance_config.taux_change_eur_kmf',
      ...(r.air_cost_kmf_per_kg > 0
        ? { AIR_KMF_PER_KG_COST: 'business_rules.AIR_KMF_PER_KG_COST' }
        : {}),
    },
  };
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check';
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL absent');
  if (!fs.existsSync(GOLDEN_PATH)) throw new Error(`Golden absent: ${GOLDEN_PATH}`);

  const doc = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
  const snapshotsBefore = stableJSON(doc.snapshots);
  const report = await readPreflight();
  const transport = buildTransportPolicies(report);

  doc.frozen_config.transport_policies = transport.policies;
  doc.frozen_config.transport_policy_sources = transport.sources;
  doc.config_fingerprint = fingerprint(doc.frozen_config);
  doc._lot1b_current_transport_enriched = true;

  if (stableJSON(doc.snapshots) !== snapshotsBefore) {
    throw new Error('INVARIANT ROMPU: les snapshots Golden ont changé pendant un enrichissement config-only');
  }

  console.log('LOT 1B-0 — Golden CURRENT transport enrichment');
  console.log(`- mode: ${mode}`);
  console.log(`- witnesses: ${doc.snapshots.length}`);
  console.log(`- SEA W/M: ${transport.policies.SEA_WM_KG_PER_M3} kg/m3`);
  console.log(`- SEA cost: ${transport.policies.SEA_EUR_PER_M3_COST} EUR/m3 (${transport.sources.SEA_EUR_PER_M3_COST})`);
  console.log(`- SEA commercial: ${transport.policies.SEA_KMF_PER_KG_COMMERCIAL} KMF/kg-equivalent`);
  console.log(`- EUR/KMF: ${transport.policies.EUR_KMF}`);
  console.log(`- fingerprint target: ${doc.config_fingerprint}`);
  console.log('✓ snapshots économiques inchangés');

  if (mode === 'write') {
    fs.writeFileSync(GOLDEN_PATH, stableJSON(doc));
    console.log(`✓ Golden CURRENT enrichi: ${path.relative(process.cwd(), GOLDEN_PATH)}`);
  } else {
    console.log('CHECK ONLY : aucun fichier écrit.');
  }
}

main()
  .catch(err => {
    console.error(`FATAL: ${err.message}`);
    process.exitCode = 2;
  })
  .finally(async () => {
    try {
      const db = require('../../db');
      if (db.pool?.end) await db.pool.end();
    } catch (_) { /* no-op */ }
  });
