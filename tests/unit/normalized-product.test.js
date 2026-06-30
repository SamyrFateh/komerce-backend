'use strict';

/**
 * tests/unit/normalized-product.test.js
 * Couvre services/suppliers/normalized-product.js
 */
const { validateNormalizedProduct, partitionValid } = require('../../services/suppliers/normalized-product');

describe('normalized-product', () => {
  describe('validateNormalizedProduct', () => {
    it('objet null/undefined → invalide', () => {
      expect(validateNormalizedProduct(null)).toEqual({ valid: false, errors: ['Objet invalide'] });
      expect(validateNormalizedProduct(undefined)).toEqual({ valid: false, errors: ['Objet invalide'] });
    });

    it('type non-objet (string) → invalide', () => {
      const result = validateNormalizedProduct('pas un objet');
      expect(result.valid).toBe(false);
    });

    it('product_name manquant → erreur dediee', () => {
      const result = validateNormalizedProduct({ supplier_name: 'Noon' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('product_name requis');
    });

    it('product_name vide ou espaces uniquement → erreur', () => {
      const result = validateNormalizedProduct({ product_name: '   ', supplier_name: 'Noon' });
      expect(result.errors).toContain('product_name requis');
    });

    it('supplier_name manquant → erreur dediee', () => {
      const result = validateNormalizedProduct({ product_name: 'Produit X' });
      expect(result.errors).toContain('supplier_name requis');
    });

    it('purchase_price negatif → erreur', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', purchase_price: -5 });
      expect(result.errors).toContain('purchase_price doit être un nombre positif');
    });

    it('purchase_price non numerique → erreur', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', purchase_price: 'abc' });
      expect(result.valid).toBe(false);
    });

    it('currency hors liste autorisee → erreur', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', currency: 'GBP' });
      expect(result.errors).toContain('currency doit être AED, EUR, USD ou KMF');
    });

    it('weight_kg negatif → erreur', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', weight_kg: -1 });
      expect(result.errors).toContain('weight_kg doit être un nombre positif');
    });

    it('objet minimal valide (juste product_name + supplier_name) → valide', () => {
      const result = validateNormalizedProduct({ product_name: 'Produit X', supplier_name: 'Noon' });
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('objet complet valide avec tous les champs optionnels corrects → valide', () => {
      const result = validateNormalizedProduct({
        product_name: 'Produit X',
        supplier_name: 'Noon',
        purchase_price: 100,
        currency: 'AED',
        weight_kg: 2.5,
      });
      expect(result.valid).toBe(true);
    });

    it('purchase_price=0 → accepte (pas strictement positif requis, juste >=0)', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', purchase_price: 0 });
      expect(result.valid).toBe(true);
    });
  });

  describe('partitionValid', () => {
    it('liste vide ou null → valid et invalid vides', () => {
      expect(partitionValid([])).toEqual({ valid: [], invalid: [] });
      expect(partitionValid(null)).toEqual({ valid: [], invalid: [] });
      expect(partitionValid(undefined)).toEqual({ valid: [], invalid: [] });
    });

    it('separe correctement valides et invalides avec leurs erreurs', () => {
      const products = [
        { product_name: 'A', supplier_name: 'Noon' },
        { product_name: '', supplier_name: 'Noon' },
        { product_name: 'C', supplier_name: 'Noon', currency: 'XXX' },
      ];
      const { valid, invalid } = partitionValid(products);
      expect(valid).toHaveLength(1);
      expect(valid[0].product_name).toBe('A');
      expect(invalid).toHaveLength(2);
      expect(invalid[0].errors).toContain('product_name requis');
      expect(invalid[1].errors).toContain('currency doit être AED, EUR, USD ou KMF');
    });

    it('tous valides → invalid vide', () => {
      const products = [
        { product_name: 'A', supplier_name: 'S1' },
        { product_name: 'B', supplier_name: 'S2' },
      ];
      const { valid, invalid } = partitionValid(products);
      expect(valid).toHaveLength(2);
      expect(invalid).toHaveLength(0);
    });
  });
});
