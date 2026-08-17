'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const graph = require('../../docs/BUSINESS_FEATURE_GRAPH.json');

describe('Business Graph warning stream doctrine', () => {
  test('drifts.warn contient uniquement la dette réelle', () => {
    expect(graph.drifts.warn).toEqual(graph.drifts.debt);
    expect(graph.drifts.summary.signals).toBe(graph.drifts.warn.length);
    expect(graph.drifts.summary.debt).toBe(graph.drifts.debt.length);
  });

  test('topologies attendues et limites outil ne sont jamais reloggées comme warnings', () => {
    const key = x => x.type + '::' + x.ref;
    const warningKeys = new Set((graph.drifts.warn || []).map(key));
    for (const item of graph.drifts.expectedTopology || []) {
      expect(warningKeys.has(key(item))).toBe(false);
    }
    for (const item of graph.drifts.generatorLimitations || []) {
      expect(warningKeys.has(key(item))).toBe(false);
    }
  });

  test('le total classifié reste traçable sans polluer le flux warning', () => {
    const s = graph.drifts.summary;
    expect(s.classifiedCandidates).toBe(
      graph.drifts.debt.length + graph.drifts.expectedTopology.length + graph.drifts.generatorLimitations.length
    );
  });
});
