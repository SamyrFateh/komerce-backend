'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  sourceFingerprint,
  technicalTokens,
  englishResidues,
  looksFrench,
  evaluateFrenchCopy,
} = require('../../services/catalog-fr-quality');

describe('catalog FR quality contract', () => {
  const source = {
    product_ref: 'KPR-1',
    supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-1',
    source_locale: 'en',
    title: 'Wireless Charger Stand 15W for iPhone',
    description: 'Adjustable wireless charger stand with 15W charging power.',
    supplier_category: 'Phones > Chargers',
    current_category: 'phones',
    current_subcategory: null,
    brand: null,
    highlights: null,
    specifications: null,
    materials: null,
    care: null,
    warnings: null,
    option_axes: null,
  };

  test('fingerprint stable regardless object key order', () => {
    const reversed = Object.fromEntries(Object.entries(source).reverse());
    expect(sourceFingerprint(reversed)).toBe(sourceFingerprint(source));
  });

  test('extracts normalized technical tokens', () => {
    expect(technicalTokens('Batterie 5000 mAh, charge 15 W, 2.4 GHz'))
      .toEqual(['15w', '2.4ghz', '5000mah']);
  });

  test('detects obvious English residues but not normal French', () => {
    expect(englishResidues('Support wireless portable')).toEqual(expect.arrayContaining(['portable', 'wireless']));
    expect(englishResidues('Support de charge compact pour téléphone')).toEqual([]);
  });

  test('accepts a natural faithful French copy', () => {
    const result = evaluateFrenchCopy(source, {
      title_fr: 'Support de charge sans fil 15 W pour iPhone',
      description_fr: 'Support réglable pour charger un iPhone sans fil avec une puissance de charge de 15 W. Il maintient le téléphone posé pendant la recharge.',
    });
    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  test('blocks invented technical values and residual English title', () => {
    const result = evaluateFrenchCopy(source, {
      title_fr: 'Wireless support de charge 30 W',
      description_fr: 'Support réglable pour téléphone avec une puissance annoncée de 30 W et un usage quotidien simple.',
    });
    expect(result.ok).toBe(false);
    expect(result.blocking).toEqual(expect.arrayContaining([
      'english_residue_in_title',
      'invented_technical_token',
    ]));
  });

  test('French detection requires actual French signals', () => {
    expect(looksFrench('Wireless charger stand premium product')).toBe(false);
    expect(looksFrench('Support de charge pour téléphone avec base réglable')).toBe(true);
  });
});
