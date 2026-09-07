#!/usr/bin/env node
/**
 * ============================================================
 * KOMERCE — Moteur d'analyse d'impact (coffre-fort production)
 * Version 1.0.0 · Avril 2026
 * 0 dépendances externes — Node.js >= 18
 * ============================================================
 *
 * Usage :
 *   node scripts/impact-check.js --diff=origin/main
 *   node scripts/impact-check.js --files=routes/orders.js,routes/payments.js
 *   node scripts/impact-check.js --all
 *   node scripts/impact-check.js --diff=origin/main --ci --json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Configuration ────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'impact-config.json');
let CONFIG;

try {
  CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (err) {
  console.error('❌ Impossible de charger impact-config.json :', err.message);
  process.exit(1);
}

// Liste d'exceptions nommee (optionnelle) : faux positifs confirmes, epingles par
// fichier + categorie + sous-chaine (survit aux deplacements de lignes), avec raison.
// Reconciliable comme l'allowlist de drift. Format :
//   [{ "file": "routes/admin-costing.js", "category": "sqlInjection",
//      "contains": "UPDATE finance_config SET", "reason": "colonnes en dur, valeurs $N" }]
let SUPPRESS_LIST = [];
try {
  SUPPRESS_LIST = JSON.parse(fs.readFileSync(path.join(__dirname, 'impact-suppressions.json'), 'utf-8'));
  if (!Array.isArray(SUPPRESS_LIST)) SUPPRESS_LIST = [];
} catch { SUPPRESS_LIST = []; }

function isNamedException(filePath, category, line) {
  return SUPPRESS_LIST.some(e =>
    e && e.category === category &&
    typeof e.file === 'string' && filePath.replace(/\\/g, '/').endsWith(e.file) &&
    typeof e.contains === 'string' && line.includes(e.contains)
  );
}

// ── Index manifest : file → { feature, routes, tables } ─────
// Construit au démarrage depuis les features/*.feature.js pour résoudre
// les services/utils non configurés dans impact-config.json.
function buildManifestIndex() {
  const index = new Map(); // filePath → { feature, routes: string[], tables: string[] }
  const featuresDir = path.join(__dirname, '..', 'features');
  let files;
  try { files = fs.readdirSync(featuresDir).filter(f => f.endsWith('.feature.js')); }
  catch { return index; }

  for (const fname of files) {
    const featName = fname.replace('.feature.js', '');
    let src;
    try { src = fs.readFileSync(path.join(featuresDir, fname), 'utf8'); } catch { continue; }

    // Routes exposées
    const routes = [...src.matchAll(/'((?:GET|POST|PUT|PATCH|DELETE)\s+[^\s']+)'/g)].map(m => m[1]);

    // Tables DB
    const tablesM = src.match(/tables:\s*\[([\s\S]*?)\]/);
    const tables = tablesM
      ? [...tablesM[1].matchAll(/'([a-z_]+):\s*[RW]+'/g)].map(m => m[1])
      : [];

    // Fichiers owned
    const fileMatches = [...src.matchAll(/'((?:routes|services|middleware|utils|bootstrap|validators)[^']+\.js)'/g)];
    for (const [, rel] of fileMatches) {
      if (!index.has(rel)) index.set(rel, { feature: featName, routes: [], tables: [] });
      const entry = index.get(rel);
      entry.routes.push(...routes);
      entry.tables.push(...tables);
    }
  }
  return index;
}
const MANIFEST_INDEX = buildManifestIndex();

// ── Arguments CLI ────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const result = { diff: null, files: null, all: false, ci: false, json: false, verbose: false };
  for (const arg of argv) {
    if (arg.startsWith('--diff='))  result.diff = arg.split('=')[1];
    else if (arg.startsWith('--files=')) result.files = arg.split('=')[1].split(',');
    else if (arg === '--all')    result.all = true;
    else if (arg === '--ci')     result.ci = true;
    else if (arg === '--json')   result.json = true;
    else if (arg === '--verbose' || arg === '-v') result.verbose = true;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
  }
  return result;
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  KOMERCE — Moteur d'analyse d'impact v1.0               ║
╚══════════════════════════════════════════════════════════╝

Usage :
  node scripts/impact-check.js [options]

Options :
  --diff=<ref>        Analyse le diff par rapport à une référence git
  --files=<f1,f2>     Analyse des fichiers spécifiques
  --all               Scan complet du projet
  --ci                Mode CI (annotations GitHub Actions)
  --json              Sortie JSON (stdout)
  --verbose, -v       Affichage détaillé
  --help, -h          Affiche cette aide

Exemples :
  node scripts/impact-check.js --diff=origin/main
  node scripts/impact-check.js --files=routes/orders.js,utils/sms.js
  node scripts/impact-check.js --all --ci --json
`);
}

// ── Récupération des fichiers modifiés ───────────────────────
function getChangedFiles() {
  if (args.files) {
    return args.files.map(f => ({ file: f.trim(), additions: 0, deletions: 0 }));
  }

  if (args.all) {
    return getAllProjectFiles().map(f => ({ file: f, additions: 0, deletions: 0 }));
  }

  if (args.diff) {
    try {
      const diffOutput = execSync(
        `git diff --numstat ${args.diff}`,
        { encoding: 'utf-8', timeout: 30000 }
      ).trim();

      if (!diffOutput) {
        console.log('ℹ️  Aucun changement détecté par rapport à', args.diff);
        process.exit(0);
      }

      return diffOutput.split('\n').map(line => {
        const [add, del, file] = line.split('\t');
        return {
          file: file,
          additions: parseInt(add) || 0,
          deletions: parseInt(del) || 0
        };
      }).filter(f => !isIgnored(f.file));
    } catch (err) {
      console.error('❌ Erreur git diff :', err.message);
      process.exit(1);
    }
  }

  // Défaut : fichiers stagés (git diff --cached)
  // On attrape silencieusement l'erreur — pas de repo git = pas de fichiers stagés
  try {
    const staged = execSync('git diff --cached --numstat', { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] }).trim();
    if (staged) {
      return staged.split('\n').map(line => {
        const [add, del, file] = line.split('\t');
        return { file, additions: parseInt(add) || 0, deletions: parseInt(del) || 0 };
      }).filter(f => !isIgnored(f.file));
    }
  } catch { /* pas de repo git ou rien de stagé — normal */ }

  console.error('❌ Aucune source de fichiers. Utilisez --diff, --files ou --all');
  process.exit(1);
}

function getAllProjectFiles() {
  const files = [];
  const walk = (dir) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        // Normaliser en forward-slash : sur Windows, path.relative() renvoie des
        // backslashes, ce qui casse le check 'public/uploads' ci-dessous et les
        // ignorePatterns multi-segments (node_modules/**, docs/**, ...) dans isIgnored().
        const relPath = path.relative(process.cwd(), fullPath).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'public/uploads'].includes(relPath)) walk(fullPath);
        } else {
          if (!isIgnored(relPath)) files.push(relPath);
        }
      }
    } catch { /* ignore permission errors */ }
  };
  walk(process.cwd());
  return files;
}

function isIgnored(filePath) {
  const ignorePatterns = CONFIG.ignorePatterns || [];
  return ignorePatterns.some(pattern => {
    // Une seule passe : '**' -> '.*' (récursif) et '*' -> '[^/]*' (un niveau).
    // BUG corrigé : deux .replace() séquentiels remangent le '*' inséré pour '**'
    // (ex. 'node_modules/**' devenait '^node_modules/.[^/]*$' — un seul niveau,
    // jamais récursif, sur TOUTE plateforme — indépendant du souci Windows ci-dessus).
    const regexStr = pattern.replace(/\*\*|\*/g, (m) => (m === '**' ? '.*' : '[^/]*'));
    const regex = new RegExp('^' + regexStr + '$');
    return regex.test(filePath);
  });
}

// ── Catégorisation des fichiers ──────────────────────────────
function categorizeFile(filePath) {
  if (filePath.startsWith('routes/'))     return { category: 'route',      name: path.basename(filePath) };
  if (filePath.startsWith('services/'))   return { category: 'service',    name: path.basename(filePath) };
  if (filePath.startsWith('middleware/')) return { category: 'middleware',  name: path.basename(filePath) };
  if (filePath.startsWith('utils/'))     return { category: 'utils',      name: path.basename(filePath) };
  if (filePath.startsWith('db/'))        return { category: 'db',         name: path.basename(filePath) };
  if (filePath.startsWith('.github/'))   return { category: 'ci',         name: filePath };
  if (filePath.startsWith('scripts/'))   return { category: 'scripts',    name: path.basename(filePath) };
  if (filePath.startsWith('public/'))    return { category: 'static',     name: filePath };
  if (filePath === 'server.js')          return { category: 'core',       name: 'server.js' };
  if (filePath === 'db.js')             return { category: 'core',       name: 'db.js' };
  if (filePath === 'package.json')      return { category: 'core',       name: 'package.json' };
  return { category: 'other', name: filePath };
}

// ── Analyse d'impact en cascade ──────────────────────────────
// ── Lignes reellement ajoutees/modifiees (pour cibler le scan securite) ──
// Retourne Map<file, Set<numeroLigneNouvelle>>, ou null en mode --all (pas de diff).
// On ne veut JAMAIS bloquer sur du code preexistant qu'on n'a pas touche : le scan
// securite ne regarde donc que les lignes du diff.
function getChangedLineMap() {
  if (args.all) return null;
  const cmd = args.diff
    ? `git diff --unified=0 ${args.diff}`
    : 'git diff --cached --unified=0';
  let out;
  try {
    out = execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe','pipe','pipe'] });
  } catch {
    return null; // en cas de doute, pas de filtrage -> comportement historique
  }
  const map = new Map();
  let current = null;
  for (const line of out.split('\n')) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { current = f[1]; if (!map.has(current)) map.set(current, new Set()); continue; }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && current) {
      const start = parseInt(h[1], 10);
      const count = h[2] === undefined ? 1 : parseInt(h[2], 10);
      for (let i = 0; i < count; i++) map.get(current).add(start + i);
    }
  }
  return map;
}

function analyzeImpact(changedFiles, changedLines) {
  const impact = {
    files: new Set(),
    tables: new Set(),
    services: new Set(),
    routes: new Set(),
    cascadeChains: [],
    criticalFiles: [],
    securityIssues: [],
    score: 0,
    level: 'SAFE',
    details: []
  };

  for (const { file, additions, deletions } of changedFiles) {
    impact.files.add(file);
    const { category, name } = categorizeFile(file);
    const linesChanged = additions + deletions;

    // — Direct impact analysis —
    switch (category) {
      case 'service': {
        // Résolution via l'index manifest : file → feature → routes exposées + tables
        const manifest = MANIFEST_INDEX.get(file);
        if (manifest) {
          manifest.routes.forEach(r => impact.routes.add(r));
          manifest.tables.forEach(t => impact.tables.add(t));
        }
        // Fallback : chercher dans impact-config.json services si déclaré
        const svcConfig = (CONFIG.architecture.services || {})[name];
        if (svcConfig) {
          (svcConfig.tables  || []).forEach(t => impact.tables.add(t));
          (svcConfig.services|| []).forEach(s => impact.services.add(s));
          if (svcConfig.critical) impact.criticalFiles.push(file);
        }
        break;
      }
      case 'route': {
        const routeKey = name.replace('.js', '') + '.js';
        const routeConfig = CONFIG.architecture.routes[routeKey];
        if (routeConfig) {
          (routeConfig.tables || []).forEach(t => impact.tables.add(t));
          (routeConfig.services || []).forEach(s => impact.services.add(s));
          (routeConfig.middleware || []).forEach(m => impact.routes.add('middleware/' + m + '.js'));
          if (routeConfig.critical) impact.criticalFiles.push(file);
        }
        impact.routes.add(file);
        break;
      }
      case 'middleware': {
        const mwConfig = CONFIG.architecture.middleware[name];
        if (mwConfig) {
          if (mwConfig.critical) impact.criticalFiles.push(file);
          if (mwConfig.affects === 'all_authenticated_routes' || mwConfig.affects === 'all_rate_limited_routes') {
            // Cascade to ALL routes that use this middleware
            Object.entries(CONFIG.architecture.routes).forEach(([route, cfg]) => {
              if ((cfg.middleware || []).includes(name.replace('.js', ''))) {
                impact.routes.add('routes/' + route);
                (cfg.tables || []).forEach(t => impact.tables.add(t));
                (cfg.services || []).forEach(s => impact.services.add(s));
              }
            });
          }
        }
        break;
      }
      case 'utils': {
        const utilConfig = CONFIG.architecture.utils[name];
        if (utilConfig) {
          (utilConfig.services || []).forEach(s => impact.services.add(s));
          if (utilConfig.critical) impact.criticalFiles.push(file);
          // Cascade to routes that use this util
          (utilConfig.usedBy || []).forEach(routeName => {
            const routeFile = routeName + '.js';
            if (CONFIG.architecture.routes[routeFile]) {
              impact.routes.add('routes/' + routeFile);
              (CONFIG.architecture.routes[routeFile].tables || []).forEach(t => impact.tables.add(t));
            }
          });
        }
        break;
      }
      case 'db': {
        const dbConfig = CONFIG.architecture.db[name];
        if (dbConfig) {
          if (dbConfig.critical) impact.criticalFiles.push(file);
          if (dbConfig.affects === 'all') {
            // DB core change = impacts everything
            Object.keys(CONFIG.architecture.routes).forEach(r => impact.routes.add('routes/' + r));
            Object.values(CONFIG.tables).flat().forEach(t => impact.tables.add(t));
          }
        }
        break;
      }
      case 'core': {
        const coreConfig = CONFIG.architecture.core[name];
        if (coreConfig) {
          if (coreConfig.critical) impact.criticalFiles.push(file);
          if (coreConfig.affects === 'all') {
            Object.keys(CONFIG.architecture.routes).forEach(r => impact.routes.add('routes/' + r));
          }
        }
        break;
      }
    }

    // — Cascade chain detection —
    for (const [chainName, chain] of Object.entries(CONFIG.cascade.chains)) {
      const baseName = path.basename(file, '.js');
      if (chain.includes(baseName) || chain.includes(name) || chain.includes(file)) {
        impact.cascadeChains.push({
          chain: chainName,
          trigger: file,
          affectedFiles: chain,
          depth: chain.length
        });
      }
    }

    // — Security scan on file content (limite aux lignes du diff) —
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf-8');
      // null => mode --all (scan complet). Sinon, uniquement les lignes changees.
      const fileLines = changedLines ? (changedLines.get(file) || new Set()) : null;
      const secIssues = scanSecurity(file, content, fileLines);
      impact.securityIssues.push(...secIssues);
    }

    // — Add detail entry —
    impact.details.push({
      file,
      category,
      linesChanged,
      isCritical: impact.criticalFiles.includes(file)
    });
  }

  // — Calculate risk score —
  impact.score = calculateScore(impact, changedFiles);
  impact.level = getLevel(impact.score);

  return impact;
}

// ── Suppresseurs "convention-aware" : ne pas flagger un motif sûr-par-convention ──
// Chaque regle encode une convention du repo (echappeur, placeholder $N, auth routeur…).
// Objectif : que la porte se declenche RAREMENT et JUSTE, pas qu'elle hurle a chaque commit.
function isSafeInterp(x) {
  // x = "${...}". Sûr si echappe / formate / identifiant / numerique / litteral.
  return /sanitize\s*\(|escapeHtml\s*\(|DOMPurify|safe[A-Z]\w*|fmt\w*\s*\(/.test(x)
      || /^\$\{\s*[\w.]*\bid\b[\w.]*\s*\}$/.test(x)        // ${p.id}, ${x.userId}
      || /^\$\{\s*[-+*/%\d\s().]+\}$/.test(x)              // expression numerique
      || /^\$\{\s*(['"]).*?\1\s*\}$/.test(x);              // litteral
}

function suppressSecurity(category, line, content) {
  const L = line.trim();
  switch (category) {
    case 'sqlInjection': {
      const concat = /['"`]\s*\+\s*(?:req|params|query|body)\b/.test(L); // concat d'entree utilisateur
      // Commandes a identifiant pur (jamais de valeur utilisateur dans la chaine).
      if (!concat && /\b(?:SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO|TRUNCATE|DROP)\b/i.test(L)) return true;
      // Neutraliser les interpolations SÛRES, puis voir s'il reste une interpolation crue.
      let s = L
        .replace(/\$\$\{[^}]*\}/g, ' ')                                     // placeholders $1,$2…
        .replace(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+\$\{[a-z_]\w*\}/gi, ' _tbl_ ') // table nue
        .replace(/\$\{[a-z_]\w*\}\s*\./gi, ' _alias_.');                    // ${alias}.colonne
      const remainingRaw = /\$\{[^}]*\}/.test(s);
      if (!remainingRaw && !concat) return true;                           // plus rien de cru -> sûr
      return false;                                                        // valeur interpolee crue -> on GARDE
    }
    case 'xss': {
      // Convention sûre : staticHtml(target)`...` refuse toute substitution et
      // n'injecte que le segment littéral strings[0] dans un <template>.
      if (/template\.innerHTML\s*=\s*strings\[0\]/.test(L)
          && /Array\.isArray\(strings\?\.raw\)/.test(content)
          && /values\.length\s*!==\s*0/.test(content)
          && /substitution-free tagged templates/.test(content)) return true;
      if (!/innerHTML\s*\+?=/.test(L)) return false;       // autres patterns (document.write/res.send) : garder
      const rhs = (L.split(/innerHTML\s*\+?=/)[1] || '');
      if (/^\s*(?:''|""|``|'\s*'|"\s*")\s*;?\s*$/.test(rhs)) return true;      // = '' (vide)
      if (/sanitize\s*\(|escapeHtml\s*\(|DOMPurify/.test(L)) return true;      // echappeur present
      if (/\brender\w*\s*\(|\w*Markup\s*\(/.test(rhs)) return true;            // builder HTML (convention render*)
      if (/\binnerHTML\b/.test(rhs)) return true;                             // concat d'innerHTML existant
      const interps = rhs.match(/\$\{[^}]*\}/g) || [];
      if (interps.length && interps.every(isSafeInterp)) return true;         // toutes interps echappees
      return false;                                        // innerHTML = <var brute> -> on GARDE
    }
    case 'hardcodedSecrets': {
      const m = L.match(/(?:password|passwd|secret|key|token|api[_-]?key|apikey)\s*[:=]\s*['"]([^'"]+)['"]/i);
      // Le pattern d'env est scanné en /i pour les autres catégories : un identifiant
      // de données comme sms_log / stripe_events_processed ne doit pas devenir un secret.
      // Si le nom contient réellement password/secret/key/token/api_key, `m` reste prioritaire.
      if (!m && /\b(?:sms|stripe|jwt|db|smtp)_[a-z0-9_]+\s*[:=]\s*['"][^'"]+['"]/.test(L)
          && !/\b(?:SMS|STRIPE|JWT|DB|SMTP)_[A-Z0-9_]+\s*[:=]/.test(L)) return true;
      if (!m) return false;                                // vrais patterns STRIPE_/Bearer : garder
      const val = m[1];
      if (val.length < 16) return true;                    // trop court pour un secret reel
      if (/^[a-z][a-z0-9_]*$/.test(val)) return true;      // label snake_case (ex: estimated_price)
      return false;
    }
    case 'dangerousOps': {
      if (/\b(?:child_process|execSync|spawnSync|spawn\s*\()/.test(L)) return false; // reels -> garder
      if (/\beval\s*\(|new\s+Function\s*\(/.test(L)) return false;
      if (/\.\s*exec\s*\(/.test(L)) return true;           // regex.exec()/methode -> faux positif
      return false;                                        // TRUNCATE/DROP : reels, geres par le tiering
    }
    case 'missingAuth': {
      // file-level : si le routeur cable l'auth, on ne flagge plus ses routes ligne a ligne
      return /router\.use\(\s*[^)]*(?:authenticate|requireAuth|verifyToken|protect|requireRole|isAuth|ensureAuth)/.test(content)
          || /\b(?:guard|requireRole|requireAdmin|requireAuth|authenticate)\b/.test(content);
    }
    default: return false;
  }
}

// L'outillage de securite lui-meme ENUMERE les motifs d'attaque (innerHTML, document.write,
// eval, etc.) comme donnees : le scanner ne doit pas se scanner lui-meme (meta-faux-positif).
const SECURITY_TOOLING = /(?:^|\/)(?:impact-check\.js|impact-config\.json|impact-suppressions\.json|arch-doctrine-sanitize-check\.js)$/;

// ── Scan de sécurité ─────────────────────────────────────────
function scanSecurity(filePath, content, changedLines) {
  if (SECURITY_TOOLING.test(String(filePath).replace(/\\/g, '/'))) return [];
  const issues = [];
  const seen = new Set();   // dedupe file:line:category (plusieurs patterns peuvent matcher la meme ligne)
  const lines = content.split('\n');

  for (const [category, config] of Object.entries(CONFIG.securityPatterns)) {
    // XSS est un risque d'exécution navigateur. Les fixtures Jest ne sont jamais servies
    // en production ; on continue en revanche à y scanner secrets et opérations dangereuses.
    const normalizedFile = String(filePath).replace(/\\/g, '/');
    if (category === 'xss' && /(?:^|\/)tests\//.test(normalizedFile)) continue;
    for (const pattern of config.patterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        lines.forEach((line, idx) => {
          // Ne scanner que les lignes reellement changees (si fournies).
          if (changedLines && !changedLines.has(idx + 1)) return;
          // Ignore commentaires
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

          if (regex.test(line)) {
            // Suppression convention-aware (echappeur, placeholder $N, auth routeur…)
            if (suppressSecurity(category, line, content)) { regex.lastIndex = 0; return; }
            // Exception nommee et justifiee (faux positif confirme, reconciliable)
            if (isNamedException(filePath, category, line)) { regex.lastIndex = 0; return; }
            const k = `${idx + 1}:${category}`;
            if (seen.has(k)) { regex.lastIndex = 0; return; }
            seen.add(k);
            issues.push({
              file: filePath,
              line: idx + 1,
              category,
              severity: config.severity,
              score: config.score,
              match: line.trim().substring(0, 120),
              description: getSecurityDescription(category)
            });
          }
          regex.lastIndex = 0; // Reset regex state
        });
      } catch { /* ignore invalid regex */ }
    }
  }

  return issues;
}

function getSecurityDescription(category) {
  const descriptions = {
    sqlInjection:     'Injection SQL potentielle — utiliser des requêtes paramétrées ($1, $2…)',
    xss:             'Faille XSS potentielle — échapper les données utilisateur',
    hardcodedSecrets: 'Secret/credential en dur — utiliser des variables d\'environnement',
    dangerousOps:    'Opération dangereuse détectée — vérifier la nécessité et sécuriser',
    missingAuth:     'Route potentiellement sans authentification',
    unsafeFileOps:   'Opération fichier non sécurisée — valider les chemins'
  };
  return descriptions[category] || 'Problème de sécurité détecté';
}

// ── Calcul du score de risque ────────────────────────────────
function calculateScore(impact, changedFiles) {
  const w = CONFIG.scoring.weights;
  let score = 0;

  // Fichiers modifiés
  score += impact.files.size * w.filesChanged;

  // Fichiers critiques
  score += impact.criticalFiles.length * w.criticalFileChanged;

  // Tables affectées
  const criticalTables = CONFIG.tables.critical || [];
  const sensitiveTables = CONFIG.tables.sensitive || [];
  for (const table of impact.tables) {
    if (criticalTables.includes(table)) {
      score += w.criticalTableAffected;
    } else if (sensitiveTables.includes(table)) {
      score += w.tablesAffected * 1.5;
    } else {
      score += w.tablesAffected;
    }
  }

  // Services externes
  score += impact.services.size * w.externalServiceAffected;

  // Issues de sécurité — paliers : plein poids en contexte critique, avertissement sinon.
  // Hors fichier critique, une alerte heuristique informe mais ne suffit pas a BLOCK.
  const critSet = new Set(impact.criticalFiles);
  for (const issue of impact.securityIssues) {
    const sevMul = issue.severity === 'critical' ? 1 : issue.severity === 'high' ? 0.6 : 0.3;
    const ctxMul = critSet.has(issue.file) ? 1 : 0.35;
    score += w.securityIssue * sevMul * ctxMul;
  }

  // Profondeur de cascade
  const maxCascadeDepth = Math.max(0, ...impact.cascadeChains.map(c => c.depth));
  score += maxCascadeDepth * w.cascadeDepth;

  // Lignes modifiées
  const totalLines = changedFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  score += totalLines * w.linesChanged;

  // Le churn (nombre de fichiers / lignes) reste informatif mais ne doit
  // jamais, à lui seul, déclencher une revue manuelle. REVIEW doit être
  // causé par un signal matériel : backend/infra, table, service externe,
  // route, cascade ou alerte sécurité.
  const structuralCategories = new Set([
    'core', 'db', 'route', 'service', 'middleware', 'utils', 'ci', 'scripts',
  ]);
  const hasStructuralFile = changedFiles.some(({ file }) =>
    structuralCategories.has(categorizeFile(file).category)
  );
  const hasMaterialSignal =
    hasStructuralFile ||
    impact.criticalFiles.length > 0 ||
    impact.tables.size > 0 ||
    impact.services.size > 0 ||
    impact.routes.size > 0 ||
    impact.cascadeChains.length > 0 ||
    impact.securityIssues.length > 0;

  const rounded = Math.min(Math.round(score), CONFIG.scoring.maxScore);

  if (!hasMaterialSignal) {
    return Math.min(rounded, CONFIG.thresholds.safe.max);
  }

  return rounded;
}

function getLevel(score) {
  for (const [, threshold] of Object.entries(CONFIG.thresholds)) {
    if (score >= threshold.min && score <= threshold.max) return threshold.label;
  }
  return 'BLOCK';
}

// ── Détection des tables dans le contenu ─────────────────────
function detectTablesInContent(content) {
  const allTables = Object.values(CONFIG.tables).flat();
  const found = new Set();
  for (const table of allTables) {
    // Match table names in SQL queries
    const patterns = [
      new RegExp(`(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+${table}\\b`, 'gi'),
      new RegExp(`['"\`]${table}['"\`]`, 'g')
    ];
    for (const pattern of patterns) {
      if (pattern.test(content)) found.add(table);
    }
  }
  return found;
}

// ── Sortie Console ───────────────────────────────────────────
function outputConsole(impact) {
  const threshold = CONFIG.thresholds[impact.level.toLowerCase()] || CONFIG.thresholds.block;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  KOMERCE — Rapport d\'analyse d\'impact                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Score
  const bar = '█'.repeat(Math.round(impact.score / 5)) + '░'.repeat(20 - Math.round(impact.score / 5));
  console.log(`  Score de risque : ${threshold.emoji} ${impact.score}/100 — ${impact.level}`);
  console.log(`  [${bar}]`);
  console.log(`  Action : ${threshold.action}`);
  console.log('');

  // Résumé
  console.log('  📊 Résumé d\'impact :');
  console.log(`     · Fichiers modifiés  : ${impact.files.size}`);
  console.log(`     · Fichiers critiques : ${impact.criticalFiles.length}`);
  console.log(`     · Tables affectées   : ${impact.tables.size} (${[...impact.tables].join(', ') || 'aucune'})`);
  console.log(`     · Services externes  : ${impact.services.size} (${[...impact.services].join(', ') || 'aucun'})`);
  console.log(`     · Routes impactées   : ${impact.routes.size}`);
  console.log(`     · Chaînes en cascade : ${impact.cascadeChains.length}`);
  console.log('');

  // Fichiers critiques
  if (impact.criticalFiles.length > 0) {
    console.log('  🔴 Fichiers critiques modifiés :');
    impact.criticalFiles.forEach(f => console.log(`     ⚠ ${f}`));
    console.log('');
  }

  // Cascades
  if (impact.cascadeChains.length > 0) {
    console.log('  ⛓️  Chaînes de cascade détectées :');
    const unique = [...new Set(impact.cascadeChains.map(c => c.chain))];
    unique.forEach(chain => {
      const c = impact.cascadeChains.find(x => x.chain === chain);
      console.log(`     ${chain} : ${c.affectedFiles.join(' → ')} (profondeur: ${c.depth})`);
    });
    console.log('');
  }

  // Issues de sécurité
  if (impact.securityIssues.length > 0) {
    console.log('  🛡️  Alertes de sécurité :');
    const byFile = {};
    impact.securityIssues.forEach(issue => {
      if (!byFile[issue.file]) byFile[issue.file] = [];
      byFile[issue.file].push(issue);
    });
    for (const [file, issues] of Object.entries(byFile)) {
      console.log(`     📄 ${file}`);
      issues.forEach(i => {
        const sev = i.severity === 'critical' ? '🔴' : i.severity === 'high' ? '🟠' : '🟡';
        console.log(`        ${sev} L${i.line} [${i.category}] ${i.description}`);
        if (args.verbose) console.log(`           → ${i.match}`);
      });
    }
    console.log('');
  }

  // Routes impactées
  if (impact.routes.size > 0) {
    console.log('  🌐 Routes impactées :');
    [...impact.routes].sort().forEach(r => console.log(`     · ${r}`));
    console.log('');
  }

  // Détail des fichiers
  if (args.verbose) {
    console.log('  📁 Détail des fichiers :');
    impact.details.forEach(d => {
      const icon = d.isCritical ? '🔴' : '⚪';
      console.log(`     ${icon} ${d.file} [${d.category}] +${d.linesChanged} lignes`);
    });
    console.log('');
  }

  console.log('═'.repeat(64));
}

// ── Sortie JSON ──────────────────────────────────────────────
function outputJSON(impact) {
  const output = {
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    score: impact.score,
    level: impact.level,
    action: CONFIG.thresholds[impact.level.toLowerCase()]?.action || 'unknown',
    summary: {
      filesChanged: impact.files.size,
      criticalFiles: impact.criticalFiles.length,
      tablesAffected: impact.tables.size,
      servicesAffected: impact.services.size,
      routesImpacted: impact.routes.size,
      securityIssues: impact.securityIssues.length,
      cascadeChains: impact.cascadeChains.length
    },
    files: [...impact.files],
    criticalFiles: impact.criticalFiles,
    tables: [...impact.tables],
    services: [...impact.services],
    routes: [...impact.routes],
    securityIssues: impact.securityIssues.map(i => ({
      file: i.file,
      line: i.line,
      category: i.category,
      severity: i.severity,
      description: i.description
    })),
    cascadeChains: [...new Set(impact.cascadeChains.map(c => c.chain))],
    details: impact.details
  };
  console.log(JSON.stringify(output, null, 2));
}

// ── Sortie CI (GitHub Actions annotations) ───────────────────
function outputCI(impact) {
  // Set output variables for GitHub Actions
  console.log(`::set-output name=score::${impact.score}`);
  console.log(`::set-output name=level::${impact.level}`);

  // Security issues as annotations
  impact.securityIssues.forEach(issue => {
    const level = issue.severity === 'critical' ? 'error' : 'warning';
    console.log(`::${level} file=${issue.file},line=${issue.line}::${issue.description} [${issue.category}]`);
  });

  // Critical files as warnings
  impact.criticalFiles.forEach(file => {
    console.log(`::warning file=${file}::⚠️ Fichier critique modifié — revue approfondie requise`);
  });

  // Summary annotation
  const threshold = CONFIG.thresholds[impact.level.toLowerCase()] || CONFIG.thresholds.block;
  if (impact.level === 'BLOCK') {
    console.log(`::error::${threshold.emoji} Score de risque : ${impact.score}/100 — MERGE BLOQUÉ. ${impact.criticalFiles.length} fichier(s) critique(s), ${impact.securityIssues.length} alerte(s) sécurité, ${impact.tables.size} table(s) impactée(s).`);
  } else if (impact.level === 'REVIEW') {
    console.log(`::warning::${threshold.emoji} Score de risque : ${impact.score}/100 — Revue manuelle requise. ${impact.criticalFiles.length} fichier(s) critique(s), ${impact.tables.size} table(s) impactée(s).`);
  } else {
    console.log(`::notice::${threshold.emoji} Score de risque : ${impact.score}/100 — SAFE. Aucun risque majeur détecté.`);
  }
}

// ── Génération commentaire PR ────────────────────────────────
function generatePRComment(impact) {
  const threshold = CONFIG.thresholds[impact.level.toLowerCase()] || CONFIG.thresholds.block;
  const bar = '█'.repeat(Math.round(impact.score / 5)) + '░'.repeat(20 - Math.round(impact.score / 5));

  let comment = `## ${threshold.emoji} Analyse d'impact — Score : ${impact.score}/100\n\n`;
  comment += `**Niveau : ${impact.level}** — ${threshold.action}\n\n`;
  comment += `\`[${bar}]\`\n\n`;

  comment += `### 📊 Résumé\n\n`;
  comment += `| Métrique | Valeur |\n|----------|--------|\n`;
  comment += `| Fichiers modifiés | ${impact.files.size} |\n`;
  comment += `| Fichiers critiques | ${impact.criticalFiles.length} |\n`;
  comment += `| Tables affectées | ${impact.tables.size} |\n`;
  comment += `| Services externes | ${impact.services.size} |\n`;
  comment += `| Routes impactées | ${impact.routes.size} |\n`;
  comment += `| Alertes sécurité | ${impact.securityIssues.length} |\n\n`;

  if (impact.criticalFiles.length > 0) {
    comment += `### 🔴 Fichiers critiques\n\n`;
    impact.criticalFiles.forEach(f => { comment += `- \`${f}\`\n`; });
    comment += '\n';
  }

  if (impact.securityIssues.length > 0) {
    comment += `### 🛡️ Alertes sécurité\n\n`;
    impact.securityIssues.forEach(i => {
      const sev = i.severity === 'critical' ? '🔴' : i.severity === 'high' ? '🟠' : '🟡';
      comment += `- ${sev} **${i.file}:${i.line}** — ${i.description}\n`;
    });
    comment += '\n';
  }

  if (impact.tables.size > 0) {
    comment += `### 🗄️ Tables impactées\n\n`;
    const criticalTables = CONFIG.tables.critical || [];
    [...impact.tables].forEach(t => {
      const icon = criticalTables.includes(t) ? '🔴' : '⚪';
      comment += `- ${icon} \`${t}\`\n`;
    });
    comment += '\n';
  }

  if (impact.cascadeChains.length > 0) {
    comment += `### ⛓️ Cascades\n\n`;
    const unique = [...new Set(impact.cascadeChains.map(c => c.chain))];
    unique.forEach(chain => {
      const c = impact.cascadeChains.find(x => x.chain === chain);
      comment += `- **${chain}** : \`${c.affectedFiles.join(' → ')}\`\n`;
    });
    comment += '\n';
  }

  comment += `\n---\n*Généré par le coffre-fort Komerce v1.0*`;

  return comment;
}

// ── Exécution principale ─────────────────────────────────────
function main() {
  const changedFiles = getChangedFiles();
  const changedLines = getChangedLineMap();

  if (args.verbose) {
    console.log(`\n📂 ${changedFiles.length} fichier(s) à analyser...\n`);
  }

  const impact = analyzeImpact(changedFiles, changedLines);

  // Sortie console (sauf si --json seul)
  if (!args.json || args.verbose) {
    outputConsole(impact);
  }

  // Sortie JSON
  if (args.json) {
    outputJSON(impact);
  }

  // Sortie CI
  if (args.ci) {
    outputCI(impact);
  }

  // Générer le commentaire PR (fichier temp pour GitHub Action)
  if (args.ci) {
    const comment = generatePRComment(impact);
    const commentPath = path.join(process.cwd(), '.impact-report.md');
    fs.writeFileSync(commentPath, comment);
  }

  // Code de sortie basé sur le niveau
  if (args.ci && impact.level === 'BLOCK') {
    process.exit(1); // Fail the CI check
  }

  process.exit(0);
}

// ── Go ! ─────────────────────────────────────────────────────
if (require.main === module) main();

module.exports = {
  scanSecurity, suppressSecurity, isSafeInterp,
  calculateScore, getLevel, getChangedLineMap, analyzeImpact
};
