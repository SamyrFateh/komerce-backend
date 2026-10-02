'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const cp = require('child_process');
const {
  norm,
  isBackendFile,
  isMigrationFile,
  isLiveSchemaFile,
  isDbRebuildFile,
  isDirectApiRuntimeFile,
  headerTouchesDb,
  headerFeedsApi,
  classifyRuntimeProof,
  isBoutiqueCssSource,
  isBoutiqueJsSource,
  isBoutiqueHtml,
  isBoutiqueUnitTest,
  isBoutiquePackageFile,
  isBoutiqueRelevant,
  isBusinessManifestSource,
  isGovernanceFile,
  classify,
  diffFiles,
} = require('../../scripts/pr-enforcement-scope');

describe('PR enforcement scope — backend + migrations + Boutique + governance', () => {
  test('normalise les chemins Windows', () => {
    expect(norm('services\\orders.js')).toBe('services/orders.js');
  });

  test.each([
    'server.js',
    'services/orders.js',
    'routes/payments.js',
    'middleware/auth.js',
    'utils/rules.js',
    'validators/order.js',
    'core/domain.js',
    'bootstrap/api-routes.js',
    'db/query.js',
    'tests/unit/wallet.test.js',
    'tests/invariants/money.spec.js',
    'tests/contract/orders.test.js',
    'tests/notifications/send.test.js',
    'tests/integration/orders.test.js',
    'tests/e2e-api/wallet.e2e.test.js',
    'tests/e2e/smoke.js',
    'tests/fixtures/catalog/golden.js',
    'tests/helpers/e2eDbKit.js',
    'tests/governance/map.test.js',
    'tests/e2e.sh',
    'tests/parcelOptimization.test.js',
    'package.json',
    'package-lock.json',
    'jest.config.js',
    'jest.unit.config.js',
  ])('classe %s dans le backend', file => {
    expect(isBackendFile(file)).toBe(true);
  });

  test.each([
    'docs/README.md',
    'docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md',
    '.github/workflows/pr-enforcement.yml',
    'features/infrastructure.feature.js',
    'scripts/pr-enforcement-scope.js',
    'migrations/144_future.sql',
    'public/boutique/css/layout.css',
  ])('ne classe pas %s dans le backend', file => {
    expect(isBackendFile(file)).toBe(false);
  });

  test.each([
    'migrations/144_future.sql',
    'migrations/014c_wallet_foundation.sql',
    'migrations/_superseded/099_old.sql',
  ])('classe %s comme migration SQL', file => {
    expect(isMigrationFile(file)).toBe(true);
  });

  test('reconnaît uniquement le dump live canonique', () => {
    expect(isLiveSchemaFile('docs/db/railway-live-schema.sql')).toBe(true);
    expect(isLiveSchemaFile('docs/db/other-schema.sql')).toBe(false);
  });

  test.each([
    ['public/boutique/css/layout.css', isBoutiqueCssSource],
    ['public/boutique/js/b-cart.js', isBoutiqueJsSource],
    ['public/boutique/index.html', isBoutiqueHtml],
    ['public/boutique/tests/unit/b-cart.test.js', isBoutiqueUnitTest],
    ['public/boutique/package.json', isBoutiquePackageFile],
    ['public/boutique/package-lock.json', isBoutiquePackageFile],
  ])('reconnaît %s comme source Boutique pertinente', (file, predicate) => {
    expect(predicate(file)).toBe(true);
    expect(isBoutiqueRelevant(file)).toBe(true);
  });

  test.each([
    'public/boutique/css/dist/base.css',
    'public/boutique/tests/e2e/authenticated/wallet-payment.spec.js',
    'public/boutique/playwright.config.js',
    'public/boutique/categories/mode-v2.webp',
    'public/boutique/scripts/check-sticky-integrity.js',
  ])('exclut %s du domaine runtime Boutique du Lot 2B', file => {
    expect(isBoutiqueRelevant(file)).toBe(false);
  });

  test('un changement doc-only ne déclenche aucun domaine actif', () => {
    const result = classify([
      'docs/README.md',
      'docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md',
    ]);
    expect(result.backend).toBe(false);
    expect(result.migrations).toBe(false);
    expect(result.boutique).toBe(false);
    expect(result.governance).toBe(false);
    expect(result.schemaDump).toBe(false);
  });

  test('un changement backend déclenche backend ET gouvernance', () => {
    const result = classify([
      'docs/README.md',
      'services/orders.js',
      'tests/unit/orders.test.js',
    ]);
    expect(result.backend).toBe(true);
    expect(result.governance).toBe(true);
    expect(result.migrations).toBe(false);
    expect(result.boutique).toBe(false);
    expect(result.backendFiles).toEqual([
      'services/orders.js',
      'tests/unit/orders.test.js',
    ]);
    expect(result.governanceFiles).toEqual([
      'services/orders.js',
      'tests/unit/orders.test.js',
    ]);
  });

  test('régression AUTH-8a : utils/auth-cookie.js réveille toujours la gouvernance', () => {
    const result = classify(['utils/auth-cookie.js']);
    expect(result.backend).toBe(true);
    expect(result.governance).toBe(true);
    expect(result.backendFiles).toEqual(['utils/auth-cookie.js']);
    expect(result.governanceFiles).toEqual(['utils/auth-cookie.js']);
  });

  test.each([
    'routes/auth.js',
    'services/webauthn-service.js',
    'middleware/auth.js',
    'utils/auth-cookie.js',
    'validators/order.js',
    'core/domain.js',
    'bootstrap/api-routes.js',
    'db/query.js',
    'tests/unit/auth.test.js',
    'package.json',
    'package-lock.json',
    'server.js',
  ])('tout fichier backend %s est aussi governance-relevant', file => {
    expect(isBackendFile(file)).toBe(true);
    expect(isGovernanceFile(file)).toBe(true);
  });

  test.each([
    'features/auth-passkey.feature.js',
    'public/boutique/features/auth-passkey.feature.js',
    'public/dashboards/features/admin-dashboard.feature.js',
    'public/features/platform.feature.js',
    'docs/doctrine/FEATURE_DOCTRINE.md',
    'docs/doctrine/APP_FEATURE_REGISTRY.md',
  ])('source Business Graph %s réveille toujours la gouvernance', file => {
    expect(isBusinessManifestSource(file)).toBe(true);
    expect(isGovernanceFile(file)).toBe(true);
    const result = classify([file]);
    expect(result.governance).toBe(true);
    expect(result.governanceFiles).toEqual([file]);
  });

  test('régression AUTH-3 : un manifest Boutique ne peut plus passer avec Governance skipped', () => {
    const result = classify(['public/boutique/features/auth-passkey.feature.js']);
    expect(result.backend).toBe(false);
    expect(result.boutique).toBe(false);
    expect(result.governance).toBe(true);
    expect(result.governanceFiles).toEqual(['public/boutique/features/auth-passkey.feature.js']);
  });

  test('une modification de test integration/e2e backend réveille backend et gouvernance', () => {
    const result = classify([
      'tests/integration/orders.test.js',
      'tests/e2e-api/wallet.e2e.test.js',
      'tests/fixtures/catalog/golden.js',
    ]);
    expect(result.backend).toBe(true);
    expect(result.governance).toBe(true);
    expect(result.backendFiles).toEqual([
      'tests/e2e-api/wallet.e2e.test.js',
      'tests/fixtures/catalog/golden.js',
      'tests/integration/orders.test.js',
    ]);
  });

  test('diffFiles ne filtre aucun statut Git — les suppressions restent visibles', () => {
    const spawn = jest.spyOn(cp, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'services/deleted.js\ntests/integration/deleted.test.js\n',
      stderr: '',
    });

    try {
      expect(diffFiles('base-sha', 'head-sha')).toEqual([
        'services/deleted.js',
        'tests/integration/deleted.test.js',
      ]);
      expect(spawn).toHaveBeenCalledWith(
        'git',
        ['diff', '--name-only', 'base-sha', 'head-sha'],
        { encoding: 'utf8' }
      );
    } finally {
      spawn.mockRestore();
    }
  });

  test('une nouvelle migration déclenche migrations sans prétendre que le dump a changé', () => {
    const result = classify(['migrations/144_future.sql']);
    expect(result.backend).toBe(false);
    expect(result.migrations).toBe(true);
    expect(result.boutique).toBe(false);
    expect(result.schemaDump).toBe(false);
    expect(result.migrationFiles).toEqual(['migrations/144_future.sql']);
  });

  test('un changement du dump déclenche migrations et le sous-gate resurrection', () => {
    const result = classify(['docs/db/railway-live-schema.sql']);
    expect(result.migrations).toBe(true);
    expect(result.schemaDump).toBe(true);
    expect(result.migrationFiles).toEqual([]);
  });

  test('scope lourd: une PR gouvernance/test unitaire ne déclenche ni DB, ni intégration, ni E2E API', () => {
    const result = classifyRuntimeProof([
      'AGENTS.md',
      '.github/workflows/pr-enforcement.yml',
      'scripts/pr-preflight.js',
      'tests/unit/pr-preflight.test.js',
    ], { readSource: () => null });

    expect(result).toEqual({
      dbRebuildRequired: false,
      integrationRequired: false,
      e2eApiRequired: false,
    });
  });

  test('scope lourd: une migration reconstruit la DB et rejoue les intégrations, sans inventer un E2E API', () => {
    const result = classifyRuntimeProof(['migrations/999_test.sql'], { readSource: () => null });
    expect(result.dbRebuildRequired).toBe(true);
    expect(result.integrationRequired).toBe(true);
    expect(result.e2eApiRequired).toBe(false);
    expect(isDbRebuildFile('migrations/999_test.sql')).toBe(true);
  });

  test('scope lourd: les headers DB déclenchent uniquement la preuve intégration nécessaire', () => {
    const source = `/**
 * @komerce-arch
 * @layer service
 * @db-read products
 * @db-write none
 * @used-by services/other.js
 */`;
    expect(headerTouchesDb(source)).toBe(true);
    expect(headerFeedsApi(source)).toBe(false);

    const result = classifyRuntimeProof(['services/catalog-reader.js'], {
      readSource: () => source,
    });
    expect(result.dbRebuildRequired).toBe(false);
    expect(result.integrationRequired).toBe(true);
    expect(result.e2eApiRequired).toBe(false);
  });

  test('scope lourd: une route ou un service utilisé par une route déclenche la preuve E2E API', () => {
    expect(isDirectApiRuntimeFile('routes/orders.js')).toBe(true);

    const source = `/**
 * @komerce-arch
 * @layer service
 * @db-read none
 * @db-write none
 * @used-by routes/orders.js
 */`;
    expect(headerFeedsApi(source)).toBe(true);

    const result = classifyRuntimeProof(['services/order-read-model.js'], {
      readSource: () => source,
    });
    expect(result.dbRebuildRequired).toBe(false);
    expect(result.integrationRequired).toBe(false);
    expect(result.e2eApiRequired).toBe(true);
  });

  test('scope lourd sémantique: orchestration interne sans changement SQL ni surface HTTP reste légère', () => {
    const before = {
      'services/catalog-workspace.js': `/**
 * @komerce-arch
 * @layer service
 * @db-read products
 * @db-write none
 * @used-by routes/admin-catalog-workspace.js
 */
async function read() {
  return db.query(\`SELECT id, name FROM products WHERE id = $1\`, [id]);
}
async function prepare() { return catalogEnrichment.enrichAndApply(id); }`,
      'routes/admin-catalog-workspace.js': `
router.post('/approval/:productRef/prepare-fr', guard, async (req, res) => {
  res.status(200).json({ result: await workspace.prepareCandidateFrench(req.params.productRef, req.user) });
});`,
    };
    const after = {
      'services/catalog-workspace.js': `/**
 * @komerce-arch
 * @layer service
 * @db-read products
 * @db-write none
 * @used-by routes/admin-catalog-workspace.js
 */
async function read() {
  return db.query(\`SELECT id, name FROM products WHERE id = $1\`, [id]);
}
async function prepare() { return catalogOverrides.upsertOverrides(db, id, payload); }`,
      'routes/admin-catalog-workspace.js': `
router.post('/approval/:productRef/prepare-fr', guard, async (req, res) => {
  res.status(200).json({ result: await workspace.prepareCandidateFrench(req.params.productRef, req.body || {}, req.user) });
});`,
    };

    const result = classifyRuntimeProof(Object.keys(after), {
      readBefore: file => before[file] || null,
      readAfter: file => after[file] || null,
    });

    expect(result).toEqual({
      dbRebuildRequired: false,
      integrationRequired: false,
      e2eApiRequired: false,
    });
  });

  test('scope lourd sémantique: une requête SQL modifiée exige la preuve intégration', () => {
    const before = `/**
 * @komerce-arch
 * @layer service
 * @db-read products
 * @db-write none
 */
return db.query(\`SELECT id FROM products WHERE id = $1\`, [id]);`;
    const after = `/**
 * @komerce-arch
 * @layer service
 * @db-read products
 * @db-write none
 */
return db.query(\`SELECT id, lifecycle FROM products WHERE id = $1\`, [id]);`;

    const result = classifyRuntimeProof(['services/catalog-reader.js'], {
      readBefore: () => before,
      readAfter: () => after,
    });
    expect(result.integrationRequired).toBe(true);
    expect(result.e2eApiRequired).toBe(false);
  });

  test('scope lourd sémantique: une surface de route modifiée exige E2E API', () => {
    const before = `router.post('/approval/:productRef/prepare-fr', guard, handler);`;
    const after = `router.patch('/approval/:productRef/prepare-fr', guard, handler);`;

    const result = classifyRuntimeProof(['routes/admin-catalog-workspace.js'], {
      readBefore: () => before,
      readAfter: () => after,
    });
    expect(result.integrationRequired).toBe(false);
    expect(result.e2eApiRequired).toBe(true);
  });

  test('un CSS Boutique source déclenche la branche CSS et alimente désormais related-tests (incident 2026-09)', () => {
    const result = classify(['public/boutique/css/layout.css']);
    expect(result.boutique).toBe(true);
    expect(result.boutiqueCss).toBe(true);
    expect(result.boutiqueJs).toBe(false);
    expect(result.boutiqueHtml).toBe(false);
    expect(result.boutiqueUnit).toBe(false);
    expect(result.backend).toBe(false);
    expect(result.governance).toBe(false);
    // Avant fix : boutiqueTestFiles excluait le CSS, donc le --files transmis
    // à run-staged-related-tests.js en CI restait vide sur une PR CSS-only —
    // l'étape "Related Boutique unit tests" tournait pour rien, même une fois
    // le script lui-même capable de reconnaître le CSS comme source.
    expect(result.boutiqueTestFiles).toEqual(['public/boutique/css/layout.css']);
  });

  test('un JS + test Boutique déclenchent related-tests sans embarquer css/dist', () => {
    const result = classify([
      'public/boutique/js/b-cart.js',
      'public/boutique/tests/unit/b-cart.test.js',
      'public/boutique/css/dist/components.css',
    ]);
    expect(result.boutique).toBe(true);
    expect(result.boutiqueJs).toBe(true);
    expect(result.boutiqueUnit).toBe(true);
    expect(result.boutiqueTestFiles).toEqual([
      'public/boutique/js/b-cart.js',
      'public/boutique/tests/unit/b-cart.test.js',
    ]);
    expect(result.boutiqueFiles).not.toContain('public/boutique/css/dist/components.css');
  });

  test('déduplique et trie le diff avant classification', () => {
    const result = classify(['services/z.js', 'services/a.js', 'services/z.js']);
    expect(result.changedFiles).toEqual(['services/a.js', 'services/z.js']);
    expect(result.backendFiles).toEqual(['services/a.js', 'services/z.js']);
    expect(result.governanceFiles).toEqual(['services/a.js', 'services/z.js']);
  });
});
