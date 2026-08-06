'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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

    // Le trim de product_name est la responsabilité des connecteurs (déjà
    // couvert par manual-connector.test.js / csv-connector.test.js), pas du
    // schéma v1 lui-même : minLength ne trim pas. Un "   " brut passé ici
    // directement compte pour 3 caractères et n'est plus l'affaire du contrat.

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
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', currency: 'GBP', raw_payload: {} });
      expect(result.errors).toContain('currency doit être AED, EUR, USD ou KMF');
    });

    it('currency absente (mais requise par le contrat v1) → erreur', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', raw_payload: {} });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('currency requise');
    });

    it('raw_payload absent (ING-I3 : le brut ne se perd jamais) → erreur', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', currency: 'AED' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('raw_payload requis (ING-I3 : le brut ne se perd jamais)');
    });

    it('champ inconnu hors contrat (additionalProperties:false) → erreur', () => {
      const result = validateNormalizedProduct({
        product_name: 'X', supplier_name: 'Y', currency: 'AED', raw_payload: {}, is_admin: true,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('is_admin'))).toBe(true);
    });

    it('weight_kg negatif → erreur', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', currency: 'AED', raw_payload: {}, weight_kg: -1 });
      expect(result.errors).toContain('weight_kg doit être un nombre positif');
    });

    it('weight_kg hors plafond contrat (500 kg) → erreur', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', currency: 'AED', raw_payload: {}, weight_kg: 25000 });
      expect(result.valid).toBe(false);
    });

    it('objet minimal valide (product_name + supplier_name + currency + raw_payload) → valide', () => {
      const result = validateNormalizedProduct({
        product_name: 'Produit X', supplier_name: 'Noon', currency: 'AED', raw_payload: {},
      });
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('objet complet valide avec tous les champs optionnels corrects → valide', () => {
      const result = validateNormalizedProduct({
        product_name: 'Produit X',
        supplier_name: 'Noon',
        purchase_price: 100,
        currency: 'AED',
        weight_kg: 2.5,
        raw_payload: { product_name: 'Produit X' },
      });
      expect(result.valid).toBe(true);
    });

    it('purchase_price=0 → invalide (contrat v1 : exclusiveMinimum, prix inconnu doit être null, pas 0)', () => {
      const result = validateNormalizedProduct({ product_name: 'X', supplier_name: 'Y', currency: 'AED', raw_payload: {}, purchase_price: 0 });
      expect(result.valid).toBe(false);
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
        { product_name: 'AA', supplier_name: 'Noon', currency: 'AED', raw_payload: {} },
        { product_name: '', supplier_name: 'Noon', currency: 'AED', raw_payload: {} },
        { product_name: 'CC', supplier_name: 'Noon', currency: 'XXX', raw_payload: {} },
      ];
      const { valid, invalid } = partitionValid(products);
      expect(valid).toHaveLength(1);
      expect(valid[0].product_name).toBe('AA');
      expect(invalid).toHaveLength(2);
      expect(invalid[0].errors).toContain('product_name requis');
      expect(invalid[1].errors).toContain('currency doit être AED, EUR, USD ou KMF');
    });

    it('tous valides → invalid vide', () => {
      const products = [
        { product_name: 'AA', supplier_name: 'S1', currency: 'AED', raw_payload: {} },
        { product_name: 'BB', supplier_name: 'S2', currency: 'AED', raw_payload: {} },
      ];
      const { valid, invalid } = partitionValid(products);
      expect(valid).toHaveLength(2);
      expect(invalid).toHaveLength(0);
    });
  });
});
