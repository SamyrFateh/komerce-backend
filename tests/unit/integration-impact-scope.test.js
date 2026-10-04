'use strict';

const { computeImpact } = require('../../scripts/integration-impact-scope');

function manifest(name, files, tests = [], type = 'feature', consumes = []) {
  return {
    name,
    type,
    files: { runtime: files, tests },
    contract: { consumes },
  };
}

describe('integration-impact-scope', () => {
  test('cible les suites d integration déclarées par la feature propriétaire', () => {
    const manifests = [
      manifest('market-delegation', ['migrations/274_x.sql'], ['tests/integration/market-scope-isolation.test.js']),
    ];
    const result = computeImpact(['migrations/274_x.sql'], { manifests });
    expect(result.mode).toBe('targeted');
    expect(result.features).toEqual(['market-delegation']);
    expect(result.suites).toEqual(['tests/integration/market-scope-isolation.test.js']);
    expect(result.reason).toMatch(/Feature First/);
  });

  test('reste full sur une surface DB globale', () => {
    const result = computeImpact(['scripts/ci-migrate.js'], { manifests: [] });
    expect(result.mode).toBe('full');
    expect(result.reason).toMatch(/global DB\/integration surface/);
  });

  test('reste full sur un runtime non possédé', () => {
    const result = computeImpact(['services/unknown.js'], { manifests: [] });
    expect(result.mode).toBe('full');
    expect(result.reason).toMatch(/unowned runtime file/);
  });

  test('skip pour documentation seule', () => {
    const result = computeImpact(['docs/README.md'], { manifests: [] });
    expect(result.mode).toBe('skip');
  });
});
