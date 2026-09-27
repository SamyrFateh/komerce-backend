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
  languageScores,
  looksFrench,
  controlledClaims,
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
    expect(englishResidues('Support wireless foldable')).toEqual(expect.arrayContaining(['wireless', 'foldable']));
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

  test('French detection rejects Spanish and English-with-accent false positives', () => {
    expect(looksFrench('Wireless charger stand premium product café')).toBe(false);
    expect(looksFrench('Producto con la base ajustable para el teléfono y carga integrada')).toBe(false);
    expect(looksFrench('Support de charge pour téléphone avec une base réglable et sans câble')).toBe(true);
    expect(languageScores('Producto con la base para el teléfono').spanish).toBeGreaterThan(0);
  });

  test('blocks invented controlled claims such as Bluetooth, GPS and IP ratings', () => {
    const result = evaluateFrenchCopy(source, {
      title_fr: 'Support de charge sans fil 15 W pour iPhone',
      description_fr: 'Support réglable pour charger un iPhone sans fil avec une puissance de 15 W, Bluetooth 5.3, GPS intégré et protection IP68.',
    });
    expect(result.ok).toBe(false);
    expect(result.blocking).toContain('invented_controlled_claim');
    expect(controlledClaims('Bluetooth 5.3 GPS IP68')).toEqual(expect.arrayContaining(['bluetooth5.3', 'gps', 'ip68']));
  });

  test('blocks omission of critical source claims', () => {
    const batterySource = {
      ...source,
      title: 'Mini écouteurs 190mAh Bluetooth 5.3',
      description: 'Battery capacity 190mAh with Bluetooth 5.3.',
    };
    const result = evaluateFrenchCopy(batterySource, {
      title_fr: 'Mini écouteurs compacts',
      description_fr: 'Écouteurs compacts pour une utilisation quotidienne avec un format léger et une prise en main simple.',
    });
    expect(result.ok).toBe(false);
    expect(result.blocking).toContain('critical_source_claim_omitted');
  });
});
