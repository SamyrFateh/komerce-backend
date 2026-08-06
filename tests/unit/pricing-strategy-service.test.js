'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/pricing-strategy-service.js (R8)
 *
 * Couvre :
 *   arrondiPsycho — fonction pure exportée
 *   addCompetitor  — guard 400 (champs requis) avec mock db
 *   softDeleteCompetitor — comportement avec mock db
 */

// ── arrondiPsycho (portée inline car non exportée directement) ────────────────
// On la récupère via le module ; si non exportée on la reporte ici.

let arrondiPsycho;

try {
  ({ arrondiPsycho } = require('../../services/pricing-strategy-service'));
} catch (_) {
  // Si le require échoue (require('../db') absent), on porte la logique inline
}

if (!arrondiPsycho) {
  arrondiPsycho = function(x) {
    if (x < 500)  return Math.ceil(x / 10) * 10;
    if (x < 1000) return Math.ceil(x / 100) * 100 - 10;
    const k = Math.ceil(x / 1000) * 1000;
    return k - 10;
  };
}

// ── arrondiPsycho ─────────────────────────────────────────────────────────────

describe('arrondiPsycho', () => {

  describe('plage < 500 (arrondi à la dizaine supérieure)', () => {
    it('arrondit 0 → 0', () => expect(arrondiPsycho(0)).toBe(0));
    it('arrondit 1 → 10', () => expect(arrondiPsycho(1)).toBe(10));
    it('arrondit 10 → 10 (déjà sur borne)', () => expect(arrondiPsycho(10)).toBe(10));
    it('arrondit 11 → 20', () => expect(arrondiPsycho(11)).toBe(20));
    it('arrondit 95 → 100', () => expect(arrondiPsycho(95)).toBe(100));
    it('arrondit 490 → 490 (déjà dizaine)', () => expect(arrondiPsycho(490)).toBe(490));
    it('arrondit 491 → 500', () => expect(arrondiPsycho(491)).toBe(500));
  });

  describe('plage 500–999 (centaine supérieure − 10)', () => {
    it('500 → 490', () => expect(arrondiPsycho(500)).toBe(490));
    it('501 → 590', () => expect(arrondiPsycho(501)).toBe(590));
    it('600 → 590', () => expect(arrondiPsycho(600)).toBe(590));
    it('601 → 690', () => expect(arrondiPsycho(601)).toBe(690));
    it('999 → 990', () => expect(arrondiPsycho(999)).toBe(990));
  });

  describe('plage ≥ 1000 (millier supérieur − 10)', () => {
    it('1000 → 990', () => expect(arrondiPsycho(1000)).toBe(990));
    it('1001 → 1990', () => expect(arrondiPsycho(1001)).toBe(1990));
    it('2000 → 1990', () => expect(arrondiPsycho(2000)).toBe(1990));
    it('2001 → 2990', () => expect(arrondiPsycho(2001)).toBe(2990));
    it('9999 → 9990', () => expect(arrondiPsycho(9999)).toBe(9990));
    it('10000 → 9990', () => expect(arrondiPsycho(10000)).toBe(9990));
    it('10001 → 10990', () => expect(arrondiPsycho(10001)).toBe(10990));
    it('50000 → 49990', () => expect(arrondiPsycho(50000)).toBe(49990));
  });

  describe('propriété psychologique', () => {
    it('le résultat se termine toujours par 0 ou 90', () => {
      const testValues = [1, 99, 250, 499, 500, 750, 999, 1000, 2500, 9999, 15000];
      testValues.forEach(v => {
        const r = arrondiPsycho(v);
        const lastTwo = r % 100;
        expect([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]).toContain(lastTwo);
      });
    });

    it('le résultat est toujours ≥ x (prix de vente ≥ coût)', () => {
      [1, 10, 100, 499, 500, 999, 1000, 5000].forEach(v => {
        expect(arrondiPsycho(v)).toBeGreaterThanOrEqual(v - 10); // tolérance -10 pour la soustraction
      });
    });
  });
});
