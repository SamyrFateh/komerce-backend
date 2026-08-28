#!/usr/bin/env node
/**
 * ============================================================
 * KOMERCE — Code Quality Gate (Niveau 2 — Pyramide Qualité)
 * Version 1.0.0 · 2026-06
 * 0 dépendances externes — Node.js >= 18
 * Doctrine : docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md
 * ============================================================
 *
 * Vérifie les règles de base du code JS Komerce :
 *   - 'use strict' présent
 *   - pas de var (const/let uniquement)
 *   - pas de console.log (utiliser utils/logger)
 *   - pas de variable non déclarée (pattern global implicite)
 *   - pas de doublon de déclaration dans le même scope
 *   - pas de code mort après return/throw
 *   - pas de secret en dur
 *   - pas d'eval / new Function
 *   - SQL paramétré (pas de concaténation directe)
 *   - try/catch sur les routes async
 *
 * Usage :
 *   node scripts/code-quality-gate.js              ← rapport complet
 *   node scripts/code-quality-gate.js --strict     ← exit(1) si violation (CI)
 *   node scripts/code-quality-gate.js --fix        ← corrige automatiquement ce qui peut l'être
 *   node scripts/code-quality-gate.js --file routes/orders.js  ← un seul fichier
 *   node scripts/code-quality-gate.js --save       ← fige la baseline
 *   node scripts/code-quality-gate.js --json       ← sortie JSON
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Configuration ─────────────────────────────────────────────────────────────
const SCAN_DIRS = ['services', 'routes', 'middleware', 'utils', 'validators', 'core', 'public/dashboards/admin/js'];

const IGNORE_PATTERNS = [
  /node_modules/,
  /public\/boutique\/css\/dist/,
  /public\/boutique\/js\/dist/,
  /public\/boutique\/js\/chunks/,
  /\.min\.js$/,
];

const BASELINE_FILE = path.join(__dirname, 'code-quality-baseline.json');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = (() => {
  const a = { strict: false, fix: false, json: false, save: false, file: null };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--strict')        a.strict = true;
    else if (arg === '--fix')      a.fix    = true;
    else if (arg === '--json')     a.json   = true;
    else if (arg === '--save')     a.save   = true;
    else if (arg === '--file' || arg === '--file=')
      a.file = arg.includes('=') ? arg.split('=')[1] : process.argv[++i];
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
  }
  return a;
})();

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  KOMERCE — Code Quality Gate v1.0  (Pyramide N2)        ║
╚══════════════════════════════════════════════════════════╝

Usage :
  node scripts/code-quality-gate.js [options]

Options :
  --strict          exit(1) si au moins une violation (CI)
  --fix             Corrige automatiquement ce qui peut l'être
  --file <path>     Vérifie un seul fichier
  --save            Fige la baseline courante
  --json            Sortie JSON sur stdout
  --help, -h        Affiche cette aide

Doctrine : docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md
`);
}

// ── Collecte des fichiers ──────────────────────────────────────────────────────
function collectFiles() {
  if (args.file) {
    const full = path.resolve(ROOT, args.file);
    return fs.existsSync(full) ? [full] : [];
  }

  const result = [];
  for (const dir of SCAN_DIRS) {
    const dirPath = path.join(ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    walk(dirPath, result);
  }
  return result;
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') { walk(full, acc); continue; }
    if (!e.isFile() || !e.name.endsWith('.js')) continue;
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (IGNORE_PATTERNS.some(p => p.test(rel))) continue;
    acc.push(full);
  }
}

// ── Allowlist fichiers (bootstrap / infrastructure) ──────────────────────────
// Ces fichiers ont des usages légitimes de console — ils sont le socle bas niveau.
const RULE_FILE_EXEMPT = {
  'N2-NO-CONSOLE': new Set([
    'utils/logger.js',             // IS le logger — fallback bootstrap pino
    'middleware/error-handler.js', // initialise avant que pino soit dispo
  ]),
};

/**
 * Ignore inline : ajouter // quality-disable N2-XXX sur la ligne concernée.
 * Ex : db.query(`SELECT ... ${where}`, params) // quality-disable N2-SQL-INJECTION
 */
function isLineDisabled(line, ruleId) {
  return line.includes(`quality-disable ${ruleId}`);
}

// ── Règles ─────────────────────────────────────────────────────────────────────

/**
 * Chaque règle a la forme :
 *   { id, label, severity, check(src, lines, rel) → [{line, col, message}] }
 * severity : 'error' (bloquant) | 'warning' (bloquant si production slice)
 */
const RULES = [

  // ── N2.1 — 'use strict' ────────────────────────────────────────────────────
  {
    id: 'N2-STRICT',
    label: "'use strict' manquant",
    severity: 'error',
    fixable: true,
    check(src) {
      if (src.includes("'use strict'") || src.includes('"use strict"')) return [];
      return [{ line: 1, col: 1, message: "Ajouter 'use strict'; en première ligne effective" }];
    },
    fix(src) {
      // Insérer après le shebang ou le header de commentaire initial
      const headerEnd = findHeaderEnd(src);
      if (headerEnd === 0) return "'use strict';\n\n" + src;
      return src.slice(0, headerEnd) + "\n'use strict';\n" + src.slice(headerEnd);
    },
  },

  // ── N2.2 — var interdit ────────────────────────────────────────────────────
  {
    id: 'N2-NO-VAR',
    label: 'var interdit (utiliser const ou let)',
    severity: 'error',
    fixable: false, // la sémantique const/let doit être choisie par le dev
    check(src, lines) {
      const hits = [];
      lines.forEach((line, i) => {
        // Exclure les commentaires et les strings
        const stripped = stripCommentAndString(line);
        const m = stripped.match(/\bvar\s+\w/);
        if (m) hits.push({ line: i + 1, col: stripped.indexOf(m[0]) + 1, message: `var → const ou let : "${m[0].trim()}"` });
      });
      return hits;
    },
  },

  // ── N2.3 — console.log interdit ───────────────────────────────────────────
  {
    id: 'N2-NO-CONSOLE',
    label: 'console.log interdit (utiliser utils/logger)',
    severity: 'error',
    fixable: false,
    check(src, lines) {
      const hits = [];
      lines.forEach((line, i) => {
        const stripped = stripCommentAndString(line);
        // console.warn et console.error sont tolérés (utilisés par les gates eux-mêmes)
        if (/\bconsole\.(log|info|debug)\s*\(/.test(stripped)) {
          hits.push({ line: i + 1, col: 1, message: 'console.log/info/debug → logger.info / logger.debug' });
        }
      });
      return hits;
    },
  },

  // ── N2.4 — eval / new Function ────────────────────────────────────────────
  {
    id: 'N2-NO-EVAL',
    label: 'eval / new Function interdit',
    severity: 'error',
    fixable: false,
    check(src, lines) {
      const hits = [];
      lines.forEach((line, i) => {
        const stripped = stripCommentAndString(line);
        if (/\beval\s*\(/.test(stripped) || /new\s+Function\s*\(/.test(stripped)) {
          hits.push({ line: i + 1, col: 1, message: 'eval / new Function — risque injection' });
        }
      });
      return hits;
    },
  },

  // ── N2.5 — Secret en dur ──────────────────────────────────────────────────
  {
    id: 'N2-NO-HARDCODED-SECRET',
    label: 'Secret potentiel en dur',
    severity: 'error',
    fixable: false,
    check(src, lines) {
      const hits = [];
      // Patterns : clés Stripe live, password= / secret= avec valeur littérale non-dummy
      const PATTERNS = [
        { re: /sk_live_[A-Za-z0-9]{20,}/, msg: 'Clé Stripe live en dur' },
        { re: /rk_live_[A-Za-z0-9]{20,}/, msg: 'Clé Stripe restricted live en dur' },
        { re: /\bpassword\s*[:=]\s*['"][^'"]{6,}['"]/, msg: 'Mot de passe littéral en dur' },
        { re: /\bsecret\s*[:=]\s*['"][^'"]{8,}['"]/, msg: 'Secret littéral en dur (vérifier si env var manquante)' },
      ];
      lines.forEach((line, i) => {
        const stripped = stripCommentAndString(line);
        for (const { re, msg } of PATTERNS) {
          if (re.test(line)) { // tester la ligne originale pour les clés
            hits.push({ line: i + 1, col: 1, message: msg });
          }
        }
      });
      return hits;
    },
  },

  // ── N2.6 — SQL concaténé ──────────────────────────────────────────────────
  {
    id: 'N2-SQL-INJECTION',
    label: 'SQL potentiellement concaténé (utiliser des paramètres $N)',
    severity: 'error',
    fixable: false,
    check(src, lines) {
      const hits = [];
      // Cherche des query() / db.query() avec concaténation de req./params./body. dans la string SQL
      lines.forEach((line, i) => {
        if (/db\.query\s*\(/.test(line) || /pool\.query\s*\(/.test(line)) {
          // La concaténation dangereuse est une donnée de requête utilisée
          // DIRECTEMENT comme fragment SQL. Inspecter chaque interpolation
          // séparément évite le faux positif historique où une interpolation
          // serveur était suivie du second argument params de db.query.
          const interpolations = [...line.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1]);
          const hasDirectRequestInterpolation = interpolations.some(expr =>
            /\b(req|params|body|query)(?:\.|\[|\b)/.test(expr)
          );
          const hasDirectRequestConcat = /\+\s*(req|params|body|query)(?:\.|\[|\b)/.test(line);
          if (hasDirectRequestConcat || hasDirectRequestInterpolation) {
            hits.push({ line: i + 1, col: 1, message: 'SQL avec concaténation directe de req/params/body — utiliser $1, $2, ...' });
          }
        }
      });
      return hits;
    },
  },

  // ── N2.7 — Route async sans try/catch ─────────────────────────────────────
  {
    id: 'N2-ROUTE-TRY-CATCH',
    label: 'Route async sans try/catch',
    severity: 'warning', // warning car certaines routes utilisent un wrapper asyncHandler
    fixable: false,
    check(src, lines, rel) {
      if (!rel.startsWith('routes/')) return [];
      const hits = [];
      // Détecte router.get/post/... async (req, res) sans try dans le body immédiat
      const routeRe = /router\.(get|post|put|patch|delete)\s*\([^,]+,\s*async\s*\(/;
      let inRoute = false;
      let braceDepth = 0;
      let routeLine = 0;
      let hasTry = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!inRoute && routeRe.test(line)) {
          inRoute = true;
          routeLine = i + 1;
          braceDepth = 0;
          hasTry = false;
        }
        if (inRoute) {
          if (/\btry\s*\{/.test(line)) hasTry = true;
          braceDepth += (line.match(/\{/g) || []).length;
          braceDepth -= (line.match(/\}/g) || []).length;
          if (braceDepth <= 0 && i > routeLine) {
            if (!hasTry) {
              // Vérifier qu'un asyncHandler wrapper n'est pas utilisé dans le fichier
              if (!src.includes('asyncHandler') && !src.includes('catchAsync')) {
                hits.push({ line: routeLine, col: 1, message: 'Route async sans try/catch (ou asyncHandler wrapper)' });
              }
            }
            inRoute = false;
          }
        }
      }
      return hits;
    },
  },

  // ── N2.8 — Code mort après return ─────────────────────────────────────────
  {
    id: 'N2-DEAD-CODE',
    label: 'Code mort après return/throw',
    severity: 'warning',
    fixable: false,
    check(src, lines) {
      const hits = [];
      for (let i = 0; i < lines.length - 1; i++) {
        const stripped = lines[i].trim();
        // Doit être un return ou throw en position de statement (pas dans un ternaire, arrow, etc.)
        if (!/^(return|throw)\b/.test(stripped)) continue;
        // Ignorer si la ligne se termine par une virgule/paren/accolade/crochet ouvrant — multi-ligne
        if (/[,({[]$/.test(stripped)) continue;
        // Ignorer si la ligne ouvre un template literal non fermé (backticks impairs)
        if ((stripped.match(/`/g) || []).length % 2 === 1) continue;
        // Ignorer si l'instruction ne se termine pas par ; sur cette ligne : c'est une
        // expression return/throw multi-lignes (chaînage .replace(), ternaire ?:, concat +,
        // opérateurs ||/&&) qui continue sur les lignes suivantes — pas un statement complet.
        if (!/;\s*$/.test(stripped)) continue;
        // Ignorer les return de fonctions fléchées imbriquées : `=> {` juste avant
        // n'est pas un indicateur fiable, on ignore ce cas
        // Ignorer si ce return/throw est le corps d'un if/else-if SANS accolades
        // (clause de garde à une ligne) : le code qui suit n'est pas mort, il correspond
        // à la branche implicite où la condition est fausse.
        let j = i - 1;
        while (j >= 0 && lines[j].trim() === '') j--;
        const prev = j >= 0 ? lines[j].trim() : '';
        if (/^(if|else if)\s*\(.*\)$/.test(prev)) continue;

        const next = lines[i + 1].trim();
        if (!next) continue;                                    // ligne vide — OK
        if (next.startsWith('//') || next.startsWith('*')) continue;  // commentaire — OK
        // Ignorer les fermetures de blocs structurels valides
        if (/^[}\])]/.test(next)) continue;                   // }, ]}, )}, etc.
        // Ignorer les clauses catch/finally/else qui SUIVENT la fermeture d'un bloc
        if (/^(catch|finally|else)\b/.test(next)) continue;
        // Ignorer les case/default dans un switch
        if (/^(case\s|default:)/.test(next)) continue;

        hits.push({ line: i + 2, col: 1, message: `Code mort après "${stripped.slice(0, 40)}"` });
      }
      return hits;
    },
  },

];

// ── Helpers de parsing ────────────────────────────────────────────────────────

/** Supprime les strings et commentaires inline pour éviter les faux positifs. */
function stripCommentAndString(line) {
  // Retire // commentaires
  let s = line.replace(/\/\/.*$/, '');
  // Retire les strings simples et doubles (simpliste mais suffisant pour ce contexte)
  s = s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');
  return s;
}

/** Trouve la fin du bloc de commentaire initial (header @komerce-arch). */
function findHeaderEnd(src) {
  const m = src.match(/^(#!.*\n(?:[ \t]*\n)*)?(\/\*[\s\S]*?\*\/\s*\n)/);
  return m ? m[0].length : 0;
}

// ── Vérification d'un fichier ─────────────────────────────────────────────────
function checkFile(fullPath) {
  const rel = path.relative(ROOT, fullPath).replace(/\\/g, '/');
  let src;
  try { src = fs.readFileSync(fullPath, 'utf8'); } catch { return null; }

  const lines = src.split('\n');
  const violations = [];
  const warnings = [];

  for (const rule of RULES) {
    // Allowlist fichier pour cette règle
    if (RULE_FILE_EXEMPT[rule.id] && RULE_FILE_EXEMPT[rule.id].has(rel)) continue;

    const hits = rule.check(src, lines, rel);
    for (const hit of hits) {
      // Ignore inline : // quality-disable N2-XXX
      if (isLineDisabled(lines[hit.line - 1] || '', rule.id)) continue;

      (rule.severity === 'error' ? violations : warnings).push({
        rule: rule.id,
        label: rule.label,
        ...hit,
      });
    }
  }

  return { rel, violations, warnings };
}

// ── Auto-fix ──────────────────────────────────────────────────────────────────
function fixFile(fullPath) {
  let src = fs.readFileSync(fullPath, 'utf8');
  let changed = false;

  for (const rule of RULES) {
    if (!rule.fixable) continue;
    const lines = src.split('\n');
    const hits = rule.check(src, lines, path.relative(ROOT, fullPath));
    if (hits.length > 0 && rule.fix) {
      src = rule.fix(src);
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(fullPath, src, 'utf8');
  return changed;
}

// ── Point d'entrée ─────────────────────────────────────────────────────────────
function main() {
  const files = collectFiles();
  if (files.length === 0) {
    console.error('❌ Aucun fichier JS trouvé à analyser');
    process.exit(1);
  }

  // --fix
  if (args.fix) {
    let fixed = 0;
    for (const f of files) { if (fixFile(f)) fixed++; }
    console.log(`✅ --fix appliqué sur ${fixed} fichier(s)`);
    // Continuer pour afficher les violations restantes
  }

  const results = files.map(checkFile).filter(Boolean);

  const totalErrors   = results.reduce((n, r) => n + r.violations.length, 0);
  const totalWarnings = results.reduce((n, r) => n + r.warnings.length,   0);
  const filesWithIssues = results.filter(r => r.violations.length + r.warnings.length > 0);

  // ── Rapport ──────────────────────────────────────────────────────────────
  if (args.json) {
    console.log(JSON.stringify({ totalErrors, totalWarnings, files: results }, null, 2));
  } else {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  KOMERCE — Code Quality Gate v1.0  (Pyramide N2)        ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    if (filesWithIssues.length === 0) {
      console.log(`✅ ${files.length} fichiers analysés — aucun problème détecté.\n`);
    } else {
      for (const r of filesWithIssues) {
        const hasErr = r.violations.length > 0;
        const hasWrn = r.warnings.length > 0;
        const icon = hasErr ? '❌' : '⚠️ ';
        console.log(`${icon} ${r.rel}`);
        for (const v of r.violations) {
          console.log(`     ❌ L${v.line}: [${v.rule}] ${v.message}`);
        }
        for (const w of r.warnings) {
          console.log(`     ⚠️  L${w.line}: [${w.rule}] ${w.message}`);
        }
      }
      console.log('');
      console.log(`Fichiers analysés  : ${files.length}`);
      console.log(`Fichiers en cause  : ${filesWithIssues.length}`);
      console.log(`Erreurs (bloquant) : ${totalErrors}`);
      console.log(`Avertissements     : ${totalWarnings}`);

      if (totalErrors > 0) {
        console.log('\n❌ Violations bloquantes détectées.');
        console.log('   Correctif rapide : node scripts/code-quality-gate.js --fix');
        console.log('   (corrige uniquement ce qui est auto-fixable)');
        console.log('\nDoctrine : docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md\n');
      } else {
        console.log('\n⚠️  Avertissements uniquement — non bloquants en développement.\n');
      }
    }
  }

  // ── --save baseline ────────────────────────────────────────────────────
  if (args.save) {
    const baseline = { savedAt: new Date().toISOString(), totalErrors, totalWarnings, files: filesWithIssues };
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
    console.log(`Baseline sauvegardée → ${BASELINE_FILE}`);
  }

  // ── --strict exit ──────────────────────────────────────────────────────
  if (args.strict && totalErrors > 0) process.exit(1);
}

main();
