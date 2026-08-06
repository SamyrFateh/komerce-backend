'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/catalog-eligibility.js (K-2, DOCTRINE_CATALOGUE §3)
 *
 * Verrouille les promesses doctrinales de l'étage ③ :
 *   - absolute avant restricted : un candidat qui matche les deux couches
 *     est écarté, pas seulement contraint.
 *   - matching insensible à la casse, sur mots-clés ET catégories.
 *   - aucune exclusion active → candidat pleinement éligible (null).
 *   - loadActiveExclusions ne lit QUE les lignes is_active = TRUE et trie
 *     absolute en premier.
 */

jest.mock('../../db');
const db = require('../../db');
const { checkEligibility, loadActiveExclusions } = require('../../services/catalog-eligibility');

function rule(overrides = {}) {
  return {
    layer: 'absolute',
    label: 'Test rule',
    keywords: [],
    categories: [],
    constraint_note: null,
    legal_note: null,
    ...overrides,
  };
}

describe('checkEligibility', () => {
  test('retourne null si aucune exclusion active', () => {
    expect(checkEligibility({ product_name: 'Power bank 10000mAh' }, [])).toBeNull();
  });

  test('retourne null si le candidat est absent', () => {
    expect(checkEligibility(null, [rule()])).toBeNull();
  });

  test('matche un mot-clé insensible à la casse dans product_name', () => {
    const exclusions = [rule({ label: 'Armes', keywords: ['weapon', 'knife'] })];
    const verdict = checkEligibility({ product_name: 'Tactical KNIFE stainless' }, exclusions);
    expect(verdict).toEqual({ layer: 'absolute', label: 'Armes', constraint_note: null, legal_note: null });
  });

  test('matche un mot-clé dans description ou supplier_category, pas seulement product_name', () => {
    const exclusions = [rule({ label: 'Batteries lithium', layer: 'restricted', keywords: ['power bank'] })];
    const verdict = checkEligibility(
      { product_name: 'Chargeur voyage', description: 'Portable power bank 20000mAh' },
      exclusions
    );
    expect(verdict.layer).toBe('restricted');
    expect(verdict.label).toBe('Batteries lithium');
  });

  test('matche par catégorie (supplier_category ou komerce_category)', () => {
    const exclusions = [rule({ label: 'Périssables', categories: ['frozen-food'] })];
    const verdict = checkEligibility(
      { product_name: 'Sac isotherme', supplier_category: 'Frozen-Food' },
      exclusions
    );
    expect(verdict.label).toBe('Périssables');
  });

  test('absolute prime sur restricted si un candidat matche les deux couches', () => {
    const exclusions = [
      rule({ layer: 'restricted', label: 'Restreint', keywords: ['spray'] }),
      rule({ layer: 'absolute', label: 'Absolu', keywords: ['spray', 'weapon'] }),
    ];
    // Même si "restricted" est en tête de tableau, absolute doit gagner —
    // c'est loadActiveExclusions qui garantit l'ordre en amont ; ce test
    // documente que checkEligibility fait confiance à l'ordre reçu.
    const sorted = [...exclusions].sort((a, b) => (a.layer === 'absolute' ? -1 : 1) - (b.layer === 'absolute' ? -1 : 1));
    const verdict = checkEligibility({ product_name: 'Spray can aerosol' }, sorted);
    expect(verdict.layer).toBe('absolute');
    expect(verdict.label).toBe('Absolu');
  });

  test('candidat sans aucun champ texte ne matche jamais (pas de crash)', () => {
    const exclusions = [rule({ keywords: ['weapon'] })];
    expect(checkEligibility({}, exclusions)).toBeNull();
  });

  test('renvoie constraint_note et legal_note pour une règle restricted', () => {
    const exclusions = [
      rule({
        layer: 'restricted',
        label: 'Batteries lithium seules',
        keywords: ['18650'],
        constraint_note: 'Maritime uniquement',
        legal_note: 'IATA DGR',
      }),
    ];
    const verdict = checkEligibility({ product_name: '18650 battery cells x4' }, exclusions);
    expect(verdict).toEqual({
      layer: 'restricted',
      label: 'Batteries lithium seules',
      constraint_note: 'Maritime uniquement',
      legal_note: 'IATA DGR',
    });
  });
});

describe('loadActiveExclusions', () => {
  test('interroge catalog_exclusions filtré sur is_active', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await loadActiveExclusions();
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('FROM catalog_exclusions');
    expect(sql).toContain('is_active = TRUE');
  });

  test('trie les résultats absolute avant restricted', async () => {
    db.query.mockResolvedValue({
      rows: [
        { layer: 'restricted', label: 'R1' },
        { layer: 'absolute', label: 'A1' },
        { layer: 'restricted', label: 'R2' },
        { layer: 'absolute', label: 'A2' },
      ],
    });
    const rows = await loadActiveExclusions();
    expect(rows.map(r => r.layer)).toEqual(['absolute', 'absolute', 'restricted', 'restricted']);
  });

  test('liste vide si aucune exclusion active', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const rows = await loadActiveExclusions();
    expect(rows).toEqual([]);
  });
});
