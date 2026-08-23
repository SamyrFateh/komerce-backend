#!/usr/bin/env node
/**
 * scripts/e2e-business-run.js
 * @brief Lance les tests E2E business dans l'ordre recommandé par l'inventaire,
 *        avec rapport consolidé et chaînage intelligent.
 *
 * L'ordre suit l'inventaire E2E_BUSINESS_FLOWS_INVENTORY.md :
 *   1. Lecture seule (F05, F06, F31) — sans risque
 *   2. Panier groupe (F20, F21) — si ALLOW_GROUP_FLOW
 *   3. Commandes (F01, F07, F04p) — si ALLOW_ORDER_SUBMIT
 *   4. Wallet (F02, F03, lifecycle) — si ALLOW_ORDER_SUBMIT + ALLOW_ORDER_CANCEL
 *   5. Admin (F30) — si ALLOW_STATUS_CHANGE
 *   6. Robustesse (R1-R5) — toujours
 *   7. Stress (S1-S9) — seulement si ALLOW_STRESS_TESTS + ALLOW_ORDER_SUBMIT
 *
 * Usage :
 *   # Minimum (lecture seule, sûr même en prod)
 *   TEST_ACCOUNT_PHONE=3211234 TEST_ACCOUNT_OTP=123456 \
 *   BASE_URL=https://komerce.co/boutique/ \
 *   node scripts/e2e-business-run.js
 *
 *   # Complet (staging)
 *   TEST_ACCOUNT_PHONE=3211234 TEST_ACCOUNT_OTP=123456 \
 *   ALLOW_ORDER_SUBMIT=true ALLOW_ORDER_CANCEL=true \
 *   ALLOW_GROUP_FLOW=true ALLOW_STATUS_CHANGE=true \
 *   ALLOW_STRESS_TESTS=true \
 *   KOMERCE_ENV=staging BASE_URL=https://komerce.co/boutique/ \
 *   node scripts/e2e-business-run.js
 *
 *   # Un seul test (debug)
 *   node scripts/e2e-business-run.js --spec=wallet-lifecycle
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flagVal = (name) => {
  const f = args.find(a => a.startsWith(`--${name}`));
  return f?.includes('=') ? f.split('=')[1] : null;
};
const specFilter = flagVal('spec');
const headed = args.includes('--headed');

// ── Couleurs terminal ────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  dim: '\x1b[2m', magenta: '\x1b[35m',
};

// ── Détection des features activées ─────────────────────────────────────
const HAS_AUTH = !!(process.env.TEST_ACCOUNT_PHONE && process.env.TEST_ACCOUNT_OTP);
const HAS_ORDER = !!process.env.ALLOW_ORDER_SUBMIT;
const HAS_CANCEL = !!process.env.ALLOW_ORDER_CANCEL;
const HAS_GROUP = !!process.env.ALLOW_GROUP_FLOW;
const HAS_STATUS = !!process.env.ALLOW_STATUS_CHANGE;
const HAS_STRESS = !!process.env.ALLOW_STRESS_TESTS;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/boutique/';

// ── Matrice de tests dans l'ordre recommandé ─────────────────────────────
const ALL_SPECS = [
  // Phase 1 — Lecture seule (aucun prérequis au-delà de l'auth)
  { id: 'F06', file: 'order-history.spec.js',         label: 'Historique commande',       requires: ['auth'], phase: 'read-only' },
  { id: 'F05', file: 'invoice-public.spec.js',        label: 'Facture publique',           requires: ['auth'], phase: 'read-only' },
  { id: 'F31', file: 'tracking-public.spec.js',       label: 'Tracking public',            requires: ['auth'], phase: 'read-only' },
  { id: 'F10', file: 'wallet-flow.spec.js',           label: 'Wallet cohérence UI↔API',    requires: ['auth'], phase: 'read-only' },

  // Phase 2 — Panier groupe
  { id: 'F20', file: 'group-flow.spec.js',            label: 'Création panier partagé',    requires: ['auth', 'group'], phase: 'group' },
  { id: 'F21', file: 'group-full-cycle.spec.js',      label: 'Panier groupe cycle complet', requires: ['auth', 'group'], phase: 'group' },

  // Phase 3 — Commandes
  { id: 'F01', file: 'order-flow.spec.js',            label: 'Commande cash complète',     requires: ['auth'], phase: 'order' },
  { id: 'F07', file: 'stock-after-order.spec.js',     label: 'Stock décrémenté',           requires: ['auth', 'order'], phase: 'order' },
  { id: 'F04p', file: 'order-confirmation.spec.js',   label: 'Écran confirmation',         requires: ['auth', 'order'], phase: 'order' },

  // Phase 4 — Wallet lifecycle (le plus ambitieux)
  { id: 'F02', file: 'wallet-payment.spec.js',        label: 'Commande wallet 100%',       requires: ['auth', 'order'], phase: 'wallet' },
  { id: 'F03', file: 'cancel-refund.spec.js',         label: 'Annulation + remboursement', requires: ['auth', 'cancel'], phase: 'wallet' },
  { id: 'LIF', file: 'wallet-lifecycle.spec.js',      label: 'Cycle wallet complet',       requires: ['auth', 'order', 'cancel'], phase: 'wallet' },

  // Phase 5 — Admin
  { id: 'F30', file: 'admin-status-transition.spec.js', label: 'Transition statut admin', requires: ['auth', 'status'], phase: 'admin' },

  // Phase 6 — Contrats & Fidélité
  { id: 'C*',  file: 'api-contracts.spec.js',          label: 'Contrats API frontend↔backend', requires: ['auth'], phase: 'contracts' },
  { id: 'F12p', file: 'loyalty-tier.spec.js',          label: 'Fidélité paliers + cohérence',  requires: ['auth'], phase: 'contracts' },

  // Phase 7 — Robustesse
  { id: 'R*',  file: 'business-resilience.spec.js',   label: 'Robustesse business',        requires: ['auth'], phase: 'resilience' },

  // Phase 8 — Stress explicite : jamais activé implicitement par `order`.
  // Plusieurs scénarios soumettent de vraies commandes ; ce lot reste le dernier cran.
  { id: 'S*',  file: 'stress-business.spec.js',       label: 'Stress : concurrence, gros panier, session', requires: ['auth', 'order', 'stress'], phase: 'stress' },
];

// ── Filtre selon les features activées ───────────────────────────────────
const CAPABILITY_MAP = {
  auth:   HAS_AUTH,
  order:  HAS_ORDER,
  cancel: HAS_CANCEL,
  group:  HAS_GROUP,
  status: HAS_STATUS,
  stress: HAS_STRESS,
};

function canRun(spec) {
  if (specFilter && !spec.file.includes(specFilter)) return false;
  return spec.requires.every(r => CAPABILITY_MAP[r]);
}

// ── Header ───────────────────────────────────────────────────────────────
console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}${c.magenta}║   🏪 E2E Business Flows — Boutique Komerce          ║${c.reset}`);
console.log(`${c.bold}${c.magenta}╚══════════════════════════════════════════════════════╝${c.reset}\n`);
console.log(`  ${c.dim}URL     :${c.reset} ${BASE_URL}`);
console.log(`  ${c.dim}Auth    :${c.reset} ${HAS_AUTH ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset} (TEST_ACCOUNT_PHONE/OTP requis)`}`);
console.log(`  ${c.dim}Order   :${c.reset} ${HAS_ORDER ? `${c.green}✓${c.reset}` : `${c.dim}—${c.reset}`}`);
console.log(`  ${c.dim}Cancel  :${c.reset} ${HAS_CANCEL ? `${c.green}✓${c.reset}` : `${c.dim}—${c.reset}`}`);
console.log(`  ${c.dim}Group   :${c.reset} ${HAS_GROUP ? `${c.green}✓${c.reset}` : `${c.dim}—${c.reset}`}`);
console.log(`  ${c.dim}Status  :${c.reset} ${HAS_STATUS ? `${c.green}✓${c.reset}` : `${c.dim}—${c.reset}`}`);
console.log(`  ${c.dim}Stress  :${c.reset} ${HAS_STRESS ? `${c.green}✓${c.reset}` : `${c.dim}—${c.reset}`}`);

if (!HAS_AUTH) {
  console.log(`\n  ${c.red}${c.bold}⛔ Impossible de lancer sans TEST_ACCOUNT_PHONE + TEST_ACCOUNT_OTP${c.reset}\n`);
  process.exit(1);
}

const runnable = ALL_SPECS.filter(canRun);
const skipped = ALL_SPECS.filter(s => !canRun(s) && (!specFilter || s.file.includes(specFilter)));

console.log(`  ${c.dim}Tests   :${c.reset} ${runnable.length} à lancer, ${skipped.length} skippés\n`);

if (skipped.length > 0) {
  console.log(`  ${c.dim}Skippés :${c.reset}`);
  for (const s of skipped) {
    const missing = s.requires.filter(r => !CAPABILITY_MAP[r]);
    console.log(`    ${c.dim}${s.id} ${s.label} — manque: ${missing.join(', ')}${c.reset}`);
  }
  console.log('');
}

// ── Exécution séquentielle ───────────────────────────────────────────────
const results = [];
const startAll = Date.now();
let currentPhase = '';

for (const spec of runnable) {
  if (spec.phase !== currentPhase) {
    currentPhase = spec.phase;
    console.log(`\n  ${c.bold}${c.cyan}── Phase : ${currentPhase} ──${c.reset}`);
  }

  const label = `  ${c.bold}[${spec.id}]${c.reset} ${spec.label}`;
  console.log(`${label} ${c.yellow}▸${c.reset}`);

  const cmd = [
    'npx playwright test',
    `tests/e2e/authenticated/${spec.file}`,
    '--project=authenticated',
    '--workers=1',
    headed ? '--headed' : '',
  ].filter(Boolean).join(' ');

  const start = Date.now();
  try {
    execSync(cmd, {
      stdio: 'pipe',
      env: { ...process.env, BASE_URL },
      cwd: ROOT,
      timeout: 120_000,
    });
    const dur = ((Date.now() - start) / 1000).toFixed(1);
    results.push({ ...spec, status: 'pass', duration: dur });
    console.log(`${label} ${c.green}✓ OK${c.reset} ${c.dim}(${dur}s)${c.reset}`);
  } catch (err) {
    const dur = ((Date.now() - start) / 1000).toFixed(1);
    const stderr = (err.stderr || '').toString().trim().split('\n').pop();
    results.push({ ...spec, status: 'fail', duration: dur, error: stderr });
    console.log(`${label} ${c.red}✗ FAIL${c.reset} ${c.dim}(${dur}s)${c.reset}`);
    if (stderr) console.log(`         ${c.red}${stderr}${c.reset}`);
  }
}

// ── Rapport consolidé ────────────────────────────────────────────────────
const totalDur = ((Date.now() - startAll) / 1000).toFixed(1);
const passed = results.filter(r => r.status === 'pass');
const failed = results.filter(r => r.status === 'fail');

console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}${c.magenta}║   📊 RAPPORT — ${passed.length}/${results.length} tests OK (${totalDur}s)${' '.repeat(Math.max(0, 22 - totalDur.length - String(passed.length).length - String(results.length).length))}║${c.reset}`);
console.log(`${c.bold}${c.magenta}╚══════════════════════════════════════════════════════╝${c.reset}\n`);

for (const r of results) {
  const icon = r.status === 'pass' ? `${c.green}✓` : `${c.red}✗`;
  console.log(`  ${icon} [${r.id}] ${r.label}${c.reset}  ${c.dim}(${r.duration}s)${c.reset}`);
}

if (skipped.length > 0) {
  console.log(`\n  ${c.dim}⏭ ${skipped.length} tests skippés (activer les flags pour les inclure)${c.reset}`);
}

if (failed.length > 0) {
  console.log(`\n  ${c.red}${c.bold}${failed.length} test(s) en échec.${c.reset}`);
  console.log(`  ${c.dim}Rapport : npx playwright show-report${c.reset}`);
  console.log(`  ${c.dim}Traces  : test-results/ (screenshots)${c.reset}\n`);
  process.exit(1);
} else {
  console.log(`\n  ${c.green}${c.bold}🎉 Tous les flux business sont au vert !${c.reset}\n`);
  process.exit(0);
}
