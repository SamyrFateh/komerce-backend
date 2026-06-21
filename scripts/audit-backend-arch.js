#!/usr/bin/env node
/**
 * audit-backend-arch.js — Garde-fou architecture Komerce backend
 *
 * Valide les invariants déclarés dans BACKEND_AUDIT.md §5.
 * Plante (exit 1) si une NOUVELLE violation est introduite.
 * Les violations existantes connues sont en allowlist explicite avec leur lot de correction.
 *
 * Usage : node scripts/audit-backend-arch.js
 *         npm run backend:audit
 *
 * Sortie : exit 0 si tout passe, exit 1 sinon.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ROOT = répertoire courant (lancer depuis la racine du repo)
// ou passer ROOT=... en variable d'environnement
const ROOT       = process.env.ROOT || process.cwd();
const ROUTES_DIR = path.join(ROOT, 'routes');
const SERVICES_DIR = path.join(ROOT, 'services');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const TESTS_DIR  = path.join(ROOT, 'tests');

const violations = [];
const warnings   = [];

function violate(rule, msg, detail) {
  violations.push({ rule, msg, detail });
}
function warn(rule, msg, detail) {
  warnings.push({ rule, msg, detail });
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return ''; }
}

function walkJs(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, results);
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

function countLines(filePath) {
  const content = readFile(filePath);
  return content ? content.split('\n').length : 0;
}

function rel(filePath) {
  return path.relative(ROOT, filePath);
}

// ════════════════════════════════════════════════════════════════
// ALLOWLISTS — violations connues, lots de correction référencés
// ════════════════════════════════════════════════════════════════

// I-BACK-2 : fichiers > 800 lignes existants au 2026-05-17
// Correction prévue : Lot B (extraction engines) + Lot B3/B4/B5
const ALLOWED_LARGE_FILES = new Set([
  'routes/dashboard.js',                         // 2614 l → Lot B4
  'routes/admin.js',                             // 1207 l → Lot B5
  'routes/order-api-v2.js',                      // 532 l  → OK, en dessous du seuil warning
  'routes/parcel-api-v2.js',                     // 1299 l → Lot B (legacy figé)
  'routes/pricing.js',                           // 1316 l → Lot B3
  'routes/pickup-secret.js',                     // 1122 l → Lot B6
  'routes/hub-dashboard.js',                     // 1015 l → Lot B
  'routes/sourcing-engine.js',                   // 960 l  → Lot B1 (cible prioritaire)
  'routes/economic-engine.js',                   // 808 l  → Lot B2
  'routes/admin-radar.js',                       // 894 l  → Lot B
  'routes/scans.js',                             // 835 l  → Lot B
  'routes/admin-dashboard.js',                   // 786 l  → Lot B
  'routes/purchasing.js',                        // 762 l  → Lot B
  'services/pricing-engine.js',                  // 1483 l → Lot B3 (service, acceptable)
  'services/shared-cart-engine.js',              // 1037 l → OK si pas d'extension prévue
  'services/collective-workspace-engine.js',     // 965 l  → OK service
  'services/collective-payment-orchestrator.js', // 942 l  → OK service
  'services/cost-allocation.js',                 // 918 l  → OK service
  'services/scan-engine.js',                     // 872 l  → OK service
  'services/notification-service.js',            // 814 l  → OK service
  'services/dashboard-metrics.js',               // 1052 l → Lot B4
]);

// I-BACK-3 : UPDATE orders SET status= hors order-status-machine.js
// Ces occurrences sont des migrations SQL ou des scripts de fix — légitimes
const ALLOWED_STATUS_UPDATE_FILES = new Set([
  'scripts/fix-schema.js',       // migrations inline légitimes
  'scripts/reset-admin.js',      // script admin one-shot
  'scripts/seed.js',             // seed de données test
]);

// I-BACK-4 : UPDATE orders SET payment_status= hors order-status-machine.js
// La machine à états elle-même set payment_status — c'est son rôle.
const ALLOWED_PAYMENT_STATUS_FILES = new Set([
  'services/order-status-machine.js', // owner légitime (machine à états)
  'services/payment-service.js',       // owner légitime (P3-A : owner cible payment_status)
  'scripts/fix-schema.js',
  'scripts/reset-admin.js',

  // ── Owners paiement reconnus — DETTE TRACÉE → Lot P3-A ──────────────────────
  // Ces 4 services mutent légitimement payment_status aujourd'hui, mais devront
  // être centralisés derrière services/payment-service.js (markPaid/markRefunded/
  // markFailed) pour rendre l'invariant structurel. Allowlist d'intention : le
  // cliquet bloque toujours tout NOUVEAU site non listé.
  'services/payment-paypal.js',            // refund PayPal ('refunded' + status)
  'services/admin-order-refund.js',        // refund admin ('refunded')
  'services/payment-stripe.js',            // échec paiement ('failed', gardé pending→failed)
  'services/parcel-auto-create-service.js',// paiement cash confirmé ('paid' + cash_paid_at)

  // ── Outil de test/chaos — PAS de la prod paiement ──────────────────────────
  // Pose volontairement des états (in)cohérents pour les scénarios de simulation.
  // Ne doit PAS passer par payment-service.js (ce serait dénaturer le chaos-testing).
  'services/simulator/state-advancer.js',
]);

// I-BACK-6 : routes/X-engine.js — engines dans routes/ (à migrer vers services/)
// Allowlist temporaire — correction prévue Lot B1 et B2
const ALLOWED_ENGINE_ROUTES = new Set([
  'routes/sourcing-engine.js',   // → Lot B1 (priorité absolue)
  'routes/economic-engine.js',   // → Lot B2
  'routes/sourcing-scanner.js',  // → Lot B1 (lié)
]);

// I-BACK-7 : console.log dans routes/ et services/
// 365 occurrences existantes au 2026-05-17 — correction Lot F1
// Le garde-fou bloque uniquement les NOUVEAUX fichiers qui dépassent un seuil
// (on ne peut pas bloquer les fichiers existants sans casser la CI immédiatement)
const CONSOLE_LOG_BASELINE = {
  // fichier → nombre de console.log tolérés (snapshot du 2026-05-17)
  // Tout fichier NON listé → tolérance 0 (nouveaux fichiers)
  // Mis à jour automatiquement par : npm run backend:arch (gen-backend-arch-live.js)
};

// I-BACK-8 : queries SQL non-paramétrées légitimes (savepoints, DDL)
const ALLOWED_RAW_SQL_PATTERNS = [
  /SAVEPOINT\s+\w+/i,
  /RELEASE\s+SAVEPOINT/i,
  /ROLLBACK\s+TO\s+SAVEPOINT/i,
  /CREATE\s+(TABLE|INDEX|SEQUENCE)/i,
  /ALTER\s+TABLE/i,
  /DROP\s+(TABLE|INDEX)/i,
];

// ════════════════════════════════════════════════════════════════
// I-BACK-1 — Aucun fichier doublon actif dans routes/
// ════════════════════════════════════════════════════════════════
function checkI1_noDuplicates() {
  const routesRoot = fs.existsSync(ROUTES_DIR)
    ? fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js'))
    : [];
  const ordersDir = path.join(ROUTES_DIR, 'orders');
  const routesOrders = fs.existsSync(ordersDir)
    ? fs.readdirSync(ordersDir).filter(f => f.endsWith('.js'))
    : [];
  const serverJs = readFile(path.join(ROOT, 'server.js'));

  for (const file of routesRoot) {
    if (!routesOrders.includes(file)) continue;
    const base = file.replace('.js', '');
    // Chercher require('./routes/X') ou require('./routes/orders/X')
    const rootRef   = serverJs.includes(`routes/${base}`) || serverJs.includes(`routes/${file}`);
    const nestedRef = serverJs.includes(`routes/orders/${base}`) || serverJs.includes(`routes/orders/${file}`);

    if (rootRef && nestedRef) {
      violate('I-BACK-1',
        `Doublon actif : routes/${file} ET routes/orders/${file} montés tous les deux`,
        'Identifier le fichier de référence et supprimer l\'autre'
      );
    }
    // Si un seul est monté (ou aucun via orders.js) → OK
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-2 — Aucun nouveau fichier .js > 800 lignes (warning) / > 1500 (erreur)
// ════════════════════════════════════════════════════════════════
function checkI2_fileSize() {
  const files = [...walkJs(ROUTES_DIR), ...walkJs(SERVICES_DIR)];
  for (const file of files) {
    const relPath = rel(file);
    const lines   = countLines(file);
    if (lines > 1500 && !ALLOWED_LARGE_FILES.has(relPath)) {
      violate('I-BACK-2',
        `${relPath} — ${lines} lignes (seuil erreur : 1500)`,
        'Extraire la logique métier dans services/'
      );
    } else if (lines > 800 && !ALLOWED_LARGE_FILES.has(relPath)) {
      warn('I-BACK-2',
        `${relPath} — ${lines} lignes (seuil warning : 800)`,
        'À surveiller — découper avant extension'
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-3 — UPDATE orders SET status hors order-status-machine.js
// ════════════════════════════════════════════════════════════════
function checkI3_statusMachineOnly() {
  const files = [...walkJs(ROUTES_DIR), ...walkJs(SERVICES_DIR)];
  const pattern = /UPDATE\s+orders\s+SET\s+status\s*=/i;

  for (const file of files) {
    const relPath = rel(file);
    if (relPath === 'services/order-status-machine.js') continue;
    if (ALLOWED_STATUS_UPDATE_FILES.has(relPath)) continue;

    const content = readFile(file);
    const lines   = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i]) && !lines[i].trim().startsWith('//')) {
        violate('I-BACK-3',
          `${relPath}:${i + 1} — UPDATE orders SET status= hors order-status-machine.js`,
          'Passer par transitionOrderStatus() de services/order-status-machine.js'
        );
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-4 — UPDATE orders SET payment_status hors owners légitimes
// ════════════════════════════════════════════════════════════════
function checkI4_paymentStatusOwner() {
  const files = [...walkJs(ROUTES_DIR), ...walkJs(SERVICES_DIR)];
  const pattern = /UPDATE\s+orders\s+SET\s+payment_status\s*=/i;

  for (const file of files) {
    const relPath = rel(file);
    if (ALLOWED_PAYMENT_STATUS_FILES.has(relPath)) continue;

    const content = readFile(file);
    const lines   = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i]) && !lines[i].trim().startsWith('//')) {
        violate('I-BACK-4',
          `${relPath}:${i + 1} — UPDATE orders SET payment_status= hors owner légitime`,
          'Passer par order-status-machine.js ou le futur payment-service.js'
        );
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-5 — Toute route /admin/* doit avoir authenticate + requireRole/requireAdmin
// ════════════════════════════════════════════════════════════════
function checkI5_adminAuth() {
  // Vérification structurelle : chaque fichier routes/admin*.js
  // doit déclarer un guard [authenticate, requireRole(...)] utilisé sur toutes ses routes
  const adminFiles = fs.existsSync(ROUTES_DIR)
    ? fs.readdirSync(ROUTES_DIR)
        .filter(f => f.startsWith('admin') && f.endsWith('.js'))
        .map(f => path.join(ROUTES_DIR, f))
    : [];

  for (const file of adminFiles) {
    const content = readFile(file);
    const relPath = rel(file);

    // Façade / fichier de montage : ne déclare aucune route propre
    // (ex. routes/admin.js = `module.exports = require('./admin/index')`).
    // Les guards vivent dans les fichiers délégués, vérifiés là où ils sont.
    // Vérifier un tel fichier pour des tokens de guard est un faux positif.
    const declaresRoutes = /\brouter\.(get|post|put|delete|patch)\s*\(/.test(content);
    if (!declaresRoutes) continue;

    const hasAuthenticate = /authenticate/.test(content);
    const hasRequireRole  = /requireRole|requireAdmin|isAdmin/.test(content);

    if (!hasAuthenticate || !hasRequireRole) {
      violate('I-BACK-5',
        `${relPath} — fichier admin sans authenticate ou requireRole déclaré`,
        'Ajouter [authenticate, requireRole([\'admin\'])] sur toutes les routes'
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-6 — Aucun routes/X-engine.js non autorisé
// ════════════════════════════════════════════════════════════════
function checkI6_noEngineInRoutes() {
  if (!fs.existsSync(ROUTES_DIR)) return;
  const engineFiles = fs.readdirSync(ROUTES_DIR)
    .filter(f => f.endsWith('-engine.js') || f.endsWith('-scanner.js'));

  for (const file of engineFiles) {
    const relPath = `routes/${file}`;
    if (!ALLOWED_ENGINE_ROUTES.has(relPath)) {
      violate('I-BACK-6',
        `${relPath} — engine ou scanner dans routes/ (doit vivre dans services/)`,
        'Extraire la logique dans services/ et ne garder qu\'un thin router'
      );
    } else {
      warn('I-BACK-6',
        `${relPath} — engine en routes/ (connu, lot B prévu)`,
        'À migrer dans services/ — voir Lot B1/B2'
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-7 — Aucun console.log dans de NOUVEAUX fichiers routes/ ou services/
// Stratégie : on ne bloque pas les fichiers existants (365 occurrences connues)
// mais tout nouveau fichier créé après le 2026-05-17 doit être propre
// ════════════════════════════════════════════════════════════════
function checkI7_noConsoleLog() {
  const BASELINE_DATE = new Date('2026-05-17T00:00:00Z');
  const pattern       = /console\.(log|debug)\s*\(/;
  const files         = [...walkJs(ROUTES_DIR), ...walkJs(SERVICES_DIR)];

  for (const file of files) {
    const stat    = fs.statSync(file);
    const created = stat.birthtime || stat.mtime;
    if (created <= BASELINE_DATE) continue; // fichier existant — toléré

    const relPath = rel(file);
    const content = readFile(file);
    const lines   = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i]) && !lines[i].trim().startsWith('//')) {
        violate('I-BACK-7',
          `${relPath}:${i + 1} — console.log/debug dans nouveau fichier`,
          'Utiliser logger.info/warn/error depuis utils/logger.js'
        );
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-8 — Aucune query SQL avec interpolation ${variable} non autorisée
// ════════════════════════════════════════════════════════════════
function checkI8_noRawSqlInterpolation() {
  const files = [...walkJs(ROUTES_DIR), ...walkJs(SERVICES_DIR)];
  // Contexte SQL : template literal avec un mot SQL ET une interpolation ${...}
  const sqlCtx = /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b[^`]*\$\{[^}]+\}[^`]*`/i;

  // VRAIE injection : une valeur interpolée non paramétrée — entre quotes,
  // ou directement après un comparateur. La lookbehind (?<!\$) exclut les
  // placeholders `$${i}` (qui produisent $1, $2 — donc déjà paramétrés).
  const valueInjection = /(['"]\s*(?<!\$)\$\{[^}]+\}|[=<>]\s*(?<!\$)\$\{[^}]+\}|\bLIKE\s+(?<!\$)\$\{|\bIN\s*\(\s*(?<!\$)\$\{)/i;

  // Identifiant interpolé (table/colonne) — NON paramétrable par nature.
  // Sûr seulement si la source est une whitelist littérale. On surveille (warn),
  // on ne bloque pas, car le codebase le fait via des maps/tableaux en dur.
  const identifierInterp = /\b(FROM|JOIN|INTO|UPDATE|TABLE|ORDER\s+BY)\s+(?<!\$)\$\{[^}]+\}/i;

  // Bruit : lignes de log (le mot "from"/"where" y déclenche faussement sqlCtx).
  const isLogLine = l => /\b(log|logger|console)\s*\.\s*(log|info|warn|error|debug)\s*\(/.test(l);

  for (const file of files) {
    const relPath = rel(file);
    const content = readFile(file);
    const lines   = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//')) continue;
      if (!sqlCtx.test(line)) continue;
      if (isLogLine(line)) continue;
      if (ALLOWED_RAW_SQL_PATTERNS.some(p => p.test(line))) continue;

      if (valueInjection.test(line)) {
        violate('I-BACK-8',
          `${relPath}:${i + 1} — valeur interpolée non paramétrée dans une requête SQL`,
          'Injection possible : utiliser des paramètres $1, $2, ... avec [value1, value2]'
        );
      } else if (identifierInterp.test(line)) {
        warn('I-BACK-8',
          `${relPath}:${i + 1} — identifiant SQL interpolé (table/colonne)`,
          'Vérifier que la source est une whitelist littérale, jamais une entrée utilisateur'
        );
      }
      // sinon : clause structurelle (`WHERE ${where}`, `(${cols})`) bâtie avec
      // des $N — sûre par construction, non signalée.
    }
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-9 — Aucun fichier test à la racine du repo
// ════════════════════════════════════════════════════════════════
function checkI9_noOrphanTests() {
  const rootFiles = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.js') && (f.startsWith('test') || f.endsWith('.test.js')));

  for (const file of rootFiles) {
    violate('I-BACK-9',
      `${file} — fichier test à la racine (doit être dans tests/)`,
      'git mv ${file} tests/integration/${file}'
    );
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-10 — Aucune collision de numéro dans migrations/
// ════════════════════════════════════════════════════════════════
function checkI10_noMigrationCollisions() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files  = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));

  // Convention intentionnelle : 015b_, 016b_, 037b_ etc. = addendums numérotés → OK
  // Vrai doublon : NNN.sql (bare, sans description) coexiste avec NNN_description.sql
  // → le bare file est ambigu sur l'ordre d'exécution
  const bareFiles = files.filter(f => /^\d+\.sql$/.test(f)); // ex: 060.sql

  for (const bare of bareFiles) {
    const num = bare.replace('.sql', '');
    const siblings = files.filter(f => f !== bare && f.startsWith(`${num}_`));
    if (siblings.length > 0) {
      violate('I-BACK-10',
        `Collision migration : ${bare} et ${siblings.join(', ')}`,
        `Renommer ${bare} en ${num}_description.sql (même contenu, nom explicite)`
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════
// RUN ALL CHECKS
// ════════════════════════════════════════════════════════════════

console.log('\n  🔍  Audit architecture Komerce backend\n');

checkI1_noDuplicates();
checkI2_fileSize();
checkI3_statusMachineOnly();
checkI4_paymentStatusOwner();
checkI5_adminAuth();
checkI6_noEngineInRoutes();
checkI7_noConsoleLog();
checkI8_noRawSqlInterpolation();
checkI9_noOrphanTests();
checkI10_noMigrationCollisions();

// ════════════════════════════════════════════════════════════════
// RAPPORT
// ════════════════════════════════════════════════════════════════

const RULE_LABELS = {
  'I-BACK-1':  'Doublons de fichiers actifs',
  'I-BACK-2':  'Taille des fichiers',
  'I-BACK-3':  'Propriété UPDATE orders.status',
  'I-BACK-4':  'Propriété UPDATE orders.payment_status',
  'I-BACK-5':  'Auth routes admin',
  'I-BACK-6':  'Engines dans routes/',
  'I-BACK-7':  'console.log dans nouveaux fichiers',
  'I-BACK-8':  'Queries SQL non-paramétrées',
  'I-BACK-9':  'Tests orphelins à la racine',
  'I-BACK-10': 'Collisions numéros migrations',
};

if (warnings.length > 0) {
  console.log(`  ⚠️   ${warnings.length} avertissement(s) (violations connues — lots prévus) :\n`);
  const warnByRule = warnings.reduce((acc, w) => {
    (acc[w.rule] = acc[w.rule] || []).push(w);
    return acc;
  }, {});
  for (const [rule, items] of Object.entries(warnByRule)) {
    console.log(`  ── ${RULE_LABELS[rule] || rule} ── (${items.length})`);
    items.slice(0, 3).forEach(w => {
      console.log(`     ⚠  ${w.msg}`);
      if (w.detail) console.log(`       ${w.detail}`);
    });
    if (items.length > 3) console.log(`     … et ${items.length - 3} autres.`);
    console.log('');
  }
}

if (violations.length === 0) {
  console.log('  ✅  Aucune violation. Architecture conforme.\n');
  process.exit(0);
}

console.log(`  ❌  ${violations.length} violation(s) nouvelle(s) détectée(s) :\n`);

const byRule = violations.reduce((acc, v) => {
  (acc[v.rule] = acc[v.rule] || []).push(v);
  return acc;
}, {});

for (const [rule, items] of Object.entries(byRule)) {
  console.log(`  ── ${RULE_LABELS[rule] || rule} ── (${items.length})`);
  items.slice(0, 5).forEach(v => {
    console.log(`     ✗  ${v.msg}`);
    if (v.detail) console.log(`       → ${v.detail}`);
  });
  if (items.length > 5) console.log(`     … et ${items.length - 5} autres.`);
  console.log('');
}

console.log('  → corrige et relance `npm run backend:audit`.\n');
process.exit(1);
