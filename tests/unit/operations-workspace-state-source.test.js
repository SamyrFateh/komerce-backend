'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'services', 'operations-workspace.js'), 'utf8');

describe('operations workspace state-machine provenance', () => {
  test('markOrdered réutilise la source métier hub_mark_ordered', () => {
    const markOrdered = source.slice(
      source.indexOf('async function markOrdered'),
      source.indexOf('async function runDistribution')
    );
    expect(markOrdered).toContain("source: 'hub_mark_ordered'");
    expect(markOrdered).not.toContain("source: 'canonical_operations_workspace'");
  });

  test('la provenance UI reste disponible dans le contexte opérationnel', () => {
    expect(source).toContain('Workspace Opérations');
    expect(source).toContain("source: 'canonical_operations_workspace'");
    expect(source).toContain('metadata:');
  });
});
