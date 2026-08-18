'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { analyze } = require('../../tools/golden-cdr/preflight-capture');
const witnesses = require('../../tools/golden-cdr/witnesses');

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

  test('les témoins CURRENT couvrent les 8 catégories canoniques DB sans fantôme accidentel', () => {
    const canonicalConfig = {
      categories: {
        ceremonie: {},
        cosmetiques: {},
        electro: {},
        enfants: {},
        mariage: {},
        materiels: {},
        phones: {},
        vetements: {},
      },
    };

    const r = analyze(canonicalConfig, witnesses);
    expect(r.unexpected_unknown).toEqual([]);
    expect(r.uncovered_known_categories).toEqual([]);
    expect(r.covered_known_categories).toEqual([
      'ceremonie', 'cosmetiques', 'electro', 'enfants',
      'mariage', 'materiels', 'phones', 'vetements',
    ]);
    expect(r.intentional_unknown).toEqual([
      expect.objectContaining({ id: 'unknown_cat__cash', category: 'ghost_category_xyz' }),
    ]);
  });
});
