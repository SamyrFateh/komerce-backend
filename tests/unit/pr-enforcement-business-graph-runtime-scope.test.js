'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  isBusinessGraphRuntimeSource,
  isGovernanceFile,
  classify,
} = require('../../scripts/pr-enforcement-scope');

describe('PR enforcement — runtime sources consumed by Business Graph', () => {
  test.each([
    'public/boutique/js/b-passkey-step-up.js',
    'public/dashboards/admin/js/views/AccountingView.js',
    'public/js/auth-guard.js',
    'public/sw.js',
  ])('%s réveille Governance', file => {
    expect(isBusinessGraphRuntimeSource(file)).toBe(true);
    expect(isGovernanceFile(file)).toBe(true);
    expect(classify([file]).governance).toBe(true);
  });

  test('régression #807 : un JS Boutique réveille Boutique ET Governance', () => {
    const result = classify(['public/boutique/js/b-passkey-step-up.js']);
    expect(result.boutique).toBe(true);
    expect(result.boutiqueJs).toBe(true);
    expect(result.governance).toBe(true);
    expect(result.governanceFiles).toEqual(['public/boutique/js/b-passkey-step-up.js']);
  });

  test('un CSS Boutique ne réveille pas Governance', () => {
    const result = classify(['public/boutique/css/layout.css']);
    expect(result.boutique).toBe(true);
    expect(result.governance).toBe(false);
  });
});
