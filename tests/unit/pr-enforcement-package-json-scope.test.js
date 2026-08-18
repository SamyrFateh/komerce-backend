'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  governanceOnlyPackageJsonObjects,
  applyPackageJsonSemanticScope,
  classify,
} = require('../../scripts/pr-enforcement-scope');

function pkg(scripts = {}, extra = {}) {
  return {
    name: 'komerce-backend',
    version: '10.6.1',
    main: 'server.js',
    scripts,
    dependencies: { express: '^4.19.2' },
    engines: { node: '>=20.0.0' },
    ...extra,
  };
}

describe('PR enforcement — package.json semantic scope', () => {
  test('un changement feature:360 uniquement est Governance-only', () => {
    const base = pkg({ 'feature:360:gen': 'old', test: 'jest' });
    const head = pkg({ 'feature:360:gen': 'new', test: 'jest' });
    expect(governanceOnlyPackageJsonObjects(base, head)).toBe(true);
  });

  test('ajouter refresh-global seul est Governance-only', () => {
    const base = pkg({ 'feature:360:gen': 'node scripts/gen-feature-360.js' });
    const head = pkg({
      'feature:360:gen': 'node scripts/gen-feature-360.js',
      'feature:360:refresh-global': 'npm run gate:findings:gen && npm run feature:360:gen',
    });
    expect(governanceOnlyPackageJsonObjects(base, head)).toBe(true);
  });

  test.each([
    ['script test', pkg({ test: 'jest --runInBand' }), pkg({ test: 'jest' })],
    ['lifecycle prepare', pkg({ prepare: 'node a.js' }), pkg({ prepare: 'node b.js' })],
    ['dependencies', pkg({}, { dependencies: { express: '^4.19.2' } }), pkg({}, { dependencies: { express: '^5.0.0' } })],
    ['engines', pkg({}, { engines: { node: '>=20' } }), pkg({}, { engines: { node: '>=22' } })],
  ])('%s reste Backend', (_label, base, head) => {
    expect(governanceOnlyPackageJsonObjects(base, head)).toBe(false);
  });

  test('l’exemption retire package.json du backend mais conserve Governance', () => {
    const model = classify(['package.json']);
    expect(model.backend).toBe(true);
    expect(model.governance).toBe(true);

    const scoped = applyPackageJsonSemanticScope(model, ['package.json'], true);
    expect(scoped.backend).toBe(false);
    expect(scoped.backendFiles).toEqual([]);
    expect(scoped.governance).toBe(true);
    expect(scoped.packageJsonGovernanceOnly).toBe(true);
  });

  test('un autre fichier backend conserve Backend même si package.json est Governance-only', () => {
    const model = classify(['package.json', 'services/orders.js']);
    const scoped = applyPackageJsonSemanticScope(model, ['package.json', 'services/orders.js'], true);
    expect(scoped.backend).toBe(true);
    expect(scoped.backendFiles).toEqual(['services/orders.js']);
  });

  test('package-lock.json interdit toujours l’exemption', () => {
    const model = classify(['package.json', 'package-lock.json']);
    const scoped = applyPackageJsonSemanticScope(model, ['package.json', 'package-lock.json'], true);
    expect(scoped.backend).toBe(true);
    expect(scoped.packageJsonGovernanceOnly).toBe(false);
  });
});
