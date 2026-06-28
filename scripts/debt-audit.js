#!/usr/bin/env node
/**
 * debt-audit.js — Tableau de bord de dette technique Komerce
 *
 * Inverse des gates : là où les gates BLOQUENT les régressions futures,
 * ce script AGRÈGE la dette existante (allowlists, baselines, exemptions)
 * et en produit un rapport chiffré par règle, avec les lots de correction.
 *
 * Usage :
 *   node scripts/debt-audit.js              ← rapport console (humain)
 *   node scripts/debt-audit.js --json       ← rapport JSON (CI/dashboards)
 *   npm run backend:debt                    ← alias recommandé
 *
 * Toujours exit 0 — jamais bloquant. Mode --report uniquement.
 *
 * Sources agrégées :
 *   • audit-backend-arch.js     → allowlists I-BACK-2/3/4/6/7/12/13/14
 *   • code-quality-gate.js      → RULE_FILE_EXEMPT + inline quality-disable
 *   • governance/test-exemptions.json
 *   • scripts/arch-debt-budget.json
 *   • scripts/code-quality-baseline.json  (si présente)
 *   • scripts/*.baseline.json   (feature-guard, dashboards-360, boutique-360…)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = process.env.ROOT || process.cwd();
const JSON_MODE = process.argv.includes('--json');

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function readFile(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

function readJson(rel) {
  const src = readFile(rel);
  if (!src) return null;
  try { return JSON.parse(src); }
  catch { return null; }
}

/** Compte les occurrences d'un pattern dans une source. */
function countMatches(src, re) {
  return (src.match(re) || []).length;
}

/** Extrait les entrées d'un Set littéral JS par son nom de variable. */
function extractSet(src, varName) {
  // cherche "const <varName> = new Set([\n  ...entrées...\n]);"
  const re = new RegExp(`(?:const|var|let)\\s+${varName}\\s*=\\s*new Set\\(\\[([^\\]]*?)\\]\\)`, 's');
  const m = src.match(re);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, '').trim().replace(/['"`,]/g, ''))
    .filter(Boolean);
}

/** Extrait toutes les allowlists dans COLUMN_OWNERSHIP. */
function extractColumnOwnershipAllowlists(src) {
  // Parcourt les blocs allowlist: new Set([...]) dans COLUMN_OWNERSHIP
  const results = [];
  const colOwnerRe = /\{\s*id:\s*'([^']+)'[^}]*?allowlist:\s*new Set\(\[([^\]]*?)\]\)/gs;
  let m;
  while ((m = colOwnerRe.exec(src)) !== null) {
    const id = m[1];
    const entries = m[2]
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, '').trim().replace(/['"`,]/g, ''))
      .filter(Boolean);
    if (entries.length) results.push({ id, entries });
  }
  return results;
}

/** Compte les commentaires // quality-disable dans un répertoire. */
function countInlineDisables(dirs, root) {
  const counts = {};
  for (const dir of dirs) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    scanDir(full, (filePath) => {
      const src = fs.readFileSync(filePath, 'utf8');
      const matches = src.match(/\/\/\s*quality-disable\s+(N2-\S+)/g) || [];
      for (const m of matches) {
        const rule = m.replace(/.*quality-disable\s+/, '').trim();
        counts[rule] = (counts[rule] || 0) + 1;
      }
    });
  }
  return counts;
}

function scanDir(dir, cb) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') scanDir(full, cb);
    else if (e.isFile() && e.name.endsWith('.js')) cb(full);
  }
}

// ════════════════════════════════════════════════════════════════
// COLLECTE DES DETTES
// ════════════════════════════════════════════════════════════════

const debts = []; // { rule, label, lot, count, entries, note }

function addDebt({ rule, label, lot, entries = [], note = '' }) {
  debts.push({ rule, label, lot, count: entries.length, entries, note });
}

// ── 1. audit-backend-arch.js ──────────────────────────────────

const auditSrc = readFile('scripts/audit-backend-arch.js')
               || readFile('scripts/audit-backend-arch-v4.js');

if (auditSrc) {

  // I-BACK-2 : fichiers trop grands
  const largeFiles = extractSet(auditSrc, 'ALLOWED_LARGE_FILES');
  addDebt({
    rule: 'I-BACK-2',
    label: 'Fichiers > 800 lignes (à décomposer)',
    lot: 'Lot B / B1-B6',
    entries: largeFiles,
    note: 'Extraction engines + routes volumineuses',
  });

  // I-BACK-3/4/12/14 : COLUMN_OWNERSHIP allowlists
  const colAllowlists = extractColumnOwnershipAllowlists(auditSrc);
  const colRuleMap = {
    'orders.status':        { rule: 'I-BACK-3',  label: 'Écritures orders.status hors machine à états' },
    'orders.payment_status':{ rule: 'I-BACK-4',  label: 'Écritures orders.payment_status hors payment-service' },
    'wallet_transactions':  { rule: 'I-BACK-12', label: 'Écritures wallet_transactions hors wallet-service' },
    'store_credits':        { rule: 'I-BACK-12', label: 'Écritures store_credits hors store-credit-service' },
    'parcels.status':       { rule: 'I-BACK-14', label: 'Écritures parcels.status hors parcelSync' },
  };
  for (const { id, entries } of colAllowlists) {
    // Exclure les scripts utilitaires communs (seed, fix-schema) du décompte — toujours légitimes
    const realDebt = entries.filter(e => !['scripts/fix-schema.js','scripts/seed.js','scripts/reset-admin.js'].includes(e));
    if (realDebt.length === 0) continue;
    const meta = colRuleMap[id] || { rule: 'I-BACK-?', label: `Colonne ${id}` };
    addDebt({
      rule: meta.rule,
      label: meta.label,
      lot: 'Exception documentée (voir commentaire in-source)',
      entries: realDebt,
      note: 'scripts/seed.js et fix-schema.js exclus (toujours légitimes)',
    });
  }

  // I-BACK-6 : engine routes
  const engineRoutes = extractSet(auditSrc, 'ALLOWED_ENGINE_ROUTES');
  addDebt({
    rule: 'I-BACK-6',
    label: 'Engines dans routes/ (à migrer vers services/)',
    lot: 'Lot B1 (sourcing-engine, sourcing-scanner) + Lot B2 (economic-engine)',
    entries: engineRoutes,
  });

  // I-BACK-7 : console.log baseline
  const baselineMatch = auditSrc.match(/const CONSOLE_LOG_BASELINE\s*=\s*\{([^}]*)\}/s);
  const baselineContent = baselineMatch ? baselineMatch[1].trim() : '';
  const baselineEntries = baselineContent
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, '').trim())
    .filter(l => l && !l.startsWith('}') && !l.startsWith('{') && l.includes(':'));
  const totalConsoleLog = baselineEntries.reduce((sum, l) => {
    const n = parseInt(l.match(/:\s*(\d+)/)?.[1] || '0', 10);
    return sum + n;
  }, 0);
  addDebt({
    rule: 'I-BACK-7',
    label: 'console.log existants (baseline figée 2026-05-17)',
    lot: 'Lot F1',
    entries: baselineEntries,
    note: baselineEntries.length === 0
      ? 'Baseline vide — tous les fichiers existants sont à 0 console.log ou baseline non générée'
      : `Total occurrences tolérées : ${totalConsoleLog}`,
  });

  // I-BACK-13 : DELETE/TRUNCATE non borné
  const destructiveSql = extractSet(auditSrc, 'ALLOWED_DESTRUCTIVE_SQL');
  // Ne compter que les non-scripts (routes/ et services/ = vraie dette)
  const destructiveDebt = destructiveSql.filter(e => !e.startsWith('scripts/'));
  if (destructiveDebt.length > 0) {
    addDebt({
      rule: 'I-BACK-13',
      label: 'DELETE/TRUNCATE sans WHERE en dehors des scripts',
      lot: 'Revue individuelle requise',
      entries: destructiveDebt,
      note: 'scripts/seed.js et fix-schema.js exclus (intentionnel)',
    });
  } else {
    addDebt({
      rule: 'I-BACK-13',
      label: 'DELETE/TRUNCATE sans WHERE',
      lot: '—',
      entries: [],
      note: `${destructiveSql.length} entrée(s) allowlistée(s) — toutes dans scripts/ (légitimes)`,
    });
  }

} else {
  debts.push({ rule: '?', label: 'audit-backend-arch.js introuvable', lot: '—', count: 0, entries: [], note: '' });
}

// ── 2. code-quality-gate.js ───────────────────────────────────

const cqSrc = readFile('scripts/code-quality-gate.js');
if (cqSrc) {
  // RULE_FILE_EXEMPT (allowlist fichiers par règle)
  const exemptMatch = cqSrc.match(/const RULE_FILE_EXEMPT\s*=\s*\{([^}]+)\}/s);
  const exemptEntries = [];
  if (exemptMatch) {
    const block = exemptMatch[1];
    const lineRe = /'(N2-[^']+)':\s*new Set\(\[([^\]]*)\]\)/gs;
    let m;
    while ((m = lineRe.exec(block)) !== null) {
      const rule = m[1];
      const files = m[2]
        .split('\n')
        .map(l => l.replace(/\/\/.*$/, '').trim().replace(/['"`,]/g, ''))
        .filter(Boolean);
      for (const f of files) exemptEntries.push(`${rule} → ${f}`);
    }
  }
  addDebt({
    rule: 'N2 (fichiers exemptés)',
    label: 'Fichiers avec exception de règle N2 (RULE_FILE_EXEMPT)',
    lot: 'Infrastructure bas niveau — légitimes',
    entries: exemptEntries,
    note: 'console.log autorisé dans logger/error-handler (bootstrap pino)',
  });

  // Inline quality-disable
  const SCAN_DIRS = ['services', 'routes', 'middleware', 'utils', 'validators', 'core', 'public/dashboards/admin/js'];
  const inlineDisables = countInlineDisables(SCAN_DIRS, ROOT);
  const totalInline = Object.values(inlineDisables).reduce((a, b) => a + b, 0);
  if (totalInline > 0) {
    const inlineEntries = Object.entries(inlineDisables)
      .sort((a, b) => b[1] - a[1])
      .map(([rule, n]) => `${rule} : ${n} occurrence(s)`);
    addDebt({
      rule: 'N2 (inline disables)',
      label: 'Suppressions inline // quality-disable dans le code',
      lot: 'Revue au cas par cas',
      entries: inlineEntries,
      note: `${totalInline} suppression(s) totale(s) — chacune est une exception locale documentée`,
    });
  }

  // Baseline code-quality (si elle existe)
  const cqBaseline = readJson('scripts/code-quality-baseline.json');
  if (cqBaseline) {
    const totalErrors   = cqBaseline.totalErrors   || 0;
    const totalWarnings = cqBaseline.totalWarnings || 0;
    const fileCount     = Object.keys(cqBaseline.files || {}).length;
    addDebt({
      rule: 'N2 (baseline)',
      label: 'Violations N2 figées dans la baseline',
      lot: 'Correction progressive — relance npm run quality:gate pour mesurer',
      entries: [`${totalErrors} erreur(s), ${totalWarnings} avertissement(s) dans ${fileCount} fichier(s)`],
      note: `Baseline sauvegardée le ${cqBaseline.savedAt || '?'}`,
    });
  }
}

// ── 3. test-exemptions.json ───────────────────────────────────

const testExemptions = readJson('governance/test-exemptions.json');
if (testExemptions) {
  const entries = Object.entries(testExemptions)
    .filter(([k]) => !k.startsWith('_'))
    .map(([file, reason]) => `${file} — ${reason}`);
  addDebt({
    rule: 'N3 (test-exemptions)',
    label: 'Fichiers exemptés du gate touched-tests',
    lot: 'Glue/bootstrap — légitimes mais à revalider à chaque modification',
    entries,
    note: 'Toute exemption doit être revue si le fichier évolue',
  });
}

// ── 4. arch-debt-budget.json ──────────────────────────────────

const archBudget = readJson('scripts/arch-debt-budget.json');
if (archBudget) {
  const ratchet = archBudget.ratchet || {};

  const ratchetEntries = Object.entries(ratchet)
    .filter(([k]) => !k.startsWith('_'))
    .map(([key, val]) => `${key} = ${val}`);

  addDebt({
    rule: 'ARCH (ratchet)',
    label: 'Clichets d\'architecture (arch-debt-budget.json)',
    lot: 'arch-reconcile.js abaisse automatiquement — jamais relevé',
    entries: ratchetEntries,
    note: ratchetEntries.every(e => e.endsWith('= 0'))
      ? '✅ Tous les clichets sont à 0 — dette d\'architecture fermée'
      : '⚠️  Certains clichets sont > 0 — voir arch-reconcile',
  });

  const allowlistEntries = Object.entries(archBudget.knownDriftAllowlist || {})
    .filter(([k]) => !k.startsWith('_') && k !== '(none)');
  if (allowlistEntries.length > 0) {
    addDebt({
      rule: 'ARCH (drift allowlist)',
      label: 'Tables fictives figées (knownDriftAllowlist)',
      lot: 'Résoudre en DB ou re-tagger le header — arch-reconcile élague auto',
      entries: allowlistEntries.map(([k, v]) => `${k} — ${v}`),
    });
  }
}

// ── 5. Baselines feature-guard et 360 ────────────────────────

const baselineFiles = [
  { file: 'scripts/feature-guard-baseline.json', label: 'Feature-guard baseline' },
  { file: 'scripts/.dashboards-360-baseline.json', label: 'Dashboards-360 baseline' },
  { file: 'scripts/.boutique-360-baseline.json',   label: 'Boutique-360 baseline' },
  { file: 'scripts/.security-360-baseline.json',   label: 'Security-360 baseline' },
  { file: 'scripts/.meta-graph-baseline.json',     label: 'Meta-graph baseline' },
];

for (const { file, label } of baselineFiles) {
  const data = readJson(file);
  if (!data) continue;
  // Cherche des compteurs de dette dans la baseline
  const errorCount = typeof data.totalErrors === 'number' ? data.totalErrors : null;
  const warnCount  = typeof data.totalWarnings === 'number' ? data.totalWarnings : null;
  // feature-guard-baseline : { sliceName: { errors, warnings } }
  const sliceTotal = typeof data === 'object' && !Array.isArray(data) && errorCount === null
    ? Object.entries(data)
        .filter(([k]) => !k.startsWith('_'))
        .reduce((acc, [, v]) => {
          if (v && typeof v === 'object') {
            acc.errors   += (v.errors   || 0);
            acc.warnings += (v.warnings || 0);
          }
          return acc;
        }, { errors: 0, warnings: 0 })
    : null;

  const summary = errorCount !== null
    ? [`${errorCount} erreur(s), ${warnCount ?? '?'} avertissement(s)`]
    : sliceTotal
      ? [`${sliceTotal.errors} erreur(s), ${sliceTotal.warnings} avertissement(s) cumulés sur ${Object.keys(data).filter(k => !k.startsWith('_')).length} slices`]
      : ['(format inconnu — voir fichier)'];

  if (summary[0].startsWith('0 erreur(s), 0')) continue; // rien à signaler

  addDebt({
    rule: label,
    label: `Violations figées dans ${path.basename(file)}`,
    lot: 'Correction progressive',
    entries: summary,
    note: `Fichier : ${file}`,
  });
}

// ════════════════════════════════════════════════════════════════
// SYNTHÈSE & RAPPORT
// ════════════════════════════════════════════════════════════════

const totalDebtItems = debts.reduce((sum, d) => sum + d.count, 0);
const openDebts = debts.filter(d =>
  d.count > 0 &&
  !d.note.startsWith('✅') &&
  !d.lot.includes('légitime') &&
  !d.lot.startsWith('Exception documentée') &&  // exceptions in-source délibérées
  d.lot !== 'Revue individuelle requise'          // exceptions routes admin documentées
);

if (JSON_MODE) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalDebtItems,
    openDebtsCount: openDebts.length,
    debts,
  }, null, 2));
  process.exit(0);
}

// ── Rapport console ────────────────────────────────────────────

const W = 72;
const line  = '═'.repeat(W);
const dline = '─'.repeat(W);

console.log('');
console.log(`╔${line}╗`);
console.log(`║  KOMERCE — Rapport de dette technique${' '.repeat(W - 38)}║`);
console.log(`║  ${new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' })}${' '.repeat(W - 2 - new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' }).length)}║`);
console.log(`╚${line}╝`);
console.log('');
console.log(`  Entrées de dette totales   : ${totalDebtItems}`);
console.log(`  Règles avec dette ouverte  : ${openDebts.length} / ${debts.length}`);
console.log('');
console.log(`  ℹ  Ce rapport est informatif — il ne bloque jamais la CI.`);
console.log(`     Pour bloquer sur régressions, utiliser les gates dédiés.`);
console.log('');

for (const debt of debts) {
  const icon = debt.count === 0 || debt.note.startsWith('✅') ? '✅' : '⚠️ ';
  console.log(`${dline}`);
  console.log(`${icon}  ${debt.rule}  —  ${debt.label}`);
  if (debt.lot && debt.lot !== '—') console.log(`   Lot : ${debt.lot}`);
  if (debt.note) console.log(`   Note : ${debt.note}`);
  if (debt.entries.length > 0) {
    console.log(`   Entrées (${debt.count}) :`);
    const preview = debt.entries.slice(0, 8);
    for (const e of preview) console.log(`     • ${e}`);
    if (debt.entries.length > 8) console.log(`     … et ${debt.entries.length - 8} autres`);
  } else {
    console.log('   (aucune entrée)');
  }
  console.log('');
}

console.log(dline);
console.log('');
if (openDebts.length === 0) {
  console.log('  ✅  Aucune dette ouverte. Tous les allowlists sont légitimes ou fermés.');
} else {
  console.log(`  📋  ${openDebts.length} poste(s) de dette à traiter :`);
  for (const d of openDebts) {
    console.log(`     • ${d.rule} (${d.count} entrée(s)) → ${d.lot}`);
  }
}
console.log('');
console.log('  Pour un rapport machine : node scripts/debt-audit.js --json');
console.log('');

process.exit(0);
