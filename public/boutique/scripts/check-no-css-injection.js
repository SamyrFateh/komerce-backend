#!/usr/bin/env node
/**
 * check-no-css-injection.js — Garde-fou exécutable de la doctrine §1.
 *
 *   « Le CSS vit dans les .css. Jamais dans le JS. »
 *   (voir docs/BOUTIQUE_CSS_INJECTION_DOCTRINE.md §1)
 *
 * Jusqu'ici cette règle était DOCUMENTAIRE : aucun script de `check:all`
 * ne l'enforçait, donc elle a dérivé en silence (cascade fantôme).
 * Ce script la rend EXÉCUTABLE.
 *
 * ── Ce qu'il fait ───────────────────────────────────────────────────────
 *  ERREUR (exit 1) — violations dures de §1 :
 *    • createElement('style') / createElement("style")
 *    • assignation d'une chaîne contenant un sélecteur CSS ({ ... })
 *      à .textContent / .innerHTML / .cssText / .insertAdjacentHTML('<style')
 *    → ce sont des <style> injectés au runtime, invisibles au bundler,
 *      à gen-ownership et à l'audit d'archi.
 *
 *  AVERTISSEMENT (n'échoue pas) — mise en page imposée par le JS :
 *    • .style.(top|bottom|left|right|width|height|position|transform) = ...
 *    • setProperty('--pager-*' | '--header-*' | '--hero-*', ...)
 *    Ces écritures « gagnent » sur le CSS (inline > cascade) et sont la
 *    cause n°1 des « impossible de positionner X » après N itérations.
 *    Elles ne sont pas interdites (une mesure runtime est parfois légitime)
 *    mais elles DOIVENT être visibles et concentrées en un seul propriétaire.
 *
 * ── Échappatoire explicite ──────────────────────────────────────────────
 *  Ajouter, sur la ligne ou juste au-dessus :
 *      // css-injection-allow: <raison courte>
 *  Une violation ainsi annotée est tolérée (et listée comme « autorisée »).
 *  L'idée : aucune injection n'est interdite *pour toujours*, mais chacune
 *  doit être un choix conscient, daté, justifié — pas une dérive muette.
 *
 * Usage : node scripts/check-no-css-injection.js
 */
'use strict';

'use strict';

const fs = require('fs');
const path = require('path');

const R = '\x1b[0m', RED = '\x1b[31m', YLW = '\x1b[33m', GRN = '\x1b[32m', DIM = '\x1b[2m', BLD = '\x1b[1m';

const JS_DIR = path.join(__dirname, '..', 'js');
const ALLOW_RE = /css-injection-allow\s*:/i;

// Dossiers ignorés (artefacts de build, tests).
const IGNORE_DIRS = new Set(['dist', 'node_modules']);

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      out.push(...listJsFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// Une ligne est « autorisée » si elle, ou la ligne juste au-dessus, porte le marqueur.
function isAllowed(lines, idx) {
  return ALLOW_RE.test(lines[idx]) || (idx > 0 && ALLOW_RE.test(lines[idx - 1]));
}

// ── Règles ─────────────────────────────────────────────────────────────
const HARD_RULES = [
  {
    id: 'STYLE-EL',
    label: "création d'un élément <style>",
    re: /createElement\(\s*['"`]style['"`]\s*\)/,
  },
  {
    id: 'STYLE-HTML',
    label: "injection d'un <style> via innerHTML / insertAdjacentHTML",
    re: /(innerHTML|insertAdjacentHTML\([^)]*)\s*[=,]?\s*[`'"][^`'"]*<style/i,
  },
  {
    id: 'CSS-TEXT',
    label: 'assignation de règles CSS (sélecteur { … }) à textContent/innerHTML/cssText',
    // chaîne template/literal contenant un "<sel> {" typique de CSS.
    // (?<!\$) exclut le '{' qui ouvre une interpolation de template
    // literal (${...}) — sinon tout `.textContent = \`... ${obj.prop} ...
    // ${fn(...)}\`` déclenche un faux positif dès qu'une propriété (le
    // '.prop' matché par [.#][\w-]+) est suivie d'une seconde
    // interpolation plus loin dans la même chaîne (le '{' de '${').
    re: /(textContent|innerHTML|cssText)\s*=\s*[`'"][^`'"]*[.#][\w-]+[^`'"]*(?<!\$)\{/,
  },
];

const SOFT_RULES = [
  {
    id: 'INLINE-LAYOUT',
    label: 'écriture inline de mise en page (.style.top/height/position/transform…)',
    re: /\.style\.(top|bottom|left|right|width|height|position|transform)\s*=/,
  },
  {
    id: 'LAYOUT-VAR',
    label: 'setProperty sur une variable de mise en page (--pager/--header/--hero)',
    re: /setProperty\(\s*['"`]--(pager|header|hero|sticky|bnav)[\w-]*['"`]/,
  },
];

const files = listJsFiles(JS_DIR);
const hard = [];        // violations dures non autorisées
const hardAllowed = []; // violations dures autorisées (annotées)
const soft = [];        // avertissements

for (const file of files) {
  const rel = path.relative(path.join(__dirname, '..'), file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of HARD_RULES) {
      if (rule.re.test(line)) {
        const rec = { rel, line: i + 1, text: line.trim(), rule };
        (isAllowed(lines, i) ? hardAllowed : hard).push(rec);
      }
    }
    for (const rule of SOFT_RULES) {
      if (rule.re.test(line) && !isAllowed(lines, i)) {
        soft.push({ rel, line: i + 1, text: line.trim(), rule });
      }
    }
  });
}

// ── Rapport ──────────────────────────────────────────────────────────────
console.log(`${BLD}── check:no-injection — doctrine §1 (CSS jamais dans le JS) ──${R}\n`);

if (hard.length) {
  console.log(`${RED}${BLD}✗ ${hard.length} injection(s) <style> interdite(s) :${R}`);
  for (const v of hard) {
    console.log(`  ${RED}${v.rel}:${v.line}${R}  [${v.rule.id}] ${v.rule.label}`);
    console.log(`    ${DIM}${v.text.slice(0, 100)}${R}`);
  }
  console.log(`\n  ${DIM}→ Déplacer ces règles dans un .css owner, ou annoter`);
  console.log(`     « // css-injection-allow: <raison> » si vraiment inévitable.${R}\n`);
} else {
  console.log(`${GRN}✓ Aucune injection <style> non autorisée.${R}`);
}

if (hardAllowed.length) {
  console.log(`\n${DIM}ℹ ${hardAllowed.length} injection(s) explicitement autorisée(s) (annotées) :${R}`);
  for (const v of hardAllowed) console.log(`  ${DIM}${v.rel}:${v.line} — ${v.rule.id}${R}`);
}

if (soft.length) {
  console.log(`\n${YLW}⚠ ${soft.length} écriture(s) de mise en page par le JS (toléré, à concentrer) :${R}`);
  // Regroupé par fichier pour repérer un propriétaire unique vs dispersion.
  const byFile = soft.reduce((m, v) => ((m[v.rel] = (m[v.rel] || 0) + 1), m), {});
  Object.entries(byFile).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => {
    console.log(`  ${YLW}${String(n).padStart(3)}${R} ${f}`);
  });
  console.log(`  ${DIM}→ Objectif doctrine : une seule fonction propriétaire écrit --pager-top,`);
  console.log(`     le CSS consomme la variable. Aucune autre ne touche .style.top.${R}`);
}

console.log('');
if (hard.length) {
  console.log(`${RED}${BLD}ÉCHEC — corrige les injections <style> ci-dessus.${R}`);
  process.exit(1);
}
console.log(`${GRN}${BLD}OK — doctrine §1 respectée (injections dures = 0).${R}`);
process.exit(0);
