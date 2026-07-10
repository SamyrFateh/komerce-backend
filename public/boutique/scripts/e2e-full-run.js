#!/usr/bin/env node
/**
 * scripts/e2e-full-run.js
 * @brief Lance la suite E2E complète en local, navigateur par navigateur,
 *        avec rapport consolidé. Miroir du pipeline CI pour validation
 *        avant push.
 *
 * Usage :
 *   node scripts/e2e-full-run.js                    # 5 navigateurs, prod
 *   node scripts/e2e-full-run.js --browsers=mobile   # Mobile Chrome + Safari
 *   node scripts/e2e-full-run.js --browsers=desktop   # Desktop × 3
 *   node scripts/e2e-full-run.js --browsers=safari    # Safari × 2
 *   node scripts/e2e-full-run.js --headed             # Mode visible (debug)
 *   node scripts/e2e-full-run.js --url=http://localhost:3000/boutique/  # Local
 *   node scripts/e2e-full-run.js --spec=cross-browser # Un seul fichier
 *   node scripts/e2e-full-run.js --fast               # 2 navs (Chrome + Safari mobile)
 */
'use strict';
const { execSync } = require('child_process');

// ── Parse arguments ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.find(a => a.startsWith(`--${name}`));
const flagVal = (name) => { const f = flag(name); return f?.includes('=') ? f.split('=')[1] : null; };

const baseURL = flagVal('url') || 'https://komerce.co/boutique/';
const headed = args.includes('--headed');
const specFilter = flagVal('spec');  // ex: --spec=cross-browser
const browserChoice = flagVal('browsers') || (args.includes('--fast') ? 'fast' : 'all');

// ── Browser matrix ───────────────────────────────────────────────────────
const BROWSERS = {
  all: ['Mobile Chrome', 'Mobile Safari', 'Desktop Chrome', 'Desktop Firefox', 'Desktop Safari'],
  mobile: ['Mobile Chrome', 'Mobile Safari'],
  desktop: ['Desktop Chrome', 'Desktop Firefox', 'Desktop Safari'],
  safari: ['Mobile Safari', 'Desktop Safari'],
  fast: ['Mobile Chrome', 'Mobile Safari'],  // Smoke rapide : 2 moteurs différents
};

const projects = BROWSERS[browserChoice] || BROWSERS.all;

// ── Colors ────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// ── Run ──────────────────────────────────────────────────────────────────
console.log(`\n${c.bold}${c.cyan}╔════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}${c.cyan}║   🧪 E2E Full Run — Boutique Komerce           ║${c.reset}`);
console.log(`${c.bold}${c.cyan}╚════════════════════════════════════════════════╝${c.reset}\n`);
console.log(`  ${c.dim}URL    :${c.reset} ${baseURL}`);
console.log(`  ${c.dim}Navs   :${c.reset} ${projects.join(', ')}`);
console.log(`  ${c.dim}Spec   :${c.reset} ${specFilter || 'tous'}`);
console.log(`  ${c.dim}Mode   :${c.reset} ${headed ? 'headed (visible)' : 'headless'}\n`);

const results = [];
const startAll = Date.now();

for (const project of projects) {
  const label = `${c.bold}[${project}]${c.reset}`;
  console.log(`${label} ${c.yellow}▸ Lancement...${c.reset}`);

  const specArg = specFilter ? `e2e/${specFilter}.spec.js` : '';
  const headedArg = headed ? '--headed' : '';

  const cmd = [
    `npx playwright test`,
    specArg,
    `--project="${project}"`,
    `--workers=2`,
    headedArg,
  ].filter(Boolean).join(' ');

  const start = Date.now();
  try {
    execSync(cmd, {
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: baseURL, CI: '' },
      cwd: __dirname.replace(/[\\/]scripts$/, ''),
    });
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    results.push({ project, status: 'pass', duration });
    console.log(`${label} ${c.green}✓ OK${c.reset} (${duration}s)\n`);
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    results.push({ project, status: 'fail', duration });
    console.log(`${label} ${c.red}✗ ÉCHEC${c.reset} (${duration}s)\n`);
  }
}

// ── Rapport ──────────────────────────────────────────────────────────────
const totalDuration = ((Date.now() - startAll) / 1000).toFixed(1);
const passed = results.filter(r => r.status === 'pass');
const failed = results.filter(r => r.status === 'fail');

console.log(`\n${c.bold}╔════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}║   📊 RAPPORT — ${passed.length}/${results.length} navigateurs OK (${totalDuration}s)      ║${c.reset}`);
console.log(`${c.bold}╚════════════════════════════════════════════════╝${c.reset}\n`);

for (const r of results) {
  const icon = r.status === 'pass' ? `${c.green}✓` : `${c.red}✗`;
  console.log(`  ${icon} ${r.project}${c.reset}  ${c.dim}(${r.duration}s)${c.reset}`);
}

if (failed.length > 0) {
  console.log(`\n  ${c.red}${c.bold}${failed.length} navigateur(s) en échec.${c.reset}`);
  console.log(`  ${c.dim}Rapport HTML : npx playwright show-report${c.reset}`);
  console.log(`  ${c.dim}Traces       : test-results/ (screenshots + error-context)${c.reset}\n`);
  process.exit(1);
} else {
  console.log(`\n  ${c.green}${c.bold}🎉 Tous les navigateurs sont au vert !${c.reset}\n`);
  process.exit(0);
}
