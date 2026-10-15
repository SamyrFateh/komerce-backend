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
  test('source FR + phrase démontrée FR (looksFrench, sans résidu anglais) : revue non signalée', () => {
    const identity = canonicalizeProductIdentity({
      product_name: 'Casque Bluetooth',
      description: 'Casque sans fil confortable avec réduction de bruit. Autonomie de 20 heures.',
      source_locale: 'fr',
    });
    expect(identity).toEqual({
      name: 'Casque Bluetooth',
      description: 'Casque sans fil confortable avec réduction de bruit.',
      needs_editorial_review: false,
      reasons: [],
    });
  });

  test('couper au premier point ne prouve rien : extraction conservée comme proposition, revue signalée', () => {
    // Même phrase mécaniquement extraite que le test précédent, mais contenu
    // anglais : looksFrench/englishResidues (FR Quality Pass, doctrine §4.1)
    // ne la qualifient jamais de fiable — seule la ponctuation ne suffit pas.
    const identity = canonicalizeProductIdentity({
      product_name: 'Wireless Headphones',
      description: 'Comfortable wireless headset. Bluetooth 5.0, 20h battery.',
      source_locale: 'en',
    });
    // La proposition reste préservée (rien n'est perdu) ...
    expect(identity.description).toBe('Comfortable wireless headset.');
    // ... mais jamais déclarée prête : contenu non démontré FR ET source non française.
    expect(identity.needs_editorial_review).toBe(true);
    expect(identity.reasons).toEqual(expect.arrayContaining([
      'PROPOSED_SENTENCE_NOT_DEMONSTRATED_FR_QUALITY',
      'NON_FR_SOURCE_NOT_EDITORIALLY_READY',
    ]));
  });

  test('DOCTRINE_CATALOGUE §4 : une source non française (ou inconnue) n\'est jamais déclarée prête, même brouillon fluide', () => {
    // Nom court + phrase FR propre, mais source_locale omise (inconnue) :
    // connector_raw non français ne peut jamais être "prêt" (doctrine §4).
    const identity = canonicalizeProductIdentity({
      product_name: 'Casque Bluetooth',
      description: 'Casque sans fil confortable avec réduction de bruit.',
    });
    expect(identity.needs_editorial_review).toBe(true);
    expect(identity.reasons).toContain('NON_FR_SOURCE_NOT_EDITORIALLY_READY');
    // Le brouillon n'est jamais bloqué : la proposition reste disponible.
    expect(identity.description).toBe('Casque sans fil confortable avec réduction de bruit.');
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
