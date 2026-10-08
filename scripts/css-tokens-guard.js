#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          css-tokens-guard
 * @domain        admin-dashboard
 * @layer         governance-gate
 * @criticality   medium
 * @inputs        public/dashboards/canonical/css/*.css
 * @outputs       exit_code
 * @depends       none
 * @used-by       tests/unit/css-tokens-guard.test.js, npm run css:tokens-guard
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_theme_authority, debt_never_increases
 * @impact-areas  admin-dashboard
 * @version       2026-10
 */
'use strict';

// Ratchet : (1) les tokens de santé (--health-*) ne sont définis que dans
// tokens.css ; (2) le nombre de `!important` par feuille ne peut que baisser
// (une feuille absente de la baseline part de 0). Descendre est libre ; pour
// baisser le plafond, éditer IMPORTANT_CEILING dans la même PR.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'public', 'dashboards', 'canonical', 'css');
// Plafond par feuille (cliquet : ne peut que baisser). Pas de registre governance/
// séparé : la valeur vit ici et se réduit dans la même PR que la correction.
const IMPORTANT_CEILING = Object.freeze({
  "canonical-finish-polish-v1.css": 2,
  "canonical-legacy-theme-v1.css": 4,
  "canonical-shell-v4.css": 2,
  "canonical-theme-v2.css": 2,
  "import-runtime.css": 141,
  "live-kit.css": 15,
  "live-ops-shell.css": 37,
  "pricing-economic-cockpit.css": 1,
  "pricing-simulation.css": 1,
  "visual-freeze-v1.css": 1
});

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function measure() {
  const files = fs.readdirSync(CSS_DIR).filter(name => name.endsWith('.css')).sort();
  const important = {};
  const healthOutsideTokens = [];
  for (const name of files) {
    const css = stripComments(fs.readFileSync(path.join(CSS_DIR, name), 'utf8'));
    const count = (css.match(/!important/g) || []).length;
    if (count) important[name] = count;
    if (name !== 'tokens.css' && /--health-(green|orange|red|unknown)[a-z-]*\s*:/.test(css)) healthOutsideTokens.push(name);
  }
  return { important, healthOutsideTokens };
}

function check(baseline = { important: IMPORTANT_CEILING }) {
  const { important, healthOutsideTokens } = measure();
  const errors = [];
  healthOutsideTokens.forEach(name => errors.push(`${name}: token --health-* défini hors tokens.css`));
  for (const [name, count] of Object.entries(important)) {
    const allowed = (baseline.important || {})[name] || 0;
    if (count > allowed) errors.push(`${name}: ${count} !important (baseline ${allowed}) — résoudre le conflit de spécificité, ne pas ajouter de !important`);
  }
  return { errors, important };
}

if (require.main === module) {
  const { errors } = check();
  if (errors.length) {
    errors.forEach(error => console.error(`✖ ${error}`));
    process.exit(1);
  }
  console.log('✔ css-tokens-guard : aucun nouveau !important, tokens de santé uniques');
}

module.exports = { check, measure };
