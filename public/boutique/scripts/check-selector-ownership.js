#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { TRACKED_SELECTORS, selectorMap } = require('./gen-boutique-arch-live.js');
const { evaluateSelectorOwnership } = require('./critical-selector-ownership.js');

const BOUTIQUE_ROOT = path.join(__dirname, '..');

function evaluateDiscoveryCardContract() {
  const renderer = fs.readFileSync(
    path.join(BOUTIQUE_ROOT, 'js/render/render-discovery-rail.js'),
    'utf8'
  );
  const cssRaw = fs.readFileSync(path.join(BOUTIQUE_ROOT, 'css/discovery-rail.css'), 'utf8');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
  const errors = [];

  const requiredRendererTokens = [
    'class="k-card k-discovery-card k-card--discovery"',
    'class="k-card-img-wrap"',
    'class="k-card-img k-discovery-img"',
    'class="k-card-info"',
    'class="k-card-name k-discovery-name"',
    'class="k-card-bottom k-card-prices-row k-discovery-bottom"',
    'class="k-card-add k-discovery-action-slot"',
  ];

  for (const token of requiredRendererTokens) {
    if (!renderer.includes(token)) {
      errors.push(`Discovery doit réutiliser le shell canonique Komerce : token manquant ${token}`);
    }
  }

  // .k-discovery-card reste un hook comportemental/data. Ces anciens owners
  // visuels recréeraient un second modèle de carte parallèle au k-card canonique.
  const forbiddenSelectors = [
    '.k-discovery-card',
    '.k-discovery-media',
    '.k-discovery-info',
    '.k-discovery-name',
  ];

  for (const selector of forbiddenSelectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`${escaped}\\s*(?:[:.#\\[][^,{]*)?\\{`, 'm');
    if (rule.test(css)) {
      errors.push(`${selector} ne peut pas posséder de règle CSS de shell ; utiliser les classes k-card canoniques`);
    }
  }

  if (/\.k-discovery-cta\s*\{[^}]*\bwidth\s*:\s*100%/m.test(css)) {
    errors.push('Le CTA Discovery ne peut pas redevenir un bouton pleine largeur hors du slot k-card-add canonique');
  }

  return { ok: errors.length === 0, errors };
}

function run(map = selectorMap(), tracked = TRACKED_SELECTORS) {
  const result = evaluateSelectorOwnership(map, tracked);
  const discovery = evaluateDiscoveryCardContract();

  console.log('\nCritical selector ownership guard');
  console.log(`${result.rows.length} sélecteur(s) critique(s) vérifié(s).`);

  const errors = [
    ...result.errors.map(error => error.message),
    ...discovery.errors,
  ];

  if (errors.length) {
    console.error(`\n✖ ${errors.length} violation(s) d'ownership / contrat visuel :`);
    for (const message of errors) console.error(`  - ${message}`);
    return 1;
  }

  const multiOwner = result.rows.filter(row => row.observed.length > 1).length;
  console.log(`✔ Contrat respecté — 0 owner non autorisé, ${multiOwner} sélecteur(s) avec adaptations explicites.`);
  console.log('✔ Discovery réutilise le shell k-card canonique — aucun second modèle visuel de carte.');
  return 0;
}

if (require.main === module) process.exitCode = run();

module.exports = { run, evaluateDiscoveryCardContract };
