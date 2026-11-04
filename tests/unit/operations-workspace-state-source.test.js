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
  test('mark-ordered est retiré : la commande passe ordered à la confirmation du paiement', () => {
    expect(source).not.toContain('markOrdered');
    expect(source).not.toContain("source: 'hub_mark_ordered'");
  });

  test('la provenance UI reste disponible dans le contexte opérationnel', () => {
    expect(source).toContain('Workspace Opérations');
    expect(source).toContain("source: 'canonical_operations_workspace'");
    expect(source).toContain('metadata:');
  });
});
