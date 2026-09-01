'use strict';

const fs = require('fs');
const path = require('path');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content); }
function requireIncludes(content, needle, label) {
  if (!content.includes(needle)) throw new Error(`U0 anchor missing: ${label}`);
}
function removeBlock(content, block, label) {
  requireIncludes(content, block, label);
  return content.replace(block, '');
}
function replaceTest(content, titleFragment, replacement) {
  const titlePos = content.indexOf(titleFragment);
  if (titlePos < 0) throw new Error(`U0 test anchor missing: ${titleFragment}`);
  const start = content.lastIndexOf('  test(', titlePos);
  const next = content.indexOf('\n  test(', start + 1);
  const end = next >= 0 ? next : content.lastIndexOf('\n});');
  if (start < 0 || end < 0) throw new Error(`U0 test bounds missing: ${titleFragment}`);
  return content.slice(0, start) + replacement.trimEnd() + '\n' + content.slice(end);
}

// 1) decision-signals is the canonical owner of radar-queries and radar-alerts/*.
const capabilityPath = 'capabilities/decision-signals.capability.js';
let capability = read(capabilityPath);
const serviceAnchor = "      'services/radar-queries.js',\n";
requireIncludes(capability, serviceAnchor, 'decision-signals services/radar-queries');
const radarServices = [
  'services/radar-alerts/cash-reconciliation-signals.js',
  'services/radar-alerts/commerce-signals.js',
  'services/radar-alerts/logistics-signals.js',
  'services/radar-alerts/payment-signals.js',
  'services/radar-alerts/treasury-signals.js',
];
if (!radarServices.every((p) => capability.includes(`'${p}'`))) {
  const block = radarServices.map((p) => `      '${p}',`).join('\n') + '\n';
  capability = capability.replace(serviceAnchor, serviceAnchor + block);
}

const testAnchor = "      'tests/unit/radar-queries.test.js',\n";
requireIncludes(capability, testAnchor, 'decision-signals tests/radar-queries');
const radarTests = [
  'tests/unit/radar-alerts-cash-reconciliation-signals.test.js',
  'tests/unit/radar-alerts-logistics-signals.test.js',
  'tests/unit/radar-alerts-payment-signals.test.js',
  'tests/unit/radar-alerts-treasury-commerce-signals.test.js',
];
if (!radarTests.every((p) => capability.includes(`'${p}'`))) {
  const block = radarTests.map((p) => `      '${p}',`).join('\n') + '\n';
  capability = capability.replace(testAnchor, testAnchor + block);
}
write(capabilityPath, capability);

// 2) dashboard consumes decision-signals but does not own its implementation files.
const dashboardPath = 'features/dashboard.feature.js';
let dashboard = read(dashboardPath);
const dashboardOwnedByMistake = new Set(['services/radar-queries.js', ...radarServices]);
dashboard = dashboard
  .split('\n')
  .filter((line) => ![...dashboardOwnedByMistake].some((p) => line.includes(`'${p}'`)))
  .join('\n');
const consume = "      'decision-signals (services/radar-queries.js — routes/admin-radar.js)',";
if (!dashboard.includes(consume)) {
  const marketConsume = "      'market (autorité horizontale des partenaires pays via requireMarketScope et operator_market_scopes)',";
  requireIncludes(dashboard, marketConsume, 'dashboard market consume');
  dashboard = dashboard.replace(marketConsume, consume + '\n' + marketConsume);
}
write(dashboardPath, dashboard);

// 3) infrastructure owns active staging CI and the executable invariant gate.
const infraPath = 'features/infrastructure.feature.js';
let infra = read(infraPath);
const stagingWorkflow = "      '.github/workflows/staging-discovery-ops.yml',";
if (!infra.includes(stagingWorkflow)) {
  const prEnforcement = "      '.github/workflows/pr-enforcement.yml',";
  requireIncludes(infra, prEnforcement, 'infrastructure pr-enforcement ownership');
  infra = infra.replace(prEnforcement, prEnforcement + '\n' + stagingWorkflow);
}
const invariantScript = "      'scripts/feature-invariant-check.js',";
if (!infra.includes(invariantScript)) {
  const featureGuard = "      'scripts/feature-guard.js',";
  requireIncludes(infra, featureGuard, 'infrastructure feature-guard ownership');
  infra = infra.replace(featureGuard, featureGuard + '\n' + invariantScript);
}
write(infraPath, infra);

// 4) PR enforcement must block every future Debt-Zero regression.
const workflowPath = '.github/workflows/pr-enforcement.yml';
let workflow = read(workflowPath);
const freshStep = "      - name: Business graph reconstructible and fresh\n        run: node scripts/business-graph-gen.js --check --dash-root public --boutique-root public/boutique\n";
requireIncludes(workflow, freshStep, 'PR enforcement business graph freshness step');
if (!workflow.includes('Business graph debt ratchet')) {
  const lockSteps = freshStep
    + "      - name: Business graph debt ratchet\n        run: npm run business-graph:ratchet-check\n"
    + "      - name: Business graph dependency disposition\n        run: npm run business-graph:disposition-check\n";
  workflow = workflow.replace(freshStep, lockSteps);
}
write(workflowPath, workflow);

// 5) Executable-invariant gate: Jest 30 flag + correct runner per scope.
// Root Jest ignores /public/, so a Boutique invariant must run from public/boutique.
const invariantPath = 'scripts/feature-invariant-check.js';
let invariantGate = read(invariantPath);
requireIncludes(invariantGate, "'--testPathPattern', inv.absPath", 'Jest 29 invariant CLI flag');
invariantGate = invariantGate
  .replace(/jest --testPathPattern/g, 'jest --testPathPatterns')
  .replace(
    "    const args = [\n      '--testPathPattern', inv.absPath.replace(/\\\\/g, '/'),",
    "    const boutiqueRoot = path.join(ROOT, 'public', 'boutique');\n"
      + "    const isBoutiqueTest = inv.absPath.startsWith(boutiqueRoot + path.sep);\n"
      + "    const jestCwd = isBoutiqueTest ? boutiqueRoot : ROOT;\n"
      + "    const jestPath = (isBoutiqueTest ? path.relative(boutiqueRoot, inv.absPath) : inv.absPath).replace(/\\\\/g, '/');\n"
      + "    const args = [\n      '--testPathPatterns', jestPath,"
  )
  .replace('      cwd: ROOT,\n      encoding:', '      cwd: jestCwd,\n      encoding:');
requireIncludes(invariantGate, 'const isBoutiqueTest =', 'scope-aware invariant runner');
write(invariantPath, invariantGate);

// 6) Boutique bus truth: keep the real Discovery command, remove speculative/orphan signals.
const inquiryPath = 'public/boutique/js/discovery-inquiry.js';
let inquiry = read(inquiryPath);
const orphanInquiryEvent = "    bus.emit('discovery:inquiry-created', {\n      id: result.inquiry.id,\n      status: result.inquiry.status,\n      kind,\n      ref,\n    });\n";
inquiry = removeBlock(inquiry, orphanInquiryEvent, 'orphan discovery:inquiry-created emission');
write(inquiryPath, inquiry);

const inquiryTestPath = 'public/boutique/tests/unit/discovery-inquiry.test.js';
let inquiryTest = read(inquiryTestPath);
const successExpectation = "    expect(mockBus.emit).toHaveBeenCalledWith('discovery:inquiry-created', {\n      id: 'inq-1', status: 'sent', kind: 'service', ref: 'svc-1',\n    });\n";
inquiryTest = removeBlock(inquiryTest, successExpectation, 'obsolete inquiry-created success expectation');
const failureExpectation = "    expect(mockBus.emit).not.toHaveBeenCalledWith('discovery:inquiry-created', expect.anything());\n";
inquiryTest = removeBlock(inquiryTest, failureExpectation, 'obsolete inquiry-created failure expectation');
write(inquiryTestPath, inquiryTest);

const railPath = 'public/boutique/js/discovery-rail.js';
let rail = read(railPath);
const speculativeMarketListener = "\n  // Contrat explicite pour une future vraie commutation market. Aujourd'hui\n  // MarketContext reste KM par défaut ; ce signal est sans émetteur runtime.\n  bus.on('market:changed', refreshDiscoveryRail);\n";
rail = removeBlock(rail, speculativeMarketListener, 'speculative market:changed listener');
write(railPath, rail);

const busPath = 'public/boutique/js/b-bus.js';
let bus = read(busPath);
const activeAnchor = " *   favorites:view-refresh —               — rafraîchir la vue Favoris après mutation du catalogue\n";
requireIncludes(bus, activeAnchor, 'bus active event anchor');
const activeDiscovery = " *   discovery:request { kind, ref, source } — agir sur une offre/service Discovery ; catalog → providers-services\n";
if (!bus.includes(activeDiscovery)) bus = bus.replace(activeAnchor, activeAnchor + activeDiscovery);

const ownedAnchor = " *   modal:composition-synced    owner=modal-product producer=b-modal-product-detail-bootstrap.js payload=none\n";
requireIncludes(bus, ownedAnchor, 'bus owned event anchor');
const ownedDiscovery = " *   discovery:request           owner=catalog producer=discovery-rail.js payload=value\n";
if (!bus.includes(ownedDiscovery)) bus = bus.replace(ownedAnchor, ownedAnchor + ownedDiscovery);

const consumersAnchor = " *   modal:composition-synced : b-modal-desktop-enhancers.js, b-modal-core.js, b-modal-suggestions.js\n";
requireIncludes(bus, consumersAnchor, 'bus consumer anchor');
const consumerDiscovery = " *   discovery:request : discovery-inquiry.js\n";
if (!bus.includes(consumerDiscovery)) bus = bus.replace(consumersAnchor, consumersAnchor + consumerDiscovery);
write(busPath, bus);

// 7) Vague-1 shadow test was stale after the reviewed V2 Inquiry exposure.
const shadowPath = 'tests/unit/shadow-domains-boundary.test.js';
let shadow = read(shadowPath);
shadow = shadow
  .replace('Boundary test — Vague 1 Shadow (PR A + PR B)', 'Boundary test — Vague 2 governed exposure')
  .replace(
    'un fichier Boutique SANS décision explicite de Vague 2 (exposition\n * graduelle, IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §9).',
    'un fichier Boutique EN DEHORS des frontières Vague 2 explicitement\n * revues (Discovery read-only + Inquiry canonique).'
  );

shadow = replaceTest(
  shadow,
  'aucun fichier Boutique (JS) ne référence les services shadow ou leurs tables',
  `  test('Boutique ne peut jamais importer directement les services backend owners', () => {
    const boutiqueFiles = walk(path.join(ROOT, 'public', 'boutique', 'js'), ['.js']);
    const offenders = [];
    const forbiddenImports = [
      /from\s+['"][^'"]*local-stock-service(?:\.js)?['"]/, 
      /from\s+['"][^'"]*providers-service(?:\.js)?['"]/, 
      /require\(\s*['"][^'"]*local-stock-service(?:\.js)?['"]\s*\)/,
      /require\(\s*['"][^'"]*providers-service(?:\.js)?['"]\s*\)/,
    ];
    for (const file of boutiqueFiles) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const src = fs.readFileSync(file, 'utf8');
      if (forbiddenImports.some((re) => re.test(src))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });`
);

shadow = shadow.replace(
  "    const ALLOWED_FRONTEND_URL_CONSUMERS = [\n      'public/boutique/js/discovery-api.js',\n    ];",
  "    const ALLOWED_FRONTEND_URL_CONSUMERS = [\n      'public/boutique/js/discovery-api.js',\n      'public/boutique/js/providers-services-api.js',\n    ];"
);
shadow = shadow.replace(
  /const ALLOWED_URL_MENTION_FILES = \[\n      'public\/boutique\/js\/discovery-api\.js',\n    \];/g,
  "const ALLOWED_URL_MENTION_FILES = [\n      'public/boutique/js/discovery-api.js',\n      'public/boutique/js/providers-services-api.js',\n    ];"
);

shadow = replaceTest(
  shadow,
  'routes/local-stock.js et routes/providers-services.js sont désormais montées dans bootstrap/api-routes.js, exclusivement en lecture',
  `  test('Vague 2 — local-stock reste GET-only et providers-services n\'autorise que l\'Inquiry POST canonique', () => {
    expect(fs.existsSync(path.join(ROOT, 'routes', 'local-stock.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'routes', 'providers-services.js'))).toBe(true);
    expect(() => require('../../routes/local-stock.js')).not.toThrow();
    expect(() => require('../../routes/providers-services.js')).not.toThrow();

    const bootstrapSrc = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');
    expect(bootstrapSrc).toMatch(/app\.use\(\s*['"]\/api\/local-stock['"]\s*,\s*localStockRouter\s*\)/);
    expect(bootstrapSrc).toMatch(/app\.use\(\s*['"]\/api\/providers-services['"]\s*,\s*providersServicesRouter\s*\)/);

    const localStockSrc = fs.readFileSync(path.join(ROOT, 'routes', 'local-stock.js'), 'utf8');
    expect(localStockSrc).not.toMatch(/router\.(post|put|patch|delete)\(/);

    const providersServicesSrc = fs.readFileSync(path.join(ROOT, 'routes', 'providers-services.js'), 'utf8');
    expect(providersServicesSrc).not.toMatch(/router\.(put|patch|delete)\(/);
    expect((providersServicesSrc.match(/router\.post\(/g) || [])).toHaveLength(1);
    expect(providersServicesSrc).toMatch(/router\.post\(\s*['"]\/inquiries['"]/);
  });`
);
write(shadowPath, shadow);

// 8) Keep local-stock's executable invariant honest with the current V2 projection.
const localStockPath = 'features/local-stock.feature.js';
let localStock = read(localStockPath);
const oldInvariant = "    { statement: 'aucune ligne local_stock n\\'est visible ou consommée par un ' +\n      'chemin Boutique/checkout tant que l\\'exposition n\\'est pas activée ' +\n      '(shadow frontend strict, y compris après D2)',\n      test: 'tests/unit/shadow-domains-boundary.test.js' },";
const newInvariant = "    { statement: 'Boutique ne lit jamais une ligne local_stock ni le service owner directement : ' +\n      'elle ne consomme que la projection publique availability/exposable via la frontière Discovery, ' +\n      'et le checkout conserve les mutations allocate/consume/release via les services owners',\n      test: 'tests/unit/shadow-domains-boundary.test.js' },";
requireIncludes(localStock, oldInvariant, 'stale local-stock shadow invariant');
localStock = localStock.replace(oldInvariant, newInvariant);
write(localStockPath, localStock);

console.log('U0 source finalization applied.');
