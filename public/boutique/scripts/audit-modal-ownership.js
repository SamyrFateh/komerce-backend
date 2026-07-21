#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          modal-ownership-gate
 * @domain        boutique
 * @layer         build-gate
 * @criticality   high
 * @purpose       Rend la RESPONSABILITÉ UNIQUE exécutable. Interdit qu'une même
 *                zone DOM de la modale produit soit écrite par plus d'un module.
 *                C'est le mécanisme anti-récidive : une modale ne peut plus
 *                redevenir multi-propriétaire sans faire échouer ce gate.
 * @used-by       npm run audit:modal-ownership  (+ CI)
 * @version       2026-07 — extension : forEach-tableau + fonctions relais
 *
 * INVARIANT VÉRIFIÉ :
 *   Pour chaque zone déclarée dans OWNERSHIP, exactement UN fichier a le droit
 *   d'y écrire (innerHTML/textContent/appendChild/hidden/class/... ). Tout
 *   écrivain non déclaré => VIOLATION => exit 1.
 *
 * Le contrat vit dans scripts/modal-ownership.contract.json (source de vérité
 * unique, lisible par un humain ET par un agent). Ce script ne fait que le
 * confronter à la réalité du code. Aucune heuristique cachée.
 *
 * DEUX FORMES D'ÉCRITURE INITIALEMENT INVISIBLES (trouvées lors du Chantier
 * Déduplication §3, corrigées ensemble — sans ça, un vrai futur écrivain
 * illégal via ces patterns serait passé inaperçu) :
 *   1. `[a, b].forEach((btn) => { btn.disabled = ...; })` — la cible est un
 *      élément de tableau littéral, mutée via le paramètre du callback,
 *      jamais assignée à une variable nommée capturable par le pattern
 *      "const x = getElementById(...)".
 *   2. `function f(param) { param.onclick = ...; }` appelée ailleurs par
 *      `f(document.getElementById('id'))` — la mutation vit dans le FICHIER
 *      QUI DÉFINIT f (c'est le vrai écrivain), mais l'id n'y apparaît
 *      textuellement que côté appelant.
 * Ce sont des extensions de l'heuristique, pas un changement de doctrine :
 * on reste conservateur (zéro heuristique cachée), on couvre juste deux
 * formes de mutation réelles qui existaient déjà dans le code avant d'être
 * détectées.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', 'js');
const CONTRACT = path.resolve(__dirname, 'modal-ownership.contract.json');

const C = {
  r: '\x1b[0m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m',
  cyn: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m',
};

// dom.<accessor> → #id  (miroir de b-store.js initDom)
const DOM_ALIASES = {
  modalPromoBadge: 'k-modal-promo-badge', modalName: 'k-modal-name',
  modalSku: 'k-modal-sku', modalDesc: 'k-modal-desc', modalPrice: 'k-modal-price',
  modalOldPrice: 'k-modal-old-price', modalCat: 'k-modal-cat', modalStock: 'k-modal-stock',
  modalVariants: 'k-modal-variants', modalQtyVal: 'k-qty-val',
  addCartBtn: 'k-add-cart-btn',
};

// Verbes d'écriture DOM (mutation de la zone)
const WRITE_OPS = [
  'innerHTML', 'textContent', 'innerText', 'appendChild', 'append',
  'replaceChildren', 'insertAdjacentHTML', 'setAttribute', 'removeAttribute',
  'classList', 'className', 'hidden', 'disabled', 'value', 'onclick',
  'style', 'dataset', 'remove\\(', 'prepend',
];

function loadContract() {
  if (!fs.existsSync(CONTRACT)) {
    console.error(`${C.red}✖ Contrat introuvable : ${CONTRACT}${C.r}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
}

function jsFiles() {
  return fs.readdirSync(JS_DIR)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .filter((f) => /modal|pdp|product-open|cart-product-open|buybox/.test(f));
}

/** Ensemble des modules réellement joignables depuis main.js (graphe d'import). */
function reachableFromMain() {
  const seen = new Set();
  const stack = ['main.js'];
  const importRe = /import[^;]*from\s*['"]\.\/([^'"]+)['"]/g;
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const p = path.join(JS_DIR, f);
    if (!fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, 'utf8');
    let m;
    while ((m = importRe.exec(s))) if (!seen.has(m[1])) stack.push(m[1]);
  }
  return seen;
}

/** Motifs regex ciblant l'élément d'une zone : id direct ou alias dom.*. */
function zoneTargetPatterns(zone) {
  const id = zone.id;
  const aliases = Object.entries(DOM_ALIASES)
    .filter(([, v]) => v === id)
    .map(([k]) => `dom\\.${k}`);
  return [
    `getElementById\\(['"]${id}['"]\\)`,
    `querySelector\\(['"]#${id}['"]\\)`,
    ...aliases,
  ];
}

/**
 * Un fichier "écrit" dans une zone s'il contient une expression qui cible
 * l'élément (par id direct OU par alias dom.*) suivie d'une op d'écriture.
 * On reste volontairement conservateur : on veut zéro faux négatif sur les
 * vraies mutations, quitte à demander une allowlist explicite pour les cas
 * légitimes (lecture, listeners neutres).
 */
function writesZone(src, zone) {
  const targets = zoneTargetPatterns(zone);
  const targetRe = new RegExp(`(${targets.join('|')})`);

  // On scanne ligne par ligne : une ligne qui référence la cible ET une op
  // d'écriture, ou une variable capturant la cible puis mutée plus bas.
  const lines = src.split('\n');
  const writeRe = new RegExp(`\\.(${WRITE_OPS.join('|')})`);

  // 1) écriture directe sur la même ligne : el.innerHTML, getElementById(x).textContent…
  for (const line of lines) {
    if (targetRe.test(line) && writeRe.test(line)) return true;
  }

  // 2) capture puis mutation : const el = getElementById('x'); … el.innerHTML =
  const captureRe = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[^;]*(${targets.join('|')})`
  );
  for (const line of lines) {
    const m = line.match(captureRe);
    if (!m) continue;
    const varName = m[1];
    const varWrite = new RegExp(`\\b${varName}\\b\\s*\\.\\s*(${WRITE_OPS.join('|')})`);
    const varWriteAssign = new RegExp(`\\b${varName}\\b\\.(innerHTML|textContent|hidden|disabled|value|className|onclick)\\s*=`);
    if (varWrite.test(src) || varWriteAssign.test(src)) return true;
  }

  // 3) tableau littéral détruit par .forEach : [a, getElementById('id')].forEach((x) => { x.prop = …; })
  if (writesZoneViaForEach(src, targets)) return true;

  return false;
}

/** Extrait le corps d'un bloc `{ … }` à partir de l'index de son `{` ouvrant. */
function extractBalancedBody(src, openBraceIdx) {
  if (src[openBraceIdx] !== '{') return null;
  let depth = 0;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(openBraceIdx + 1, i);
    }
  }
  return null; // accolades déséquilibrées : on n'affirme rien plutôt que de se tromper
}

/**
 * Même principe qu'extractBalancedBody mais pour des parenthèses. Nécessaire
 * pour lire les arguments d'un appel de fonction relais quand l'argument
 * lui-même contient un appel imbriqué — exactement le cas motivant
 * `wireBuyNowButton(document.getElementById('k-buy-now-btn'))` : une capture
 * naïve `[^)]*` s'arrête à la PREMIÈRE parenthèse fermante rencontrée (celle
 * de getElementById), tronque l'argument, et le fait échouer au test de
 * cible — trouvé en écrivant le self-test de ce gate (2026-07).
 */
function extractBalancedArgs(src, openParenIdx) {
  if (src[openParenIdx] !== '(') return null;
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(openParenIdx + 1, i);
    }
  }
  return null; // parenthèses déséquilibrées : on n'affirme rien plutôt que de se tromper
}

/**
 * `[a, b].forEach((param) => { param.prop = …; })` — la cible figure dans le
 * tableau littéral, la mutation porte sur le paramètre du callback. Repéré
 * séparément du cas §2 (capture par variable) car aucune variable nommée
 * ne référence directement la cible ici.
 */
function writesZoneViaForEach(src, targets) {
  const targetRe = new RegExp(targets.join('|'));
  const forEachRe = /\[([^\]]*)\]\s*\.\s*forEach\s*\(\s*(?:\(\s*)?([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\{/g;
  let m;
  while ((m = forEachRe.exec(src))) {
    if (!targetRe.test(m[1])) continue;
    const paramName = m[2];
    const braceIdx = m.index + m[0].length - 1;
    const body = extractBalancedBody(src, braceIdx);
    if (body == null) continue;
    const writeRe = new RegExp(`\\b${paramName}\\b\\s*\\.\\s*(${WRITE_OPS.join('|')})`);
    if (writeRe.test(body)) return true;
  }
  return false;
}

/**
 * Fonctions "relais" à un seul paramètre : `function f(param) { … param.prop
 * = …; }` où c'est l'APPELANT qui passe la cible d'une zone en argument
 * (`f(document.getElementById('k-buy-now-btn'))`). La mutation vit dans le
 * fichier qui DÉFINIT f — c'est lui l'écrivain réel — même si l'id de la
 * zone n'y apparaît textuellement jamais. Repérage borné à un seul
 * paramètre : suffisant pour les cas réels rencontrés à ce jour ; une
 * fonction multi-paramètres qui muterait un paramètre non ciblé resterait
 * invisible (cas non rencontré, pas couvert pour éviter de complexifier
 * l'heuristique sans preuve de besoin).
 */
function forwardingFunctions(sources, reachable) {
  const result = [];
  const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g;
  for (const [file, src] of sources) {
    if (!reachable.has(file)) continue;
    let m;
    while ((m = fnRe.exec(src))) {
      const fnName = m[1];
      const paramName = m[2];
      const braceIdx = m.index + m[0].length - 1;
      const body = extractBalancedBody(src, braceIdx);
      if (body == null) continue;
      const writeRe = new RegExp(`\\b${paramName}\\b\\s*\\.\\s*(${WRITE_OPS.join('|')})`);
      if (writeRe.test(body)) result.push({ file, fnName });
    }
  }
  return result;
}

/**
 * Pour une zone donnée, fichiers qui l'écrivent indirectement via un appel à
 * une fonction relais (cf. forwardingFunctions) avec la cible de la zone en
 * argument. Le résultat attribue l'écriture au fichier qui DÉFINIT la
 * fonction relais, pas au fichier appelant.
 */
function writersViaForwarding(sources, zone, forwarders, reachable) {
  const targets = zoneTargetPatterns(zone);
  const targetRe = new RegExp(targets.join('|'));
  const writers = new Set();
  for (const [file, src] of sources) {
    if (!reachable.has(file)) continue;
    for (const fwd of forwarders) {
      const callRe = new RegExp(`\\b${fwd.fnName}\\s*\\(`, 'g');
      let cm;
      while ((cm = callRe.exec(src))) {
        const openParenIdx = cm.index + cm[0].length - 1;
        const args = extractBalancedArgs(src, openParenIdx);
        if (args != null && targetRe.test(args)) writers.add(fwd.file);
      }
    }
  }
  return writers;
}

/**
 * Écrivains réels d'une zone : union des écritures directes/forEach
 * (writesZone) et des écritures via fonction relais (writersViaForwarding).
 * Extrait de main() pour être testable isolément (self-test du gate) et
 * pour garantir que les DEUX formes ajoutées lors du Chantier Déduplication
 * §3 sont bien exercées — pas seulement définies. C'est le trou trouvé le
 * 2026-07 : forwardingFunctions/writersViaForwarding existaient mais
 * n'étaient appelées nulle part depuis main().
 */
function zoneWriters(sources, zone, reachable, forwarders) {
  const writers = new Set();
  for (const [f, src] of sources) {
    if (!reachable.has(f)) continue;
    if (writesZone(src, zone)) writers.add(f);
  }
  for (const w of writersViaForwarding(sources, zone, forwarders, reachable)) {
    writers.add(w);
  }
  return [...writers];
}

function main() {
  const contract = loadContract();
  const files = jsFiles();
  const reachable = reachableFromMain();
  const sources = new Map();
  for (const f of files) sources.set(f, fs.readFileSync(path.join(JS_DIR, f), 'utf8'));
  const forwarders = forwardingFunctions(sources, reachable);

  const violations = [];
  const orphans = [];
  const matrix = [];
  const deadWakeups = [];

  // Anti-récidive #1 : un module déclaré mort ne doit pas redevenir joignable
  // (réveil silencieux = retour du multi-ownership par la petite porte).
  for (const dead of (contract.deadModulesToDelete || [])) {
    const stillOnDisk = fs.existsSync(path.join(JS_DIR, dead));
    if (reachable.has(dead)) deadWakeups.push(dead);
    if (stillOnDisk && !reachable.has(dead)) {
      // présent mais mort : à supprimer (avertissement, non bloquant)
    }
  }

  for (const zone of contract.zones) {
    const writers = zoneWriters(sources, zone, reachable, forwarders);
    const allowed = new Set([zone.owner, ...(zone.allow || [])]);
    const illegal = writers.filter((w) => !allowed.has(w));
    matrix.push({ zone: zone.id, owner: zone.owner, writers, illegal });

    if (!writers.includes(zone.owner)) {
      orphans.push({ zone: zone.id, owner: zone.owner, writers });
    }
    if (illegal.length) {
      violations.push({ zone: zone.id, owner: zone.owner, illegal });
    }
  }

  // Rapport
  console.log(`\n${C.bold}═══ AUDIT RESPONSABILITÉ UNIQUE — modale produit ═══${C.r}\n`);
  console.log(`${C.dim}zone${' '.repeat(24)}owner déclaré → écrivains réels${C.r}`);
  for (const row of matrix) {
    const tag = row.illegal.length ? `${C.red}✖${C.r}`
      : (row.writers.includes(row.owner) ? `${C.grn}✓${C.r}` : `${C.ylw}○${C.r}`);
    const w = row.writers.length
      ? row.writers.map((x) => row.illegal.includes(x) ? `${C.red}${x}${C.r}` : x).join(', ')
      : `${C.dim}(personne)${C.r}`;
    console.log(` ${tag} ${row.zone.padEnd(26)} ${C.cyn}${row.owner}${C.r}  ←  ${w}`);
  }

  if (orphans.length) {
    console.log(`\n${C.ylw}○ ZONES ORPHELINES (owner déclaré n'écrit pas — souvent transitoire pendant la migration)${C.r}`);
    for (const o of orphans) console.log(`   ${o.zone} — owner ${o.owner} absent ; écrivains: ${o.writers.join(', ') || 'aucun'}`);
  }

  // Code mort encore présent sur disque
  const deadPresent = (contract.deadModulesToDelete || [])
    .filter((d) => fs.existsSync(path.join(JS_DIR, d)) && !reachable.has(d));
  if (deadPresent.length) {
    console.log(`\n${C.ylw}○ MODULES MORTS À SUPPRIMER (présents, injoignables depuis main.js)${C.r}`);
    for (const d of deadPresent) console.log(`   ${d}`);
  }

  // Anti-récidive : réveil d'un module mort
  if (deadWakeups.length) {
    console.log(`\n${C.red}${C.bold}✖ RÉVEIL DE CODE MORT${C.r} — ces modules déclarés morts sont redevenus joignables :`);
    for (const d of deadWakeups) console.log(`   ${d}`);
    process.exit(1);
  }

  if (violations.length) {
    console.log(`\n${C.red}${C.bold}✖ ${violations.length} VIOLATION(S) DE PROPRIÉTÉ UNIQUE${C.r}`);
    for (const v of violations) {
      console.log(`   ${C.red}${v.zone}${C.r} appartient à ${C.cyn}${v.owner}${C.r} mais est aussi écrit par : ${v.illegal.join(', ')}`);
    }
    console.log(`\n${C.dim}→ Corriger : soit déplacer l'écriture chez l'owner, soit ajouter le fichier`);
    console.log(`  dans "allow" du contrat SI la co-écriture est intentionnelle et documentée.${C.r}\n`);
    process.exit(1);
  }

  console.log(`\n${C.grn}${C.bold}✓ Responsabilité unique respectée pour ${matrix.length} zones.${C.r}\n`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

// Exports réservés au self-test du gate (tests/unit/audit-modal-ownership-selftest.test.js).
// N'affecte pas l'exécution CLI (`node scripts/audit-modal-ownership.js`) ci-dessus.
module.exports = {
  writesZone,
  writesZoneViaForEach,
  forwardingFunctions,
  writersViaForwarding,
  zoneWriters,
  zoneTargetPatterns,
};
