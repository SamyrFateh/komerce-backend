'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-drift-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Porte SCHEMA.md <-> DB vivante. Confronte ce que le code/les headers
 *               PRETENDENT toucher en base a ce qui EXISTE reellement dans le dump live.
 *               Comble l'angle mort §2.6 de l'audit.
 * @inputs       docs/db/railway-live-schema.sql, docs/SCHEMA.md,
 *               docs/komerce-arch-header-graph.json, scripts/arch-debt-budget.json
 * @outputs      stdout report, process exit code
 * @depends      scripts/lib/arch-drift-core.js, scripts/generate-komerce-arch-graph.js
 * @used-by      .github/workflows/governance.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE, KOMERCE_ARCH_GRAPH_DOCTRINE
 * @impact-areas governance, ci
 *
 * Dependency-free. Ne touche aucun comportement applicatif.
 *
 * Trois constats, par tier :
 *   FICTION (bloquant)  : un header @db-read/@db-write nomme une table absente de tout
 *                         objet live. Tolere SEULEMENT si nomme dans knownDriftAllowlist.
 *   FANTOME (bloquant)  : SCHEMA.md catalogue un nom absent du live. Cible : 0.
 *   NON-DOCUMENTE (cliquet) : table BASE live hors catalogue SCHEMA.md. Plafond budget.
 *
 * Reprise : quand une fiction est resolue (DB corrigee OU header re-tagge), son entree
 * d'allowlist devient RESOLUE. Plutot que de bloquer sur une corvee JSON, ce cas pointe
 * vers `npm run arch:reconcile -- --write`, qui elague l'entree automatiquement.
 *
 * Usage :
 *   node scripts/arch-schema-drift-check.js          # bloque
 *   node scripts/arch-schema-drift-check.js --report # observe : sort toujours 0
 */

const core = require('./lib/arch-drift-core');

const REPORT_ONLY = process.argv.includes('--report');

function main() {
  let a;
  try {
    a = core.analyze();
  } catch (e) {
    console.error('FATAL: ' + e.message);
    process.exit(2);
  }

  const { live, headerTokens, allowlist, ratchetMax } = a;
  const { fiction, fictionUnlisted, fictionPendingMigration, fictionMigrationHints, allowlistResolved, ghosts, ghostMigrationHints, undocumented } = a;
  const ratchetOver = undocumented.length > ratchetMax;

  console.log('============================================================');
  console.log(' KOMERCE - Porte SCHEMA.md <-> DB vivante (drift)');
  console.log('============================================================');
  console.log(`Mode                    : ${REPORT_ONLY ? '--report (non bloquant)' : 'bloquant'}`);
  console.log(`Dump live               : docs/db/railway-live-schema.sql`);
  console.log(`Objets live             : ${live.tables.size} tables, ${live.views.size} vues, ${live.types.size} types, ${live.functions.size} fn, ${live.triggers.size} triggers`);
  console.log(`Tokens table (headers)  : ${headerTokens.size}`);
  console.log('');
  console.log('--- TIER BLOQUANT ---');
  console.log(`Fiction (hors liste)    : ${fictionUnlisted.length}`);
  console.log(`Fiction (figee/connue)  : ${fiction.length - fictionUnlisted.length - fictionPendingMigration.length}`);
  console.log(`Intention migration     : ${fictionPendingMigration.length}`);
  console.log(`Fantomes SCHEMA.md      : ${ghosts.length}`);
  console.log('');
  console.log('--- CLIQUET ---');
  const ratchetTag = ratchetMax === Infinity ? '(plafond non defini)' : ratchetOver ? `REGRESSION > ${ratchetMax}` : `OK (<= ${ratchetMax})`;
  console.log(`Tables live non doc.    : ${String(undocumented.length).padStart(3)}   ${ratchetTag}`);
  console.log('');

  const blockers = [];

  if (fictionPendingMigration.length) {
    console.log('--- INTENTIONS MIGRATION (header -> objet pas encore live, non bloquant) ---');
    for (const f of fictionPendingMigration) {
      console.log(`  [PENDING] ${f.token}`);
      console.log(`            <- ${f.files.slice(0, 6).join(', ')}${f.files.length > 6 ? ', ...' : ''}`);
      console.log(`            migration : ${fictionMigrationHints.get(f.token)}`);
    }
    console.log('');
  }

  const blockingFiction = fiction.filter(f => f.allowed || fictionUnlisted.some(u => u.token === f.token));
  if (blockingFiction.length) {
    console.log('--- FICTION (header -> table inexistante en base) ---');
    for (const f of blockingFiction) {
      const flag = f.allowed ? 'FIGEE ' : 'HORS-LISTE ';
      console.log(`  [${flag}] ${f.token}`);
      console.log(`            <- ${f.files.slice(0, 6).join(', ')}${f.files.length > 6 ? ', ...' : ''}`);
      if (f.allowed && allowlist[f.token]) console.log(`            note: ${allowlist[f.token]}`);
      const mig = !f.allowed && fictionMigrationHints.get(f.token);
      if (mig) {
        const migNumMatch = mig.split(/[/\\]/).pop().match(/^(\d+)/);
        const migNum = migNumMatch ? migNumMatch[1] : '?';
        console.log(`            trouve dans : ${mig} (migration locale, pas encore en live)`);
        console.log(`            -> deploy pas encore fait : ajouter temporairement "${f.token}"`);
        console.log(`               a knownDriftAllowlist (scripts/arch-debt-budget.json) avec une`);
        console.log(`               note "migration ${migNum}, pas encore deployee". Auto-elague`);
        console.log(`               par arch-reconcile des que live.`);
      }
    }
    console.log('');
  }
  if (fictionUnlisted.length) {
    blockers.push(`Fiction hors liste blanche: ${fictionUnlisted.length} (${fictionUnlisted.map(f => f.token).join(', ')})`);
  }
  if (allowlistResolved.length) {
    console.log('--- ENTREES D\'ALLOWLIST RESOLUES (a elaguer automatiquement) ---');
    for (const t of allowlistResolved) console.log(`  ${t}  (fiction disparue)`);
    console.log('  -> reprise : npm run arch:reconcile -- --write   (puis commit du budget)');
    console.log('');
    blockers.push(`Allowlist contient ${allowlistResolved.length} entree(s) resolue(s): ${allowlistResolved.join(', ')} -> lance "npm run arch:reconcile -- --write"`);
  }
  if (ghosts.length) {
    console.log('--- FANTOMES (SCHEMA.md -> objet inexistant en base) ---');
    for (const g of ghosts) {
      const mig = ghostMigrationHints.get(g);
      console.log(`  ${g}`);
      if (mig) {
        console.log(`            trouve dans : ${mig} (migration locale, pas encore en live)`);
        console.log(`            -> probablement une declaration prematuree : cet objet doit`);
        console.log(`               etre un bloc <!-- schema-pending --> dans SCHEMA.md, pas`);
        console.log(`               une ligne de tableau directe. Voir scripts/schema-promote.js`);
        console.log(`               (format du bloc en tete de fichier). Une fois deploye,`);
        console.log(`               "npm run schema:promote:write" convertit le bloc en ligne.`);
      }
    }
    console.log('');
    blockers.push(`Fantomes dans SCHEMA.md: ${ghosts.length} (${ghosts.join(', ')})`);
  }
  if (undocumented.length) {
    console.log('--- TABLES LIVE NON DOCUMENTEES (cliquet) ---');
    for (const u of undocumented) console.log(`  ${u}`);
    console.log('');
  }
  if (ratchetOver) {
    blockers.push(`Tables live non documentees: ${undocumented.length} > cliquet ${ratchetMax} (documente-les dans SCHEMA.md, puis "npm run arch:reconcile -- --write")`);
  }

  console.log('============================================================');
  if (blockers.length) {
    for (const b of blockers) console.error('🚫 ' + b);
    if (REPORT_ONLY) {
      console.log(`MODE --report : ${blockers.length} blocage(s) detecte(s), sortie non bloquante.`);
      process.exit(0);
    }
    console.error(`ECHEC: ${blockers.length} blocage(s) de drift.`);
    process.exit(1);
  }
  console.log('✅ Aucun drift bloquant. SCHEMA.md et headers concordent avec la DB live.');
  process.exit(0);
}

main();
