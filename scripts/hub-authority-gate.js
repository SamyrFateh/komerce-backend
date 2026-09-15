#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch
 * @role         governance-hub-authority-gate
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      HUB-000 / F4 — empêche @domain logistics d'écrire directement
 *               dans les tables/colonnes d'autorité amont (purchase_orders,
 *               product_skus en table-level ; orders.market_id,
 *               orders.relais_id en column-level). Voir
 *               scripts/lib/hub-authority.js pour la doctrine complète et
 *               l'arbitrage Option C (2026-09) qui a fixé ce scope après
 *               audit du repo réel.
 * @inputs       scripts/lib/hub-authority.js, docs/komerce-arch-header-graph.json
 * @outputs      stdout report, process exit code
 * @depends      scripts/lib/hub-authority.js
 * @used-by      .github/workflows/pr-enforcement.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_ARCH_GRAPH_DOCTRINE
 * @impact-areas governance, ci, logistics
 *
 * Ce gate n'est PAS un moteur SQL générique de column ownership — il ferme un
 * seam précis (logistics -> orders/purchase_orders/product_skus). Ne pas
 * étendre PROTECTED_COLUMNS/TABLE_LEVEL_FORBIDDEN sans nouvel audit du
 * graphe réel prouvant l'absence d'écriture légitime existante.
 *
 * Usage :
 *   node scripts/hub-authority-gate.js          # bloque si violation
 *   node scripts/hub-authority-gate.js --report # observe : sort toujours 0
 */

const { analyzeHubAuthority } = require('./lib/hub-authority');

const REPORT_ONLY = process.argv.includes('--report');

function describe(v) {
  if (v.type === 'TABLE_LEVEL_FORBIDDEN') {
    return `${v.file} [${v.domain}] écrit directement "${v.table}" — table d'autorité pure, aucun writer logistics légitime`;
  }
  if (v.type === 'PROTECTED_COLUMN') {
    return `${v.file} [${v.domain}] écrit directement "${v.table}.${v.column}" — colonne d'autorité amont, doit passer par la boundary du domaine propriétaire`;
  }
  if (v.type === 'UNPARSEABLE_PROTECTED_TABLE_WRITE') {
    return `${v.file} [${v.domain}] contient une écriture non-analysable vers "${v.table}" — fail-closed (forme SQL non reconnue par le parseur étroit)`;
  }
  return `${v.file} [${v.domain}] violation non classifiée sur "${v.table}"`;
}

function main() {
  let result;
  try {
    result = analyzeHubAuthority();
  } catch (e) {
    console.error('FATAL: ' + e.message);
    process.exit(2);
  }

  console.log('============================================================');
  console.log(' KOMERCE - Hub Authority Gate (F4)');
  console.log('============================================================');
  console.log(`Mode                    : ${REPORT_ONLY ? '--report (non bloquant)' : 'bloquant'}`);
  console.log(`Fichiers @domain logistics scannés : ${result.scannedFiles.length}`);
  console.log(`Violations              : ${result.violations.length}`);
  console.log('');

  if (result.violations.length > 0) {
    console.error('\x1b[31m\x1b[1m✖ Écritures interdites détectées :\x1b[0m');
    for (const v of result.violations) {
      console.error(`  - ${describe(v)}`);
    }
    console.error('');
    console.error('\x1b[2m  Voir scripts/lib/hub-authority.js (doctrine Option C, 2026-09).\x1b[0m');
    if (!REPORT_ONLY) process.exit(1);
    process.exit(0);
  }

  console.log('\x1b[32m\x1b[1m✔ Aucune écriture logistics dans une table/colonne d\'autorité amont.\x1b[0m');
  process.exit(0);
}

main();
