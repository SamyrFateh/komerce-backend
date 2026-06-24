#!/usr/bin/env node
/**
 * GOV-03 — npm audit gate (port Node.js, cross-platform)
 *
 * Usage:
 *   npm run audit:gate          // bloquant (exit 1 si high/critical)
 *   npm run audit:gate:observe  // observatoire (exit 0 toujours, log seulement)
 *
 * Câblage package.json :
 *   "audit:gate":         "node scripts/npm-audit-gate.js",
 *   "audit:gate:observe": "node scripts/npm-audit-gate.js --observe"
 *
 * Note: utilise --json pour éviter la dépendance à l'endpoint legacy npm
 * /v1/security/audits/quick (retiré juin 2026). L'API bulk advisory reste
 * accessible via `npm audit --json` (auditReportVersion: 2).
 */

'use strict';

const { execSync } = require('child_process');

const MODE = process.argv.includes('--observe') ? 'observe' : 'blocking';

console.log('╔══════════════════════════════════════════════════════════╗');
console.log(`║  GOV-03 — npm audit gate (mode: ${MODE.padEnd(22)})║`);
console.log('╚══════════════════════════════════════════════════════════╝');

let rawOutput = '';
try {
  rawOutput = execSync('npm audit --json', { encoding: 'utf8' });
} catch (err) {
  // npm audit --json exits non-zero when vulns are found; stdout still has JSON
  rawOutput = err.stdout || '';
  if (!rawOutput) {
    // Real command failure (network, etc.) — not a vuln result
    console.error('⚠️  npm audit failed to run:', (err.stderr || err.message).slice(0, 200));
    if (MODE === 'observe') { process.exit(0); }
    process.exit(1);
  }
}

let data;
try {
  // Strip any leading/trailing non-JSON noise
  const match = rawOutput.match(/\{[\s\S]*\}/);
  data = JSON.parse(match ? match[0] : rawOutput);
} catch (e) {
  console.error('⚠️  Could not parse npm audit JSON:', e.message.slice(0, 100));
  if (MODE === 'observe') { process.exit(0); }
  process.exit(1);
}

const meta = (data.metadata || {}).vulnerabilities || {};
const high     = meta.high     || 0;
const critical = meta.critical || 0;
const moderate = meta.moderate || 0;
const low      = meta.low      || 0;
const total    = meta.total    || 0;

console.log(`\n📦 Vulnerabilities: critical=${critical} high=${high} moderate=${moderate} low=${low} total=${total}`);

if (high === 0 && critical === 0) {
  console.log('\n✅ npm audit: 0 high/critical vulnerabilities');
  process.exit(0);
}

console.log('\n⚠️  npm audit: high/critical vulnerabilities detected');

// List the offenders
const vulns = data.vulnerabilities || {};
for (const [name, v] of Object.entries(vulns)) {
  if (['high', 'critical'].includes(v.severity)) {
    console.log(`  ❌ ${v.severity.toUpperCase()} — ${name}: ${v.title || v.via?.[0]?.title || '(no title)'}`);
  }
}

if (MODE === 'observe') {
  console.log('ℹ️  Mode observe — pas de blocage CI');
  process.exit(0);
} else {
  console.log('❌ Mode bloquant — CI fail');
  console.log('');
  console.log('Fix: npm audit fix');
  console.log('Exception: ajouter une exception datée dans scripts/npm-audit-exceptions.json');
  process.exit(1);
}
