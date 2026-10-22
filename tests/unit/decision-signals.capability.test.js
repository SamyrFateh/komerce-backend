'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const capability = require('../../capabilities/decision-signals.capability');

describe('capability decision-signals — contrat', () => {
  const consumes = capability.contract.consumes;

  test('déclare la consommation du prédicat réel/RCT1 partagé (dashboard)', () => {
    expect(consumes.some(c => /^dashboard \(services\/signal-simulation-scope\.js/.test(c))).toBe(true);
  });

  test('déclare la couverture cash canonique (payments), en lecture seule', () => {
    expect(consumes.some(c => /^payments \(services\/cash-deposit-service\.js/.test(c) && /lecture seule/.test(c))).toBe(true);
  });

  test('les services qui appliquent le prédicat RCT1 sont dans le périmètre de la capability', () => {
    const files = JSON.stringify(capability);
    expect(files).toContain('services/signal-admin-service.js');
    expect(files).toContain('services/radar-queries.js');
  });
});
