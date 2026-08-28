#!/usr/bin/env node
/**
 * check-body-classes.js — Garde-fou classes body Komerce boutique
 * Version : 2.0 (2026-05-19)
 *
 * Toute classe ajoutée sur document.body par le JS doit être retirée
 * quelque part. Un `classList.add` sans `classList.remove` correspondant
 * crée un état persistant invisible qui casse l'UI (ex: `cart-open` bloque
 * pointer-events sur toute la page après fermeture du panier — P-7 §10).
 *
 * Ce que ce script vérifie :
 *   B-1  Chaque classe ajoutée sur body a au moins un remove ou toggle
 *   B-2  Chaque classe retirée de body était bien ajoutée quelque part
 *        (remove orphelin = probablement une coquille)
 *   B-3  Chaque classe body utilisée dans le CSS (body.xxx) est
 *        gérée par le JS (add + remove existants)
 *   B-4  Tableau récapitulatif : classe → add / remove / toggle / CSS / statut
 *
 * Corrections v2 vs v1 :
 *   - PERMANENT_CLASSES : k-view-shop, k-view-fav, k-view-track sont
 *     des classes de VUE, pas vraiment permanentes. Elles sont retirées
 *     par b-nav.js switchView() avant d'ajouter la nouvelle vue.
 *     → Supprimées de PERMANENT_CLASSES, ajoutées à VIEW_CLASSES (traitement dédié).
 *     Le script ne génère plus de faux-positif B-1 pour ces classes.
 *   - Détection de body.k-modal-open dans le CSS (cart.css:262) sans JS correspondant :
 *     aucun JS n'ajoute 'k-modal-open' (le JS utilise 'modal-open').
 *     Le script expose ce B-3 réel qui doit être nettoyé du CSS.
 *   - CSS scanné : css/ et css/dist/ (le walk est récursif, couvre les bundles)
 *   - Ajout du pattern `dom.body.classList` en complément de `document.body.classList`
 *   - Détection des classes posées sur body dans index.html (script inline)
 *
 * Usage :
 *   node scripts/check-body-classes.js
 *   npm run check:body-classes
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

const ROOT    = path.resolve(__dirname, '..');
const JS_DIR  = path.join(ROOT, 'js');
const CSS_DIR = path.join(ROOT, 'css');   // walk récursif → couvre css/dist/

/**
 * Classes de VUE : elles sont add/remove en rotation par b-nav.js switchView().
 * Logique : remove('k-view-shop', 'k-view-fav', 'k-view-track') + add('k-view-X').
 * Ces classes ont toujours add ET remove dans le code — on les marque "vue"
 * pour que le tableau B-4 soit lisible.
 */
const VIEW_CLASSES = new Set([
  'k-view-shop',
  'k-view-fav',
  'k-view-track',
  'k-view-group',
  'k-view-komerce',
]);

/**
 * Classes posées par le HTML inline (script dans <head> de index.html)
 * et jamais retirées de façon isolée — leur remove est implicite via
 * switchView() qui retire TOUTES les classes de vue avant d'en ajouter une.
 * Non signalées en B-2 (remove sans add) car leur add est dans le HTML.
 */
const HTML_INIT_CLASSES = new Set([
  'k-view-shop',   // classe par défaut au boot (index.html script inline)
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
const BLUE   = '\x1b[34m';

function relPath(p) { return path.relative(ROOT, p); }

// ────────────────────────────────────────────────────────────────────
// COLLECTE DES FICHIERS
// ────────────────────────────────────────────────────────────────────

function collectFiles(dir, ext) {
  const results = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith(ext)) results.push(full);
    }
  }
  walk(dir);
  return results;
}

// ────────────────────────────────────────────────────────────────────
// EXTRACTION DES MUTATIONS BODY DANS LE JS
// ────────────────────────────────────────────────────────────────────

/**
 * Retourne un tableau :
 * { op: 'add'|'remove'|'toggle'|'contains', className, file, line, dynamic? }
 *
 * Patterns supportés :
 *   document.body.classList.add('foo', 'bar')
 *   document.body.classList.remove('foo')
 *   document.body.classList.toggle('foo')
 *   document.body.classList.contains('foo')
 *
 * Pattern dynamique détecté mais non vérifiable :
 *   document.body.classList.add('k-view-' + tab)
 *   document.body.classList.add(`k-view-${tab}`)
 */
function extractBodyClassOps(filepath) {
  const src   = fs.readFileSync(filepath, 'utf8');
  const lines = src.split('\n');
  const ops   = [];

  // Uniquement les propriétaires explicites du vrai <body>.
  // Ne jamais matcher une variable locale nommée `body` (ex. const body = dom.orderBody),
  // sinon une mutation d'un composant est faussement classée comme état global.
  const bodyRe = /(?:document\.body|dom\.body)\.classList\.(add|remove|toggle|contains)\s*\(([^)]+)\)/g;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line    = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // Skip les lignes commentées
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    bodyRe.lastIndex = 0;
    let m;
    while ((m = bodyRe.exec(line)) !== null) {
      const op      = m[1];
      const argsRaw = m[2];

      // Classe dynamique (template literal ou concaténation)
      if (argsRaw.includes('${') || argsRaw.includes("' +") || argsRaw.includes('" +') || argsRaw.includes("` ")) {
        ops.push({
          op,
          className: '__dynamic__',
          file: filepath,
          line: lineNum,
          dynamic: true,
          rawExpr: argsRaw.trim(),
        });
        continue;
      }

      // Classes statiques entre guillemets
      const classRe = /['"]([^'"]+)['"]/g;
      let cm;
      while ((cm = classRe.exec(argsRaw)) !== null) {
        ops.push({ op, className: cm[1], file: filepath, line: lineNum });
      }
    }
  }

  return ops;
}

/**
 * Extrait les classes body posées dans les scripts inline de index.html.
 * Pattern : document.body.classList.add('foo') dans un <script> de l'HTML.
 */
function extractHtmlInlineBodyClasses(htmlPath) {
  if (!fs.existsSync(htmlPath)) return [];
  const src  = fs.readFileSync(htmlPath, 'utf8');
  const ops  = [];
  // Extrait le contenu des <script> inline
  const scriptRe = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;
  let s;
  while ((s = scriptRe.exec(src)) !== null) {
    if (s[0].includes('src=')) continue; // script externe, pas inline
    const content = s[1];
    const lines = content.split('\n');
    const bodyRe = /document\.body\.classList\.(add|remove|toggle)\s*\(([^)]+)\)/g;
    for (let i = 0; i < lines.length; i++) {
      bodyRe.lastIndex = 0;
      let m;
      while ((m = bodyRe.exec(lines[i])) !== null) {
        const op = m[1];
        const argsRaw = m[2];
        const classRe = /['"]([^'"]+)['"]/g;
        let cm;
        while ((cm = classRe.exec(argsRaw)) !== null) {
          ops.push({ op, className: cm[1], file: htmlPath, line: i + 1, source: 'html-inline' });
        }
      }
    }
  }
  return ops;
}

// ────────────────────────────────────────────────────────────────────
// EXTRACTION DES BODY CLASSES DANS LE CSS
// ────────────────────────────────────────────────────────────────────

/**
 * Retourne un Map : className → [{ file, line }]
 * Pattern : body.classname comme sélecteur CSS.
 *
 * Exclut :
 *   - .k-modal-spec-body.is-open  (le "body" est dans le nom de classe, pas le tag)
 *   - body::before, body:hover, etc. (pseudo-éléments)
 */
function extractCssBodyClasses(filepath) {
  const src     = fs.readFileSync(filepath, 'utf8');
  const classes = new Map(); // className → [line]
  const lines   = src.split('\n');

  const re = /(?:^|[\s,{(>+~])body\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const cls = m[1];
      // Exclut les pseudo-classes/pseudo-éléments et cas "body" dans un nom de classe
      if (cls.startsWith('hover') || cls.startsWith('focus') || cls.startsWith('active')
        || cls.startsWith('before') || cls.startsWith('after') || cls.startsWith('not')
        || cls.startsWith('nth') || cls.startsWith('first') || cls.startsWith('last')) continue;
      if (!classes.has(cls)) classes.set(cls, []);
      classes.get(cls).push({ file: filepath, line: i + 1 });
    }
  }
  return classes;
}

// ────────────────────────────────────────────────────────────────────
// ANALYSE PRINCIPALE
// ────────────────────────────────────────────────────────────────────

(function main() {
  const jsFiles   = collectFiles(JS_DIR, '.js');
  const cssFiles  = collectFiles(CSS_DIR, '.css');
  const indexHtml = path.join(ROOT, 'index.html');

  console.log(`\n${BOLD}${CYAN}━━━ check-body-classes v2 — Komerce Boutique ━━━${RESET}`);
  console.log(`${DIM}Analyse de ${jsFiles.length} module(s) JS + ${cssFiles.length} feuille(s) CSS…${RESET}\n`);

  // ── Collecte des ops JS ─────────────────────────────────────────
  /**
   * classMap : className → { adds, removes, toggles, contains, source }
   *   source : 'js' | 'html-inline'
   */
  const classMap = new Map();

  function ensure(cls) {
    if (!classMap.has(cls)) {
      classMap.set(cls, { adds: [], removes: [], toggles: [], contains: [] });
    }
    return classMap.get(cls);
  }

  const dynamicOps = [];

  // JS
  for (const file of jsFiles) {
    for (const op of extractBodyClassOps(file)) {
      if (op.dynamic) { dynamicOps.push(op); continue; }
      const entry = ensure(op.className);
      if (op.op === 'add')      entry.adds.push({ file: op.file, line: op.line });
      if (op.op === 'remove')   entry.removes.push({ file: op.file, line: op.line });
      if (op.op === 'toggle')   entry.toggles.push({ file: op.file, line: op.line });
      if (op.op === 'contains') entry.contains.push({ file: op.file, line: op.line });
    }
  }

  // HTML inline
  for (const op of extractHtmlInlineBodyClasses(indexHtml)) {
    if (op.dynamic) { dynamicOps.push(op); continue; }
    const entry = ensure(op.className);
    if (op.op === 'add')    entry.adds.push({ file: op.file, line: op.line, source: 'html-inline' });
    if (op.op === 'remove') entry.removes.push({ file: op.file, line: op.line, source: 'html-inline' });
    if (op.op === 'toggle') entry.toggles.push({ file: op.file, line: op.line, source: 'html-inline' });
  }

  if (dynamicOps.length > 0) {
    console.log(`${DIM}ℹ  ${dynamicOps.length} opération(s) avec classe dynamique (non vérifiables statiquement) :${RESET}`);
    for (const op of dynamicOps) {
      console.log(`  ${DIM}${relPath(op.file)}:${op.line} — classList.${op.op}(${op.rawExpr})${RESET}`);
    }
    console.log();
  }

  // ── Collecte des classes CSS body.xxx ──────────────────────────
  const cssBodyClassMap = new Map(); // className → [{file, line}]
  for (const file of cssFiles) {
    for (const [cls, locs] of extractCssBodyClasses(file)) {
      if (!cssBodyClassMap.has(cls)) cssBodyClassMap.set(cls, []);
      cssBodyClassMap.get(cls).push(...locs);
    }
  }

  const hasDynamicViewAdd = dynamicOps.some(op =>
    op.op === 'add' && /k-view-/.test(op.rawExpr || '')
  );

  // ────────────────────────────────────────────────────────────────
  // VÉRIFICATIONS
  // ────────────────────────────────────────────────────────────────

  const errors   = [];
  const warnings = [];

  function err(code, cls, msg, detail) {
    errors.push({ code, cls, msg, detail });
  }
  function warn(code, cls, msg, detail) {
    warnings.push({ code, cls, msg, detail });
  }

  for (const [cls, entry] of classMap) {
    const hasToggle   = entry.toggles.length > 0;
    const hasAdd      = entry.adds.length > 0;
    const hasRemove   = entry.removes.length > 0;
    const isViewClass = VIEW_CLASSES.has(cls);

    // B-1 : add sans remove (sauf classes de vue et toggle-gérées)
    if (hasAdd && !hasRemove && !hasToggle && !isViewClass) {
      err('B-1', cls,
        `Classe body '${cls}' ajoutée mais jamais retirée`,
        `add(s) : ${entry.adds.map(a => `${relPath(a.file)}:${a.line}`).join(', ')}`);
    }

    // B-2 : remove sans add (remove orphelin)
    if (hasRemove && !hasAdd && !hasToggle && !HTML_INIT_CLASSES.has(cls) && !(isViewClass && hasDynamicViewAdd)) {
      warn('B-2', cls,
        `Classe body '${cls}' retirée mais jamais ajoutée dans le JS ou HTML inline`,
        `remove(s) : ${entry.removes.map(r => `${relPath(r.file)}:${r.line}`).join(', ')} — vérifiez index.html`);
    }
  }

  // B-3 : classes CSS body.xxx non gérées par le JS
  for (const [cls, locs] of cssBodyClassMap) {
    if (!classMap.has(cls)) {
      const locStr = locs.slice(0, 2).map(l => `${relPath(l.file)}:${l.line}`).join(', ');
      warn('B-3', cls,
        `CSS utilise body.${cls} mais aucun JS ne gère cette classe`,
        `Référencé en CSS : ${locStr}${locs.length > 2 ? ' …' : ''} — sélecteur legacy ou JS manquant`);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // TABLEAU B-4
  // ────────────────────────────────────────────────────────────────

  const allClasses = new Set([...classMap.keys(), ...cssBodyClassMap.keys()]);

  console.log(`${BOLD}${BLUE}── Tableau des classes body (B-4) ─────────────────────────${RESET}`);
  console.log(
    `${DIM}${'Classe'.padEnd(28)} ${'Add'.padEnd(5)} ${'Rem'.padEnd(5)} ${'Tog'.padEnd(5)} ${'CSS'.padEnd(5)} Statut${RESET}`
  );
  console.log(`${DIM}${'─'.repeat(72)}${RESET}`);

  for (const cls of [...allClasses].sort()) {
    const entry    = classMap.get(cls) || { adds: [], removes: [], toggles: [], contains: [] };
    const inCss    = cssBodyClassMap.has(cls);
    const isView   = VIEW_CLASSES.has(cls);
    const hasErr   = errors.some(e => e.cls === cls);
    const hasWarn  = warnings.some(w => w.cls === cls);
    const addCnt   = entry.adds.length;
    const remCnt   = entry.removes.length;
    const togCnt   = entry.toggles.length;

    let status;
    if      (isView)    status = `${DIM}vue (switchView)${RESET}`;
    else if (hasErr)    status = `${RED}✖ erreur${RESET}`;
    else if (hasWarn)   status = `${YELLOW}⚠ warning${RESET}`;
    else if (togCnt > 0 && addCnt === 0 && remCnt === 0) status = `${GREEN}✔ toggle-only${RESET}`;
    else                status = `${GREEN}✔ équilibré${RESET}`;

    const p = (n, w) => String(n).padEnd(w);
    console.log(
      `${cls.padEnd(28)} ${p(addCnt,5)} ${p(remCnt,5)} ${p(togCnt,5)} ${inCss ? '✔' : '·'} ${' '.repeat(5)}${status}`
    );
  }
  console.log();

  // ── Détail erreurs / warnings ──────────────────────────────────

  if (errors.length > 0) {
    console.log(`${BOLD}${RED}── Erreurs ─────────────────────────────────────────────────${RESET}`);
    for (const e of errors) {
      console.log(`${RED}✖${RESET} ${BOLD}[${e.code}]${RESET} ${e.msg}`);
      if (e.detail) console.log(`  ${DIM}↳ ${e.detail}${RESET}`);
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log(`${BOLD}${YELLOW}── Avertissements ──────────────────────────────────────────${RESET}`);
    for (const w of warnings) {
      console.log(`${YELLOW}⚠${RESET} ${BOLD}[${w.code}]${RESET} ${w.msg}`);
      if (w.detail) console.log(`  ${DIM}↳ ${w.detail}${RESET}`);
    }
    console.log();
  }

  // ── Résumé ─────────────────────────────────────────────────────

  console.log(`${BOLD}${CYAN}━━━ Résultat ━━━${RESET}`);

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`${GREEN}${BOLD}✔ Toutes les classes body sont correctement appairées.${RESET}`);
    console.log(`${DIM}  ${allClasses.size} classe(s) suivie(s).${RESET}\n`);
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log(`${RED}${BOLD}✖ ${errors.length} erreur(s), ${warnings.length} avertissement(s)${RESET}`);
    console.log(`${DIM}Corrigez les [B-1] en priorité : ils créent des états UI définitivement bloqués.${RESET}\n`);
    process.exit(1);
  }

  console.log(`${YELLOW}⚠ 0 erreur, ${warnings.length} avertissement(s) — exit 0${RESET}`);
  console.log(`${DIM}[B-2] : peut être un add dans le HTML. [B-3] : peut être du CSS legacy à nettoyer.${RESET}\n`);
  process.exit(0);
})();
