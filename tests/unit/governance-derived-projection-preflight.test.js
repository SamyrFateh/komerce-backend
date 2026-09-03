'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const { COMMANDS } = require('../../scripts/ci-refresh-governance-projections');

const ROOT = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-enforcement.yml'), 'utf8');

describe('Governance CI — derived projections preflight', () => {
  test('hydrate les trois projections dérivées dans l’ordre de dépendance', () => {
    expect(COMMANDS.map(([cmd, args]) => [cmd, [...args]])).toEqual([
      ['node', ['scripts/business-graph-gen.js', '--dash-root', 'public', '--boutique-root', 'public/boutique']],
      ['node', ['scripts/gen-feature-360.js']],
      ['node', ['scripts/gen-agent-remediation-index.js']],
    ]);
  });

  test('hydrate avant les gates qui consomment les projections', () => {
    const hydrate = workflow.indexOf('name: Hydrate derived governance projections');
    const graphCheck = workflow.indexOf('name: Business graph semantic check on fresh projection');
    const feature360 = workflow.indexOf('name: Feature 360 canonical projection check');
    const remediation = workflow.indexOf('name: Agent remediation index check');

    expect(hydrate).toBeGreaterThan(-1);
    expect(graphCheck).toBeGreaterThan(hydrate);
    expect(feature360).toBeGreaterThan(graphCheck);
    expect(remediation).toBeGreaterThan(feature360);
  });

  test('restaure uniquement les projections CI avant le contrôle de mutation canonique', () => {
    const restore = workflow.indexOf('name: Restore CI-only generated projections');
    const mutationCheck = workflow.indexOf('name: Prove gates did not mutate canonical sources');

    expect(restore).toBeGreaterThan(-1);
    expect(mutationCheck).toBeGreaterThan(restore);

    for (const artifact of [
      'docs/BUSINESS_FEATURE_GRAPH.json',
      'docs/BUSINESS_FEATURE_GRAPH.md',
      'docs/O6_INVENTORY.md',
      'docs/FEATURE_360.json',
      'docs/FEATURE_360.md',
      'docs/AGENT_REMEDIATION_INDEX.json',
    ]) {
      expect(workflow).toContain(artifact);
    }
  });

  test('la restauration et le contrôle final tournent même après un gate rouge', () => {
    const restoreBlock = workflow.slice(workflow.indexOf('name: Restore CI-only generated projections'));
    expect(restoreBlock).toContain('if: always()');
    expect(restoreBlock).toContain('name: Prove gates did not mutate canonical sources');
  });
});
