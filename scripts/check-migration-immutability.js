#!/usr/bin/env node
'use strict';

/**
 * Gate PR read-only : les migrations SQL déjà présentes sur la base de la PR
 * sont immuables. Seuls les nouveaux fichiers SQL sont autorisés.
 *
 * Contrairement au snapshot historique de predeploy-gate.js, ce contrôle
 * n'écrit aucun fichier et s'appuie directement sur le diff Git base..head.
 *
 * Usage :
 *   node scripts/check-migration-immutability.js --base <sha> --head <sha>
 */

const cp = require('child_process');

const args = process.argv.slice(2);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function norm(file) {
  return String(file || '').replace(/\\/g, '/').trim();
}

function parseNameStatus(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const parts = line.split('\t');
      const rawStatus = parts[0] || '';
      const code = rawStatus[0] || '';
      const paths = parts.slice(1).map(norm).filter(Boolean);
      return { rawStatus, code, paths };
    });
}

function isMigrationSql(file) {
  return /^migrations\/.+\.sql$/i.test(norm(file));
}

function evaluate(records) {
  const violations = [];
  const additions = [];

  for (const record of records || []) {
    const sqlPaths = record.paths.filter(isMigrationSql);
    if (!sqlPaths.length) continue;

    if (record.code === 'A' && sqlPaths.length === 1) {
      additions.push(sqlPaths[0]);
      continue;
    }

    violations.push({
      status: record.rawStatus,
      paths: sqlPaths,
    });
  }

  return { additions, violations, ok: violations.length === 0 };
}

function gitDiffNameStatus(base, head) {
  if (!base || !head) throw new Error('Les SHA --base et --head sont obligatoires.');
  const r = cp.spawnSync(
    'git',
    ['diff', '--name-status', '--find-renames', base, head, '--', 'migrations/'],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) {
    throw new Error(`git diff impossible: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return parseNameStatus(r.stdout);
}

function main() {
  const records = gitDiffNameStatus(argValue('--base'), argValue('--head'));
  const result = evaluate(records);

  for (const file of result.additions) {
    console.log(`+ migration append-only autorisée : ${file}`);
  }

  if (!result.ok) {
    console.error('\n❌ Migration existante modifiée/supprimée/renommée :');
    for (const violation of result.violations) {
      console.error(`   ${violation.status}\t${violation.paths.join(' -> ')}`);
    }
    console.error('\nRègle : une migration déjà versionnée est immuable. Ajouter une nouvelle migration corrective.');
    process.exitCode = 1;
    return;
  }

  console.log(`✅ Immutabilité migrations : ${result.additions.length} ajout(s), aucune réécriture historique.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Migration immutability: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { norm, parseNameStatus, isMigrationSql, evaluate };
