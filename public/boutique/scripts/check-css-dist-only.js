#!/usr/bin/env node
'use strict';

/**
 * check-css-dist-only.js — Garde-fou : la prod ne charge QUE des bundles css/dist/.
 *
 *   Invariant (README §3) : « La prod charge uniquement css/dist/*.css. »
 *   Un <link rel="stylesheet" href="css/hero.css"> brut (source non bundlée)
 *   court-circuite le pipeline, le cache-buster et l'audit d'archi. Cette règle
 *   était documentaire → rendue exécutable ici.
 *
 * Bloque (exit 1) si un <link> feuille de style pointe vers un .css hors css/dist/.
 *
 * Usage : node scripts/check-css-dist-only.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');

const RED = '\x1b[31m', GRN = '\x1b[32m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

const html = fs.readFileSync(INDEX, 'utf8');

// Toutes les balises <link ...> qui chargent une feuille de style (.css).
const linkRe = /<link\b[^>]*>/gi;
const offenders = [];
let m;
while ((m = linkRe.exec(html)) !== null) {
  const tag = m[0];
  // On ne s'intéresse qu'aux feuilles de style : rel="stylesheet" OU href .css.
  const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
  if (!hrefMatch) continue;
  const href = hrefMatch[1];
  const isStylesheet = /rel\s*=\s*["']stylesheet["']/i.test(tag) || /\.css(\?|#|$)/i.test(href);
  if (!isStylesheet) continue;
  if (!/\.css(\?|#|$)/i.test(href)) continue;          // pas une CSS (ex: preconnect)
  // Doit pointer vers css/dist/ (avec ou sans préfixe /boutique, ./, etc.).
  if (!/(^|\/)css\/dist\//.test(href)) {
    offenders.push(href);
  }
}

if (offenders.length === 0) {
  console.log(`${GRN}${BLD}✔ index.html ne charge que des bundles css/dist/.${R}`);
  process.exit(0);
}

console.log(`${RED}${BLD}✖ ${offenders.length} feuille(s) de style hors css/dist/ dans index.html :${R}`);
offenders.forEach(h => console.log(`${RED}   • ${h}${R}`));
console.log(`${DIM}  La prod ne doit charger que les bundles générés. Édite la source CSS puis${R}`);
console.log(`${DIM}  npm run deploy:css — ne référence jamais un css/*.css brut dans index.html.${R}`);
process.exit(1);
