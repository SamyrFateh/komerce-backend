'use strict';

const {
  norm,
  isBackendFile,
  isMigrationFile,
  isLiveSchemaFile,
  classify,
} = require('../../scripts/pr-enforcement-scope');

describe('PR enforcement scope — backend + migrations', () => {
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
    'tests/parcelOptimization.test.js',
    'package.json',
    'package-lock.json',
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

  test('un changement doc-only ne déclenche ni backend ni migrations', () => {
    const result = classify([
      'docs/README.md',
      'docs/doctrine/QUALITY_PYRAMID_DOCTRINE.md',
    ]);
    expect(result.backend).toBe(false);
    expect(result.migrations).toBe(false);
    expect(result.schemaDump).toBe(false);
  });

  test('un changement backend déclenche uniquement le backend', () => {
    const result = classify([
      'docs/README.md',
      'services/orders.js',
      'tests/unit/orders.test.js',
      'public/boutique/css/layout.css',
    ]);
    expect(result.backend).toBe(true);
    expect(result.migrations).toBe(false);
    expect(result.backendFiles).toEqual([
      'services/orders.js',
      'tests/unit/orders.test.js',
    ]);
  });

  test('une nouvelle migration déclenche migrations sans prétendre que le dump a changé', () => {
    const result = classify(['migrations/144_future.sql']);
    expect(result.backend).toBe(false);
    expect(result.migrations).toBe(true);
    expect(result.schemaDump).toBe(false);
    expect(result.migrationFiles).toEqual(['migrations/144_future.sql']);
  });

  test('un changement du dump déclenche migrations et le sous-gate resurrection', () => {
    const result = classify(['docs/db/railway-live-schema.sql']);
    expect(result.migrations).toBe(true);
    expect(result.schemaDump).toBe(true);
    expect(result.migrationFiles).toEqual([]);
  });

  test('déduplique et trie le diff avant classification', () => {
    const result = classify(['services/z.js', 'services/a.js', 'services/z.js']);
    expect(result.changedFiles).toEqual(['services/a.js', 'services/z.js']);
    expect(result.backendFiles).toEqual(['services/a.js', 'services/z.js']);
  });
});
