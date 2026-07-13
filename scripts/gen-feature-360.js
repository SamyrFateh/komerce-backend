#!/usr/bin/env node
'use strict';

/**
 * gen-feature-360.js — Feature 360 : projection de pilotage business (Lot O8).
 *
 *   Reconstruit docs/FEATURE_360.json + docs/FEATURE_360.md en projetant
 *   exclusivement les autorités Feature First déjà gouvernées (O2-O7.3) :
 *   docs/BUSINESS_FEATURE_GRAPH.json + features/*.feature.js et équivalents.
 *
 *   Ne recrée aucune vérité, aucune ontologie, aucun registre parallèle.
 *   Logique de construction dans scripts/lib/feature-360-builder.js (partagée
 *   avec le checker et les tests négatifs).
 *
 * Modes :
 *   node scripts/gen-feature-360.js            → (re)génère les deux fichiers
 *   node scripts/gen-feature-360.js --check    → régénère en mémoire, échoue
 *                                                 si le disque est périmé (stale)
 *
 * Intégration package.json :
 *   "feature:360:gen":   "node scripts/gen-feature-360.js"
 *   "feature:360:check": "node scripts/gen-feature-360.js --check"
 */

const fs = require('fs');
const path = require('path');
const { build } = require('./lib/feature-360-builder.js');
const { renderMd } = require('./lib/feature-360-render.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'docs', 'FEATURE_360.json');
const OUT_MD = path.join(ROOT, 'docs', 'FEATURE_360.md');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');

const RED = '\x1b[31m', GRN = '\x1b[32m', YLW = '\x1b[33m', CYN = '\x1b[36m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

const model = build();
const json = JSON.stringify(model, null, 2) + '\n';
const md = renderMd(model);

if (CHECK) {
  const onDiskJson = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON, 'utf8') : null;
  const onDiskMd = fs.existsSync(OUT_MD) ? fs.readFileSync(OUT_MD, 'utf8') : null;
  const jsonStale = onDiskJson !== json;
  const mdStale = onDiskMd !== md;
  if (!jsonStale && !mdStale) {
    console.log(`${GRN}${BLD}✔ Feature 360 à jour${R} ${DIM}(${model.summary.features} features, ${model.summary.healthy} healthy, ${model.summary.attention} attention, ${model.summary.blocked} blocked)${R}`);
    process.exit(0);
  }
  console.error(`${RED}${BLD}✖ Feature 360 périmée (stale).${R}`);
  if (jsonStale) console.error(`${RED}  docs/FEATURE_360.json ne correspond plus aux autorités sources.${R}`);
  if (mdStale) console.error(`${RED}  docs/FEATURE_360.md ne correspond plus aux autorités sources.${R}`);
  console.error(`${DIM}  Régénère : npm run feature:360:gen${R}`);
  process.exit(1);
}

fs.writeFileSync(OUT_JSON, json);
fs.writeFileSync(OUT_MD, md);
console.log(`${GRN}${BLD}✔ Feature 360 générée${R} ${DIM}(${model.summary.features} features · ${model.summary.healthy} healthy · ${model.summary.attention} attention · ${model.summary.blocked} blocked · ${model.summary.businessDependencies} business deps)${R}`);
console.log(`${CYN}  docs/FEATURE_360.json${R} + ${CYN}docs/FEATURE_360.md${R}`);
