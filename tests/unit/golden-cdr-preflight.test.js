'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { analyze } = require('../../tools/golden-cdr/preflight-capture');

describe('Golden CDR — preflight capture', () => {
  const cfg = { categories: { phones: {}, vetements: {}, electro: {} } };

  test('accepte les catégories connues et le ghost intentionnel', () => {
    const r = analyze(cfg, [
      { id: 'a', product: { category: 'phones' } },
      { id: 'b', product: { category: 'vetements' } },
      { id: 'ghost', product: { category: 'ghost_category_xyz' } },
    ]);
    expect(r.unexpected_unknown).toEqual([]);
    expect(r.intentional_unknown).toHaveLength(1);
    expect(r.covered_known_categories).toEqual(['phones', 'vetements']);
    expect(r.uncovered_known_categories).toEqual(['electro']);
  });

  test('signale toute catégorie fantôme non intentionnelle', () => {
    const r = analyze(cfg, [
      { id: 'bad', product: { category: 'electronics' } },
    ]);
    expect(r.unexpected_unknown).toEqual([
      expect.objectContaining({ id: 'bad', category: 'electronics', known: false, intentional_unknown: false }),
    ]);
  });
});
