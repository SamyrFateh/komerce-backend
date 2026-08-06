'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/phone.test.js
 *
 * Tests du module utils/phone.js (normalisation E.164)
 *
 * Couverture :
 *   ✓ déjà E.164 valide / invalide (longueur)
 *   ✓ 00XX → +XX
 *   ✓ defaultCountry='+33' : 06xx, 33xx, sans préfixe, longueur invalide, préfixe invalide (ni 6 ni 7)
 *   ✓ defaultCountry='+269' : 269xx, sans préfixe, longueur invalide
 *   ✓ sans defaultCountry → null (pas de devinette)
 *   ✓ entrées vides / non-string / null / undefined
 */

const { normalizePhone } = require('../../utils/phone');

describe('normalizePhone', () => {
  describe('entrées vides ou invalides', () => {
    it('retourne null pour null', () => {
      expect(normalizePhone(null)).toBeNull();
    });

    it('retourne null pour undefined', () => {
      expect(normalizePhone(undefined)).toBeNull();
    });

    it('retourne null pour une chaîne vide', () => {
      expect(normalizePhone('')).toBeNull();
    });

    it('retourne null pour des espaces seuls', () => {
      expect(normalizePhone('   ')).toBeNull();
    });
  });

  describe('déjà au format E.164', () => {
    it('accepte un numéro français déjà E.164', () => {
      expect(normalizePhone('+33699272526')).toBe('+33699272526');
    });

    it('accepte un numéro avec espaces et le nettoie', () => {
      expect(normalizePhone('+33 6 99 27 25 26')).toBe('+33699272526');
    });

    it('rejette un E.164 trop court (< 8 chiffres)', () => {
      expect(normalizePhone('+1234567')).toBeNull();
    });

    it('rejette un E.164 trop long (> 15 chiffres)', () => {
      expect(normalizePhone('+1234567890123456')).toBeNull();
    });

    it('accepte la borne basse (8 chiffres)', () => {
      expect(normalizePhone('+26932112')).toBe('+26932112');
    });

    it('accepte la borne haute (15 chiffres)', () => {
      expect(normalizePhone('+123456789012345')).toBe('+123456789012345');
    });
  });

  describe('00XX → +XX', () => {
    it('convertit un préfixe international 0033', () => {
      expect(normalizePhone('0033699272526')).toBe('+33699272526');
    });

    it('rejette si la conversion 00XX donne une longueur invalide', () => {
      expect(normalizePhone('001234567')).toBeNull();
    });
  });

  describe('defaultCountry +33', () => {
    it('normalise un numéro local 06...', () => {
      expect(normalizePhone('0699272526', '+33')).toBe('+33699272526');
    });

    it('normalise un numéro local 07...', () => {
      expect(normalizePhone('0799272526', '+33')).toBe('+33799272526');
    });

    it('normalise un numéro avec indicatif sans + (33699...)', () => {
      expect(normalizePhone('33699272526', '+33')).toBe('+33699272526');
    });

    it('rejette une longueur invalide après nettoyage', () => {
      expect(normalizePhone('069927', '+33')).toBeNull();
    });

    it('rejette un numéro qui ne commence ni par 6 ni par 7', () => {
      expect(normalizePhone('0199272526', '+33')).toBeNull();
    });

    it("rejette un numéro contenant un '+' résiduel au milieu (échec de la validation \\d+ malgré la bonne longueur)", () => {
      // digitsOnly conserve les '+' où qu'ils soient dans la chaîne, pas seulement en tête.
      // "0699+27526" → après suppression du 0 initial : "699+27526" (9 caractères, commence par 6)
      // mais échoue au test /^\d+$/ car il reste un '+' au milieu.
      expect(normalizePhone('0699+27526', '+33')).toBeNull();
    });

    it('sans defaultCountry, un numéro local reste null (pas de devinette)', () => {
      expect(normalizePhone('0699272526')).toBeNull();
    });
  });

  describe('defaultCountry +269 (Comores)', () => {
    it('normalise un numéro local à 7 chiffres', () => {
      expect(normalizePhone('3211234', '+269')).toBe('+2693211234');
    });

    it('normalise un numéro avec indicatif sans + (269321...)', () => {
      expect(normalizePhone('2693211234', '+269')).toBe('+2693211234');
    });

    it('rejette une longueur invalide (6 chiffres)', () => {
      expect(normalizePhone('321123', '+269')).toBeNull();
    });

    it('rejette une longueur invalide (8 chiffres)', () => {
      expect(normalizePhone('32112345', '+269')).toBeNull();
    });

    it("rejette un numéro contenant un '+' résiduel au milieu malgré la bonne longueur (7 caractères)", () => {
      expect(normalizePhone('321+234', '+269')).toBeNull();
    });
  });

  describe('defaultCountry inconnu', () => {
    it('refuse de deviner pour un indicatif non géré', () => {
      expect(normalizePhone('0699272526', '+44')).toBeNull();
    });
  });
});
