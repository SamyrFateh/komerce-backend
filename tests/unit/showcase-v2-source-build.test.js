'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { TAXONOMY_TARGETS } = require('../../scripts/showcase-v2-plan');
const {
  FALLBACK_QUERIES,
  segmentKey,
  queriesForTarget,
} = require('../../scripts/showcase-v2-source-build');

describe('showcase-v2-source-build query resilience', () => {
  test('chaque sous-catégorie possède une réserve de requêtes métier', () => {
    for (const target of TAXONOMY_TARGETS) {
      const key = segmentKey(target);
      expect(FALLBACK_QUERIES[key]).toBeDefined();
      expect(FALLBACK_QUERIES[key].length).toBeGreaterThanOrEqual(4);
    }
  });

  test('les requêtes primaires restent prioritaires et les doublons sont supprimés', () => {
    const target = TAXONOMY_TARGETS[0];
    const queries = queriesForTarget(target);
    expect(queries.slice(0, target.queries.length)).toEqual(target.queries);
    expect(new Set(queries.map((query) => query.toLowerCase())).size).toBe(queries.length);
    expect(queries.length).toBeGreaterThan(target.queries.length);
  });

  test('la campagne couvre toujours 21 segments avec plusieurs portes de sourcing', () => {
    expect(TAXONOMY_TARGETS).toHaveLength(21);
    for (const target of TAXONOMY_TARGETS) {
      expect(queriesForTarget(target).length).toBeGreaterThanOrEqual(6);
    }
  });
});
