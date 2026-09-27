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

  test('audits the existing CJ 500 locally without any provider sourcing call', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'catalog-700-local-audit' }))
      .toBe('catalog-700-local-audit');
    expect(worker.commandPlan('catalog-700-local-audit')).toEqual([
      ['scripts/real-supplier-1000-stress-staging.js', '--operation=supplier-slice-audit', '--supplier=CJdropshipping', '--limit=500'],
    ]);
    expect(worker.commandPlan('catalog-700-local-audit').flat().join(' ')).not.toMatch(/cj-500-e2e-catalog-sync|cj-refinery-commandability|fetchProducts/);
  });

  test('resolves historical CJ WATCH rows locally then gates 712', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'catalog-712-resolve-watch' }))
      .toBe('catalog-712-resolve-watch');
    expect(worker.commandPlan('catalog-712-resolve-watch')).toEqual([
      ['scripts/catalog-e2e-taxonomy-bootstrap.js'],
      ['scripts/catalog-cj-certified-500-resolve-watch.js'],
      ['scripts/catalog-e2e-712-acceptance.js', '--output=artifacts/catalog-e2e-712/final-acceptance.json'],
    ]);
    expect(worker.commandPlan('catalog-712-resolve-watch').flat().join(' ')).not.toMatch(/fetchProductDetail|cj-500-e2e-catalog-sync/);
  });

  test('audits historical CJ WATCH rows without supplier calls', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'catalog-712-watch-audit' }))
      .toBe('catalog-712-watch-audit');
    expect(worker.commandPlan('catalog-712-watch-audit')).toEqual([
      ['scripts/catalog-cj-certified-500-watch-audit.js'],
    ]);
  });

  test('materializes and accepts the reconciled 712 catalog in one plan', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'catalog-712-materialize' }))
      .toBe('catalog-712-materialize');
    expect(worker.commandPlan('catalog-712-materialize')).toEqual([
      ['scripts/catalog-e2e-taxonomy-bootstrap.js'],
      ['scripts/catalog-cj-certified-500-materialize.js'],
      ['scripts/catalog-e2e-712-acceptance.js', '--output=artifacts/catalog-e2e-712/final-acceptance.json'],
    ]);
  });

  test('can rerun the 712 gate without supplier calls', () => {
    expect(worker.commandPlan('catalog-712-accept')).toEqual([
      ['scripts/catalog-e2e-712-acceptance.js', '--output=artifacts/catalog-e2e-712/final-acceptance.json'],
    ]);
  });

  test('finishes the reconciled CJ new12 in one explicit plan', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'catalog-cj-new12-finish' }))
      .toBe('catalog-cj-new12-finish');
    expect(worker.commandPlan('catalog-cj-new12-finish')).toEqual([
      ['scripts/catalog-fr-free-e2e-preparation.js', '--limit=12', '--supplier=CJdropshipping', '--output=artifacts/catalog-e2e-700/cj-new12-fr.json'],
      ['scripts/cj-refinery-commandability-continuation.js', '--limit=12', '--chunk=12', '--output=artifacts/catalog-e2e-700/cj-new12-commandability.json'],
      ['scripts/catalog-refinery-final-acceptance.js', '--mode=final', '--expected=12', '--output=artifacts/catalog-e2e-700/cj-new12-final.json'],
    ]);
  });

  test('promotes only the reconciled new CJ products from local data', () => {
    expect(worker.resolveMode({ KOMERCE_ALI_E2E_200_WORKER_MODE: 'catalog-cj-reconcile-promote-local' }))
      .toBe('catalog-cj-reconcile-promote-local');
    expect(worker.commandPlan('catalog-cj-reconcile-promote-local')).toEqual([
      ['scripts/cj-reconcile-current-new-12-promote.js'],
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
