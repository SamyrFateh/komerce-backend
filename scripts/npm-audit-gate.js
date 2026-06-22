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
 * Câblage CI (GitHub Actions) :
 *   - name: npm audit (high/critical)
 *     run: npm run audit:gate
 */

const { execSync } = require('child_process');

const MODE = process.argv.includes('--observe') ? 'observe' : 'blocking';

console.log('╔══════════════════════════════════════════════════════════╗');
console.log(`║  GOV-03 — npm audit gate (mode: ${MODE.padEnd(22)})║`);
console.log('╚══════════════════════════════════════════════════════════╝');

let output = '';
let auditExit = 0;

try {
  output = execSync('npm audit --audit-level=high', { encoding: 'utf8' });
} catch (err) {
  // npm audit renvoie un code non-zero dès qu'il trouve des vulns au-dessus du seuil
  output = (err.stdout || '') + (err.stderr || '');
  auditExit = typeof err.status === 'number' ? err.status : 1;
}

console.log(output);

if (auditExit === 0) {
  console.log('\n✅ npm audit: 0 high/critical vulnerabilities');
  process.exit(0);
}

console.log('\n⚠️  npm audit: high/critical vulnerabilities detected');

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
