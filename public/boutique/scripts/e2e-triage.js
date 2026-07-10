#!/usr/bin/env node
/**
 * scripts/e2e-triage.js
 * @brief Analyse les résultats Playwright et classe chaque échec :
 *        🐛 BUG RÉEL (app) vs 🔧 TEST À ADAPTER
 *
 * Usage :
 *   node scripts/e2e-triage.js                    # Analyse le dernier run
 *   node scripts/e2e-triage.js --fix              # Suggère les corrections
 *
 * Fonctionne en lisant les error-context.md générés par Playwright.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'test-results');
const TRIAGE_DIR = path.join(RESULTS_DIR, 'triage');

// ── Heuristiques de classification ──────────────────────────────────────

const PATTERNS = {
  testBug: [
    {
      pattern: /Cannot find module/i,
      label: '🔧 Import cassé',
      fix: 'Vérifier le chemin require() — probablement ../helpers au lieu de ./helpers',
    },
    {
      pattern: /Timeout \d+ms exceeded.*waitForSelector/i,
      label: '🔧 Timeout sélecteur',
      fix: 'Le sélecteur CSS a peut-être changé ou le timing est trop court. Lancer CAL-01 à CAL-06.',
    },
    {
      pattern: /waitForURL.*Timeout/i,
      label: '🔧 Timeout navigation',
      fix: 'L\'URL attendue ne correspond pas au comportement réel (redirect, replaceState).',
    },
    {
      pattern: /locator\.(toBeVisible|toBeAttached|toHaveClass).*Timeout/i,
      label: '🔧 Assertion timing',
      fix: 'L\'élément existe mais pas assez vite, ou la classe attendue est différente.',
    },
    {
      pattern: /strict mode violation.*resolved to \d+ elements/i,
      label: '🔧 Sélecteur ambigu',
      fix: 'Le sélecteur matche plusieurs éléments — scoper avec .first() ou un parent plus précis.',
    },
    {
      pattern: /not visible/i,
      label: '🔧 Élément caché',
      fix: 'L\'élément est dans le DOM mais display:none / visibility:hidden. Vérifier mobile vs desktop.',
    },
    {
      pattern: /page\.evaluate.*is not a function/i,
      label: '🔧 API JS absente',
      fix: 'La fonction ou variable globale attendue n\'existe pas (window.__bus, etc.).',
    },
  ],
  appBug: [
    {
      pattern: /net::ERR_|Failed to fetch|NetworkError/i,
      label: '🐛 Erreur réseau',
      fix: 'Requête API échouée — vérifier le backend/CDN.',
    },
    {
      pattern: /status (4\d{2}|5\d{2})/i,
      label: '🐛 Erreur HTTP',
      fix: 'Le serveur retourne une erreur — vérifier les routes API.',
    },
    {
      pattern: /page crashed/i,
      label: '🐛 Crash page',
      fix: 'La page a planté (OOM, boucle infinie). Bug critique.',
    },
    {
      pattern: /Chargement….*never resolved/i,
      label: '🐛 Spinner infini',
      fix: 'L\'app est bloquée en chargement — timeout API non géré.',
    },
  ],
};

function classify(errorMessage) {
  for (const rule of PATTERNS.appBug) {
    if (rule.pattern.test(errorMessage)) {
      return { type: 'app', ...rule };
    }
  }
  for (const rule of PATTERNS.testBug) {
    if (rule.pattern.test(errorMessage)) {
      return { type: 'test', ...rule };
    }
  }
  return { type: 'unknown', label: '❓ À analyser manuellement', fix: 'Ouvrir le screenshot + trace.' };
}

// ── Lecture des résultats ────────────────────────────────────────────────

function findErrorContextFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findErrorContextFiles(full));
    } else if (entry.name === 'error-context.md') {
      files.push(full);
    }
  }
  return files;
}

function parseErrorContext(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const dir = path.basename(path.dirname(filePath));

  // Extraire le nom du test depuis le nom du dossier
  const testName = dir
    .replace(/-Mobile-Chrome|-Mobile-Safari|-Desktop-Chrome|-Desktop-Firefox|-Desktop-Safari/g, '')
    .replace(/^e2e-/, '')
    .replace(/-/g, ' ')
    .slice(0, 80);

  // Extraire le navigateur
  const browserMatch = dir.match(/(Mobile|Desktop)-(Chrome|Safari|Firefox)/);
  const browser = browserMatch ? browserMatch[0] : 'unknown';

  return { testName, browser, content, dir };
}

// ── Main ────────────────────────────────────────────────────────────────

const errorFiles = findErrorContextFiles(RESULTS_DIR);

if (errorFiles.length === 0) {
  console.log('\n  ✅ Aucun échec trouvé dans test-results/\n');
  process.exit(0);
}

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

console.log(`\n${c.bold}${c.cyan}╔════════════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}${c.cyan}║   🔍 Triage E2E — ${errorFiles.length} échec(s) à analyser              ║${c.reset}`);
console.log(`${c.bold}${c.cyan}╚════════════════════════════════════════════════════════╝${c.reset}\n`);

const summary = { app: [], test: [], unknown: [] };

for (const file of errorFiles) {
  const { testName, browser, content } = parseErrorContext(file);
  const classification = classify(content);

  summary[classification.type].push({ testName, browser, classification });

  const icon = classification.type === 'app' ? `${c.red}🐛`
             : classification.type === 'test' ? `${c.yellow}🔧`
             : `${c.dim}❓`;

  console.log(`  ${icon} ${c.bold}${classification.label}${c.reset}`);
  console.log(`     ${c.dim}Test :${c.reset} ${testName}`);
  console.log(`     ${c.dim}Nav  :${c.reset} ${browser}`);
  console.log(`     ${c.dim}Fix  :${c.reset} ${classification.fix}`);
  console.log();
}

// ── Résumé ──────────────────────────────────────────────────────────────

console.log(`${c.bold}── Résumé ──${c.reset}`);
if (summary.app.length > 0) {
  console.log(`  ${c.red}${c.bold}🐛 ${summary.app.length} bug(s) réel(s) dans l'app${c.reset} — à corriger en priorité`);
}
if (summary.test.length > 0) {
  console.log(`  ${c.yellow}${c.bold}🔧 ${summary.test.length} test(s) à adapter${c.reset} — sélecteurs ou timing à ajuster`);
}
if (summary.unknown.length > 0) {
  console.log(`  ${c.dim}❓ ${summary.unknown.length} à analyser manuellement${c.reset} — ouvrir screenshots + traces`);
}

console.log(`\n  ${c.dim}Traces     : npx playwright show-report${c.reset}`);
console.log(`  ${c.dim}Screenshots: test-results/*/test-failed-*.png${c.reset}`);
console.log(`  ${c.dim}Calibration: npx playwright test e2e/calibration.spec.js${c.reset}\n`);

process.exit(summary.app.length > 0 ? 1 : 0);
