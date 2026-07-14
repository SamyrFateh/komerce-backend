#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          alerts-contract-gate
 * @domain        infrastructure
 * @layer         script
 * @criticality   high
 * @inputs        services/**\/*.js, utils/**\/*.js, routes/**\/*.js, core/**\/*.js,
 *                capabilities/**\/*.js, middleware/**\/*.js, bootstrap/**\/*.js,
 *                validators/**\/*.js, db.js, server.js
 * @outputs       exit_code, rapport_console (LEGACY_ALERT_RUNTIME_WRITERS)
 * @depends       fs, path
 * @used-by       npm run alerts:contract:check, map:check
 * @db-read       @none
 * @db-write      @none
 * @db-txn        @none
 * @doctrine      ALERTS_CONTRACT_RECOVERY (docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md)
 * @impact-areas  infrastructure, ci, alerts
 * @version       2026-07
 */

/**
 * KOMERCE — Gate CI « alerts contract » (mission ALERTS_CONTRACT_RECOVERY §12)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Répond mécaniquement à la question :
 *
 *   « Un writer runtime peut-il encore écrire dans `alerts` avec le
 *     schéma legacy (level, source, message, payload) ? »
 *
 * Ne dépend d'aucune liste figée de fichiers : scanne l'arborescence
 * runtime réelle et détecte LE PATTERN interdit (tolérant aux espaces,
 * retours ligne, casse SQL, et à la présence de `created_at`), pas une
 * liste de quinze noms de fichiers connus. Un nouveau fichier introduisant
 * le même pattern legacy est bloqué au même titre.
 *
 * N'intercepte rien à l'exécution (pas de monkey-patch node-pg) : c'est un
 * grep structuré exécuté en CI / pre-push, pas un mécanisme runtime.
 *
 * Usage : npm run alerts:contract:check
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Répertoires runtime scannés (exclut tests/, docs/, migrations/, scripts/,
// schemas/, public/, node_modules/ — l'inventaire n'a jamais vocation à
// « embellir » l'historique ou les fixtures de test).
const RUNTIME_DIRS = [
  'services',
  'utils',
  'routes',
  'core',
  'capabilities',
  'middleware',
  'bootstrap',
];
const RUNTIME_ROOT_FILES = ['db.js', 'server.js'];

const NEGATIVE_FIXTURE_MARKER = 'ALERTS_CONTRACT_CHECK_NEGATIVE_FIXTURE';

// Pattern interdit : INSERT INTO alerts(level, source, message, payload[, created_at])
// — whitespace/newlines normalisés avant matching, casse SQL ignorée,
// tolère la colonne created_at legacy en plus.
const LEGACY_PATTERN = /insert\s+into\s+alerts\s*\(\s*level\s*,\s*source\s*,\s*message\s*,\s*payload\s*(,\s*created_at\s*)?\)/i;

function listJsFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(listJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scanne un répertoire racine (paramétrable pour les tests) et retourne
 * la liste des fichiers runtime contenant le pattern legacy interdit.
 * @param {string} rootDir
 * @param {{ runtimeDirs?: string[], runtimeRootFiles?: string[] }} [options]
 */
function scanForLegacyAlertWriters(rootDir, options) {
  const opts = options || {};
  const runtimeDirs = opts.runtimeDirs || RUNTIME_DIRS;
  const runtimeRootFiles = opts.runtimeRootFiles || RUNTIME_ROOT_FILES;

  const candidates = [];
  for (const dir of runtimeDirs) {
    candidates.push(...listJsFiles(path.join(rootDir, dir)));
  }
  for (const f of runtimeRootFiles) {
    const full = path.join(rootDir, f);
    if (fs.existsSync(full)) candidates.push(full);
  }

  const offenders = [];
  for (const file of candidates) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (err) {
      continue;
    }
    if (content.includes(NEGATIVE_FIXTURE_MARKER)) continue;

    const normalized = content.replace(/\s+/g, ' ');
    if (LEGACY_PATTERN.test(normalized)) {
      offenders.push(path.relative(rootDir, file));
    }
  }
  return offenders;
}

function main() {
  const offenders = scanForLegacyAlertWriters(ROOT);

  console.log('KOMERCE — alerts:contract:check');
  console.log('─'.repeat(60));
  if (offenders.length === 0) {
    console.log('LEGACY_ALERT_RUNTIME_WRITERS = 0');
    console.log('OK — aucun writer runtime sur le schéma legacy alerts(level, source, message, payload).');
    process.exit(0);
  }

  console.log(`LEGACY_ALERT_RUNTIME_WRITERS = ${offenders.length}`);
  console.log('');
  console.log('Fichiers en violation (schéma legacy alerts détecté) :');
  for (const f of offenders) console.log(`  - ${f}`);
  console.log('');
  console.log('Utiliser utils/alerts.js (createAlert) — voir docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md.');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { scanForLegacyAlertWriters, LEGACY_PATTERN, NEGATIVE_FIXTURE_MARKER };
