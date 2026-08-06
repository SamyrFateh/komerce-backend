'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pricing-guards.test.js
 *
 * Couvre services/pricing-guards.js (REFACTO-R1) — fonctions pures de
 * validation extraites de routes/pricing.js (PUT /apply-price/:id,
 * PUT /apply-all). Vérifie l'iso-comportement avec les conditions
 * historiques (y compris la coercition JS d'origine).
 */

const {
  isPriceInvalid,
  isBatchEmpty,
  isBatchOversize,
  getSurvivalViolation,
} = require('../../services/pricing-guards');

describe('pricing-guards', () => {
  describe('isPriceInvalid', () => {
    it('refuse 0, undefined, null, négatif', () => {
      expect(isPriceInvalid(0)).toBe(true);
      expect(isPriceInvalid(undefined)).toBe(true);
      expect(isPriceInvalid(null)).toBe(true);
      expect(isPriceInvalid(-100)).toBe(true);
    });

    it('accepte un prix positif', () => {
      expect(isPriceInvalid(1000)).toBe(false);
      expect(isPriceInvalid(1)).toBe(false);
    });
  });

  describe('isBatchEmpty', () => {
    it('refuse non-array, array vide', () => {
      expect(isBatchEmpty(undefined)).toBe(true);
      expect(isBatchEmpty(null)).toBe(true);
      expect(isBatchEmpty([])).toBe(true);
      expect(isBatchEmpty('not-an-array')).toBe(true);
    });

    it('accepte un array non vide', () => {
      expect(isBatchEmpty([{ product_id: 'p1', price_kmf: 1000 }])).toBe(false);
    });
  });

  describe('isBatchOversize', () => {
    it('refuse un batch > max', () => {
      const items = new Array(501).fill({ product_id: 'p1', price_kmf: 1000 });
      expect(isBatchOversize(items, 500)).toBe(true);
    });

    it('accepte un batch <= max', () => {
      const items = new Array(500).fill({ product_id: 'p1', price_kmf: 1000 });
      expect(isBatchOversize(items, 500)).toBe(false);
    });
  });

  describe('getSurvivalViolation', () => {
    it('retourne null si survival_price_kmf absent/falsy', () => {
      expect(getSurvivalViolation(1000, undefined)).toBeNull();
      expect(getSurvivalViolation(1000, null)).toBeNull();
      expect(getSurvivalViolation(1000, 0)).toBeNull();
    });

    it('retourne le seuil de survie si prix < survie', () => {
      expect(getSurvivalViolation(900, 1000)).toBe(1000);
    });

    it('retourne null si prix >= survie', () => {
      expect(getSurvivalViolation(1000, 1000)).toBeNull();
      expect(getSurvivalViolation(1100, 1000)).toBeNull();
    });

    it('coerce survival_price_kmf string en Number', () => {
      expect(getSurvivalViolation(900, '1000')).toBe(1000);
    });
  });
});
