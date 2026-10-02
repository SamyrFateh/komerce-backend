'use strict';

const {
  selectSuitesForFiles,
} = require('../../scripts/run-integration-tests');

function manifests() {
  return [
    {
      name: 'catalog',
      files: {
        routes: ['routes/admin-catalog-workspace.js'],
        services: ['services/catalog-workspace.js'],
        tests: [
          'tests/unit/catalog-workspace.test.js',
          'tests/integration/catalog-approval-queue-contract.test.js',
          'tests/integration/catalog-import-json.integration.test.js',
        ],
      },
    },
    {
      name: 'sourcing',
      files: {
        services: ['services/sourcing-workspace.js'],
        tests: ['tests/integration/sourcing-source-registry-real-db.test.js'],
      },
    },
  ];
}

test('integration scope targets only the unique owning feature', () => {
  const result = selectSuitesForFiles([
    'routes/admin-catalog-workspace.js',
    'services/catalog-workspace.js',
    'tests/unit/catalog-workspace.test.js',
  ], manifests());

  expect(result).toEqual({
    mode: 'targeted',
    owners: ['catalog'],
    suites: [
      'tests/integration/catalog-approval-queue-contract.test.js',
      'tests/integration/catalog-import-json.integration.test.js',
    ],
    reason: 'feature-owned integration scope',
  });
});

test('unit/governance-only diff does not wake integration', () => {
  const result = selectSuitesForFiles([
    'tests/unit/pr-preflight.test.js',
    '.github/workflows/pr-enforcement.yml',
  ], manifests());

  expect(result).toMatchObject({
    mode: 'skip',
    owners: [],
    suites: [],
  });
});

test('unowned runtime remains fail-closed to full integration', () => {
  const result = selectSuitesForFiles(['services/unowned-runtime.js'], manifests());
  expect(result.mode).toBe('full');
  expect(result.reason).toContain('unowned integration runtime');
});
