'use strict';

/**
 * @komerce-arch
 * @role         governance-header-sql-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Porte headers <-> SQL reel du fichier. Ferme le §2.2 de l'audit :
 *               un header doit declarer toute table LIVE qu'il touche reellement
 *               (FROM/JOIN/INSERT/UPDATE/DELETE). Detecte la SOUS-DECLARATION, que
 *               ni la porte de drift ni l'hygiene des headers ne voyaient.
 * @inputs       scripts/lib/arch-drift-core.js, docs/komerce-arch-header-graph.json,
 *               docs/db/railway-live-schema.sql, scripts/arch-debt-budget.json
 * @outputs      stdout report, process exit code
 * @depends      scripts/lib/arch-drift-core.js, scripts/generate-komerce-arch-graph.js
 * @used-by      .github/workflows/governance.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE, KOMERCE_ARCH_GRAPH_DOCTRINE
 * @impact-areas governance, ci
 *
 * Conservateur : ancre chaque reference sur les vraies tables live (un token qui n'est
 * pas une table live est ignore -> alias, CTE, artefact). Le SQL dynamique reste @unknown.
 *
 * Cliquet : la sous-declaration existante est gelee (budget.ratchet.headerUnderDeclaration)
 * et ne peut que baisser ; toute NOUVELLE sous-declaration au-dela du plafond bloque.
 * Tant que le plafond n'est pas defini, la porte est en OBSERVATION (non bloquante) et
 * invite a fixer la base via `npm run arch:reconcile -- --write`.
 *
 * Usage :
 *   node scripts/arch-header-sql-check.js          # bloque si > cliquet
 *   node scripts/arch-header-sql-check.js --report # observe : sort toujours 0
 */

const core = require('./lib/arch-drift-core');

const REPORT_ONLY = process.argv.includes('--report');

function main() {
  let r, budgetRaw;
  try {
    r = core.analyzeHeaderSql();
    budgetRaw = core.loadBudgetRaw();
  } catch (e) {
    console.error('FATAL: ' + e.message);
    process.exit(2);
  }

  const ratchet = budgetRaw && budgetRaw.ratchet || {};
  const hasFloor = typeof ratchet.headerUnderDeclaration === 'number';
  const floor = hasFloor ? ratchet.headerUnderDeclaration : Infinity;
  const over = r.totalUnder > floor;

  console.log('============================================================');
  console.log(' KOMERCE - Porte headers <-> SQL reel (sous-declaration)');
  console.log('============================================================');
  console.log(`Mode                    : ${REPORT_ONLY ? '--report (non bloquant)' : hasFloor ? 'bloquant' : 'observation (cliquet non defini)'}`);
  console.log(`Fichiers en sous-decl.  : ${r.findings.length}`);
  console.log(`Total (fichier,table)   : ${r.totalUnder}`);
  console.log(`Cliquet                 : ${hasFloor ? floor : '(non defini)'}${over ? '  REGRESSION' : hasFloor ? '  OK' : ''}`);
  console.log('');

  if (r.findings.length) {
    console.log('--- SOUS-DECLARATIONS (table touchee par le code, absente du header) ---');
    for (const f of r.findings) {
      console.log(`  ${f.file}`);
      console.log(`      manquant: ${f.missing.join(', ')}`);
    }
    console.log('');
  }

  console.log('============================================================');

  if (!hasFloor) {
    console.log('OBSERVATION : cliquet non defini. Aucun blocage pour l\'instant.');
    console.log('Pour figer la base et activer l\'enforcement :');
    console.log('  npm run arch:reconcile -- --write   (fixe le plafond a la mesure courante)');
    console.log('Puis chaque nouvelle sous-declaration au-dela bloquera.');
    process.exit(0);
  }

  if (over) {
    console.error(`🚫 Sous-declaration: ${r.totalUnder} > cliquet ${floor}.`);
    console.error('   Declare les tables manquantes dans @db-read/@db-write des fichiers ci-dessus,');
    console.error('   ou si la baisse est legitime : npm run arch:reconcile -- --write');
    if (REPORT_ONLY) {
      console.log('MODE --report : sortie non bloquante.');
      process.exit(0);
    }
    process.exit(1);
  }

  // total <= floor : si total < floor, on peut resserrer le cliquet (via reconcile)
  if (r.totalUnder < floor) {
    console.log(`✅ Sous le cliquet (${r.totalUnder} <= ${floor}).`);
    console.log(`   Astuce : "npm run arch:reconcile -- --write" resserre le plafond a ${r.totalUnder}.`);
  } else {
    console.log(`✅ Au niveau du cliquet (${r.totalUnder}). Aucune regression.`);
  }
  process.exit(0);
}

main();
