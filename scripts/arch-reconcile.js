'use strict';

/**
 * @komerce-arch
 * @role         governance-arch-reconcile
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Reprise automatique du budget apres correction. Quand une fiction est
 *               resolue (DB corrigee OU header re-tagge) ou qu'une table est documentee,
 *               recale le budget tout seul : elague les entrees d'allowlist resolues et
 *               abaisse le cliquet. Supprime la corvee d'edition JSON manuelle.
 * @inputs       scripts/lib/arch-drift-core.js (analyse), scripts/arch-debt-budget.json
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
 *   - RESOUDRE est automatique : on elague une fiction disparue, on abaisse le cliquet.
 *   - SUPPRIMER reste un acte humain : reconcile n'AJOUTE jamais a l'allowlist et ne
 *     RELEVE jamais le cliquet. Un nouveau bug reste donc bloquant (pas d'auto-masquage).
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

function main() {
  let a;
  try {
    a = core.analyze();
  } catch (e) {
    console.error('FATAL: ' + e.message);
    process.exit(2);
  }

  const budget = a.budgetRaw && Object.keys(a.budgetRaw).length ? a.budgetRaw : null;
  if (!budget) {
    console.error('FATAL: scripts/arch-debt-budget.json absent ou illisible.');
    process.exit(2);
  }

  // ---- Reprises AUTO possibles ----
  // 1. Allowlist : entrees resolues (fiction disparue) a elaguer.
  const toPrune = a.allowlistResolved.slice().sort();

  // 2. Cliquet : abaisser a la mesure courante si elle est plus basse (jamais relever).
  const measured = a.undocumented.length;
  const currentMax = a.ratchetMax; // Infinity si non defini
  const canLower = currentMax === Infinity ? true : measured < currentMax;
  const newRatchet = canLower ? measured : currentMax;
  const ratchetChanges = currentMax !== newRatchet && newRatchet !== Infinity;

  // ---- Ce que reconcile NE touche PAS (reste a la main) ----
  const stillManual = [];
  if (a.fictionUnlisted.length) {
    stillManual.push(`Fiction hors liste (vrai bug a corriger, ou a inscrire volontairement dans l'allowlist) : ${a.fictionUnlisted.map(f => f.token).join(', ')}`);
  }
  if (a.ghosts.length) {
    stillManual.push(`Fantomes SCHEMA.md (retirer du doc, ces objets n'existent pas live) : ${a.ghosts.join(', ')}`);
  }
  if (currentMax !== Infinity && measured > currentMax) {
    stillManual.push(`Cliquet depasse : ${measured} tables non documentees > plafond ${currentMax} (documente-les dans SCHEMA.md ; reconcile ne releve jamais le plafond)`);
  }

  const hasAutoWork = toPrune.length > 0 || ratchetChanges;

  // ---- Rapport ----
  console.log('============================================================');
  console.log(' KOMERCE - Reconciliation du budget de drift');
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
  if (ratchetChanges) {
    console.log(`Cliquet liveTablesUndocumented        : ${currentMax === Infinity ? '(non defini)' : currentMax} -> ${newRatchet}`);
  } else {
    console.log(`Cliquet liveTablesUndocumented        : ${currentMax === Infinity ? '(non defini)' : currentMax} (inchange)`);
  }
  console.log('');

  if (stillManual.length) {
    console.log('--- RESTE A LA MAIN (reconcile ne touche pas) ---');
    for (const s of stillManual) console.log(`  ! ${s}`);
    console.log('');
  }

  // ---- Mode --check : verifie que le budget est deja a jour ----
  if (CHECK) {
    console.log('============================================================');
    if (hasAutoWork) {
      console.error(`🚫 Budget non reconcilie : ${toPrune.length} entree(s) a elaguer` + (ratchetChanges ? `, cliquet a abaisser a ${newRatchet}` : '') + '.');
      console.error('   Lance : npm run arch:reconcile -- --write   puis commit du budget.');
      process.exit(1);
    }
    console.log('✅ Budget deja reconcilie (rien a faire).');
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

  // --write : muter le budget en preservant meta-cles, notes et autres sections.
  budget.knownDriftAllowlist = budget.knownDriftAllowlist || {};
  for (const t of toPrune) delete budget.knownDriftAllowlist[t];

  if (ratchetChanges) {
    budget.ratchet = budget.ratchet || {};
    budget.ratchet.liveTablesUndocumented = newRatchet;
    budget.ratchet._note_liveTablesUndocumented =
      `Abaisse a ${newRatchet} par arch-reconcile (cliquet : ne peut que baisser).`;
  }

  fs.writeFileSync(a.paths.budget, JSON.stringify(budget, null, 2) + '\n', 'utf8');

  console.log('============================================================');
  console.log(`✅ Budget reconcilie et reecrit : scripts/arch-debt-budget.json`);
  if (toPrune.length) console.log(`   - ${toPrune.length} entree(s) d'allowlist elaguee(s)`);
  if (ratchetChanges) console.log(`   - cliquet abaisse a ${newRatchet}`);
  console.log('   Pense a committer le budget. La porte de drift repassera au vert.');
  process.exit(0);
}

main();
