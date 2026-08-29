'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const auditGate = require('../../scripts/audit-gate.js');

describe('audit-gate — arbre npm complet', () => {
  test('runNpmAudit n’exclut jamais les devDependencies', () => {
    const exec = jest.fn(() => JSON.stringify({
      vulnerabilities: {},
      metadata: { vulnerabilities: { total: 0 } },
    }));

    const report = auditGate.runNpmAudit(exec);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toBe('npm audit --json');
    expect(exec.mock.calls[0][0]).not.toContain('--omit=dev');
    expect(report.metadata.vulnerabilities.total).toBe(0);
  });

  test('high et critical restent les niveaux bloquants', () => {
    const report = {
      vulnerabilities: {
        lowPkg: { severity: 'low', range: '*', via: [] },
        highPkg: { severity: 'high', range: '<2', via: [{ title: 'high advisory' }] },
        criticalPkg: { severity: 'critical', range: '<3', via: ['transitive-pkg'] },
      },
    };

    expect(auditGate.extractFindings(report).map(item => item.name)).toEqual([
      'criticalPkg',
      'highPkg',
    ]);
  });

  test('sans baseline, toute high/critical est nouvelle et bloquante', () => {
    const evaluated = auditGate.evaluate({
      vulnerabilities: {
        pkg: { severity: 'high', range: '<1.2.3', via: [] },
      },
      metadata: { vulnerabilities: { high: 1 } },
    }, null);

    expect(evaluated.findings).toHaveLength(1);
    expect(evaluated.knownFindings).toHaveLength(0);
    expect(evaluated.newFindings).toHaveLength(1);
  });
});
