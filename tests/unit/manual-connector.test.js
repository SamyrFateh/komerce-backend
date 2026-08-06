'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/manual-connector.test.js
 * Couvre services/suppliers/connectors/manual-connector.js
 */
const { fetchProducts, normalizeFormItem } = require('../../services/suppliers/connectors/manual-connector');

describe('normalizeFormItem', () => {
  it('item minimal → aucun défaut inventé (ING-2 : currency absente reste null, pas AED)', () => {
    const result = normalizeFormItem({ product_name: 'Chaise' }, 'Fournisseur X');
    expect(result).toEqual({
      supplier_name: 'Fournisseur X',
      supplier_product_id: null,
      product_name: 'Chaise',
      supplier_category: null,
      purchase_price: null,
      currency: null,
      image_url: null,
      product_url: null,
      description: null,
      stock_available: null,
      min_order_qty: null,
      supplier_delay_days: null,
      weight_kg: null,
      dimensions: null,
      raw_payload: { product_name: 'Chaise' },
    });
  });

  it('product_name → trim des espaces superflus', () => {
    const result = normalizeFormItem({ product_name: '  Table basse  ' }, 'Fournisseur X');
    expect(result.product_name).toBe('Table basse');
  });

  it('product_name absent → chaine vide (pas de crash)', () => {
    const result = normalizeFormItem({}, 'Fournisseur X');
    expect(result.product_name).toBe('');
  });

  it('champs numeriques en string → convertis en Number/parseInt', () => {
    const result = normalizeFormItem({
      product_name: 'Lampe',
      purchase_price: '49.90',
      stock_available: '12',
      min_order_qty: '3',
      supplier_delay_days: '7',
      weight_kg: '1.5',
    }, 'Fournisseur X');
    expect(result.purchase_price).toBe(49.9);
    expect(result.stock_available).toBe(12);
    expect(result.min_order_qty).toBe(3);
    expect(result.supplier_delay_days).toBe(7);
    expect(result.weight_kg).toBe(1.5);
  });

  it('champs numeriques en chaine vide → null (pas NaN)', () => {
    const result = normalizeFormItem({
      product_name: 'Lampe',
      purchase_price: '',
      stock_available: '',
      weight_kg: '',
    }, 'Fournisseur X');
    expect(result.purchase_price).toBeNull();
    expect(result.stock_available).toBeNull();
    expect(result.weight_kg).toBeNull();
  });

  it('currency → toujours normalisee en majuscules', () => {
    const result = normalizeFormItem({ product_name: 'X', currency: 'usd' }, 'F');
    expect(result.currency).toBe('USD');
  });

  it('dim_l_cm/dim_w_cm/dim_h_cm individuels → regroupes dans dimensions', () => {
    const result = normalizeFormItem({
      product_name: 'Carton', dim_l_cm: '30', dim_w_cm: '20', dim_h_cm: '10',
    }, 'F');
    expect(result.dimensions).toEqual({ l_cm: 30, w_cm: 20, h_cm: 10 });
  });

  it('dimensions partielles (seulement L) → objet avec uniquement l_cm', () => {
    const result = normalizeFormItem({ product_name: 'X', dim_l_cm: '15' }, 'F');
    expect(result.dimensions).toEqual({ l_cm: 15 });
  });

  it('aucune dimension fournie → dimensions null', () => {
    const result = normalizeFormItem({ product_name: 'X' }, 'F');
    expect(result.dimensions).toBeNull();
  });

  it('objet dimensions deja fourni → prioritaire sur les champs individuels dim_*', () => {
    const result = normalizeFormItem({
      product_name: 'X', dim_l_cm: '99', dimensions: { l_cm: 1, w_cm: 2, h_cm: 3 },
    }, 'F');
    expect(result.dimensions).toEqual({ l_cm: 1, w_cm: 2, h_cm: 3 });
  });

  it('raw_payload → conserve une copie du payload original', () => {
    const item = { product_name: 'X', foo: 'bar' };
    const result = normalizeFormItem(item, 'F');
    expect(result.raw_payload).toEqual(item);
    expect(result.raw_payload).not.toBe(item); // copie, pas la meme reference
  });

  // ── ING-2 : parsing strict, jamais deviner en silence (ING-I2) ──────────

  it('purchase_price illisible ("beaucoup") → _connectorErrors, pas droppé en silence', () => {
    const result = normalizeFormItem({ product_name: 'X', purchase_price: 'beaucoup' }, 'F');
    expect(result.purchase_price).toBeNull();
    expect(result._connectorErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('purchase_price invalide')])
    );
  });

  it('stock_available illisible ("12 units") → _connectorErrors', () => {
    const result = normalizeFormItem({ product_name: 'X', stock_available: '12 units' }, 'F');
    expect(result._connectorErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('stock_available invalide')])
    );
  });

  it('weight_kg illisible → _connectorErrors', () => {
    const result = normalizeFormItem({ product_name: 'X', weight_kg: 'lourd' }, 'F');
    expect(result._connectorErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('weight_kg invalide')])
    );
  });

  it('dim_l_cm illisible → _connectorErrors, plus d\'objet dimensions accepté tel quel', () => {
    const result = normalizeFormItem({ product_name: 'X', dim_l_cm: 'trente' }, 'F');
    expect(result._connectorErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('dimensions.l_cm invalide')])
    );
  });

  it('objet dimensions fourni avec une valeur négative → _connectorErrors', () => {
    const result = normalizeFormItem({ product_name: 'X', dimensions: { l_cm: -5, w_cm: 10 } }, 'F');
    expect(result._connectorErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('dimensions.l_cm invalide')])
    );
  });

  it('_connectorErrors absent quand tout est propre', () => {
    const result = normalizeFormItem({ product_name: 'X', purchase_price: '49.9', stock_available: '12' }, 'F');
    expect(result._connectorErrors).toBeUndefined();
  });
});

describe('fetchProducts', () => {
  it('supplier_name manquant → rejette (throw)', () => {
    expect(() => fetchProducts({ items: [{ product_name: 'X' }] })).toThrow('supplier_name requis');
  });

  it('supplier_name vide ou espaces → rejette', () => {
    expect(() => fetchProducts({ supplier_name: '   ', items: [{ product_name: 'X' }] })).toThrow('supplier_name requis');
  });

  it('items absent → rejette', () => {
    expect(() => fetchProducts({ supplier_name: 'F' })).toThrow('items requis');
  });

  it('items vide → rejette', () => {
    expect(() => fetchProducts({ supplier_name: 'F', items: [] })).toThrow('items requis');
  });

  it('items pas un tableau → rejette', () => {
    expect(() => fetchProducts({ supplier_name: 'F', items: 'pas-un-tableau' })).toThrow('items requis');
  });

  it('nominal → normalise tous les items et les classe valid/invalid', () => {
    const result = fetchProducts({
      supplier_name: 'Fournisseur X',
      items: [{ product_name: 'Chaise', currency: 'AED' }, { product_name: 'Table', currency: 'EUR' }],
    });
    expect(result.total).toBe(2);
    expect(result.products).toHaveLength(2);
    expect(result.invalid).toHaveLength(0);
    expect(result.products[0].supplier_name).toBe('Fournisseur X');
  });

  it('item invalide (product_name manquant) → classe dans invalid avec errors, pas de crash', () => {
    const result = fetchProducts({
      supplier_name: 'Fournisseur X',
      items: [{ product_name: 'Valide', currency: 'AED' }, { product_name: '', currency: 'AED' }],
    });
    expect(result.total).toBe(2);
    expect(result.products).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toContain('product_name requis');
  });

  it('currency absente (ING-2 : plus de défaut AED) → item classe invalid', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      items: [{ product_name: 'Chaise' }],
    });
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toContain('currency doit être AED, EUR, USD ou KMF');
  });

  it('currency invalide → item classe invalid', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      items: [{ product_name: 'X', currency: 'XYZ' }],
    });
    // currency est normalisee en majuscule par normalizeFormItem mais reste hors de l'enum -> invalid
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toContain('currency doit être AED, EUR, USD ou KMF');
  });

  it('purchase_price negatif → item classe invalid', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      items: [{ product_name: 'X', currency: 'AED', purchase_price: '-5' }],
    });
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toContain('purchase_price doit être un nombre positif');
  });

  it('purchase_price illisible → invalid via _connectorErrors, jamais silencieusement null en base', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      items: [{ product_name: 'X', currency: 'AED', purchase_price: 'beaucoup' }],
    });
    expect(result.products).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toEqual(
      expect.arrayContaining([expect.stringContaining('purchase_price invalide')])
    );
  });
});
