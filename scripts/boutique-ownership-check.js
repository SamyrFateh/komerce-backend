#!/usr/bin/env node
'use strict';

/**
 * boutique-ownership-check.js
 *
 * Targeted gate for Boutique ownership gaps. It checks that the product modal
 * and its mobile image/lightbox surface are owned in three places:
 *   - the generated Boutique 360 snapshot;
 *   - the canonical Boutique docs;
 *   - the catalog feature card.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.cwd());
const C = { red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', bld: '\x1b[1m', r: '\x1b[0m' };

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function json(rel) {
  return JSON.parse(read(rel));
}

const requiredModalJs = [
  'public/boutique/js/b-modal.js',
  'public/boutique/js/b-modal-core.js',
  'public/boutique/js/b-modal-product.js',
  'public/boutique/js/b-modal-image-ux.js',
  'public/boutique/js/b-modal-social-proof.js',
  'public/boutique/js/b-modal-nav.js',
  'public/boutique/js/b-modal-suggestions.js',
  'public/boutique/js/b-modal-cart.js',
  'public/boutique/js/b-modal-desktop-enhancers.js',
  'public/boutique/js/b-modal-product-detail-bootstrap.js',
  'public/boutique/js/b-modal-mobile-product.js',
  'public/boutique/js/b-modal-desktop-product.js',
  'public/boutique/js/view-models/modal-selection-model.js',
];

const requiredModalCss = [
  'public/boutique/css/modal-shell.css',
  'public/boutique/css/modal-media.css',
  'public/boutique/css/modal-product.css',
  'public/boutique/css/modal-product-lot4-hybrid.css',
];

const canonicalDocs = [
  'docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md',
  'docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md',
  'public/boutique/README.md',
];

const errors = [];
const warnings = [];

function error(msg) { errors.push(msg); }
function warning(msg) { warnings.push(msg); }
function hasText(haystack, needle) { return haystack.includes(needle); }
function catalogDeclaresBoutiqueFile(file) {
  const normalized = file.replace(/^public\/boutique\//, '');
  return hasText(catalogCard, file) || hasText(catalogCard, normalized);
}

let boutique360;
try {
  boutique360 = json('docs/BOUTIQUE_360.json');
} catch (e) {
  error(`docs/BOUTIQUE_360.json illisible: ${e.message}`);
  boutique360 = { summary: {}, modules: [] };
}

const modules = new Map((boutique360.modules || []).map(m => [m.file, m]));
const docsText = canonicalDocs.map(rel => {
  try { return `\n--- ${rel} ---\n${read(rel)}`; }
  catch (e) { error(`${rel} illisible: ${e.message}`); return ''; }
}).join('\n');

let catalogCard = '';
try { catalogCard = read('features/catalog.feature.js'); }
catch (e) { error(`features/catalog.feature.js illisible: ${e.message}`); }

if (boutique360.summary && boutique360.summary.modules !== boutique360.summary.withHeader) {
  error(`BOUTIQUE_360 incomplet: ${boutique360.summary.withHeader}/${boutique360.summary.modules} modules avec header`);
}

for (const file of requiredModalJs) {
  const mod = modules.get(file);
  if (!mod) {
    error(`Owner JS absent de docs/BOUTIQUE_360.json: ${file}`);
    continue;
  }
  for (const field of ['role', 'domain', 'layer']) {
    if (!mod[field]) error(`${file}: header @${field} absent dans BOUTIQUE_360`);
  }
  if (!hasText(docsText, file)) error(`Owner JS non documente dans les docs canoniques Boutique: ${file}`);
  if (!catalogDeclaresBoutiqueFile(file)) error(`catalog.feature.js ne declare pas le fichier modal: ${file}`);
}

for (const file of requiredModalCss) {
  if (!hasText(docsText, file)) error(`Owner CSS non documente dans les docs canoniques Boutique: ${file}`);
  if (!catalogDeclaresBoutiqueFile(file)) error(`catalog.feature.js ne declare pas le fichier CSS modal: ${file}`);
}

const imageUx = modules.get('public/boutique/js/b-modal-image-ux.js');
if (imageUx) {
  const doctrine = Array.isArray(imageUx.doctrine) ? imageUx.doctrine.join(' ') : '';
  if (!/image_produit_inspectable|modal_produit_sans_chevauchement/.test(doctrine)) {
    error('b-modal-image-ux.js doit declarer une doctrine image/modal inspectable dans BOUTIQUE_360');
  }
}

if (!hasText(docsText, 'Voir en grand')) {
  error('Les docs canoniques Boutique ne nomment pas le parcours mobile "Voir en grand"');
}
if (!hasText(docsText, 'public/boutique/js/b-modal-image-ux.js') || !hasText(docsText, 'public/boutique/css/modal-media.css')) {
  error('Le parcours "Voir en grand" doit pointer vers b-modal-image-ux.js et modal-media.css');
}

try {
  const localMobileDoc = read('public/boutique/docs/MODAL_MOBILE_ARCHITECTURE.md');
  if (!hasText(localMobileDoc, 'Source canonique actuelle')) {
    warning('public/boutique/docs/MODAL_MOBILE_ARCHITECTURE.md doit rappeler sa source canonique actuelle');
  }
} catch (e) {
  warning(`Doc mobile locale absente ou illisible: ${e.message}`);
}

console.log(`\n${C.bld}Boutique ownership gate${C.r}`);
console.log(`${C.dim}${requiredModalJs.length} owner(s) JS modal, ${requiredModalCss.length} owner(s) CSS modal verifies.${C.r}`);

if (warnings.length) {
  console.log(`\n${C.ylw}${C.bld}Warnings:${C.r}`);
  warnings.forEach(msg => console.log(`${C.ylw}  - ${msg}${C.r}`));
}

if (errors.length) {
  console.log(`\n${C.red}${C.bld}Errors:${C.r}`);
  errors.forEach(msg => console.log(`${C.red}  - ${msg}${C.r}`));
  process.exit(1);
}

console.log(`\n${C.grn}${C.bld}OK — Boutique modal/catalog ownership is explicit.${C.r}`);
