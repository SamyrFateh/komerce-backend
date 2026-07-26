#!/usr/bin/env node
'use strict';

/**
 * check-zindex-contract.js — Garde-fou contrat z-index réel
 *
 * check-html-balance.js (SIBLING_ORDER) vérifie que les overlays apparaissent
 * dans le bon ORDRE DOM (ex. #k-modal-overlay avant #k-modal). Mais deux
 * éléments bien ordonnés dans le DOM peuvent quand même se chevaucher
 * visuellement si leurs z-index numériques réels sont incohérents — c'est un
 * bug qui ne se voit qu'à l'œil, jamais en CI (même famille que l'incident
 * #k-modal-cart-slot : le gate existant est vert, le rendu peut être cassé).
 *
 * Ce script vérifie deux choses à partir d'un manifeste de "couches" nommées :
 *   V-Z1  Chaque sélecteur d'une couche a un z-index réel compris dans
 *         [zIndexMin, zIndexMax] déclaré pour cette couche (le manifeste fige
 *         l'état actuel comme référence — cliquet, même philosophie que
 *         css-guard.js : --save pour figer, --strict pour bloquer toute
 *         dérive hors des bornes).
 *   V-Z2  Pour chaque paire { below, above } déclarée, le z-index MAX de
 *         `below` doit être strictement inférieur au z-index MIN de `above`
 *         — sinon deux couches censées être ordonnées peuvent se chevaucher
 *         selon le contexte d'empilement.
 *
 * Limites assumées (cohérent avec css-guard.js / check-dom-contract.js) :
 *   - Pas de résolution réelle des contextes d'empilement (position:relative
 *     sans z-index, transform créant un nouveau stacking context, etc.).
 *     Ce script compare des VALEURS déclarées, pas un rendu réel.
 *   - z-index posés dynamiquement en JS (style.zIndex = ...) ignorés sauf
 *     s'ils sont dans `jsAssignedLayers` du manifeste (valeur documentée à la
 *     main, non vérifiée automatiquement).
 *
 * Usage :
 *   node scripts/check-zindex-contract.js [--strict]
 *   npm run check:zindex
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'css');
const MANIFEST = path.join(ROOT, 'governance', 'zindex-contract.json');

const RESET = '\x1b[0m', RED = '\x1b[31m', YELLOW = '\x1b[33m',
      GREEN = '\x1b[32m', BOLD = '\x1b[1m', DIM = '\x1b[2m', CYAN = '\x1b[36m';

const args   = process.argv.slice(2);
const STRICT = args.includes('--strict');

function rel(p) { return path.relative(ROOT, p); }

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

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    console.log(`${YELLOW}⚠  Manifeste introuvable : ${rel(MANIFEST)} — aucun contrat à vérifier.${RESET}`);
    return { layers: [], order: [] };
  }
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

/**
 * Neutralise le CONTENU des commentaires en préservant longueur et sauts de
 * ligne — donc index et numéros de ligne restent exacts.
 *
 * FIX 2026-07 : findZIndexesForSelector scannait la source brute. Un simple
 * commentaire citant un sélecteur de couche (« … alors que .k-modal-overlay
 * est à 300 … ») était pris pour une vraie occurrence : le matcher sautait
 * ensuite à la première `{` suivante — celle d'une règle sans rapport — et
 * lui attribuait le z-index de cette règle. Résultat : erreur fantôme, ou
 * pire, une occurrence inventée qui pollue les bornes d'une couche.
 * Même angle mort que celui corrigé dans css-guard.js (parser aveugle aux
 * commentaires) : documenter du CSS dans un commentaire ne doit jamais
 * modifier ce que les gates mesurent.
 */
function stripCssComments(src) {
  let out = '', i = 0, inC = false;
  while (i < src.length) {
    if (!inC && src[i] === '/' && src[i + 1] === '*') { inC = true; out += '  '; i += 2; continue; }
    if (inC && src[i] === '*' && src[i + 1] === '/') { inC = false; out += '  '; i += 2; continue; }
    out += inC ? (src[i] === '\n' ? '\n' : ' ') : src[i];
    i++;
  }
  return out;
}

// ── Trouve tous les z-index réels déclarés pour un sélecteur littéral donné.
// Recherche par sélecteur EXACT (ex. ".k-modal-overlay" ou "#k-cart-drawer"),
// y compris dans les blocs CSS minifiés sur une seule ligne (css/dist/*.css).
function findZIndexesForSelector(cssFiles, selector) {
  const results = []; // { value, file, line }
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Le sélecteur doit être suivi de { ou , ou un espace (combinateur), pas
  // d'un autre caractère de nom de classe/id (éviter .k-modal matchant
  // .k-modal-overlay).
  const SEL_RE = new RegExp(`(^|[\\s,}])${escaped}(?=[\\s,{.:\\[#]|$)`, 'g');

  for (const file of cssFiles) {
    const src = stripCssComments(fs.readFileSync(file, 'utf8'));
    let m;
    while ((m = SEL_RE.exec(src))) {
      // Chercher la 1ère accolade ouvrante après la position du sélecteur.
      const braceOpen = src.indexOf('{', m.index);
      if (braceOpen === -1) continue;
      // Vérifier qu'aucune autre accolade fermante n'intervient avant (sinon
      // le sélecteur ne définit pas ce bloc — cas de virgule multi-sélecteur
      // déjà géré par le lookahead, donc on avance simplement à la 1ère '{').
      let depth = 1, i = braceOpen + 1;
      let bodyEnd = -1;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) bodyEnd = i; }
        i++;
      }
      if (bodyEnd === -1) continue;
      const body = src.slice(braceOpen + 1, bodyEnd);
      const zMatch = body.match(/z-index\s*:\s*(-?\d+)/);
      if (!zMatch) continue;
      const lineNo = src.slice(0, braceOpen).split('\n').length;
      results.push({ value: parseInt(zMatch[1], 10), file, line: lineNo });
    }
  }
  return results;
}

function main() {
  const cssFiles = collectFiles(CSS_DIR, '.css').filter(f => !f.includes(`${path.sep}dist${path.sep}`));
  const manifest = loadManifest();

  console.log(`\n${BOLD}${CYAN}━━━ check-zindex-contract — Komerce Boutique ━━━${RESET}`);
  console.log(`${DIM}${cssFiles.length} feuille(s) CSS source — ${manifest.layers.length} couche(s) déclarée(s) — ${manifest.order.length} règle(s) d'ordre${RESET}\n`);

  const errors = [];
  const warnings = [];
  const observed = {}; // layerName -> { min, max, occurrences }

  // ── V-Z1 : chaque couche reste dans ses bornes déclarées ──────────────
  for (const layer of manifest.layers) {
    const all = [];
    for (const sel of layer.selectors) {
      all.push(...findZIndexesForSelector(cssFiles, sel));
    }
    if (all.length === 0) {
      warnings.push({
        code: 'V-Z0',
        msg: `Couche '${layer.name}' : aucun z-index trouvé pour ${layer.selectors.join(', ')}`,
        detail: `Sélecteur renommé/supprimé ? Mets à jour ${rel(MANIFEST)}.`,
      });
      continue;
    }
    const values = all.map(a => a.value);
    const min = Math.min(...values), max = Math.max(...values);
    observed[layer.name] = { min, max, occurrences: all };

    for (const occ of all) {
      if (occ.value < layer.zIndexMin || occ.value > layer.zIndexMax) {
        errors.push({
          code: 'V-Z1',
          msg: `Couche '${layer.name}' : z-index ${occ.value} hors des bornes [${layer.zIndexMin}, ${layer.zIndexMax}]`,
          detail: `${rel(occ.file)}:${occ.line} — si ce changement est voulu, mets à jour les bornes dans ${rel(MANIFEST)} (${layer.reason || ''})`,
        });
      }
    }
  }

  // ── V-Z2 : ordre pairwise below < above ────────────────────────────────
  for (const pair of manifest.order) {
    const below = observed[pair.below];
    const above = observed[pair.above];
    if (!below || !above) continue; // déjà signalé en V-Z0
    if (below.max >= above.min) {
      errors.push({
        code: 'V-Z2',
        msg: `'${pair.below}' (max ${below.max}) doit rester sous '${pair.above}' (min ${above.min})`,
        detail: pair.reason || `Chevauchement possible : ${pair.below} et ${pair.above} ont des plages de z-index qui se touchent ou se croisent.`,
      });
    }
  }

  function printIssue(x, prefix, color) {
    console.log(`${color}${prefix}${RESET} ${BOLD}[${x.code}]${RESET} ${x.msg}`);
    if (x.detail) console.log(`  ${DIM}↳ ${x.detail}${RESET}`);
  }

  const promoted = STRICT ? warnings : [];
  const activeWarnings = STRICT ? [] : warnings;
  const allErrors = [...errors, ...promoted];

  for (const e of allErrors) printIssue(e, '✖', RED);
  for (const w of activeWarnings) printIssue(w, '⚠', YELLOW);

  console.log(`\n${BOLD}${CYAN}━━━ Résultat ━━━${RESET}`);
  if (allErrors.length === 0 && activeWarnings.length === 0) {
    console.log(`${GREEN}${BOLD}✔ Contrat z-index respecté.${RESET}\n`);
    process.exit(0);
  }
  if (allErrors.length > 0) {
    console.log(`${RED}${BOLD}✖ ${allErrors.length} erreur(s)${RESET}${activeWarnings.length ? `, ${YELLOW}${activeWarnings.length} avertissement(s)${RESET}` : ''}`);
    console.log(`${DIM}Corrigez les erreurs (exit 1) avant de merger.${RESET}\n`);
    process.exit(1);
  }
  console.log(`${YELLOW}⚠ 0 erreur, ${activeWarnings.length} avertissement(s) — exit 0${RESET}\n`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  findZIndexesForSelector,
};
