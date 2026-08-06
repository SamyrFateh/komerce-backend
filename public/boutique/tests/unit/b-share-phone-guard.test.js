'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-share-phone-guard.test.js
 *
 * Module #26 — js/b-share-phone-guard.js (31L)
 * Tombstone : ancien guard guest désactivé, conservé pour compat avec
 * main.js qui importe setupSharePhoneGuard(). Doit rester strictement no-op
 * (le flow "📤 Partager" unique vit dans b-share-cart.js).
 */

const { setupSharePhoneGuard } = require('../../js/b-share-phone-guard.js');

describe('b-share-phone-guard (tombstone no-op)', () => {
  it('exporte une fonction', () => {
    expect(typeof setupSharePhoneGuard).toBe('function');
  });

  it('ne crashe pas quand appelée sans DOM particulier', () => {
    expect(() => setupSharePhoneGuard()).not.toThrow();
  });

  it("ne retourne rien (undefined) — pas d'API de retour à maintenir", () => {
    expect(setupSharePhoneGuard()).toBeUndefined();
  });

  it("n'attache aucun listener global sur document (pas de capture de clic)", () => {
    const addSpy = jest.spyOn(document, 'addEventListener');
    setupSharePhoneGuard();
    expect(addSpy).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it("n'attache aucun listener global sur window", () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    setupSharePhoneGuard();
    expect(addSpy).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it('appels multiples restent sans effet de bord (idempotent)', () => {
    expect(() => {
      setupSharePhoneGuard();
      setupSharePhoneGuard();
      setupSharePhoneGuard();
    }).not.toThrow();
  });
});
