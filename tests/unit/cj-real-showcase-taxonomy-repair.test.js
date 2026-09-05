'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/product-admin-service', () => ({ updateProduct: jest.fn() }));

const {
  FAMILIES,
  TARGET,
  TARGET_PER_FAMILY,
} = require('../../scripts/cj-real-showcase-seed');
const {
  TAXONOMY_BY_FAMILY,
  taxonomyForFamily,
} = require('../../scripts/cj-real-showcase-taxonomy-repair');

describe('CJ real showcase taxonomy repair contract', () => {
  it('maps every one of the 21 showcase families to a canonical category and subcategory', () => {
    expect(Object.keys(TAXONOMY_BY_FAMILY)).toHaveLength(FAMILIES.length);
    for (const family of FAMILIES) {
      const taxonomy = taxonomyForFamily(family);
      expect(taxonomy).toEqual(expect.objectContaining({
        category: expect.any(String),
        subcategory: expect.any(String),
      }));
    }
    expect(FAMILIES.length * TARGET_PER_FAMILY).toBe(TARGET);
  });

  it('covers the six visible Komerce universes used by the showcase', () => {
    const categories = new Set(Object.values(TAXONOMY_BY_FAMILY).map((row) => row.category));
    expect(categories).toEqual(new Set([
      'Mode & Beauté',
      'Maison',
      'Tech',
      'Bricolage',
      'Créations personnelles',
      'Auto',
    ]));
  });

  it('keeps representative family mappings aligned with the boutique taxonomy', () => {
    expect(taxonomyForFamily('women')).toEqual({ category: 'Mode & Beauté', subcategory: 'Femme' });
    expect(taxonomyForFamily('kitchen')).toEqual({ category: 'Maison', subcategory: 'Cuisine' });
    expect(taxonomyForFamily('phones')).toEqual({ category: 'Tech', subcategory: 'Phones' });
    expect(taxonomyForFamily('tools')).toEqual({ category: 'Bricolage', subcategory: 'Outillage' });
    expect(taxonomyForFamily('gift')).toEqual({ category: 'Créations personnelles', subcategory: 'Cadeau' });
    expect(taxonomyForFamily('moto')).toEqual({ category: 'Auto', subcategory: 'Moto' });
  });
});
