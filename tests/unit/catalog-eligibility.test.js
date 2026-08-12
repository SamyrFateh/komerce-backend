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
 *   - absolute prime sur restricted même si la liste fournie n'est pas triée ;
 *   - matching insensible à la casse, sur mots-clés ET catégories ;
 *   - les mots-clés sont des termes/phrases, jamais des sous-chaînes arbitraires ;
 *   - chaque exclusion expose la preuve exacte du match ;
 *   - aucune exclusion active → candidat pleinement éligible (null).
 */

jest.mock('../../db');
const db = require('../../db');
const {
  checkEligibility,
  loadActiveExclusions,
  keywordMatches,
  orderRules,
} = require('../../services/catalog-eligibility');

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

  test('matche un mot-clé insensible à la casse et expose la preuve', () => {
    const exclusions = [rule({ label: 'Armes', keywords: ['weapon', 'knife'] })];
    const verdict = checkEligibility({ product_name: 'Tactical KNIFE stainless' }, exclusions);
    expect(verdict).toEqual({
      layer: 'absolute',
      label: 'Armes',
      constraint_note: null,
      legal_note: null,
      match: { type: 'keyword', value: 'knife' },
    });
  });

  test('ne matche jamais une sous-chaîne à l’intérieur d’un autre mot', () => {
    const exclusions = [rule({ label: 'Armes', keywords: ['gun', 'replica'] })];
    expect(checkEligibility({ product_name: 'Gyeongbokgung traditional clothing' }, exclusions)).toBeNull();
    expect(checkEligibility({ product_name: 'Samsung phone running Replicant 6.0' }, exclusions)).toBeNull();
    expect(keywordMatches('commercial replica rifle', 'replica')).toBe(true);
    expect(keywordMatches('Replicant operating system', 'replica')).toBe(false);
  });

  test('conserve le matching des phrases et termes ponctués', () => {
    expect(keywordMatches('portable power bank 20000mAh', 'power bank')).toBe(true);
    expect(keywordMatches('seller claims 1:1 quality item', '1:1 quality')).toBe(true);
    expect(keywordMatches('uses an 18650 battery cell', '18650')).toBe(true);
  });

  test('matche un mot-clé dans description et expose le terme déclencheur', () => {
    const exclusions = [rule({ label: 'Batteries lithium', layer: 'restricted', keywords: ['power bank'] })];
    const verdict = checkEligibility(
      { product_name: 'Chargeur voyage', description: 'Portable power bank 20000mAh' },
      exclusions
    );
    expect(verdict.layer).toBe('restricted');
    expect(verdict.label).toBe('Batteries lithium');
    expect(verdict.match).toEqual({ type: 'keyword', value: 'power bank' });
  });

  test('matche par catégorie et expose la catégorie déclencheuse', () => {
    const exclusions = [rule({ label: 'Périssables', categories: ['frozen-food'] })];
    const verdict = checkEligibility(
      { product_name: 'Sac isotherme', supplier_category: 'Frozen-Food' },
      exclusions
    );
    expect(verdict.label).toBe('Périssables');
    expect(verdict.match).toEqual({ type: 'category', value: 'frozen-food' });
  });

  test('absolute prime dans le moteur même si restricted arrive en premier', () => {
    const exclusions = [
      rule({ layer: 'restricted', label: 'Restreint', keywords: ['spray'] }),
      rule({ layer: 'absolute', label: 'Absolu', keywords: ['weapon'] }),
    ];
    const verdict = checkEligibility({ product_name: 'Weapon spray can aerosol' }, exclusions);
    expect(verdict.layer).toBe('absolute');
    expect(verdict.label).toBe('Absolu');
    expect(verdict.match).toEqual({ type: 'keyword', value: 'weapon' });
  });

  test('candidat sans aucun champ texte ne matche jamais (pas de crash)', () => {
    const exclusions = [rule({ keywords: ['weapon'] })];
    expect(checkEligibility({}, exclusions)).toBeNull();
  });

  test('renvoie contrainte, base légale et preuve pour une règle restricted', () => {
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
      match: { type: 'keyword', value: '18650' },
    });
  });
});

describe('orderRules / loadActiveExclusions', () => {
  test('orderRules garantit absolute puis restricted sans muter la liste source', () => {
    const source = [
      { layer: 'restricted', label: 'R1' },
      { layer: 'absolute', label: 'A1' },
      { layer: 'restricted', label: 'R2' },
      { layer: 'absolute', label: 'A2' },
    ];
    const ordered = orderRules(source);
    expect(ordered.map(r => r.layer)).toEqual(['absolute', 'absolute', 'restricted', 'restricted']);
    expect(source.map(r => r.layer)).toEqual(['restricted', 'absolute', 'restricted', 'absolute']);
  });

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
