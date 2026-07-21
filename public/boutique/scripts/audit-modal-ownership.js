#!/usr/bin/env node
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
 * @version       2026-07
 *
 * INVARIANT VÉRIFIÉ :
 *   Pour chaque zone déclarée dans OWNERSHIP, exactement UN fichier a le droit
 *   d'y écrire (innerHTML/textContent/appendChild/hidden/class/... ). Tout
 *   écrivain non déclaré => VIOLATION => exit 1.
 *
 * Le contrat vit dans scripts/modal-ownership.contract.json (source de vérité
 * unique, lisible par un humain ET par un agent). Ce script ne fait que le
 * confronter à la réalité du code. Aucune heuristique cachée.
 */
'use strict';

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

/**
 * Un fichier "écrit" dans une zone s'il contient une expression qui cible
 * l'élément (par id direct OU par alias dom.*) suivie d'une op d'écriture.
 * On reste volontairement conservateur : on veut zéro faux négatif sur les
 * vraies mutations, quitte à demander une allowlist explicite pour les cas
 * légitimes (lecture, listeners neutres).
 */
function writesZone(src, zone) {
  const id = zone.id;
  const aliases = Object.entries(DOM_ALIASES)
    .filter(([, v]) => v === id)
    .map(([k]) => `dom\\.${k}`);

  // Cibles possibles de l'élément dans une même expression
  const targets = [
    `getElementById\\(['"]${id}['"]\\)`,
    `querySelector\\(['"]#${id}['"]\\)`,
    ...aliases,
  ];
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
  return false;
}

function main() {
  const contract = loadContract();
  const files = jsFiles();
  const reachable = reachableFromMain();
  const sources = new Map();
  for (const f of files) sources.set(f, fs.readFileSync(path.join(JS_DIR, f), 'utf8'));

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
    const writers = [];
    for (const [f, src] of sources) {
      // Seuls les modules VIVANTS peuvent violer à l'exécution.
      if (!reachable.has(f)) continue;
      if (writesZone(src, zone)) writers.push(f);
    }
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

main();
