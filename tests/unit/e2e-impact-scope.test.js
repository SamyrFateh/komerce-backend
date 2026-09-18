'use strict';

const {
  computeImpact,
  isPeripheralRuntimeFile,
  isDeepOrTransversal,
} = require('../../scripts/e2e-impact-scope');

function manifests() {
  return [
    {
      name: 'catalog',
      files: {
        services: ['services/suppliers/connectors/ebay-connector.js'],
        tests: ['tests/unit/ebay-connector.test.js'],
      },
      contract: { consumes: [] },
    },
    {
      name: 'sourcing',
      files: { services: ['services/sourcing-import-dispatch.js'] },
      contract: { consumes: ['catalog (NormalizedSupplierProduct V2)'] },
    },
    {
      name: 'purchasing',
      files: { services: ['services/purchasing-trigger-service.js'] },
      contract: { consumes: ['catalog (sellable_units)', 'sourcing (canonical resolution)'] },
    },
  ];
}

const e2eFeatures = new Set(['catalog', 'sourcing', 'purchasing']);

describe('E2E impact scope', () => {
  test('provider connector is peripheral', () => {
    expect(isPeripheralRuntimeFile('services/suppliers/connectors/ebay-connector.js')).toBe(true);
  });

  test('connector change targets owner plus direct declared consumers only', () => {
    expect(computeImpact(
      ['services/suppliers/connectors/ebay-connector.js'],
      { manifests: manifests(), e2eFeatures }
    )).toMatchObject({
      mode: 'targeted',
      features: ['catalog', 'purchasing', 'sourcing'],
    });
  });

  test('owned unit test follows the same targeted blast radius', () => {
    expect(computeImpact(
      ['tests/unit/ebay-connector.test.js'],
      { manifests: manifests(), e2eFeatures }
    )).toMatchObject({
      mode: 'targeted',
      features: ['catalog', 'purchasing', 'sourcing'],
    });
  });

  test('deep runtime change remains full', () => {
    expect(isDeepOrTransversal('routes/purchasing.js')).toBe(true);
    expect(computeImpact(
      ['routes/purchasing.js'],
      { manifests: manifests(), e2eFeatures }
    )).toMatchObject({ mode: 'full' });
  });

  test('migration remains full', () => {
    expect(computeImpact(
      ['migrations/999_example.sql'],
      { manifests: manifests(), e2eFeatures }
    )).toMatchObject({ mode: 'full' });
  });

  test('unowned peripheral file fails closed to full', () => {
    expect(computeImpact(
      ['services/suppliers/connectors/future-connector.js'],
      { manifests: manifests(), e2eFeatures }
    )).toMatchObject({
      mode: 'full',
      reason: 'unowned peripheral/test file: services/suppliers/connectors/future-connector.js',
    });
  });

  test('governance/docs-only change skips E2E API', () => {
    expect(computeImpact(
      ['docs/external-providers/suppliers/EBAY.md', 'governance/external-provider-registry.json'],
      { manifests: manifests(), e2eFeatures }
    )).toMatchObject({
      mode: 'skip',
      features: [],
    });
  });

  test('direct E2E test change targets its feature', () => {
    expect(computeImpact(
      ['tests/e2e-api/purchasing.no-duplicate-po.e2e.test.js'],
      { manifests: manifests(), e2eFeatures }
    )).toMatchObject({
      mode: 'targeted',
      features: ['purchasing'],
    });
  });
});
