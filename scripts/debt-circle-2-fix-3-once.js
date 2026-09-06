'use strict';

const fs = require('fs');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function replaceOnce(file, from, to, label) {
  const src = read(file);
  if (!src.includes(from)) throw new Error(`${label}: pattern not found in ${file}`);
  write(file, src.replace(from, to));
}

// Production catalogue smoke appartient au propriétaire du catalogue public.
replaceOnce(
  'features/catalog.feature.js',
  "      '.github/workflows/cj-real-showcase-contract.yml',\n",
  "      '.github/workflows/cj-real-showcase-contract.yml',\n      '.github/workflows/catalog-prod-smoke.yml',\n",
  'catalog-prod-smoke ownership'
);

// La réparation CJ Discovery se déclare elle-même domain=recommendations ;
// elle pilote l'ordre/candidats du rail, sans prendre l'autorité des sources.
replaceOnce(
  'features/recommendations.feature.js',
  "  files: {\n    services: [",
  "  files: {\n    ci: [\n      '.github/workflows/discovery-cj-local-repair.yml',\n    ],\n    scripts: [\n      'scripts/discovery-cj-local-repair.js',\n    ],\n    services: [",
  'discovery CJ workflow/script ownership'
);
replaceOnce(
  'features/recommendations.feature.js',
  "      'tests/unit/discovery-rail-service.test.js',\n",
  "      'tests/unit/discovery-rail-service.test.js',\n      'tests/unit/discovery-cj-local-repair.test.js',\n",
  'discovery CJ behavioral test ownership'
);

// Le seed contextual modal V2 est déjà détenu par providers-services :
// le workflow d'exploitation staging suit le même owner.
replaceOnce(
  'features/providers-services.feature.js',
  "    scripts: [\n      'scripts/seed-discovery-staging.js',",
  "    ci: [\n      '.github/workflows/staging-discovery-modal-v2-ops.yml',\n    ],\n    scripts: [\n      'scripts/seed-discovery-staging.js',",
  'staging discovery modal workflow ownership'
);

// Railway deployment plumbing appartient à infrastructure, déjà propriétaire
// de railway.toml/package/bootstrap CI.
replaceOnce(
  'features/infrastructure.feature.js',
  "    ci: [\n      '.github/CODEOWNERS',",
  "    ci: [\n      '.github/CODEOWNERS',\n      '.github/workflows/railway-prod-unblock.yml',",
  'railway prod unblock ownership'
);

console.log('✅ Four active orphan workflows assigned to canonical owners.');
