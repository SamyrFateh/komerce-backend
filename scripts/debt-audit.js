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
 *   • audit-backend-arch.js     → COLUMN_OWNERSHIP (auto-découverte), allowlists I-BACK-*
 *   • code-quality-gate.js      → RULE_FILE_EXEMPT + inline quality-disable
 *   • governance/test-exemptions.json
 *   • scripts/arch-debt-budget.json
 *   • scripts/code-quality-baseline.json  (si présente)
 *   • scripts/.*baseline*.json  (tous les gates avec baseline — auto-découverte)
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
  const re = new RegExp(`(?:const|var|let)\\s+${varName}\\s*=\\s*new Set\\(\\[([^\\]]*?)\\]\\)`, 's');
  const m = src.match(re);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, '').trim().replace(/['"`,]/g, ''))
    .filter(Boolean);
}

/**
 * Auto-découverte : parse COLUMN_OWNERSHIP depuis la source de audit-backend-arch.js.
 * Extrait { id, rule, remedy, allowlist[] } pour chaque entrée — sans map statique.
 * Si audit-backend-arch expose un RULE_LABELS, on s'en sert pour les labels.
 */
function extractColumnOwnership(src) {
  const results = [];
  const colOwnerRe = /\{\s*id:\s*'([^']+)'[\s\S]*?rule:\s*'([^']+)'[\s\S]*?allowlist:\s*new Set\(\[([^\]]*?)\]\)[\s\S]*?remedy:\s*'([^']+)'/gs;
  let m;
  while ((m = colOwnerRe.exec(src)) !== null) {
    const id      = m[1];
    const rule    = m[2];
    const remedy  = m[4];
    const entries = m[3]
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, '').trim().replace(/['"`,]/g, ''))
      .filter(Boolean);
    results.push({ id, rule, remedy, entries });
  }
  return results;
}

/**
 * Auto-découverte : extrait RULE_LABELS depuis la source de audit-backend-arch.js.
 * Retourne un Map rule → label, ou Map vide si absent.
 */
function extractRuleLabels(src) {
  const map = {};
  const blockRe = /const RULE_LABELS\s*=\s*\{([^}]+)\}/s;
  const bm = src.match(blockRe);
  if (!bm) return map;
  const lineRe = /'(I-BACK-\d+)':\s*'([^']+)'/g;
  let m;
  while ((m = lineRe.exec(bm[1])) !== null) map[m[1]] = m[2];
  return map;
}

/**
 * Auto-découverte : liste tous les dossiers sources JS existants dans ROOT,
 * en excluant les dossiers non-source connus.
 * Remplace la liste SCAN_DIRS statique.
 */
function discoverSourceDirs() {
  const EXCLUDE = new Set([
    'node_modules', '.git', 'scripts', 'tests', 'migrations',
    'docs', 'governance', 'features', 'coverage', 'dist', 'bootstrap',
  ]);
  const dirs = [];
  let entries;
  try { entries = fs.readdirSync(ROOT, { withFileTypes: true }); }
  catch { return []; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (EXCLUDE.has(e.name) || e.name.startsWith('.')) continue;
    // Ne garder que les dossiers qui contiennent au moins un .js
    const full = path.join(ROOT, e.name);
    if (hasJsFiles(full)) dirs.push(e.name);
  }
  // Ajouter les sous-dossiers standards connus (profondeur 2 non récursive)
  const KNOWN_SUBDIRS = ['public/dashboards/admin/js', 'dashboards/admin/js'];
  for (const sub of KNOWN_SUBDIRS) {
    const full = path.join(ROOT, sub);
    if (fs.existsSync(full) && hasJsFiles(full)) dirs.push(sub);
  }
  return dirs;
}

function hasJsFiles(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.some(e => e.isFile() && e.name.endsWith('.js'));
  } catch { return false; }
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

/**
 * Auto-découverte : liste tous les fichiers .*baseline*.json dans scripts/.
 * Dérive le label depuis le nom de fichier.
 * Remplace la liste baselineFiles statique.
 */
function discoverBaselineFiles() {
  const scriptsDir = path.join(ROOT, 'scripts');
  let entries;
  try { entries = fs.readdirSync(scriptsDir, { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter(e => e.isFile() && e.name.startsWith('.') && e.name.includes('baseline') && e.name.endsWith('.json'))
    .map(e => ({
      file: `scripts/${e.name}`,
      label: e.name
        .replace(/^\./, '')
        .replace(/-baseline\.json$/, '')
        .replace(/-/g, ' ')
        // capitalise première lettre
        .replace(/^\w/, c => c.toUpperCase()),
    }));
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

  // I-BACK-2 : séparer la dette historique des exceptions réauditées.
  const largeFiles = extractSet(auditSrc, 'ALLOWED_LARGE_FILES');
  const reviewedLargeFiles = new Set(extractSet(auditSrc, 'REVIEWED_LARGE_FILES'));
  const openLargeFiles = largeFiles.filter(file => !reviewedLargeFiles.has(file));
  if (openLargeFiles.length > 0) {
    addDebt({
      rule: 'I-BACK-2',
      label: 'Fichiers > 800 lignes (à décomposer)',
      lot: 'Lot B / B1-B6',
      entries: openLargeFiles,
      note: 'Entrées grandfathered non encore réauditées',
    });
  }
  const healthyLargeFiles = largeFiles.filter(file => reviewedLargeFiles.has(file));
  if (healthyLargeFiles.length > 0) {
    addDebt({
      rule: 'I-BACK-2 (reviewed)',
      label: 'Fichiers volumineux réaudités et cohésifs',
      lot: 'Exception documentée — revue architecturale 2026-08-28',
      entries: healthyLargeFiles,
      note: 'Conservés grands par cohésion métier ; à revalider seulement si leur responsabilité évolue',
    });
  }

  // I-BACK-3/4/12/14 : COLUMN_OWNERSHIP — auto-découverte depuis la source
  const ruleLabels   = extractRuleLabels(auditSrc);
  const colOwnership = extractColumnOwnership(auditSrc);
  const SCRIPT_LEGIT = new Set(['scripts/fix-schema.js', 'scripts/seed.js', 'scripts/reset-admin.js']);

  for (const { id, rule, remedy, entries } of colOwnership) {
    const realDebt = entries.filter(e => !SCRIPT_LEGIT.has(e));
    if (realDebt.length === 0) continue;
    // label : RULE_LABELS si disponible, sinon construit depuis id + remedy
    const ruleLabel = ruleLabels[rule] || `Propriété ${id}`;
    addDebt({
      rule,
      label: `${ruleLabel} — allowlist hors scripts légitimes`,
      lot: 'Exception documentée (voir commentaire in-source)',
      entries: realDebt,
      note: `Remedy : ${remedy}`,
    });
  }

  // I-BACK-6 : une allowlist nominale n'est fermée que si elle a été réauditée.
  const engineRoutes = extractSet(auditSrc, 'ALLOWED_ENGINE_ROUTES');
  const reviewedEngineRoutes = new Set(extractSet(auditSrc, 'REVIEWED_ENGINE_ROUTE_EXCEPTIONS'));
  const openEngineRoutes = engineRoutes.filter(file => !reviewedEngineRoutes.has(file));
  if (openEngineRoutes.length > 0) {
    addDebt({
      rule: 'I-BACK-6',
      label: 'Engines dans routes/ (à migrer vers services/)',
      lot: 'Lot B1/B2',
      entries: openEngineRoutes,
    });
  }
  const nominalEngineRoutes = engineRoutes.filter(file => reviewedEngineRoutes.has(file));
  if (nominalEngineRoutes.length > 0) {
    addDebt({
      rule: 'I-BACK-6 (reviewed)',
      label: 'Routes au nom historique *-scanner, façade déjà mince',
      lot: 'Exception documentée — dette nominale réauditée',
      entries: nominalEngineRoutes,
      note: 'Le suffixe historique ne correspond plus à une responsabilité engine',
    });
  }

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

  // Inline quality-disable — dossiers sources auto-découverts
  const sourceDirs = discoverSourceDirs();
  const inlineDisables = countInlineDisables(sourceDirs, ROOT);
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
      note: `${totalInline} suppression(s) totale(s) — dossiers scannés : ${sourceDirs.join(', ')}`,
    });
  }

  // Baseline code-quality (si elle existe)
  const cqBaseline = readJson('scripts/code-quality-baseline.json');
  if (cqBaseline) {
    const totalErrors   = cqBaseline.totalErrors   || 0;
    const totalWarnings = cqBaseline.totalWarnings || 0;
    const fileCount     = Object.keys(cqBaseline.files || {}).length;
    if (totalErrors > 0 || totalWarnings > 0) {
      addDebt({
        rule: 'N2 (baseline)',
        label: 'Violations N2 figées dans la baseline',
        lot: 'Correction progressive — relance npm run quality:gate pour mesurer',
        entries: [`${totalErrors} erreur(s), ${totalWarnings} avertissement(s) dans ${fileCount} fichier(s)`],
        note: `Baseline sauvegardée le ${cqBaseline.savedAt || '?'}`,
      });
    }
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

// ── 5. Baselines gates — auto-découverte scripts/.*baseline*.json ──────────

const baselineFiles = discoverBaselineFiles();

for (const { file, label } of baselineFiles) {
  const data = readJson(file);
  if (!data) continue;
  const errorCount = typeof data.totalErrors === 'number' ? data.totalErrors : null;
  const warnCount  = typeof data.totalWarnings === 'number' ? data.totalWarnings : null;
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

  if (summary[0].startsWith('0 erreur(s), 0')) continue;

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
  !d.lot.startsWith('Exception documentée') &&
  d.lot !== 'Revue individuelle requise'
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
