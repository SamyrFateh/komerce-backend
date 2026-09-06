'use strict';

const fs = require('fs');
const path = require('path');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function replaceOnce(file, from, to, label) {
  const src = read(file);
  if (!src.includes(from)) throw new Error(`${label}: pattern not found in ${file}`);
  write(file, src.replace(from, to));
}
function writeJson(file, value) {
  write(file, JSON.stringify(value, null, 2) + '\n');
}

// 1) Baselines historiques : elles ne décrivent plus aucune dette réelle.
writeJson('scripts/.docs-history-lint-baseline.json', {
  _doctrine: "Zéro dette : aucune exemption historique hors archive. Toute entrée future exige une décision humaine explicite et reste protégée par Debt Zero.",
  _updated: '2026-09-06',
  exempt: [],
});
writeJson('scripts/.feature-schema-tests-baseline.json', {
  _doctrine: "Zéro dette : aucune carte sans preuve tests|verification|contracts. Les identités de carte sont des chemins de manifeste, jamais le seul champ name.",
  _updated: '2026-09-06',
  exempt: [],
});

// 2) Le seul document historique encore vivant devient explicitement une archive.
const liveChallenge = 'docs/architecture/CHALLENGE_FULFILLMENT_MIXTE_2026-09-04.md';
const archivedChallenge = 'docs/_archive/architecture/CHALLENGE_FULFILLMENT_MIXTE_2026-09-04.md';
if (fs.existsSync(liveChallenge)) {
  fs.mkdirSync(path.dirname(archivedChallenge), { recursive: true });
  if (fs.existsSync(archivedChallenge)) throw new Error('archive fulfillment challenge already exists');
  fs.renameSync(liveChallenge, archivedChallenge);
}

// 3) La slice Boutique recommendations possède déjà une vraie preuve comportementale : on la déclare.
replaceOnce(
  'public/boutique/features/recommendations.feature.js',
  "    css: [\n      '../css/modal-product-polish.css',\n      '../css/modal-suggestion-card-polish.css',\n      '../css/modal-suggestion-filter.css',\n    ],\n  },",
  "    css: [\n      '../css/modal-product-polish.css',\n      '../css/modal-suggestion-card-polish.css',\n      '../css/modal-suggestion-filter.css',\n    ],\n    tests: [\n      '../tests/unit/b-modal-suggestions.test.js',\n    ],\n  },",
  'recommendations behavioral test ownership'
);

// 4) Compléter le seul périmètre actif réellement immature.
replaceOnce(
  'public/boutique/features/auth-passkey.feature.js',
  "    out: [\n    ],",
  "    out: [\n      'génération et vérification serveur des challenges/credentials WebAuthn — feature backend auth-passkey',\n      'autorité OTP/WhatsApp et création de session — feature auth/auth-identity',\n      'persistance et révocation d authentificateurs — autorité backend, jamais le navigateur',\n    ],",
  'auth-passkey perimeter.out'
);

// 5) Un manifeste deprecated vide n'est pas une feature active immature.
replaceOnce(
  'scripts/feature-schema-check.js',
`function governanceChecks(m) {\n  const miss = [];\n  if (!m.perimeter || !Array.isArray(m.perimeter.in)  || !m.perimeter.in.length)  miss.push('perimeter.in');\n  if (!m.perimeter || !Array.isArray(m.perimeter.out) || !m.perimeter.out.length) miss.push('perimeter.out');\n  if (!m.files || !Object.keys(m.files).length) miss.push('files');\n  if (!m.authority) miss.push('authority');\n  if (!m.contract || !Array.isArray(m.contract.exposes))  miss.push('contract.exposes');\n  if (!m.contract || !Array.isArray(m.contract.consumes)) miss.push('contract.consumes');\n  if (!Array.isArray(m.invariants) || !m.invariants.length) miss.push('invariants');\n  // tests|verification|contracts retiré d'ici : gouverné séparément par le\n  // RATCHET ci-dessous (voir governanceChecksMinusTests + checkRatchet).\n  return miss;\n}\n`,
`function isDeprecatedCard(m) {\n  return m && (\n    m.status === 'deprecated' ||\n    m.classification?.kind === 'deprecated' ||\n    m.classification?.decision === 'deprecated'\n  );\n}\nfunction governanceChecks(m) {\n  const miss = [];\n  const deprecated = isDeprecatedCard(m);\n  // Une tombstone deprecated doit conserver la FORME des champs, mais leur\n  // vacuité est précisément la preuve qu'elle n'exerce plus d'autorité.\n  if (!m.perimeter || !Array.isArray(m.perimeter.in) || (!deprecated && !m.perimeter.in.length)) miss.push('perimeter.in');\n  if (!m.perimeter || !Array.isArray(m.perimeter.out) || !m.perimeter.out.length) miss.push('perimeter.out');\n  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files) || (!deprecated && !Object.keys(m.files).length)) miss.push('files');\n  if (!m.authority) miss.push('authority');\n  if (!m.contract || !Array.isArray(m.contract.exposes))  miss.push('contract.exposes');\n  if (!m.contract || !Array.isArray(m.contract.consumes)) miss.push('contract.consumes');\n  if (!Array.isArray(m.invariants) || (!deprecated && !m.invariants.length)) miss.push('invariants');\n  return miss;\n}\n`,
  'deprecated card governance semantics'
);

replaceOnce(
  'scripts/feature-schema-check.js',
  "const cards = load();\nconst BASELINE_EXISTED = fs.existsSync(TESTS_BASELINE_FILE);",
  "const cards = load();\nconst featureKey = m => String(m.__file || m.name || '').replace(/\\\\/g, '/');\nconst BASELINE_EXISTED = fs.existsSync(TESTS_BASELINE_FILE);",
  'feature baseline path identity helper'
);
replaceOnce(
  'scripts/feature-schema-check.js',
  "  if (missingTests) stillMissingTests.add(m.name);\n  const ratchetFail = missingTests && !baseline.has(m.name); // nouvelle carte / régression",
  "  const baselineKey = featureKey(m);\n  if (missingTests) stillMissingTests.add(baselineKey);\n  const ratchetFail = missingTests && !baseline.has(baselineKey); // nouvelle carte / régression",
  'feature baseline path identity use'
);
replaceOnce(
  'scripts/feature-schema-check.js',
  "if (SAVE) {\n  const next = saveTestsBaseline(stillMissingTests, baseline, !BASELINE_EXISTED);",
  "const staleBaseline = [...baseline].filter(key => !stillMissingTests.has(key));\nif (staleBaseline.length) {\n  errRatchet += staleBaseline.length;\n  console.log(`\\n${C.red}✖ ${staleBaseline.length} exemption(s) tests devenue(s) inutile(s) :${C.r}`);\n  staleBaseline.forEach(key => console.log(`${C.red}   ↓ ${key}${C.r}`));\n  console.log(`${C.dim}  Rétrécir scripts/.feature-schema-tests-baseline.json ; une dette remboursée ne reste jamais baselinée.${C.r}`);\n}\n\nif (SAVE) {\n  const next = saveTestsBaseline(stillMissingTests, baseline, !BASELINE_EXISTED);",
  'feature stale baseline exactness'
);

// 6) Même exactitude pour la baseline documentaire.
replaceOnce(
  'scripts/docs-history-lint.js',
  "if (SAVE) {\n  const next = saveBaseline(rawViolations, baseline, !BASELINE_EXISTED);",
  "const rawViolationSet = new Set(rawViolations.map(v => v.file.rel));\nconst staleBaseline = [...baseline].filter(rel => !rawViolationSet.has(rel));\nif (staleBaseline.length) {\n  console.log(`\\n${C.red}✖ ${staleBaseline.length} exemption(s) docs devenue(s) inutile(s) :${C.r}`);\n  staleBaseline.forEach(rel => console.log(`${C.red}   ↓ ${rel}${C.r}`));\n  console.log(`${C.dim}  Rétrécir scripts/.docs-history-lint-baseline.json ; une dette archivée/supprimée ne reste jamais baselinée.${C.r}`);\n}\n\nif (SAVE) {\n  const next = saveBaseline(rawViolations, baseline, !BASELINE_EXISTED);",
  'docs stale baseline exactness'
);
replaceOnce(
  'scripts/docs-history-lint.js',
  "if (violations.length) {",
  "if (violations.length || (STRICT && staleBaseline.length)) {",
  'docs stale baseline hard fail'
);
replaceOnce(
  'scripts/docs-history-lint.js',
  "if (!violations.length) {\n  console.log(`\\n${C.grn}${C.bld}✔ Gate 5 OK — aucune nouvelle dette historique hors archive.${C.r}`);\n}",
  "if (!violations.length && !staleBaseline.length) {\n  console.log(`\\n${C.grn}${C.bld}✔ Gate 5 OK — zéro dette historique hors archive, baseline exacte.${C.r}`);\n}",
  'docs zero success message'
);

// 7) Retirer l'unique suppression morte ; conserver les 20 faux positifs encore vivants.
const suppressionsPath = 'scripts/impact-suppressions.json';
const suppressions = JSON.parse(read(suppressionsPath));
const nextSuppressions = suppressions.filter(entry => !(
  entry.file === 'public/boutique/js/b-komerce.js' &&
  entry.category === 'xss' &&
  entry.contains === 'LOT4B_STATIC_WALLET_CONTAINER'
));
if (suppressions.length !== 21 || nextSuppressions.length !== 20) {
  throw new Error(`unexpected impact suppression inventory ${suppressions.length} -> ${nextSuppressions.length}`);
}
writeJson(suppressionsPath, nextSuppressions);

// 8) Ownership du nouveau gate.
replaceOnce(
  'features/infrastructure.feature.js',
  "      'scripts/impact-check.js',\n      'scripts/impact-config.json',",
  "      'scripts/impact-check.js',\n      'scripts/impact-suppression-check.js',\n      'scripts/impact-config.json',",
  'infrastructure owns suppression gate'
);

// 9) Les commandes locales normales deviennent elles aussi zéro-dette/full.
const pkg = JSON.parse(read('package.json'));
pkg.scripts['gate:schema'] = 'node scripts/feature-schema-check.js --strict --full';
pkg.scripts['gate:docs-lint'] = 'node scripts/docs-history-lint.js --strict --full';
pkg.scripts['impact:suppressions:check'] = 'node scripts/impact-suppression-check.js';
writeJson('package.json', pkg);

// map-check doit certifier la même cible que la CI.
replaceOnce(
  'scripts/map-check.js',
  "    cmd:      'node scripts/feature-schema-check.js --strict',",
  "    cmd:      'node scripts/feature-schema-check.js --strict --full',",
  'map-check full schema'
);

// 10) Required verdict voit désormais les trois zéros globaux sur CHAQUE PR.
replaceOnce(
  '.github/workflows/pr-enforcement.yml',
  '        run: node scripts/pr-enforcement-scope.js --base "$BASE_SHA" --head "$HEAD_SHA" --github-output "$GITHUB_OUTPUT"\n',
  '        run: node scripts/pr-enforcement-scope.js --base "$BASE_SHA" --head "$HEAD_SHA" --github-output "$GITHUB_OUTPUT"\n      - name: Feature card schema — zero debt\n        run: node scripts/feature-schema-check.js --strict --full\n      - name: Docs history — zero debt\n        run: node scripts/docs-history-lint.js --strict --full\n      - name: Impact suppression hygiene\n        run: node scripts/impact-suppression-check.js\n',
  'global zero-debt checks in changes job'
);

console.log('✅ Second-circle permanent fixes staged.');
