'use strict';

const {
  actionableVulnerabilities,
  hasDirectAdvisory,
  inheritedHighCriticalCount,
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
    expect(inheritedHighCriticalCount(vulnerabilities)).toBe(2);
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

  test('ignores moderate advisories for the high/critical blocking gate', () => {
    const vulnerabilities = {
      moderate: {
        name: 'moderate-only',
        severity: 'moderate',
        via: [{ source: 789, title: 'Moderate advisory', severity: 'moderate' }],
      },
    };

    expect(actionableVulnerabilities(vulnerabilities)).toEqual([]);
    expect(inheritedHighCriticalCount(vulnerabilities)).toBe(0);
  });
});
