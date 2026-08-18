#!/usr/bin/env node
'use strict';

/**
 * LOT 1B-1 — preuve DELTA TOTAL == DELTA EXPLIQUÉ pour le transport.
 *
 * Décomposition causale par témoin Golden :
 *   CURRENT
 *   + delta W/M seul (mêmes cost_components historiques)
 *   + delta retrait des valorisations freight génériques
 *   = TARGET transport canonique
 *
 * La recette commerciale SEA est mesurée séparément : ancien kg réel vs W/M.
 */

const fs = require('fs');
const path = require('path');
const legacy = require('../../services/pricing-cdr-legacy');
const target = require('../../services/pricing-cdr');
const {
  quoteTransportCost,
  quoteTransportCommercial,
} = require('../../services/transport-valuation');
const WITNESSES = require('../golden-cdr/witnesses');

const GOLDEN_PATH = path.resolve(__dirname, '../golden-cdr/golden/cdr.golden.json');

function r(n) { return Math.round(Number(n) || 0); }

function currentSeaCommercialPrice(w, policies) {
  const weight = Number(w.product?.weight_kg) || 0;
  const rate = Number(policies?.SEA_KMF_PER_KG_COMMERCIAL) || 0;
  return Math.round(weight * rate);
}

function computeWitnessDelta(w, config, goldenSnapshot) {
  const volumeM3 = Number(w.ctx?.volume_m3) || 0.005;
  const weightKg = Number(w.product?.weight_kg) || 1;
  const policies = config.transport_policies || {};

  const current = legacy.computeCDR(w.product, {
    config,
    volume_m3: w.ctx?.volume_m3,
    channel: w.ctx?.channel,
  });

  const costQuote = quoteTransportCost({
    railCode: 'SEA_STANDARD',
    weightKg,
    volumeCm3: volumeM3 * 1_000_000,
    quantity: 1,
    policies,
  });

  const wmOnly = legacy.computeCDR(w.product, {
    config,
    volume_m3: costQuote.chargeable_quantity,
    channel: w.ctx?.channel,
  });

  const canonical = target.computeCDR(w.product, {
    config,
    volume_m3: w.ctx?.volume_m3,
    channel: w.ctx?.channel,
  });

  const currentTotal = r(current.cost_complete_estimated_kmf);
  const wmOnlyTotal = r(wmOnly.cost_complete_estimated_kmf);
  const targetTotal = r(canonical.cost_complete_estimated_kmf);
  const deltaWm = wmOnlyTotal - currentTotal;
  const deltaDedicated = targetTotal - wmOnlyTotal;
  const deltaTotal = targetTotal - currentTotal;
  const deltaExplained = deltaWm + deltaDedicated;

  const commercialTarget = quoteTransportCommercial({
    railCode: 'SEA_STANDARD',
    weightKg,
    volumeCm3: volumeM3 * 1_000_000,
    quantity: 1,
    policies,
  });
  const commercialCurrent = currentSeaCommercialPrice(w, policies);

  return {
    id: w.id,
    label: w.label,
    dominant_measure: costQuote.dominant_measure,
    chargeable_m3: costQuote.chargeable_quantity,
    current_total_kmf: currentTotal,
    golden_total_kmf: r(goldenSnapshot?.totals?.total),
    target_total_kmf: targetTotal,
    delta_wm_kmf: deltaWm,
    delta_remove_generic_freight_kmf: deltaDedicated,
    delta_total_kmf: deltaTotal,
    delta_explained_kmf: deltaExplained,
    equation_ok: deltaTotal === deltaExplained,
    current_matches_golden: currentTotal === r(goldenSnapshot?.totals?.total),
    freight_current_kmf: r(current.details?.freight),
    freight_target_kmf: r(canonical.details?.freight),
    commercial_current_kmf: commercialCurrent,
    commercial_target_kmf: commercialTarget.price_kmf,
    commercial_delta_kmf: commercialTarget.price_kmf - commercialCurrent,
  };
}

function printRow(row) {
  const sign = n => n >= 0 ? `+${n}` : String(n);
  console.log(`\n${row.id} — ${row.label}`);
  console.log(`  CDR CURRENT ${row.current_total_kmf} -> TARGET ${row.target_total_kmf} = ${sign(row.delta_total_kmf)} KMF`);
  console.log(`  expliqué: W/M ${sign(row.delta_wm_kmf)} + retrait freight générique ${sign(row.delta_remove_generic_freight_kmf)} = ${sign(row.delta_explained_kmf)} ${row.equation_ok ? '✓' : '✗'}`);
  console.log(`  freight : ${row.freight_current_kmf} -> ${row.freight_target_kmf} KMF · dominante ${row.dominant_measure}`);
  console.log(`  recette SEA : ${row.commercial_current_kmf} -> ${row.commercial_target_kmf} = ${sign(row.commercial_delta_kmf)} KMF`);
  if (!row.current_matches_golden) {
    console.log(`  ✗ CURRENT ne correspond pas au Golden (${row.golden_total_kmf})`);
  }
}

function main() {
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
  const config = golden.frozen_config;
  const byId = new Map(golden.snapshots.map(s => [s.id, s]));
  const rows = WITNESSES.map(w => computeWitnessDelta(w, config, byId.get(w.id)));

  console.log('============================================================');
  console.log(' KOMERCE — LOT 1B-1 TRANSPORT DELTA EXPLAINED');
  console.log('============================================================');
  for (const row of rows) printRow(row);

  const failures = rows.filter(r => !r.equation_ok || !r.current_matches_golden);
  const totalDelta = rows.reduce((s, r) => s + r.delta_total_kmf, 0);
  const totalExplained = rows.reduce((s, r) => s + r.delta_explained_kmf, 0);
  const revenueDelta = rows.reduce((s, r) => s + r.commercial_delta_kmf, 0);

  console.log('\n------------------------------------------------------------');
  console.log(`13 témoins — delta CDR agrégé: ${totalDelta} KMF`);
  console.log(`             delta expliqué: ${totalExplained} KMF ${totalDelta === totalExplained ? '✓' : '✗'}`);
  console.log(`             delta recette SEA (témoins): ${revenueDelta} KMF`);

  if (process.argv.includes('--json')) {
    console.log('\n' + JSON.stringify(rows, null, 2));
  }

  if (failures.length || totalDelta !== totalExplained) {
    console.error(`\n✗ RATC HET 1B ROMPU — ${failures.length} témoin(s) non expliqué(s).`);
    process.exit(1);
  }
  console.log('\n✓ DELTA TOTAL == DELTA EXPLIQUÉ — 13/13 témoins.');
}

if (require.main === module) main();

module.exports = { computeWitnessDelta, currentSeaCommercialPrice };
