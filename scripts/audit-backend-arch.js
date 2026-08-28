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
  // Normaliser en forward-slash : sur Windows, path.relative() renvoie des
  // backslashes, ce qui casse toute comparaison Set.has(relPath) contre les
  // allowlists (écrites en forward-slash) — ex. services/payment-service.js
  // n'est plus reconnu comme owner légitime → faux I-BACK-4 bloquant.
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

// ════════════════════════════════════════════════════════════════
// ALLOWLISTS — violations connues, lots de correction référencés
// ════════════════════════════════════════════════════════════════

// I-BACK-2 : exception de taille explicitement réauditée le 2026-08-28.
// Les 16 anciennes entrées ont été supprimées : elles sont désormais <800 lignes
// ou n'existent plus. scan-engine.js reste volontairement monolithique : state
// machine de scan cohésive, testée et sans contournement de lifecycle owner.
const ALLOWED_LARGE_FILES = new Set([
  'services/scan-engine.js', // 935L au 2026-08-28 — KEEP_LARGE, vigilance si content verification grossit
]);

// Sous-ensemble réaudité : exception saine, pas dette à résorber. Toute future
// entrée ajoutée à ALLOWED_LARGE_FILES reste une dette ouverte tant qu'elle
// n'est pas explicitement revue ici.
const REVIEWED_LARGE_FILES = new Set([
  'services/scan-engine.js', // audit 2026-08-28 : state machine cohésive, owners respectés, KEEP_LARGE
]);

// ════════════════════════════════════════════════════════════════
// MATRICE DE PROPRIÉTÉ DES COLONNES SENSIBLES
// Remplace les anciens ALLOWED_STATUS_UPDATE_FILES (I-BACK-3),
// ALLOWED_PAYMENT_STATUS_FILES (I-BACK-4) et ALLOWED_WALLET_WRITERS
// (I-BACK-12) par une configuration déclarative unique.
//
// Format par entrée :
//   id          — identifiant de règle (ex: 'orders.status')
//   rule        — code I-BACK affiché dans le rapport
//   ops         — opérations surveillées : 'UPDATE', 'INSERT'
//   table       — nom de la table SQL
//   column      — nom de la colonne (null = toute écriture sur la table)
//   owners      — fichiers autorisés à écrire (chemins repo-relatifs)
//   allowlist   — fichiers supplémentaires tolérés (scripts, exceptions documentées)
//   remedy      — message d'aide affiché en cas de violation
// ════════════════════════════════════════════════════════════════
const COLUMN_OWNERSHIP = [
  {
    id:      'orders.status',
    rule:    'I-BACK-3',
    ops:     ['UPDATE'],
    table:   'orders',
    column:  'status',
    owners:  new Set(['services/order-status-machine.js']),
    allowlist: new Set([
      'scripts/fix-schema.js',
      'scripts/reset-admin.js',
      'scripts/seed.js',
    ]),
    remedy: 'Passer par transitionOrderStatus() de services/order-status-machine.js',
  },
  {
    id:      'orders.payment_status',
    rule:    'I-BACK-4',
    ops:     ['UPDATE'],
    table:   'orders',
    column:  'payment_status',
    owners:  new Set([
      'services/order-status-machine.js', // owner historique (machine à états)
      'services/payment-service.js',       // owner cible P3-A
    ]),
    allowlist: new Set([
      'scripts/fix-schema.js',
      'scripts/reset-admin.js',
      // ── Chaos-testing — PAS de la prod paiement ──────────────────────────
      // Pose volontairement des états incohérents. Ne doit PAS passer par
      // payment-service.js (ce serait dénaturer le chaos-testing).
      'services/simulator/state-advancer.js',
    ]),
    remedy: 'Passer par services/payment-service.js (markPaid/markRefunded/markFailed)',
  },
  {
    id:      'parcels.status',
    rule:    'I-BACK-14',
    ops:     ['UPDATE'],
    table:   'parcels',
    column:  'status',
    // ── Deux owners légitimes, pas un seul ──────────────────────────────
    // utils/parcelSync.js       : chemin scan (routes/scans.js, routes/hub.js)
    // services/parcel-operations.js::transitionParcelStatus() : chemin générique
    //   (parcel-operations.js, cancelBackorder, admin) — SSOT déclaré dans son
    //   propre header. Découvert manquant de la matrice le 2026-07-11 : ne passait
    //   le gate que par trou de détection (SET dynamique, cf. commentaire plus bas),
    //   pas parce qu'il était autorisé. Vérifié le 2026-07-11 : aucune autre écriture
    //   directe de parcels.status en dehors de ces deux fichiers.
    owners:  new Set(['utils/parcelSync.js', 'services/parcel-operations.js']),
    allowlist: new Set([
      'scripts/fix-schema.js',
      'scripts/seed.js',
      // ── Chaos-testing — même raison que orders.payment_status ci-dessus ──
      'services/simulator/state-advancer.js',
    ]),
    remedy: 'Passer par utils/parcelSync.js (flux scan) ou services/parcel-operations.js::transitionParcelStatus() (flux générique)',
  },
  {
    id:      'wallet_transactions',
    rule:    'I-BACK-12',
    ops:     ['UPDATE', 'INSERT'],
    table:   'wallet_transactions',
    column:  null, // toute écriture sur la table
    owners:  new Set(['services/wallet-service.js']),
    allowlist: new Set([
      'scripts/fix-schema.js',
      'scripts/seed.js',
      // ── Chaos-testing ────────────────────────────────────────────────────
      'services/simulator/state-advancer.js',
    ]),
    remedy: 'Passer par services/wallet-service.js',
  },
  {
    id:      'store_credits',
    rule:    'I-BACK-12',
    ops:     ['UPDATE', 'INSERT'],
    table:   'store_credits',
    column:  null,
    owners:  new Set(['services/store-credit-service.js']),
    allowlist: new Set([
      'scripts/fix-schema.js',
      'scripts/seed.js',
      'services/simulator/state-advancer.js',
    ]),
    remedy: 'Passer par services/store-credit-service.js',
  },
];

// I-BACK-6 : routes/X-engine.js — engines dans routes/ (à migrer vers services/)
// Allowlist — B1 (sourcing-engine → sourcing.js) + B2 (economic-engine → economic.js) clôturés
// par renommage 2026-06-28. sourcing-scanner.js : extraction catalogs/import déjà faite (B1-réel),
// le suffixe -scanner.js reste par choix nominal, plus de dette logique.
const ALLOWED_ENGINE_ROUTES = new Set([
  'routes/sourcing-scanner.js',  // catalogs/import extrait (2026-06-28) ; reste *-scanner.js par choix nominal
]);

// Exception nominale réauditée : la route est une façade mince, pas un engine.
const REVIEWED_ENGINE_ROUTE_EXCEPTIONS = new Set([
  'routes/sourcing-scanner.js',
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

// I-BACK-11 : webhook paiement sans vérification de signature
const ALLOWED_WEBHOOK_NO_SIG = new Set([
  // Aucun pour l'instant — tout nouveau webhook DOIT vérifier la signature.
]);

// I-BACK-13 : DELETE ou TRUNCATE sans clause WHERE (destructif non borné)
// Patterns légitimes : migrations DDL, truncate sur table temporaire.
const ALLOWED_DESTRUCTIVE_SQL = new Set([
  'scripts/seed.js',
  'scripts/fix-schema.js',

  // ── Route admin système — TRUNCATE intentionnel ───────────────────────────
  // Reset de données de démo / cache applicatif via interface admin.
  // Accès restreint par authenticate + requireAdmin (I-BACK-5).
  'routes/admin/system.js',
]);


const ALLOWED_RAW_SQL_PATTERNS = [
  /SAVEPOINT\s+\w+/i,
  /RELEASE\s+SAVEPOINT/i,
  /ROLLBACK\s+TO\s+SAVEPOINT/i,
  /CREATE\s+(TABLE|INDEX|SEQUENCE)/i,
  /ALTER\s+TABLE/i,
  /DROP\s+(TABLE|INDEX)/i,

  // D-14 — routes/admin/system.js:110 : `DELETE FROM ${tbl}` où tbl itère sur
  // CLEAN_TABLES_ALLOWLIST (tableau littéral en dur, re-vérifié par un garde AUD-07
  // avant chaque usage) — jamais une entrée utilisateur. Cf. commentaire arch-safe
  // sur place.
  /DELETE\s+FROM\s+\$\{tbl\}/,
];

// ════════════════════════════════════════════════════════════════
// I-BACK-15 : Cohérence de la state machine orders
//
// Deux vérifications complémentaires :
//
//   A) SOURCES : toute valeur de `source` passée à transitionOrderStatus()
//      doit être déclarée dans STATE_MACHINE_ALL_SOURCES. Une source inconnue
//      = branche de validation implicite (tombe dans le else forward-only sans
//      décision explicite).
//
//   B) TRANSITIONS PATCH : pour les appels avec source='patch', la paire
//      (newStatus) doit exister dans VALID_TRANSITIONS. Les sources forward-only
//      (scan/system/…) utilisent isForwardTransition() — non vérifiables
//      statiquement sans connaître le statut courant, donc on les tolère.
// ════════════════════════════════════════════════════════════════

// Sources dont la validation est forward-only (branche else de la machine) :
const STATE_MACHINE_FORWARD_SOURCES = new Set([
  'scan', 'system', 'simulator', 'cancel',
  // Sources applicatives connues — branche forward-only délibérée
  'transitaire_ship', 'hub_mark_ordered', 'hub_start_prep', 'hub_auto_prepare',
  'auto_parcel', 'scan_engine_sync',
]);

// Sources dont la validation est STRICT (VALID_TRANSITIONS) :
const STATE_MACHINE_PATCH_SOURCES = new Set(['patch']);

// Sources dont la validation est payment-only (pending → confirmed uniquement) :
const STATE_MACHINE_PAYMENT_SOURCES = new Set([
  'stripe_webhook', 'cash_confirm', 'wallet_full_payment',
  'shared_cart_full_payment', 'paypal_capture',
]);

// Union : toutes les sources reconnues
const STATE_MACHINE_ALL_SOURCES = new Set([
  ...STATE_MACHINE_FORWARD_SOURCES,
  ...STATE_MACHINE_PATCH_SOURCES,
  ...STATE_MACHINE_PAYMENT_SOURCES,
]);

// Exemptions : chaos-testing — transitions délibérément incohérentes
const ALLOWED_STATE_MACHINE_BYPASS = new Set([
  'services/simulator/state-advancer.js',
]);



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
// I-BACK-3 / I-BACK-4 / I-BACK-12 / I-BACK-14
// Checker générique piloté par COLUMN_OWNERSHIP
// ════════════════════════════════════════════════════════════════
function checkColumnOwnership() {
  const files = [...walkJs(ROUTES_DIR), ...walkJs(SERVICES_DIR)];

  for (const entry of COLUMN_OWNERSHIP) {
    // Construire le pattern de détection selon les ops et la colonne
    // ex: UPDATE orders SET status=  |  INSERT INTO wallet_transactions
    const patterns = entry.ops.map(op => {
      if (op === 'UPDATE') {
        return entry.column
          ? new RegExp(`UPDATE\\s+${entry.table}\\s+SET\\s+${entry.column}\\s*=`, 'i')
          : new RegExp(`UPDATE\\s+${entry.table}\\b`, 'i');
      }
      if (op === 'INSERT') {
        return new RegExp(`INSERT\\s+INTO\\s+${entry.table}\\b`, 'i');
      }
      return null;
    }).filter(Boolean);

    for (const file of files) {
      const relPath = rel(file);
      if (entry.owners.has(relPath) || entry.allowlist.has(relPath)) continue;

      const content = readFile(file);
      const lines   = content.split('\n');

      // Pass 1 — écriture littérale sur une seule ligne : `UPDATE table SET column =`
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('//')) continue;
        if (patterns.some(p => p.test(lines[i]))) {
          violate(entry.rule,
            `${relPath}:${i + 1} — écriture non autorisée sur ${entry.table}${entry.column ? '.' + entry.column : ''} (${entry.ops.join('/')})`,
            entry.remedy
          );
        }
      }

      // Pass 2 — SET dynamique ou SQL multi-lignes (durcissement 2026-07-11, I-BACK-3/14)
      // `UPDATE table SET ${arr.join(', ')}` ou un SQL étalé sur plusieurs lignes ne
      // contiennent jamais littéralement "SET column =" sur une même ligne → invisibles
      // à la Pass 1. On repère toute ligne `UPDATE table` hors owner/allowlist, puis on
      // cherche dans une fenêtre autour un fragment `"column ="` / `` `column =` `` —
      // signature d'une chaîne SQL poussée dans un tableau `updates`/`setParts`, ou
      // d'un SET multi-lignes littéral. Le lookbehind sur guillemet/backtick (et pas
      // simple espace) évite de confondre avec des comparaisons JS (`status === ...`).
      if (entry.column && entry.ops.includes('UPDATE')) {
        const updateLineRe   = new RegExp(`UPDATE\\s+${entry.table}\\b`, 'i');
        const columnAssignRe = new RegExp('[`\'"]\\s*' + entry.column + '\\s*=(?!=)', 'i');

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().startsWith('//')) continue;
          if (!updateLineRe.test(lines[i])) continue;
          if (patterns.some(p => p.test(lines[i]))) continue; // déjà remonté en Pass 1

          const windowStart = Math.max(0, i - 60);
          const windowEnd   = Math.min(lines.length, i + 20);
          const windowText  = lines.slice(windowStart, windowEnd).join('\n');

          if (columnAssignRe.test(windowText)) {
            violate(entry.rule,
              `${relPath}:${i + 1} — UPDATE ${entry.table} avec SET dynamique/multi-lignes ; fragment "${entry.column} =" détecté à proximité (vérification manuelle requise)`,
              entry.remedy
            );
          }
        }
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
        `${relPath} — engine en routes/ (nom de fichier seulement, façade déjà mince)`,
        'Acceptée en l\'état (STATUS.md §B1/B2) — pas de migration prévue, dette purement nominale'
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
//
// Historique : la version d'origine ne détectait QUE le motif "bare" (ex.
// 060.sql coexistant avec 060_description.sql). Elle ratait le motif réel
// d'AUD-10 (clos 2026-06-23, STATUS.md) : DEUX fichiers DÉCRITS partageant
// le même préfixe numérique (ex. 014_parcels_final_cleanup.sql ET
// 014_transaction_documents.sql) — aucun des deux n'est "bare", donc
// l'ancienne regex ne voyait rien, alors que l'ordre d'exécution réel des
// deux migrations reste ambigu pour un humain qui relit l'historique.
//
// Détection généralisée : on groupe les fichiers par TOKEN = préfixe
// numérique + suffixe lettre optionnel (014, 072, 072a, 015b…), avant le
// premier "_" (ou avant ".sql" pour un bare file). Tout token porté par
// 2+ fichiers est une collision, SAUF s'il est explicitement documenté
// dans migrations/GAPS.md (section "COLLISION:" — dette connue, traitée
// à part, jamais bloquante ici tant qu'elle reste documentée).
function checkI10_noMigrationCollisions() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  const acceptedSets = loadAcceptedMigrationCollisions(); // Map<token, Set<filename>>

  const groups = new Map(); // token -> [filenames]
  for (const f of files) {
    const m = f.match(/^(\d+[a-z]?)(?:_|\.sql$)/);
    if (!m) continue;
    const token = m[1];
    if (!groups.has(token)) groups.set(token, []);
    groups.get(token).push(f);
  }

  for (const [token, group] of groups) {
    if (group.length < 2) continue;
    const accepted = acceptedSets.get(token);
    const currentSet = new Set(group);

    // Allowlist ancrée sur l'ENSEMBLE EXACT, pas sur le token seul : un token
    // déjà amnistié ne couvre QUE les fichiers documentés. Tout fichier en
    // plus (ou différent) sous ce préfixe est une collision NEUVE, distincte,
    // jamais absorbée silencieusement par une dette ancienne.
    if (accepted && setsEqual(accepted, currentSet)) {
      warn('I-BACK-10',
        `Collision migration documentée (préfixe ${token}) : ${group.join(', ')}`,
        `Dette connue listée dans migrations/GAPS.md — à nettoyer dès que possible, ne bloque pas`
      );
      continue;
    }

    if (accepted) {
      const extra = group.filter(f => !accepted.has(f));
      violate('I-BACK-10',
        `Collision migration sur le préfixe ${token} : ${group.join(', ')} ` +
        `— ${extra.length ? `fichier(s) NON couvert(s) par l'allowlist existante : ${extra.join(', ')}` : 'ensemble different de celui documenté'}`,
        `migrations/GAPS.md n'amnistie que ${[...accepted].join(', ')} pour ce préfixe — ` +
        `mettre à jour la ligne COLLISION si le nouveau fichier est légitime, sinon le renommer`
      );
      continue;
    }

    violate('I-BACK-10',
      `Collision migration NON documentée sur le préfixe ${token} : ${group.join(', ')}`,
      `Renommer l'un des deux avec un numéro libre, OU si le doublon est connu/accepté, ` +
      `l'ajouter à migrations/GAPS.md avec une ligne "- COLLISION: \`${token}\` = ${group.join(', ')}"`
    );
  }
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// migrations/GAPS.md documente des collisions de préfixe ACCEPTÉES (dette
// connue, pas une régression) via des lignes au format :
//   - COLLISION: `014` = fichier_a.sql, fichier_b.sql
// L'ensemble de fichiers fait partie intégrante de l'allowlist : ce n'est
// pas le préfixe seul qui est amnistié, c'est CETTE liste précise.
function loadAcceptedMigrationCollisions() {
  const gapsFile = path.join(MIGRATIONS_DIR, 'GAPS.md');
  const content = readFile(gapsFile);
  const accepted = new Map(); // token -> Set<filename>
  for (const m of content.matchAll(/COLLISION:\s*`([^`]+)`\s*=\s*([^\n]+)/g)) {
    const token = m[1];
    const fileSet = new Set(m[2].split(',').map(s => s.trim()).filter(Boolean));
    accepted.set(token, fileSet);
  }
  return accepted;
}

// ════════════════════════════════════════════════════════════════
// I-BACK-11 — Webhook paiement sans vérification de signature
// Tout fichier routes/webhook*.js ou routes/*-webhook.js doit
// contenir un appel à une fonction de vérification de signature
// (ex. verifySignature, validateWebhookSignature, crypto.timingSafeEqual,
// stripe.webhooks.constructEvent, paypal.verifyWebhookSignature…)
// AVANT tout accès à req.body ou traitement métier.
// ════════════════════════════════════════════════════════════════
function checkI11_webhookSignature() {
  if (!fs.existsSync(ROUTES_DIR)) return;
  const webhookFiles = fs.readdirSync(ROUTES_DIR)
    .filter(f => (f.startsWith('webhook') || f.endsWith('-webhook.js')) && f.endsWith('.js'))
    .map(f => path.join(ROUTES_DIR, f));

  const SIG_PATTERNS = [
    /verifySignature/i,
    /validateWebhook/i,
    /constructEvent/i,
    /verifyWebhookSignature/i,
    /crypto\.timingSafeEqual/,
    /rawBody/,          // pattern express-raw-body pour vérif HMAC manuelle
  ];

  for (const file of webhookFiles) {
    const relPath = rel(file);
    if (ALLOWED_WEBHOOK_NO_SIG.has(relPath)) continue;
    const content = readFile(file);
    const hasSig = SIG_PATTERNS.some(p => p.test(content));
    if (!hasSig) {
      violate('I-BACK-11',
        `${relPath} — webhook sans vérification de signature détectée`,
        'Vérifier la signature (HMAC/stripe.webhooks.constructEvent/…) avant tout traitement req.body'
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════
// I-BACK-13 — DELETE ou TRUNCATE sans clause WHERE (destructif non borné)
// ════════════════════════════════════════════════════════════════
function checkI13_destructiveSql() {
  const files = [...walkJs(ROUTES_DIR), ...walkJs(SERVICES_DIR)];
  // DELETE FROM table sans WHERE sur la même ligne (ou ligne suivante immédiate)
  // TRUNCATE TABLE sans condition — toujours non borné
  const deleteNoWhere = /\bDELETE\s+FROM\s+\w+\s*(?:;|`|$)/i;
  const truncate      = /\bTRUNCATE\s+(?:TABLE\s+)?\w+/i;

  for (const file of files) {
    const relPath = rel(file);
    if (ALLOWED_DESTRUCTIVE_SQL.has(relPath)) continue;
    const content = readFile(file);
    const lines   = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//')) continue;
      if (deleteNoWhere.test(line)) {
        // Vérifier si la ligne suivante (dans le template literal) ajoute un WHERE
        const nextLine = (lines[i + 1] || '').trim();
        if (/^\s*WHERE\b/i.test(nextLine)) continue;
        violate('I-BACK-13',
          `${relPath}:${i + 1} — DELETE sans clause WHERE (destructif non borné)`,
          'Ajouter une clause WHERE ou documenter l\'intention dans ALLOWED_DESTRUCTIVE_SQL'
        );
      }
      if (truncate.test(line)) {
        violate('I-BACK-13',
          `${relPath}:${i + 1} — TRUNCATE détecté`,
          'TRUNCATE est non borné par nature — utiliser DELETE avec WHERE ou documenter dans ALLOWED_DESTRUCTIVE_SQL'
        );
      }
    }
  }
}



// ════════════════════════════════════════════════════════════════
// I-BACK-15 — Cohérence de la state machine orders
// ════════════════════════════════════════════════════════════════
function checkI15_stateMachineCoherence() {
  const files = [...walkJs(ROUTES_DIR), ...walkJs(SERVICES_DIR)];

  // Lire VALID_TRANSITIONS depuis order-status-machine.js (source de vérité)
  const machineFile = path.join(ROOT, 'services', 'order-status-machine.js');
  const machineContent = readFile(machineFile);

  // Extraire la matrice VALID_TRANSITIONS par parsing léger du source
  // Format attendu : "  from: ['to1', 'to2', ...],\n"
  const validTransitions = {}; // from → Set<to>
  const matrixMatch = machineContent.match(/const VALID_TRANSITIONS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (matrixMatch) {
    const matrixBody = matrixMatch[1];
    for (const m of matrixBody.matchAll(/(\w+)\s*:\s*\[([^\]]*)\]/g)) {
      const from = m[1];
      const tos  = [...m[2].matchAll(/'(\w+)'/g)].map(x => x[1]);
      validTransitions[from] = new Set(tos);
    }
  } else {
    warn('I-BACK-15',
      'services/order-status-machine.js — VALID_TRANSITIONS introuvable (parsing échoué)',
      'Vérifier que la matrice est bien exportée sous ce nom exact'
    );
    return;
  }

  // Regex pour détecter un appel transitionOrderStatus({ ... }) sur plusieurs lignes
  // On capture le bloc d'arguments en cherchant source et newStatus
  const callRe = /transitionOrderStatus\s*\(\s*\{([^}]+)\}/g;
  const sourceRe = /source\s*:\s*'([\w_]+)'/;
  const newStatusRe = /newStatus\s*:\s*'([\w_]+)'/;

  for (const file of files) {
    const relPath = rel(file);
    if (relPath === 'services/order-status-machine.js') continue;
    if (ALLOWED_STATE_MACHINE_BYPASS.has(relPath)) continue;

    const content = readFile(file);
    let match;
    while ((match = callRe.exec(content)) !== null) {
      const block = match[1];

      // ── A) Source inconnue ───────────────────────────────────────────────
      const srcMatch = sourceRe.exec(block);
      if (srcMatch) {
        const src = srcMatch[1];
        if (!STATE_MACHINE_ALL_SOURCES.has(src)) {
          // Calculer le numéro de ligne approximatif
          const lineNo = content.slice(0, match.index).split('\n').length;
          violate('I-BACK-15',
            `${relPath}:${lineNo} — source '${src}' inconnue de la state machine`,
            `Ajouter '${src}' dans STATE_MACHINE_FORWARD_SOURCES (forward-only) ou STATE_MACHINE_PATCH_SOURCES (strict) selon la sémantique voulue`
          );
        }
      }

      // ── B) Transition patch sur statut inexistant dans VALID_TRANSITIONS ─
      const srcVal = srcMatch ? srcMatch[1] : null;
      if (srcVal && STATE_MACHINE_PATCH_SOURCES.has(srcVal)) {
        const nsMatch = newStatusRe.exec(block);
        if (nsMatch) {
          const to = nsMatch[1];
          const lineNo = content.slice(0, match.index).split('\n').length;
          // Vérifier que 'to' est une cible dans au moins un from de la matrice
          const reachable = Object.values(validTransitions).some(tos => tos.has(to));
          if (!reachable) {
            violate('I-BACK-15',
              `${relPath}:${lineNo} — newStatus '${to}' (source=patch) absent de toute transition dans VALID_TRANSITIONS`,
              `Ajouter la transition dans services/order-status-machine.js ou corriger le newStatus`
            );
          }
        }
      }
    }
  }
}

console.log('\n  🔍  Audit architecture Komerce backend\n');

checkI1_noDuplicates();
checkI2_fileSize();
checkColumnOwnership();   // I-BACK-3, I-BACK-4, I-BACK-12, I-BACK-14
checkI5_adminAuth();
checkI6_noEngineInRoutes();
checkI7_noConsoleLog();
checkI8_noRawSqlInterpolation();
checkI9_noOrphanTests();
checkI10_noMigrationCollisions();
checkI11_webhookSignature();
checkI13_destructiveSql();
checkI15_stateMachineCoherence();

// ════════════════════════════════════════════════════════════════
// RAPPORT
// ════════════════════════════════════════════════════════════════

const RULE_LABELS = {
  'I-BACK-1':  'Doublons de fichiers actifs',
  'I-BACK-2':  'Taille des fichiers',
  'I-BACK-3':  'Propriété orders.status',
  'I-BACK-4':  'Propriété orders.payment_status',
  'I-BACK-5':  'Auth routes admin',
  'I-BACK-6':  'Engines dans routes/',
  'I-BACK-7':  'console.log dans nouveaux fichiers',
  'I-BACK-8':  'Queries SQL non-paramétrées',
  'I-BACK-9':  'Tests orphelins à la racine',
  'I-BACK-10': 'Collisions numéros migrations',
  'I-BACK-11': 'Webhook sans vérification de signature',
  'I-BACK-12': 'Propriété wallet_transactions / store_credits',
  'I-BACK-13': 'DELETE/TRUNCATE non borné',
  'I-BACK-14': 'Propriété parcels.status',
  'I-BACK-15': 'Cohérence state machine orders (sources + transitions)',
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
