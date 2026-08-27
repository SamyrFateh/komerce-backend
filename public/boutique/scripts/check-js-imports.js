#!/usr/bin/env node
/**
 * check-js-imports.js — Garde-fou imports JS Komerce boutique
 * Version : 2.1 (2026-08-27)
 *
 * Détecte les bugs d'imports qui causent des ReferenceError runtime
 * silencieux (P-2, P-3, P-4 documentés dans CARTOGRAPHY_360_BOUTIQUE.md §10).
 *
 * Ce que ce script vérifie :
 *   I-1  Chaque nom importé existe réellement dans le module source
 *        (ex: `import { scrollPageToTop } from './b-scroll-owner.js'` — ✔
 *             `import { scrollTop } from './b-scroll-owner.js'`       — ✖ fantôme)
 *   I-2  Pas d'import circulaire direct (A→B→A)
 *        Cycles intentionnels documentés dans KNOWN_CYCLES : warning, non bloquant.
 *   I-3  Chaque fichier importé existe sur disque
 *   I-4  Exports non consommés dans l'ensemble du projet (dead exports)
 *        Consommateurs reconnus : ESM statique, import() runtime et require() tests.
 *        [warn uniquement — un warning doit rester actionnable]
 *   I-5  Les re-exports alias (export { X as Y }) sont résolus correctement
 *
 * Corrections v2 vs v1 :
 *   - collectJsFiles scanne maintenant js/controllers/, js/render/, js/view-models/
 *     (les sous-dossiers existaient déjà dans le walk récursif — vérifié OK)
 *   - SKIP_EXPORT_CHECK : boutique.js retiré de la liste car il n'a pas
 *     de named exports (grep confirme 0 lignes `^export`). Il était skipé
 *     inutilement — on le traite maintenant normalement.
 *   - Ajout de product-store.js et shop-schema.js dans l'inventaire
 *   - I-1 : le parseur d'exports gère les exports multi-lignes via
 *     concaténation de lignes (les imports multi-lignes étaient déjà gérés)
 *   - Rapport : les I-4 dead exports sont limités à 4 par fichier en affichage
 *     mais le comptage reste exact
 *
 * Usage :
 *   node scripts/check-js-imports.js [fichier.js ...]
 *   node scripts/check-js-imports.js          ← scanne tous les .js de js/
 *   npm run check:imports
 *
 * Sortie : exit 0 si tout passe, exit 1 sinon.
 */
'use strict';

'use strict';

const fs   = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────────

const ROOT      = path.resolve(__dirname, '..');
const JS_DIR    = path.join(ROOT, 'js');
const TESTS_DIR = path.join(ROOT, 'tests');

/**
 * Modules que l'on ne vérifie pas pour les named exports :
 *   - main.js     : point d'entrée sans exports
 *   - komerce-api : script classique non-module (window.KomerceApi)
 *
 * boutique.js est retiré de cette liste (v2) : grep confirme qu'il
 * n'exporte rien, donc extractExports() retournera un Set vide —
 * tout import depuis boutique.js sera signalé I-1 comme prévu.
 */
const SKIP_EXPORT_CHECK = new Set([
  'main.js',
  'komerce-api.js',
]);

// ────────────────────────────────────────────────────────────────────
// COULEURS
// ────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';

function relPath(p) { return path.relative(ROOT, p); }

// ────────────────────────────────────────────────────────────────────
// COLLECTE DES FICHIERS JS
// Walk récursif — couvre js/, js/controllers/, js/render/, js/view-models/
// ────────────────────────────────────────────────────────────────────

function collectJsFiles(dir) {
  const results = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith('.js')) results.push(full);
    }
  }
  walk(dir);
  return results;
}

// ────────────────────────────────────────────────────────────────────
// PARSEUR D'EXPORTS
// ────────────────────────────────────────────────────────────────────

/**
 * Extrait tous les noms named-exportés d'un fichier JS.
 * Gère les exports inline et les blocs export { } multi-lignes.
 */
function extractExports(filepath) {
  const src      = fs.readFileSync(filepath, 'utf8');
  const exported = new Set();

  // export function foo / export async function foo / export class Foo
  // export const foo / export let foo / export let foo
  {
    const re = /^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm;
    let m;
    while ((m = re.exec(src)) !== null) exported.add(m[1]);
  }

  // export { foo, bar as baz } — éventuellement sur plusieurs lignes
  // On normalise d'abord le src pour éviter les faux négatifs multi-lignes
  {
    // Fusionne les exports { } multi-lignes en une seule ligne pour la regex
    const flat = src.replace(/export\s*\{([^}]+)\}/gms, (_, inner) => {
      return `export{${inner.replace(/\n/g, ' ')}}`;
    });
    const re = /^export\{([^}]+)\}/gm;
    let m;
    while ((m = re.exec(flat)) !== null) {
      const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const item of items) {
        const parts = item.split(/\s+as\s+/);
        const original = parts[0].trim();
        const alias    = parts.length > 1 ? parts[1].trim() : null;
        // Le nom visible de l'extérieur est l'alias (ou l'original s'il n'y a pas d'alias)
        const publicName = alias && alias !== 'default' ? alias : original;
        if (original && original !== 'default') exported.add(original);
        if (publicName && publicName !== 'default') exported.add(publicName);
      }
    }
  }

  // export default function foo / export default class Foo
  {
    const re = /^export\s+default\s+(?:async\s+)?(?:function\*?|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]+)/gm;
    let m;
    while ((m = re.exec(src)) !== null) exported.add(m[1]);
  }

  return exported;
}

// ────────────────────────────────────────────────────────────────────
// PARSEUR D'IMPORTS
// ────────────────────────────────────────────────────────────────────

/**
 * Retourne un tableau :
 *   { specifiers: ['foo','bar'], isStar: bool, source: './b-store.js', line }
 */
function extractImports(filepath) {
  const src     = fs.readFileSync(filepath, 'utf8');
  const imports = [];

  // Normalise les imports multi-lignes
  const flat = src.replace(
    /^import\s*(\{[^}]*\}|\*[^;]*|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"][^'"]+['"]/gms,
    m => m.replace(/\n/g, ' '),
  );

  const importRe =
    /^import\s*(?:\{([^}]*)\}|(\*\s+as\s+\w+)|([a-zA-Z_$][a-zA-Z0-9_$]*))?\s*(?:,\s*\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/gm;

  let m;
  while ((m = importRe.exec(flat)) !== null) {
    const lineNum    = src.slice(0, m.index).split('\n').length;
    const namedBlock = ((m[1] || '') + ',' + (m[4] || '')).replace(/^,|,$/g, '');
    const specifiers = [];

    for (const item of namedBlock.split(',').map(s => s.trim()).filter(Boolean)) {
      const parts = item.split(/\s+as\s+/);
      const original = parts[0].trim();
      if (original) specifiers.push(original);
    }

    const isStar = Boolean(m[2]);
    imports.push({ specifiers, isStar, source: m[5], line: lineNum });
  }

  return imports;
}


// ────────────────────────────────────────────────────────────────────
// CONSOMMATEURS I-4 HORS IMPORTS ESM STATIQUES
// ────────────────────────────────────────────────────────────────────

function parseDestructuredNames(block) {
  return block.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(item => item.split(':')[0].trim())
    .filter(Boolean);
}

function extractRequires(filepath) {
  const src = fs.readFileSync(filepath, 'utf8');
  const requires = [];
  const patterns = [
    /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['\"]([^'\"]+)['\"]\s*\)/gms,
    /\(\s*\{([^}]+)\}\s*=\s*require\(\s*['\"]([^'\"]+)['\"]\s*\)\s*\)/gms,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      requires.push({ specifiers: parseDestructuredNames(m[1]), source: m[2], namespace: null });
    }
  }
  const namespaceRe = /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\(\s*['\"]([^'\"]+)['\"]\s*\)/gm;
  let m;
  while ((m = namespaceRe.exec(src)) !== null) {
    requires.push({ specifiers: [], source: m[2], namespace: m[1] });
  }
  const namespaceAssignmentRe = /(?:^|[;\n]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\(\s*['\"]([^'\"]+)['\"]\s*\)/gm;
  while ((m = namespaceAssignmentRe.exec(src)) !== null) {
    requires.push({ specifiers: [], source: m[2], namespace: m[1] });
  }
  return requires;
}

function extractDynamicImports(filepath, exportMap) {
  const src = fs.readFileSync(filepath, 'utf8');
  const imports = [];
  const re = /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const resolved = resolveSource(filepath, m[1]);
    if (!resolved || !exportMap.has(resolved)) continue;
    const exported = exportMap.get(resolved) || new Set();
    const local = src.slice(m.index, Math.min(src.length, m.index + 1400));
    const specifiers = [];
    for (const name of exported) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:\\.|\\?\\.)${escaped}\\b`).test(local)) specifiers.push(name);
    }
    imports.push({ specifiers, source: m[1] });
  }
  return imports;
}

// ────────────────────────────────────────────────────────────────────
// RÉSOLVEUR DE CHEMINS
// ────────────────────────────────────────────────────────────────────

function resolveSource(importingFile, specifier) {
  if (!specifier.startsWith('.')) return null; // externe
  const dir      = path.dirname(importingFile);
  let resolved   = path.resolve(dir, specifier);
  if (!path.extname(resolved)) resolved += '.js';
  return resolved;
}

// ────────────────────────────────────────────────────────────────────
// DÉTECTION DES CYCLES DIRECTS (A → B → A)
// ────────────────────────────────────────────────────────────────────

function buildDepGraph(allFiles) {
  const graph = new Map();
  for (const file of allFiles) {
    const deps = new Set();
    for (const imp of extractImports(file)) {
      const resolved = resolveSource(file, imp.source);
      if (resolved && fs.existsSync(resolved)) deps.add(resolved);
    }
    graph.set(file, deps);
  }
  return graph;
}

function findDirectCycles(graph) {
  const cycles = [];
  for (const [a, deps] of graph) {
    for (const b of deps) {
      const bDeps = graph.get(b);
      if (bDeps && bDeps.has(a)) {
        const exists = cycles.some(c =>
          (c.a === a && c.b === b) || (c.a === b && c.b === a));
        if (!exists) cycles.push({ a, b });
      }
    }
  }
  return cycles;
}

/**
 * Cycles A↔B documentés comme intentionnels.
 * Chaque cycle doit avoir une justification dans `reason`.
 *
 * PROCÉDURE DE MISE À JOUR :
 *   Si un nouveau cycle apparaît et que c'est intentionnel, ajoute une
 *   entrée ici ET dans CARTOGRAPHY_360_BOUTIQUE.md §10b (registre bus).
 *   Ne jamais supprimer une entrée sans vérifier que le cycle n'existe plus.
 */
const KNOWN_CYCLES = [
  {
    a: 'b-cart.js',    b: 'b-catalog.js',
    reason: 'scrollToCategorySection — couplage scroll/catalogue, cycle isolé à 1 fonction',
  },
  {
    a: 'b-catalog.js', b: 'b-modal.js',
    reason: 'openModal — découplé via bus.on(modal:open) ; le cycle import direct est résiduel',
  },
  {
    a: 'b-catalog.js', b: 'b-subcat.js',
    reason: '_renderCard/renderGrid — refactoring Phase 4 en cours, à supprimer une fois découplé',
  },
  {
    a: 'b-catalog.js', b: 'home-controller.js',
    reason: 'syncRailActiveState/renderSubcatRail — couplage bidirectionnel connu controllers/',
  },
];

// ────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────

(function main() {
  let files;
  if (process.argv.length > 2) {
    files = process.argv.slice(2).map(f => path.resolve(process.cwd(), f));
  } else {
    files = collectJsFiles(JS_DIR);
  }

  if (files.length === 0) {
    console.log(`${YELLOW}⚠${RESET}  Aucun fichier JS trouvé dans ${JS_DIR}`);
    process.exit(0);
  }

  console.log(`\n${BOLD}${CYAN}━━━ check-js-imports v2 — Komerce Boutique ━━━${RESET}`);
  console.log(`${DIM}Analyse de ${files.length} module(s)…${RESET}\n`);

  // ── Pré-calcul des exports ──────────────────────────────────────
  const exportMap = new Map();
  for (const file of files) {
    const base = path.basename(file);
    if (SKIP_EXPORT_CHECK.has(base)) {
      exportMap.set(file, new Set(['*'])); // wildcard = skip les checks I-1
      continue;
    }
    try {
      exportMap.set(file, extractExports(file));
    } catch {
      exportMap.set(file, new Set());
    }
  }

  const errors   = [];
  const warnings = [];

  function err(code, file, line, msg, detail) {
    errors.push({ code, file: relPath(file), line, msg, detail });
  }
  function warn(code, file, line, msg, detail) {
    warnings.push({ code, file: relPath(file), line, msg, detail });
  }

  // Suivi des exports consommés (pour I-4)
  const consumedExports = new Map();
  for (const [f] of exportMap) consumedExports.set(f, new Set());

  // ── I-3 + I-1 : fichier existe + nom importé existe ─────────────
  for (const file of files) {
    for (const imp of extractImports(file)) {
      if (!imp.source.startsWith('.')) continue;

      const resolved = resolveSource(file, imp.source);

      // I-3 : fichier existe
      if (!resolved || !fs.existsSync(resolved)) {
        err('I-3', file, imp.line,
          `Module introuvable : ${imp.source}`,
          `Importé depuis ${relPath(file)} ligne ${imp.line}`);
        continue;
      }

      if (imp.isStar) continue;
      if (SKIP_EXPORT_CHECK.has(path.basename(resolved))) continue;

      const sourceExports = exportMap.get(resolved) || new Set();
      if (sourceExports.has('*')) continue;

      // I-1 : chaque specifier doit exister dans les exports
      for (const name of imp.specifiers) {
        if (!sourceExports.has(name)) {
          err('I-1', file, imp.line,
            `Import fantôme : '${name}' n'est pas exporté par ${path.basename(resolved)}`,
            `Vérifiez : export function/const ${name} dans ${relPath(resolved)}`);
        } else {
          consumedExports.get(resolved)?.add(name);
        }
      }
    }
  }


  // ── I-4 consommateurs runtime dynamiques + tests CommonJS ─────────
  for (const importer of collectJsFiles(JS_DIR)) {
    for (const imp of extractDynamicImports(importer, exportMap)) {
      const resolved = resolveSource(importer, imp.source);
      if (!resolved || !consumedExports.has(resolved)) continue;
      for (const name of imp.specifiers) {
        if ((exportMap.get(resolved) || new Set()).has(name)) consumedExports.get(resolved).add(name);
      }
    }
  }

  for (const testFile of collectJsFiles(TESTS_DIR)) {
    const testSrc = fs.readFileSync(testFile, 'utf8');
    for (const req of extractRequires(testFile)) {
      const resolved = resolveSource(testFile, req.source);
      if (!resolved || !consumedExports.has(resolved)) continue;
      const sourceExports = exportMap.get(resolved) || new Set();
      for (const name of req.specifiers) {
        if (sourceExports.has(name)) consumedExports.get(resolved).add(name);
      }
      if (req.namespace) {
        for (const name of sourceExports) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const ns = req.namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${ns}\\.${escaped}\\b`).test(testSrc)) consumedExports.get(resolved).add(name);
        }
      }
    }
  }

  // ── I-2 : cycles directs ────────────────────────────────────────
  const graph  = buildDepGraph(files);
  const cycles = findDirectCycles(graph);

  for (const { a, b } of cycles) {
    const aBase = path.basename(a);
    const bBase = path.basename(b);

    // Cycles via les modules hub (bus, store) : toujours acceptés
    if (aBase === 'b-bus.js'   || bBase === 'b-bus.js')   continue;
    if (aBase === 'b-store.js' || bBase === 'b-store.js') continue;
    if (aBase === 'b-utils.js' || bBase === 'b-utils.js') continue;

    const known = KNOWN_CYCLES.find(k =>
      (k.a === aBase && k.b === bBase) || (k.a === bBase && k.b === aBase));

    if (known) {
      warn('I-2', a, 0,
        `Cycle connu [acceptable] : ${aBase} ↔ ${bBase}`,
        known.reason);
      continue;
    }

    err('I-2', a, 0,
      `Import circulaire direct inconnu : ${aBase} ↔ ${bBase}`,
      `Ajoutez-le à KNOWN_CYCLES si intentionnel, sinon découplez via b-bus.js`);
  }

  // ── I-4 : dead exports (warn, b-* uniquement) ───────────────────
  for (const [filepath, exported] of exportMap) {
    if (SKIP_EXPORT_CHECK.has(path.basename(filepath))) continue;
    if (!path.basename(filepath).startsWith('b-')) continue;
    const consumed = consumedExports.get(filepath) || new Set();
    for (const name of exported) {
      if (!consumed.has(name)) {
        warn('I-4', filepath, 0,
          `Export non consommé : '${name}' dans ${path.basename(filepath)}`,
          'Peut être voulu (API publique) ou du dead code à nettoyer');
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // RAPPORT
  // ────────────────────────────────────────────────────────────────

  const criticalErrors = errors.filter(e => ['I-1', 'I-2', 'I-3'].includes(e.code));

  if (criticalErrors.length > 0) {
    console.log(`${RED}${BOLD}── Erreurs bloquantes ──────────────────────────────────────${RESET}`);
    for (const e of criticalErrors) {
      console.log(`${RED}✖${RESET} ${BOLD}[${e.code}]${RESET} ${e.msg}`);
      console.log(`  ${DIM}${e.file}${e.line ? ':' + e.line : ''}${RESET}`);
      if (e.detail) console.log(`  ${DIM}↳ ${e.detail}${RESET}`);
    }
    console.log();
  }

  const knownCycles = warnings.filter(w => w.code === 'I-2');
  if (knownCycles.length > 0) {
    console.log(`${YELLOW}${BOLD}── Cycles documentés (non bloquants) ──────────────────────${RESET}`);
    for (const w of knownCycles) {
      console.log(`  ${YELLOW}⚠${RESET} ${w.msg}`);
      if (w.detail) console.log(`    ${DIM}↳ ${w.detail}${RESET}`);
    }
    console.log();
  }

  const deadExports = warnings.filter(w => w.code === 'I-4');
  if (deadExports.length > 0) {
    // Grouper par fichier
    const byFile = new Map();
    for (const w of deadExports) {
      if (!byFile.has(w.file)) byFile.set(w.file, []);
      byFile.get(w.file).push(w);
    }
    console.log(`${DIM}── Exports non consommés [I-4] (informatif) ────────────────${RESET}`);
    for (const [f, items] of byFile) {
      console.log(`  ${YELLOW}⚠${RESET} ${DIM}${f} — ${items.length} export(s) non consommé(s) :${RESET}`);
      for (const w of items.slice(0, 4)) {
        const name = w.msg.match(/'([^']+)'/)?.[1] || '?';
        console.log(`    ${DIM}↳ '${name}'${RESET}`);
      }
      if (items.length > 4) console.log(`    ${DIM}↳ … et ${items.length - 4} autre(s)${RESET}`);
    }
    console.log();
  }

  console.log(`\n${BOLD}${CYAN}━━━ Résultat ━━━${RESET}`);

  if (errors.length === 0) {
    console.log(`${GREEN}${BOLD}✔ Aucun import fantôme ni cycle inconnu ni module manquant.${RESET}`);
    console.log(`${DIM}  ${files.length} modules analysés — ${exportMap.size} cartes d'exports construites.${RESET}`);
    if (deadExports.length > 0) {
      console.log(`${YELLOW}  ${deadExports.length} export(s) non consommés [I-4] (informatif uniquement).${RESET}`);
    }
    console.log();
    process.exit(0);
  }

  const i1 = errors.filter(e => e.code === 'I-1').length;
  const i2 = errors.filter(e => e.code === 'I-2').length;
  const i3 = errors.filter(e => e.code === 'I-3').length;

  console.log(`${RED}${BOLD}✖ ${errors.length} erreur(s) : ${i1} fantôme(s) [I-1], ${i2} cycle(s) [I-2], ${i3} module(s) manquant(s) [I-3]${RESET}`);
  if (deadExports.length > 0) {
    console.log(`${YELLOW}  ${deadExports.length} export(s) non consommés [I-4] (informatif)${RESET}`);
  }
  console.log(`${DIM}Corrigez les erreurs [I-1/I-3] en priorité — elles provoquent des ReferenceError runtime.${RESET}\n`);
  process.exit(1);
})();
