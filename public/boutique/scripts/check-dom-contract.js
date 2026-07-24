#!/usr/bin/env node
/**
 * check-dom-contract.js — Garde-fou contrat HTML ↔ JS ↔ CSS Komerce boutique
 * Version : 1.0 (2026-07-24)
 *
 * Né de l'incident #k-modal-main / #k-modal-cart-slot : un commentaire HTML
 * décrivait une structure, le CSS ciblait cette structure, mais les éléments
 * DOM n'avaient jamais été créés — et aucun gate existant ne pouvait le voir.
 * check-html-balance.js (V-5) vérifie des IDs, mais seulement ceux inscrits
 * à la main dans CRITICAL_IDS. Ce script généralise le principe : le HTML,
 * le JS et le CSS doivent s'accorder sur ce qu'ils se réfèrent mutuellement.
 *
 * Ce que ce script vérifie :
 *   V-8   Sélecteurs structurels obligatoires (manifeste requiredSelectors)
 *         présents dans le DOM statique d'index.html
 *   V-9   Classes posées par classList.add/toggle/replace sur des éléments
 *         (hors document.body — déjà couvert par check-body-classes.js)
 *         ont au moins une règle CSS correspondante, sauf allowlist explicite
 *         (logicOnlyClasses = classes lues uniquement en JS, jamais stylées)
 *   V-10  IDs ciblés par getElementById/querySelector('#id') en JS existent
 *         soit statiquement dans index.html, soit sont créés dynamiquement
 *         en JS (détecté automatiquement via `.id = 'x'`, ou listés dans
 *         knownDynamicIds pour les patterns non détectables statiquement).
 *         Exception : deprecatedIds — IDs de legacy/features retirées du HTML
 *         mais dont le JS garde un `if (el) ...` défensif (null-safe par design,
 *         pas un bug). Reporté en info, jamais en erreur.
 *
 * Ce que ce script NE fait PAS (hors scope volontaire) :
 *   - Simuler un vrai moteur de sélecteurs CSS (pas de jsdom en dépendance
 *     de gate statique, cohérent avec check-html-balance.js/check-body-classes.js
 *     qui n'en utilisent pas non plus). "#ancestor .descendant" est résolu
 *     par imbrication de lignes (l'ID doit contenir la classe dans son
 *     intervalle de lignes ouverture→fermeture), pas par un vrai arbre DOM.
 *   - Remplacer un jugement humain sur les classes dynamiques
 *     (`classList.add(\`k-x-${n}\`)`) — celles-ci sont listées en info,
 *     jamais vérifiées automatiquement.
 *
 * Usage :
 *   node scripts/check-dom-contract.js [--strict]
 *   npm run check:dom-contract
 *
 * Sortie : exit 0 si aucune erreur (des warnings n'y font pas obstacle sauf
 * --strict qui promeut les warnings V-9 orphelines en erreurs).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const JS_DIR     = path.join(ROOT, 'js');
const CSS_DIR    = path.join(ROOT, 'css');
const INDEX_HTML = path.join(ROOT, 'index.html');
const MANIFEST   = path.join(ROOT, 'governance', 'dom-contract.json');

const STRICT = process.argv.includes('--strict');

// ────────────────────────────────────────────────────────────────────
// COULEURS
// ────────────────────────────────────────────────────────────────────
const RESET = '\x1b[0m', RED = '\x1b[31m', YELLOW = '\x1b[33m',
      GREEN = '\x1b[32m', BOLD = '\x1b[1m', DIM = '\x1b[2m', CYAN = '\x1b[36m';

function rel(p) { return path.relative(ROOT, p); }

// ────────────────────────────────────────────────────────────────────
// COLLECTE FICHIERS
// ────────────────────────────────────────────────────────────────────
function collectFiles(dir, ext) {
  const out = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'coverage'
        || e.name === 'playwright-report' || e.name === 'test-results') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (e.name.endsWith(ext)) out.push(full);
    }
  }
  walk(dir);
  return out;
}

// ────────────────────────────────────────────────────────────────────
// MANIFESTE
// ────────────────────────────────────────────────────────────────────
function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    console.log(`${YELLOW}⚠  Manifeste introuvable : ${rel(MANIFEST)} — aucun contrat à vérifier.${RESET}`);
    return { requiredSelectors: [], logicOnlyClasses: [], knownDynamicIds: [], deprecatedIds: new Set() };
  }
  const raw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return {
    requiredSelectors: raw.requiredSelectors || [],
    logicOnlyClasses: new Set((raw.logicOnlyClasses || []).map(x => x.class)),
    knownDynamicIds: new Set(raw.knownDynamicIds || []),
    deprecatedIds: new Set((raw.deprecatedIds || []).map(x => x.id)),
  };
}

// ────────────────────────────────────────────────────────────────────
// HTML : tokenizer minimal + intervalles de lignes par ID
// (même logique que check-html-balance.js, dupliquée volontairement —
//  pas de module partagé pour garder chaque gate indépendant/auditable)
// ────────────────────────────────────────────────────────────────────
function parseHtml(src) {
  const openRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\/?>/g;
  const closeRe = /<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/g;
  const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

  // Tokenise séquentiellement (ouvertures + fermetures mêlées, dans l'ordre du texte)
  const tokens = [];
  const combinedRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  let m;
  while ((m = combinedRe.exec(src)) !== null) {
    const raw = m[0];
    const isClose = raw[1] === '/';
    const name = m[1].toLowerCase();
    const lineNum = src.slice(0, m.index).split('\n').length;
    if (isClose) {
      tokens.push({ type: 'close', name, line: lineNum });
    } else {
      const attrsStr = m[2] || '';
      const selfClose = m[3] === '/' || VOID_TAGS.has(name);
      const idMatch = attrsStr.match(/\bid\s*=\s*["']([^"']+)["']/);
      const classMatch = attrsStr.match(/\bclass\s*=\s*["']([^"']*)["']/);
      tokens.push({
        type: selfClose ? 'selfclose' : 'open',
        name, line: lineNum,
        id: idMatch ? idMatch[1] : null,
        classes: classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [],
      });
    }
  }

  // Construit id → { startLine, endLine } via une pile
  const idRanges = new Map();
  const allClasses = new Set();
  const stack = [];
  for (const tok of tokens) {
    if (tok.type === 'open') {
      stack.push(tok);
      tok.classes.forEach(c => allClasses.add(c));
      continue;
    }
    if (tok.type === 'selfclose') {
      tok.classes.forEach(c => allClasses.add(c));
      if (tok.id) idRanges.set(tok.id, { startLine: tok.line, endLine: tok.line });
      continue;
    }
    // close : dépile jusqu'au tag correspondant
    const idx = stack.map(s => s.name).lastIndexOf(tok.name);
    if (idx === -1) continue;
    const opened = stack.splice(idx)[0];
    if (opened.id) {
      idRanges.set(opened.id, { startLine: opened.line, endLine: tok.line });
    }
  }
  // Tags jamais fermés (fin de fichier) : laissent une plage ouverte jusqu'à la fin
  const totalLines = src.split('\n').length;
  for (const s of stack) {
    if (s.id && !idRanges.has(s.id)) idRanges.set(s.id, { startLine: s.line, endLine: totalLines });
  }

  return { idRanges, allClasses };
}

/** Retourne les lignes brutes contenant class="..." pour vérifier une classe dans un intervalle */
function classPresentInRange(src, className, range) {
  const lines = src.split('\n').slice(range.startLine - 1, range.endLine);
  const re = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRe(className)}\\b[^"']*["']`);
  return lines.some(l => re.test(l));
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Coupe une liste d'arguments sur les virgules de premier niveau (hors quotes/parens). */
function splitTopLevelArgs(args) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      cur += c;
      if (c === quote && args[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ────────────────────────────────────────────────────────────────────
// CSS : ensemble des classes stylées
// ────────────────────────────────────────────────────────────────────
function collectCssClasses(cssFiles) {
  const classes = new Set();
  for (const f of cssFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) classes.add(m[1]);
  }
  return classes;
}

// ────────────────────────────────────────────────────────────────────
// JS : classList ops (hors body) + getElementById + IDs créés dynamiquement
// ────────────────────────────────────────────────────────────────────
function scanJs(jsFiles) {
  const classOps = [];      // { className, file, line }
  const dynamicClassOps = []; // classe non-littérale (template/concat) — info seulement
  const getByIdCalls = [];  // { id, file, line }
  const dynamicIdsCreated = new Set();

  const classListRe = /(?<!document\.body|body)\.classList\.(?:add|toggle|replace)\s*\(([^)]*)\)/g;
  const getByIdRe = /(?:document\.)?getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
  // Couvre deux formes de création d'ID dynamique :
  //   1) el.id = 'x'                    (assignation directe)
  //   2) '<div id="x">' / `id="x"`      (HTML construit en template/concat, très répandu ici)
  // Lookbehind négatif pour exclure data-id=, aria-id=, etc.
  const idAssignRe = /(?<![\w-])id\s*=\s*['"]([a-zA-Z0-9_-]+)['"]/g;

  for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (path.basename(path.dirname(file)) === 'dist' || file.includes(`${path.sep}dist${path.sep}`)) continue; // bundles minifiés, non-source
    const lines = src.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      let m;
      classListRe.lastIndex = 0;
      while ((m = classListRe.exec(line)) !== null) {
        const args = m[1];
        if (args.includes('${') || /['"]\s*\+/.test(args) || /\+\s*['"]/.test(args)) {
          dynamicClassOps.push({ file, line: i + 1, rawExpr: args.trim() });
          continue;
        }
        // Ne garder que les arguments qui SONT (dans leur intégralité, une fois
        // coupés sur les virgules de premier niveau) un littéral entre quotes.
        // Exclut `classList.toggle('show', tab === 'group')` : le 2e segment
        // n'est pas un littéral pur → 'group' n'est PAS un nom de classe ici,
        // c'est une valeur de comparaison dans la condition.
        for (const segment of splitTopLevelArgs(args)) {
          const s = segment.trim();
          const pure = s.match(/^['"]([^'"]*)['"]$/);
          if (pure) classOps.push({ className: pure[1], file, line: i + 1 });
        }
      }

      getByIdRe.lastIndex = 0;
      while ((m = getByIdRe.exec(line)) !== null) {
        getByIdCalls.push({ id: m[1], file, line: i + 1 });
      }

      idAssignRe.lastIndex = 0;
      while ((m = idAssignRe.exec(line)) !== null) {
        dynamicIdsCreated.add(m[1]);
      }
    }
  }

  return { classOps, dynamicClassOps, getByIdCalls, dynamicIdsCreated };
}

// ────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────
function main() {
  console.log(`\n${BOLD}${CYAN}━━━ check-dom-contract v1 — Komerce Boutique ━━━${RESET}`);

  const manifest = loadManifest();

  if (!fs.existsSync(INDEX_HTML)) {
    console.log(`${RED}✖ index.html introuvable à la racine du projet boutique.${RESET}\n`);
    process.exit(1);
  }
  const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf8');
  const { idRanges, allClasses: htmlClasses } = parseHtml(htmlSrc);

  const jsFiles  = collectFiles(JS_DIR, '.js');
  const cssFiles = collectFiles(CSS_DIR, '.css');
  const cssClasses = collectCssClasses(cssFiles);
  const { classOps, dynamicClassOps, getByIdCalls, dynamicIdsCreated } = scanJs(jsFiles);

  console.log(`${DIM}index.html : ${idRanges.size} ID(s) — ${jsFiles.length} module(s) JS — ${cssFiles.length} feuille(s) CSS${RESET}\n`);

  const errors = [];
  const warnings = [];
  function err(code, msg, detail)  { errors.push({ code, msg, detail }); }
  function warn(code, msg, detail) { warnings.push({ code, msg, detail }); }

  // ── V-8 : sélecteurs structurels obligatoires ─────────────────────
  for (const rule of manifest.requiredSelectors) {
    const parts = rule.selector.trim().split(/\s+/);
    if (parts.length === 1) {
      const tok = parts[0];
      if (tok.startsWith('#')) {
        const id = tok.slice(1);
        if (!idRanges.has(id)) {
          err('V-8', `Sélecteur obligatoire absent : ${rule.selector}`,
            `${rule.reason} — #${id} n'existe pas dans index.html`);
        }
      } else if (tok.startsWith('.')) {
        const cls = tok.slice(1);
        if (!htmlClasses.has(cls)) {
          err('V-8', `Sélecteur obligatoire absent : ${rule.selector}`,
            `${rule.reason} — .${cls} n'existe sur aucun élément d'index.html`);
        }
      }
    } else if (parts.length === 2 && parts[0].startsWith('#') && parts[1].startsWith('.')) {
      const id = parts[0].slice(1);
      const cls = parts[1].slice(1);
      const range = idRanges.get(id);
      if (!range) {
        err('V-8', `Sélecteur obligatoire absent : ${rule.selector}`,
          `${rule.reason} — #${id} n'existe pas dans index.html`);
      } else if (!classPresentInRange(htmlSrc, cls, range)) {
        err('V-8', `Sélecteur obligatoire absent : ${rule.selector}`,
          `${rule.reason} — #${id} existe (L${range.startLine}-${range.endLine}) mais aucun descendant .${cls} n'y est déclaré`);
      }
    } else {
      warn('V-8', `Sélecteur non supporté par ce gate : ${rule.selector}`,
        `Syntaxe limitée à "#id", ".classe" ou "#id .classe" — vérifie ce cas manuellement`);
    }
  }

  // ── V-9 : classes JS (hors body) doivent être stylées ou allowlistées ──
  const seenOrphans = new Map(); // className → premières occurrences
  for (const op of classOps) {
    if (manifest.logicOnlyClasses.has(op.className)) continue;
    if (cssClasses.has(op.className)) continue;
    if (!seenOrphans.has(op.className)) seenOrphans.set(op.className, []);
    seenOrphans.get(op.className).push(op);
  }
  for (const [cls, occs] of seenOrphans) {
    const locs = occs.slice(0, 3).map(o => `${rel(o.file)}:${o.line}`).join(', ');
    const detail = `classList sans règle CSS .${cls} — ${locs}${occs.length > 3 ? ` …(+${occs.length - 3})` : ''}. Si intentionnel (état lu en JS uniquement), ajoute-la à logicOnlyClasses dans ${rel(MANIFEST)}.`;
    if (STRICT) err('V-9', `Classe '${cls}' posée en JS mais jamais stylée`, detail);
    else warn('V-9', `Classe '${cls}' posée en JS mais jamais stylée`, detail);
  }

  // ── V-10 : IDs ciblés en JS doivent exister (statique ou dynamique) ──
  const seenMissingIds = new Map();
  const seenDeprecated = new Map();
  for (const call of getByIdCalls) {
    if (idRanges.has(call.id)) continue;
    if (dynamicIdsCreated.has(call.id)) continue;
    if (manifest.knownDynamicIds.has(call.id)) continue;
    if (manifest.deprecatedIds.has(call.id)) {
      if (!seenDeprecated.has(call.id)) seenDeprecated.set(call.id, []);
      seenDeprecated.get(call.id).push(call);
      continue;
    }
    if (!seenMissingIds.has(call.id)) seenMissingIds.set(call.id, []);
    seenMissingIds.get(call.id).push(call);
  }
  if (seenDeprecated.size > 0) {
    console.log(`${DIM}ℹ  ${seenDeprecated.size} ID(s) ciblé(s) en JS mais volontairement absent(s) du HTML (deprecatedIds, cf. manifeste) : ${[...seenDeprecated.keys()].join(', ')}${RESET}\n`);
  }
  for (const [id, occs] of seenMissingIds) {
    const locs = occs.slice(0, 3).map(o => `${rel(o.file)}:${o.line}`).join(', ');
    err('V-10', `getElementById('${id}') ne trouvera jamais rien`,
      `#${id} n'existe pas dans index.html, n'est créé par aucun \`.id = '${id}'\` en JS, et n'est pas listé dans knownDynamicIds — ${locs}${occs.length > 3 ? ` …(+${occs.length - 3})` : ''}`);
  }

  // ── Info : classes/IDs dynamiques non vérifiables ─────────────────
  if (dynamicClassOps.length > 0) {
    console.log(`${DIM}ℹ  ${dynamicClassOps.length} classList avec expression dynamique (non vérifiable statiquement, ignoré)${RESET}\n`);
  }

  // ── Rapport ─────────────────────────────────────────────────────
  function printIssue(x, prefix, color) {
    console.log(`${color}${prefix}${RESET} ${BOLD}[${x.code}]${RESET} ${x.msg}`);
    if (x.detail) console.log(`  ${DIM}↳ ${x.detail}${RESET}`);
  }
  for (const e of errors) printIssue(e, '✖', RED);
  for (const w of warnings) printIssue(w, '⚠', YELLOW);

  console.log(`\n${BOLD}${CYAN}━━━ Résultat ━━━${RESET}`);
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`${GREEN}${BOLD}✔ Contrat DOM ↔ JS ↔ CSS respecté.${RESET}\n`);
    process.exit(0);
  }
  if (errors.length > 0) {
    console.log(`${RED}${BOLD}✖ ${errors.length} erreur(s)${RESET}${warnings.length ? `, ${YELLOW}${warnings.length} avertissement(s)${RESET}` : ''}`);
    console.log(`${DIM}Corrigez les erreurs (exit 1) avant de merger.${RESET}\n`);
    process.exit(1);
  }
  console.log(`${YELLOW}⚠ 0 erreur, ${warnings.length} avertissement(s) — exit 0${RESET}`);
  console.log(`${DIM}Triage recommandé : chaque classe orpheline est soit un bug (CSS manquant), soit à ajouter à logicOnlyClasses. Relance avec --strict une fois trié pour verrouiller.${RESET}\n`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

// Exports réservés au self-test du gate (tests/unit/check-dom-contract-selftest.test.js).
// N'affecte pas l'exécution CLI (`node scripts/check-dom-contract.js`) ci-dessus.
module.exports = {
  parseHtml,
  classPresentInRange,
  collectCssClasses,
  scanJs,
  splitTopLevelArgs,
};
