'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const scope = require('../../scripts/pr-enforcement-scope');

const SECURITY_360_SOURCES = [
  'scripts/gen-security-360.js',
  'scripts/run-security-360.js',
  'scripts/.security-360-baseline.json',
  'docs/SECURITY_360.json',
  'docs/SECURITY_360.md',
];

test('Security 360 sources always wake Backend enforcement', () => {
  for (const file of SECURITY_360_SOURCES) {
    expect(scope.isBackendFile(file)).toBe(true);
  }
});

test('Security 360 executable source remains Governance-scoped too', () => {
  expect(scope.isGovernanceFile('scripts/gen-security-360.js')).toBe(true);
  expect(scope.isGovernanceFile('scripts/run-security-360.js')).toBe(true);
});

test('a Security 360 derived-doc-only change still wakes Backend', () => {
  const model = scope.classify(['docs/SECURITY_360.json']);
  expect(model.backend).toBe(true);
  expect(model.backendFiles).toEqual(['docs/SECURITY_360.json']);
});
