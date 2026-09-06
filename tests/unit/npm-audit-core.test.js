'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  actionableVulnerabilities,
  hasDirectAdvisory,
  inheritedBlockingCount,
} = require('../../scripts/lib/npm-audit-core');

describe('npm audit v2 advisory classification', () => {
  test('keeps the real advisory and excludes inherited wrapper entries', () => {
    const vulnerabilities = {
      'brace-expansion': {
        name: 'brace-expansion',
        severity: 'high',
        via: [{ source: 123, title: 'DoS', severity: 'high', range: '<=5.0.7' }],
      },
      jest: {
        name: 'jest',
        severity: 'high',
        via: ['@jest/core', 'jest-cli'],
      },
      '@jest/core': {
        name: '@jest/core',
        severity: 'high',
        via: ['glob', 'jest-runtime'],
      },
    };

    expect(actionableVulnerabilities(vulnerabilities).map((v) => v.name))
      .toEqual(['brace-expansion']);
    expect(inheritedBlockingCount(vulnerabilities)).toBe(2);
  });

  test('does not hide a critical entry carrying its own advisory object', () => {
    const vulnerability = {
      name: 'direct-critical',
      severity: 'critical',
      via: [{ source: 456, title: 'Critical advisory', severity: 'critical' }],
    };

    expect(hasDirectAdvisory(vulnerability)).toBe(true);
    expect(actionableVulnerabilities({ direct: vulnerability })).toEqual([vulnerability]);
  });

  test('treats moderate advisories as blocking debt', () => {
    const vulnerability = {
      name: 'moderate-only',
      severity: 'moderate',
      via: [{ source: 789, title: 'Moderate advisory', severity: 'moderate' }],
    };

    expect(actionableVulnerabilities({ moderate: vulnerability })).toEqual([vulnerability]);
    expect(inheritedBlockingCount({ moderate: vulnerability })).toBe(0);
  });

  test('still ignores low advisories in the blocking gate', () => {
    const vulnerability = {
      name: 'low-only',
      severity: 'low',
      via: [{ source: 790, title: 'Low advisory', severity: 'low' }],
    };

    expect(actionableVulnerabilities({ low: vulnerability })).toEqual([]);
    expect(inheritedBlockingCount({ low: vulnerability })).toBe(0);
  });
});

describe('npm audit dependency resolution', () => {
  test('pins the patched qs release in both package policy and lock', () => {
    const pkg = require('../../package.json');
    const lock = require('../../package-lock.json');

    expect(pkg.overrides?.qs).toBe('6.16.0');
    expect(lock.packages?.['node_modules/qs']?.version).toBe('6.16.0');
  });
});
