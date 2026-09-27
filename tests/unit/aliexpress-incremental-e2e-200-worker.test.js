'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const worker = require('../../scripts/aliexpress-incremental-e2e-200-worker');

describe('AliExpress incremental +200 Railway worker launcher', () => {
  test('fails closed to idle when no explicit worker mode is configured', () => {
    expect(worker.resolveMode({})).toBe('idle');
    expect(worker.commandPlan('idle')).toEqual([]);
  });

  test('runs the historical campaign only when explicitly selected', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'campaign' })).toBe('campaign');
    expect(worker.commandPlan('campaign').map(step => step.join(' '))).toEqual([
      'scripts/aliexpress-wave2-sourcing.js',
      'scripts/aliexpress-incremental-e2e-200.js --operation=refinery-audit',
      'scripts/aliexpress-incremental-e2e-200.js --operation=promote',
      'scripts/aliexpress-incremental-e2e-200.js --operation=prepare-fr',
      'scripts/aliexpress-incremental-e2e-200.js --operation=accept --output=artifacts/aliexpress-incremental-e2e-200/final-acceptance.json',
    ]);
  });

  test('builds the unified 700 dataset in one explicit fail-closed plan', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'catalog-700-build' }))
      .toBe('catalog-700-build');
    expect(worker.commandPlan('catalog-700-build')).toEqual([
      ['scripts/cj-500-e2e-catalog-sync.js'],
      ['scripts/real-supplier-1000-stress-staging.js', '--operation=refinery-audit', '--limit=715'],
      ['scripts/real-supplier-1000-stress-staging.js', '--operation=promote', '--limit=500'],
      ['scripts/catalog-fr-free-e2e-preparation.js', '--limit=1000'],
      ['scripts/cj-refinery-commandability-continuation.js', '--limit=500', '--chunk=20', '--output=artifacts/catalog-e2e-700/cj-commandability.json'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=accept', '--output=artifacts/catalog-e2e-700/ali-final-acceptance.json'],
      ['scripts/catalog-e2e-700-acceptance.js', '--output=artifacts/catalog-e2e-700/final-acceptance.json'],
    ]);
  });

  test('taxonomy-audit runs only the read-only projection command', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'taxonomy-audit' }))
      .toBe('taxonomy-audit');
    expect(worker.commandPlan('taxonomy-audit')).toEqual([
      ['scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js', '--operation=audit'],
    ]);
  });

  test('taxonomy repair top-up mode repairs, replenishes, promotes, prepares and accepts in one run', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'taxonomy-repair-topup' }))
      .toBe('taxonomy-repair-topup');
    expect(worker.commandPlan('taxonomy-repair-topup')).toEqual([
      ['scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js', '--operation=apply'],
      ['scripts/aliexpress-wave2-sourcing.js'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=refinery-audit'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=promote'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=prepare-fr'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=accept', '--output=artifacts/aliexpress-incremental-e2e-200/final-acceptance.json'],
    ]);
  });

  test('taxonomy apply mode repairs then re-audits and re-accepts the same 200', () => {
    expect(worker.commandPlan('taxonomy-apply-and-accept')).toEqual([
      ['scripts/aliexpress-incremental-e2e-200-taxonomy-repair.js', '--operation=apply'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=refinery-audit'],
      ['scripts/aliexpress-incremental-e2e-200.js', '--operation=accept', '--output=artifacts/aliexpress-incremental-e2e-200/final-acceptance.json'],
    ]);
  });

  test('rejects an unknown mode instead of silently running the campaign', () => {
    expect(() => worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'apply' }))
      .toThrow(/invalide/);
  });
});
