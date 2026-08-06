'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/contract/catalog-normalized-product.contract.test.js
 *
 * ING-1 — le contrat pivot NormalizedSupplierProduct v1 est désormais un
 * schéma exécutable, pas une convention JSDoc. Ce fichier est la définition
 * exécutable du contrat : un `it` par règle du schéma, y compris les cas
 * qui passaient silencieusement avant (doctrine ING-I1, ING-I7).
 *
 * Référence : schemas/catalog/normalized-supplier-product.v1.schema.json
 */

const { validateNormalizedProduct } = require('../../services/suppliers/normalized-product');

function base(overrides = {}) {
  return {
    supplier_name: 'Dragon Mart',
    product_name: 'Casque Bluetooth Pro',
    currency: 'AED',
    raw_payload: { name: 'Casque Bluetooth Pro' },
    ...overrides,
  };
}

describe('contrat v1 — NormalizedSupplierProduct', () => {
  it('objet conforme minimal → valide', () => {
    expect(validateNormalizedProduct(base())).toEqual({ valid: true, errors: [] });
  });

  it('champ inconnu hors contrat (additionalProperties:false) → invalide', () => {
    const result = validateNormalizedProduct(base({ is_admin: true }));
    expect(result.valid).toBe(false);
  });

  it('supplier_name absent → invalide', () => {
    const { supplier_name, ...withoutSupplier } = base();
    expect(validateNormalizedProduct(withoutSupplier).valid).toBe(false);
  });

  it('product_name absent → invalide', () => {
    const { product_name, ...withoutName } = base();
    expect(validateNormalizedProduct(withoutName).valid).toBe(false);
  });

  it('product_name trop long (>300 caractères) → invalide (anti keyword-stuffing)', () => {
    expect(validateNormalizedProduct(base({ product_name: 'x'.repeat(301) })).valid).toBe(false);
  });

  it('currency absente → invalide (jamais de défaut deviné, ING-I2)', () => {
    const { currency, ...withoutCurrency } = base();
    expect(validateNormalizedProduct(withoutCurrency).valid).toBe(false);
  });

  it('currency hors whitelist (ex: GBP) → invalide', () => {
    expect(validateNormalizedProduct(base({ currency: 'GBP' })).valid).toBe(false);
  });

  it('raw_payload absent → invalide (ING-I3 : le brut ne se perd jamais)', () => {
    const { raw_payload, ...withoutRaw } = base();
    expect(validateNormalizedProduct(withoutRaw).valid).toBe(false);
  });

  it('purchase_price = 0 → invalide (exclusiveMinimum : prix inconnu = null, pas 0)', () => {
    expect(validateNormalizedProduct(base({ purchase_price: 0 })).valid).toBe(false);
  });

  it('purchase_price négatif → invalide', () => {
    expect(validateNormalizedProduct(base({ purchase_price: -10 })).valid).toBe(false);
  });

  it('purchase_price au-delà du plafond contrat (10 000 000) → invalide', () => {
    expect(validateNormalizedProduct(base({ purchase_price: 999999999 })).valid).toBe(false);
  });

  it('purchase_price positif dans les bornes → valide', () => {
    expect(validateNormalizedProduct(base({ purchase_price: 5000 })).valid).toBe(true);
  });

  it('stock_available négatif (-50) → invalide', () => {
    expect(validateNormalizedProduct(base({ stock_available: -50 })).valid).toBe(false);
  });

  it('stock_available non entier (12.9) → invalide', () => {
    expect(validateNormalizedProduct(base({ stock_available: 12.9 })).valid).toBe(false);
  });

  it('stock_available entier positif → valide', () => {
    expect(validateNormalizedProduct(base({ stock_available: 12 })).valid).toBe(true);
  });

  it('weight_kg = 0 → invalide (exclusiveMinimum)', () => {
    expect(validateNormalizedProduct(base({ weight_kg: 0 })).valid).toBe(false);
  });

  it('weight_kg au-delà du plafond contrat (25000 kg) → invalide', () => {
    expect(validateNormalizedProduct(base({ weight_kg: 25000 })).valid).toBe(false);
  });

  it('weight_kg dans les bornes → valide', () => {
    expect(validateNormalizedProduct(base({ weight_kg: 12.5 })).valid).toBe(true);
  });

  it('dimensions avec un champ non numérique → invalide', () => {
    const result = validateNormalizedProduct(base({ dimensions: { l_cm: 'très long', w_cm: 10, h_cm: 5 } }));
    expect(result.valid).toBe(false);
  });

  it('dimensions avec un champ inconnu (additionalProperties:false imbriqué) → invalide', () => {
    const result = validateNormalizedProduct(base({ dimensions: { l_cm: 10, w_cm: 10, h_cm: 10, poids: 5 } }));
    expect(result.valid).toBe(false);
  });

  it('dimensions complètes et positives → valide', () => {
    expect(validateNormalizedProduct(base({ dimensions: { l_cm: 10, w_cm: 20, h_cm: 30 } })).valid).toBe(true);
  });

  it('image_url mal formée (pas une URI) → invalide', () => {
    expect(validateNormalizedProduct(base({ image_url: 'pas-une-url' })).valid).toBe(false);
  });

  it('image_url valide → valide', () => {
    expect(validateNormalizedProduct(base({ image_url: 'https://example.com/x.jpg' })).valid).toBe(true);
  });

  it('description au-delà de 10000 caractères → invalide', () => {
    expect(validateNormalizedProduct(base({ description: 'x'.repeat(10001) })).valid).toBe(false);
  });

  it('supplier_delay_days au-delà de 365 → invalide', () => {
    expect(validateNormalizedProduct(base({ supplier_delay_days: 400 })).valid).toBe(false);
  });

  it('min_order_qty = 0 → invalide (minimum contractuel : 1)', () => {
    expect(validateNormalizedProduct(base({ min_order_qty: 0 })).valid).toBe(false);
  });

  it('tous les champs optionnels à null → valide (le contrat accepte l\'absence explicite)', () => {
    expect(validateNormalizedProduct(base({
      supplier_product_id: null,
      supplier_category: null,
      purchase_price: null,
      image_url: null,
      product_url: null,
      description: null,
      stock_available: null,
      min_order_qty: null,
      supplier_delay_days: null,
      weight_kg: null,
      dimensions: null,
    })).valid).toBe(true);
  });

  it('objet non-objet (string, tableau, null) → invalide sans lever d\'exception', () => {
    expect(validateNormalizedProduct('pas un objet').valid).toBe(false);
    expect(validateNormalizedProduct([1, 2, 3]).valid).toBe(false);
    expect(validateNormalizedProduct(null).valid).toBe(false);
    expect(validateNormalizedProduct(undefined).valid).toBe(false);
  });
});
