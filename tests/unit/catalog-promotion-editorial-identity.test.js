'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  canonicalizeProductIdentity,
  SHORT_NAME_MAX,
} = require('../../services/catalog-promotion/editorial-identity');

describe('catalog-promotion/editorial-identity : identité client sans invention', () => {
  test('nom court + phrase factuelle extraite quand les faits fournisseur suffisent', () => {
    const identity = canonicalizeProductIdentity({
      product_name: 'Wireless Headphones',
      description: 'Comfortable wireless headset. Bluetooth 5.0, 20h battery.',
    });
    expect(identity).toEqual({
      name: 'Wireless Headphones',
      description: 'Comfortable wireless headset.',
      needs_editorial_review: false,
      reasons: [],
    });
  });

  test('ne tronque jamais un nom hors borne : nom complet publié, revue signalée', () => {
    const longName = 'Titre fournisseur très long '.repeat(10).trim();
    expect(longName.length).toBeGreaterThan(SHORT_NAME_MAX);
    const identity = canonicalizeProductIdentity({ product_name: longName, description: 'Fait. Autre fait.' });
    expect(identity.name).toBe(longName);
    expect(identity.needs_editorial_review).toBe(true);
    expect(identity.reasons).toContain('NAME_TOO_LONG_FOR_SHORT_IDENTITY');
  });

  test('ne fabrique aucune description absente : null, revue signalée', () => {
    const identity = canonicalizeProductIdentity({ product_name: 'Casque' });
    expect(identity.description).toBeNull();
    expect(identity.needs_editorial_review).toBe(true);
    expect(identity.reasons).toContain('DESCRIPTION_ABSENT');
  });

  test('ne fabrique aucune phrase quand la description est un bloc sans ponctuation fiable', () => {
    const identity = canonicalizeProductIdentity({
      product_name: 'Produit',
      description: 'Raw supplier description',
    });
    expect(identity.description).toBeNull();
    expect(identity.needs_editorial_review).toBe(true);
    expect(identity.reasons).toContain('NO_RELIABLE_FACTUAL_SENTENCE');
  });

  test('normalise les espaces du nom sans jamais réinterpréter le contenu', () => {
    const identity = canonicalizeProductIdentity({ product_name: '  Casque   Bluetooth  ', description: null });
    expect(identity.name).toBe('Casque Bluetooth');
  });
});
