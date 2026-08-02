'use strict';

/**
 * tests/unit/group-helpers.test.js
 *
 * Module js/group/group-helpers.js — Boutique First, domaine minimal.
 * Tout le calcul V4.1 (montants d'engagement, statuts métier projetés,
 * fenêtre de paiement/règlement, timers) a été retiré avec ses tests :
 * ces concepts n'existent plus côté backend (migration 124). La liste
 * partageable ne porte que trois statuts (open/closed/cancelled),
 * transmis tels quels, sans projection front.
 *
 * Seule fonction restante : r() (arrondi tolérant), utilisée ailleurs
 * dans le module shared-cart front pour normaliser quantités/prix.
 */

const { r } = require('../../js/group/group-helpers.js');

describe('r (arrondi tolérant)', () => {
  it('arrondit un nombre', () => {
    expect(r(4.4)).toBe(4);
    expect(r(4.5)).toBe(5);
  });
  it('tolère string numérique', () => {
    expect(r('12.6')).toBe(13);
  });
  it('retourne 0 pour null/undefined/NaN/chaîne invalide', () => {
    expect(r(null)).toBe(0);
    expect(r(undefined)).toBe(0);
    expect(r(NaN)).toBe(0);
    expect(r('abc')).toBe(0);
  });
});
