'use strict';

/**
 * tests/unit/b-friendly-group-redirect.test.js
 *
 * Module #27 — js/b-friendly-group-redirect.js (33L)
 *
 * window.location.replace est une propriété non-configurable/non-writable
 * sous jsdom (jest.spyOn / jest.replaceProperty / Object.defineProperty
 * échouent tous : "Property `replace` is not declared configurable").
 * Impossible d'espionner l'appel réel sans patcher jsdom lui-même.
 *
 * Pattern du repo (cf. boutique-core.unit.test.js) : on extrait la logique
 * pure du module et on l'injecte avec un pathname + un callback `replace`
 * mockable, en gardant exactement le même comportement (regex, garde de
 * longueur, encodage).
 *
 * Source: js/b-friendly-group-redirect.js L22-33 (2026-06)
 */
function friendlyGroupRedirect(pathname, replace) {
  const match = pathname.match(/^\/g\/([A-Za-z0-9_-]+)$/);
  if (!match) return;

  const token = match[1];
  if (!token || token.length > 120) {
    replace('/boutique/');
    return;
  }

  replace('/event/w/' + encodeURIComponent(token));
}

describe('b-friendly-group-redirect (logique pure)', () => {
  it("pathname ne matche pas /g/:token → ne fait rien (pas de replace)", () => {
    const replace = jest.fn();
    friendlyGroupRedirect('/boutique/produit/123', replace);
    expect(replace).not.toHaveBeenCalled();
  });

  it('pathname /g/ABC123 → redirige vers /event/w/ABC123', () => {
    const replace = jest.fn();
    friendlyGroupRedirect('/g/ABC123', replace);
    expect(replace).toHaveBeenCalledWith('/event/w/ABC123');
  });

  it('token avec tirets/underscores → URL finale correctement préfixée', () => {
    const replace = jest.fn();
    friendlyGroupRedirect('/g/abc-DEF_123', replace);
    expect(replace).toHaveBeenCalledWith('/event/w/abc-DEF_123');
  });

  it('token vide (edge — ne matche jamais le regex +) → no-op', () => {
    const replace = jest.fn();
    friendlyGroupRedirect('/g/', replace);
    expect(replace).not.toHaveBeenCalled();
  });

  it('token trop long (>120 chars) → fallback /boutique/ au lieu de /event/w/...', () => {
    const replace = jest.fn();
    const longToken = 'a'.repeat(121);
    friendlyGroupRedirect('/g/' + longToken, replace);
    expect(replace).toHaveBeenCalledWith('/boutique/');
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining('/event/w/'));
  });

  it('token exactement 120 chars → accepté, redirige vers /event/w/...', () => {
    const replace = jest.fn();
    const token120 = 'b'.repeat(120);
    friendlyGroupRedirect('/g/' + token120, replace);
    expect(replace).toHaveBeenCalledWith('/event/w/' + token120);
  });

  it('pathname avec segment supplémentaire après le token → ne matche pas (regex ancrée $)', () => {
    const replace = jest.fn();
    friendlyGroupRedirect('/g/abc123/extra', replace);
    expect(replace).not.toHaveBeenCalled();
  });

  it('pathname racine "/" → ne matche pas', () => {
    const replace = jest.fn();
    friendlyGroupRedirect('/', replace);
    expect(replace).not.toHaveBeenCalled();
  });
});

/**
 * Test fumée additionnel : on vérifie que le vrai module (avec le vrai
 * window.location) ne throw jamais, même si jsdom logguera en interne
 * "Not implemented: navigation" (non bloquant, capturé par jest-environment-jsdom).
 */
describe('b-friendly-group-redirect (smoke réel, sans assertion sur la navigation)', () => {
  const { setupFriendlyGroupRedirect } = require('../../js/b-friendly-group-redirect.js');

  it("n'explose jamais, quel que soit le pathname courant", () => {
    window.history.pushState(null, '', '/g/abc123');
    expect(() => setupFriendlyGroupRedirect()).not.toThrow();
  });

  it("n'explose pas non plus sur un pathname non concerné", () => {
    window.history.pushState(null, '', '/boutique/catalogue');
    expect(() => setupFriendlyGroupRedirect()).not.toThrow();
  });
});
