'use strict';

/**
 * @komerce-arch
 * @role         governance-arch-reconcile
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Reprise automatique du budget apres correction. Elague les entrees
 *               d'allowlist resolues et abaisse les cliquets a la mesure courante.
 *               Supprime la corvee d'edition JSON manuelle.
 * @inputs       scripts/lib/arch-drift-core.js, scripts/arch-debt-budget.json
 * @outputs      stdout report, [--write] reecrit scripts/arch-debt-budget.json, exit code
 * @depends      scripts/lib/arch-drift-core.js
 * @used-by      .github/workflows/governance.yml, scripts/setup-hooks.sh
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE, KOMERCE_ARCH_GRAPH_DOCTRINE
 * @impact-areas governance, ci
 *
 * Asymetrie volontaire :
 *   - RESOUDRE est automatique : elague une fiction disparue, abaisse un cliquet.
 *   - SUPPRIMER reste humain : n'AJOUTE jamais a l'allowlist, ne RELEVE jamais un cliquet.
 *     Un nouveau probleme reste donc bloquant (pas d'auto-masquage).
 *
 * Cliquets geres : liveTablesUndocumented (drift), headerUnderDeclaration (headers<->SQL).
 *
 * Modes :
 *   node scripts/arch-reconcile.js            # dry-run : montre le plan, n'ecrit rien
 *   node scripts/arch-reconcile.js --write     # applique au budget
 *   node scripts/arch-reconcile.js --check     # CI : exit 1 si le budget n'est pas a jour
 */

const fs = require('fs');
const core = require('./lib/arch-drift-core');

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');

const RATCHET_LABELS = {
  liveTablesUndocumented: 'Tables live non documentees',
  headerUnderDeclaration: 'Sous-declaration headers<->SQL'
};

function metricState(key, measured, currentRaw) {
  const current = (typeof currentRaw === 'number') ? currentRaw : Infinity;
  const newVal = (current === Infinity || measured < current) ? measured : current;
  return {
    key,
    measured,
    current,
    newVal,
    isBaseline: current === Infinity,                     // 1re definition du plafond (opt-in)
    changes: current !== newVal && newVal !== Infinity,  // abaissement ou baseline
    over: current !== Infinity && measured > current      // regression : reste a la main
  };
}

function main() {
  let a, headerSql;
  try {
    a = core.analyze();
    headerSql = core.analyzeHeaderSql();
  } catch (e) {
    console.error('FATAL: ' + e.message);
    process.exit(2);
  }

  const budget = a.budgetRaw && Object.keys(a.budgetRaw).length ? a.budgetRaw : null;
  if (!budget) {
    console.error('FATAL: scripts/arch-debt-budget.json absent ou illisible.');
    process.exit(2);
  }
  const ratchet = budget.ratchet || {};

  // 1. Allowlist : entrees resolues (fiction disparue) a elaguer.
  const toPrune = a.allowlistResolved.slice().sort();

  // 2. Cliquets : abaisser/baseliner a la mesure courante.
  const metrics = [
    metricState('liveTablesUndocumented', a.undocumented.length, ratchet.liveTablesUndocumented),
    metricState('headerUnderDeclaration', headerSql.totalUnder, ratchet.headerUnderDeclaration)
  ];
  const metricsToLower = metrics.filter(m => m.changes);

  // 3. Ce que reconcile NE touche PAS (reste a la main).
  const stillManual = [];
  if (a.fictionPendingMigration && a.fictionPendingMigration.length) {
    console.log(`ℹ️  Intentions migration non live : ${a.fictionPendingMigration.map(f => f.token).join(', ')}`);
  }
  if (a.fictionUnlisted.length) {
    stillManual.push(`Fiction hors liste (vrai bug a corriger, ou a inscrire volontairement dans l'allowlist) : ${a.fictionUnlisted.map(f => f.token).join(', ')}`);
  }
  if (a.ghosts.length) {
    stillManual.push(`Fantomes SCHEMA.md (retirer du doc, ces objets n'existent pas live) : ${a.ghosts.join(', ')}`);
  }
  for (const m of metrics) {
    if (m.over) {
      stillManual.push(`${RATCHET_LABELS[m.key]} : ${m.measured} > plafond ${m.current} (a corriger ; reconcile ne releve jamais un cliquet)`);
    }
  }

  const hasAutoWork = toPrune.length > 0 || metricsToLower.length > 0;

  // ---- Rapport ----
  console.log('============================================================');
  console.log(' KOMERCE - Reconciliation du budget');
  console.log('============================================================');
  console.log(`Mode                    : ${WRITE ? '--write' : CHECK ? '--check' : 'dry-run'}`);
  console.log('');
  console.log('--- REPRISES AUTOMATIQUES ---');
  if (toPrune.length) {
    console.log(`Allowlist a elaguer (fiction resolue) : ${toPrune.length}`);
    for (const t of toPrune) console.log(`  - ${t}`);
  } else {
    console.log('Allowlist a elaguer (fiction resolue) : (aucune)');
  }
  for (const m of metrics) {
    const cur = m.current === Infinity ? '(non defini)' : m.current;
    if (m.changes) console.log(`Cliquet ${m.key.padEnd(22)}: ${cur} -> ${m.newVal}`);
    else           console.log(`Cliquet ${m.key.padEnd(22)}: ${cur} (inchange)`);
  }
  console.log('');

  if (stillManual.length) {
    console.log('--- RESTE A LA MAIN (reconcile ne touche pas) ---');
    for (const s of stillManual) console.log(`  ! ${s}`);
    console.log('');
  }

  // ---- Mode --check ----
  // Ne bloque QUE sur ce qui rend le budget malhonnete : une fiction resolue laissee
  // dans l'allowlist (la porte de drift bloque dessus). Baseliner/resserrer un cliquet
  // est optionnel (offert par --write), jamais impose ici.
  if (CHECK) {
    console.log('============================================================');
    if (toPrune.length) {
      console.error(`🚫 Budget non reconcilie : ${toPrune.length} entree(s) d'allowlist resolue(s) a elaguer (${toPrune.join(', ')}).`);
      console.error('   Lance : npm run arch:reconcile -- --write   puis commit du budget.');
      process.exit(1);
    }
    console.log('✅ Budget reconcilie (allowlist a jour).');
    const offer = metricsToLower.filter(m => m.isBaseline).map(m => m.key);
    const tidy  = metricsToLower.filter(m => !m.isBaseline).map(m => m.key);
    if (offer.length) console.log(`   (optionnel) cliquet a baseliner : ${offer.join(', ')} -> npm run arch:reconcile -- --write`);
    if (tidy.length)  console.log(`   (optionnel) cliquet resserrable : ${tidy.join(', ')} -> npm run arch:reconcile -- --write`);
    process.exit(0);
  }

  // ---- Application ----
  if (!hasAutoWork) {
    console.log('============================================================');
    console.log('✅ Rien a reconcilier. Budget deja a jour.');
    process.exit(0);
  }
  if (!WRITE) {
    console.log('============================================================');
    console.log('DRY-RUN : aucun fichier modifie. Relance avec --write pour appliquer :');
    console.log('  npm run arch:reconcile -- --write');
    process.exit(0);
  }

  // --write : muter en preservant meta-cles, notes et autres sections.
  budget.knownDriftAllowlist = budget.knownDriftAllowlist || {};
  for (const t of toPrune) delete budget.knownDriftAllowlist[t];

  if (metricsToLower.length) {
    budget.ratchet = budget.ratchet || {};
    for (const m of metricsToLower) {
      budget.ratchet[m.key] = m.newVal;
      budget.ratchet[`_note_${m.key}`] =
        `Cale a ${m.newVal} par arch-reconcile (cliquet : ne peut que baisser).`;
    }
  }

  fs.writeFileSync(a.paths.budget, JSON.stringify(budget, null, 2) + '\n', 'utf8');

  console.log('============================================================');
  console.log('✅ Budget reconcilie et reecrit : scripts/arch-debt-budget.json');
  if (toPrune.length) console.log(`   - ${toPrune.length} entree(s) d'allowlist elaguee(s)`);
  for (const m of metricsToLower) console.log(`   - cliquet ${m.key} cale a ${m.newVal}`);
  console.log('   Pense a committer le budget.');
  process.exit(0);
}

main();
