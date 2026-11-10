/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('fs');
const path = require('path');
const { assertTarget, NOT_COVERED } = require('../../scripts/recette/hub-v1-http-action-runner');
const SRC = fs.readFileSync(path.join(__dirname, '../../scripts/recette/hub-v1-http-action-runner.js'), 'utf8');

describe('hub-v1-http-action-runner', () => {
  test('cible : staging officiel, ou localhost explicitement autorise', () => {
    expect(assertTarget({}).local).toBe(false);
    expect(() => assertTarget({ HTTP_RUNNER_BASE_URL: 'https://example.com' })).toThrow('HTTP_RUNNER_TARGET_REFUSED');
    expect(() => assertTarget({ HTTP_RUNNER_BASE_URL: 'http://localhost:3999' })).toThrow('HTTP_RUNNER_TARGET_REFUSED');
    expect(assertTarget({ HTTP_RUNNER_BASE_URL: 'http://localhost:3999', HTTP_RUNNER_ALLOW_LOCAL: '1' }).local).toBe(true);
  });
  test('aucune ecriture SQL ni appel service hors le seam de declenchement ; Origin envoye comme le navigateur', () => {
    const code = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(code).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
    const services = [...code.matchAll(/require\('\.\.\/\.\.\/services\/([a-z-]+)'\)/g)].map((m) => m[1]);
    expect(services).toEqual(['purchasing-trigger-service']);
    expect(code).toMatch(/origin: this\.base/);
  });
  test('les actions physiques non couvertes sont listees, jamais PASS', () => {
    expect(NOT_COVERED.length).toBeGreaterThanOrEqual(8);
  });
});
