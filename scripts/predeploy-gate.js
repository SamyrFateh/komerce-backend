#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @feature       infrastructure
 * @domain        infrastructure
 * @owner         backend
 *
 * predeploy-gate.js — Gate unifiée de prédéploiement production.
 *
 * Usage :
 *   npm run predeploy              # bloquant (exit 1 si échec)
 *   npm run predeploy -- --report  # rapport seul (exit 0 toujours)
 *   npm run predeploy -- --skip-tests  # sans jest (pour CI qui teste séparément)
 *
 * Ordre d'exécution (fail-fast : arrêt au premier échec sauf --report) :
 *
 *   Étage 0 — Registre features     (feature-registry-check.js --strict)
 *   Étage 1 — Qualité code N1-4     (code-quality-gate.js --strict)
 *   Étage 2 — Audit architecture    (audit-backend-arch.js)
 *   Étage 3 — Contrats inter-feature (contract-check.js)
 *   Étage 4 — Sécurité npm          (npm-audit-gate.js)
 *   Étage 5 — Schema DB fraîcheur   (check-schema-freshness.js)
 *   Étage 6 — Tests unitaires        (jest --coverage)
 *   Étage 7 — Tests déclarés existent (vérifie que chaque test dans files.tests existe sur disque)
 *   Étage 8 — Migrations immutables   (hash SHA des migrations appliquées vs snapshot)
 *   Étage 9 — Feature slice guard    (feature-guard.js --strict)
 *
 * Créé 2026-07-01 — audit gouvernance, fermeture du trou "pas de predeploy gate".
 */
'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPORT_ONLY = process.argv.includes('--report');
const SKIP_TESTS  = process.argv.includes('--skip-tests');

const PASS = '\x1b[32m✅ PASS\x1b[0m';
const FAIL = '\x1b[31m❌ FAIL\x1b[0m';
const SKIP = '\x1b[33m⏭️  SKIP\x1b[0m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let failures = 0;
let skipped = 0;
const results = [];

function banner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Predeploy Gate — Komerce Production                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
}

function runGate(label, cmd, opts = {}) {
  const { skipIf, custom } = opts;
  process.stdout.write(`  ${BOLD}Étage ${results.length}${RESET} — ${label} ... `);

  if (skipIf) {
    console.log(SKIP);
    skipped++;
    results.push({ label, status: 'skip' });
    return;
  }

  try {
    if (custom) {
      custom(); // throws on failure
    } else {
      execSync(cmd, { stdio: 'pipe', timeout: 120_000 });
    }
    console.log(PASS);
    results.push({ label, status: 'pass' });
  } catch (err) {
    console.log(FAIL);
    const output = (err.stdout || err.message || '').toString().slice(0, 500);
    if (output) console.log('    ' + output.split('\n').join('\n    '));
    failures++;
    results.push({ label, status: 'fail', error: output });
    if (!REPORT_ONLY) {
      summary();
      process.exit(1);
    }
  }
}

function checkDeclaredTestsExist() {
  const missing = [];
  for (const f of fs.readdirSync('./features')) {
    if (!f.endsWith('.feature.js')) continue;
    const fp = path.resolve('./features', f);
    delete require.cache[fp];
    const m = require(fp);
    const tests = ((m.files || {}).tests || []);
    for (const t of tests) {
      const norm = path.normalize(t.replace(/^\.\.\//,''));
      if (!fs.existsSync(norm)) {
        missing.push(`${m.name}: ${norm}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`${missing.length} test(s) déclaré(s) mais absents du disque:\n` +
      missing.map(m => '  - ' + m).join('\n'));
  }
}

function checkMigrationImmutability() {
  const snapshotPath = 'governance/migration-hashes.json';
  const migDir = 'migrations';

  if (!fs.existsSync(migDir)) return;

  // Compute current hashes
  const current = {};
  for (const f of fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
    const content = fs.readFileSync(path.join(migDir, f), 'utf8');
    current[f] = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  // Load or create snapshot
  if (!fs.existsSync(snapshotPath)) {
    // First run: save snapshot, pass
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + '\n');
    console.log('\n    Snapshot créé: ' + snapshotPath + ' (' + Object.keys(current).length + ' migrations)');
    return;
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const modified = [];
  const removed = [];

  // Check for modified or removed migrations
  for (const [file, hash] of Object.entries(snapshot)) {
    if (!current[file]) {
      removed.push(file);
    } else if (current[file] !== hash) {
      modified.push(file);
    }
  }

  if (modified.length > 0 || removed.length > 0) {
    const msg = [];
    if (modified.length) msg.push(`${modified.length} migration(s) modifiée(s): ${modified.join(', ')}`);
    if (removed.length)  msg.push(`${removed.length} migration(s) supprimée(s): ${removed.join(', ')}`);
    throw new Error(msg.join('\n'));
  }

  // Update snapshot with new migrations (append only)
  const newMigs = Object.keys(current).filter(f => !snapshot[f]);
  if (newMigs.length > 0) {
    fs.writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + '\n');
    console.log(`\n    +${newMigs.length} nouvelle(s) migration(s) ajoutée(s) au snapshot`);
  }
}

function summary() {
  console.log('');
  console.log('─'.repeat(58));
  const passed = results.filter(r => r.status === 'pass').length;
  const total  = results.length;
  console.log(`  ${passed}/${total} passed, ${failures} failed, ${skipped} skipped`);

  if (failures === 0) {
    console.log(`\n  ${BOLD}${PASS} — Prêt pour la production.${RESET}`);
  } else {
    console.log(`\n  ${BOLD}${FAIL} — Déploiement bloqué.${RESET}`);
  }
  console.log('');
}

// ── Exécution ────────────────────────────────────────────────────────────────

banner();

runGate('Registre features',         'node scripts/feature-registry-check.js --strict');
runGate('Qualité code N1-4',         'node scripts/code-quality-gate.js --strict');
runGate('Audit architecture',        'node scripts/audit-backend-arch.js');
runGate('Contrats inter-features',   'node scripts/contract-check.js');
runGate('Sécurité npm',              'node scripts/npm-audit-gate.js');
runGate('Schema DB fraîcheur',       'node scripts/check-schema-freshness.js');
runGate('Tests unitaires',           'npx jest --coverage --forceExit --detectOpenHandles',
        { skipIf: SKIP_TESTS });
runGate('Tests déclarés existent',   null, { custom: checkDeclaredTestsExist });
runGate('Migrations immutables',     null, { custom: checkMigrationImmutability });
runGate('Feature slice guard',       'node scripts/feature-guard.js --strict');

summary();
process.exit(REPORT_ONLY ? 0 : (failures > 0 ? 1 : 0));
