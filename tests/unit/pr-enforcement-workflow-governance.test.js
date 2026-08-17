'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  isGovernanceFile,
  classify,
} = require('../../scripts/pr-enforcement-scope');

describe('PR enforcement scope — active GitHub workflows', () => {
  test.each([
    '.github/workflows/pr-enforcement.yml',
    '.github/workflows/ci.yml',
    '.github/workflows/security-checks.yaml',
  ])('classe %s dans governance', file => {
    expect(isGovernanceFile(file)).toBe(true);
    const result = classify([file]);
    expect(result.governance).toBe(true);
    expect(result.governanceFiles).toEqual([file]);
  });

  test('ne réactive pas le répertoire historique workflows-disabled dans ce scope', () => {
    const file = '.github/workflows-disabled/legacy.yml';
    expect(isGovernanceFile(file)).toBe(false);
    expect(classify([file]).governance).toBe(false);
  });
});
