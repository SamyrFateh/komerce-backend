'use strict';

/**
 * KOMERCE — Tests Lot 0 : projection métier & transitions V4.1
 * Verrouille la table de la doctrine. Toute évolution de la machine
 * d'état DOIT passer par une modification consciente de ce fichier.
 */

const T = require('../../services/shared-cart-v41-transitions');
const { BUSINESS } = T;

const cart = (status, metadata) => ({ status, metadata });

describe('businessStatusOf — projection enum SQL → état métier', () => {
  test.each([
    ['draft', BUSINESS.OPEN],
    ['active', BUSINESS.OPEN],
    ['commitment_open', BUSINESS.OPEN],
    ['partially_funded', BUSINESS.OPEN],
    ['closed_for_settlement', BUSINESS.CLOSED],
    ['settlement_in_progress', BUSINESS.CLOSED],
    ['awaiting_choice', BUSINESS.AWAITING_CHOICE],
    ['converted_to_order', BUSINESS.ORDERED],
    ['fully_funded', BUSINESS.ORDERED],
    ['ready_to_finalize', BUSINESS.ORDERED],
    ['cancelled', BUSINESS.CANCELLED],
    ['refunded', BUSINESS.CANCELLED],
    ['expired', BUSINESS.EXPIRED],
    ['archived', BUSINESS.ARCHIVED],
  ])('%s → %s', (sql, business) => {
    expect(T.businessStatusOf(cart(sql))).toBe(business);
  });

  test('metadata.settlement_open=true projette CLOSED (compat transitionnelle)', () => {
    expect(T.businessStatusOf(cart('active', { settlement_open: true }))).toBe(BUSINESS.CLOSED);
    expect(T.businessStatusOf(cart('partially_funded', JSON.stringify({ settlement_open: true })))).toBe(BUSINESS.CLOSED);
  });

  test('les terminaux priment sur metadata.settlement_open', () => {
    expect(T.businessStatusOf(cart('cancelled', { settlement_open: true }))).toBe(BUSINESS.CANCELLED);
    expect(T.businessStatusOf(cart('converted_to_order', { settlement_open: true }))).toBe(BUSINESS.ORDERED);
  });

  test('statut inconnu → échec bruyant, jamais un état par défaut', () => {
    expect(() => T.businessStatusOf(cart('banana'))).toThrow(/inconnu/);
  });

  test('expired et archived ne sont jamais visibles', () => {
    expect(T.isVisibleStatus(BUSINESS.EXPIRED)).toBe(false);
    expect(T.isVisibleStatus(BUSINESS.ARCHIVED)).toBe(false);
    expect(T.isVisibleStatus(BUSINESS.OPEN)).toBe(true);
  });
});

describe('Table des transitions — diagramme de la doctrine, rien de plus', () => {
  const ALLOWED = [
    [BUSINESS.OPEN, BUSINESS.CLOSED],
    [BUSINESS.OPEN, BUSINESS.CANCELLED],
    [BUSINESS.CLOSED, BUSINESS.ORDERED],
    [BUSINESS.CLOSED, BUSINESS.AWAITING_CHOICE],
    [BUSINESS.CLOSED, BUSINESS.CANCELLED],
    [BUSINESS.AWAITING_CHOICE, BUSINESS.ORDERED],
    [BUSINESS.AWAITING_CHOICE, BUSINESS.CLOSED],
    [BUSINESS.AWAITING_CHOICE, BUSINESS.CANCELLED],
    [BUSINESS.AWAITING_CHOICE, BUSINESS.EXPIRED],
    [BUSINESS.EXPIRED, BUSINESS.ARCHIVED],
  ];

  test.each(ALLOWED)('autorisée : %s → %s', (from, to) => {
    expect(T.canTransition(from, to)).toBe(true);
    expect(() => T.assertTransition(from, to)).not.toThrow();
  });

  test('toute paire hors doctrine est interdite — exhaustif', () => {
    const all = Object.values(BUSINESS);
    const allowedSet = new Set(ALLOWED.map(([f, t]) => `${f}>${t}`));
    for (const from of all) {
      for (const to of all) {
        const expected = allowedSet.has(`${from}>${to}`);
        expect(T.canTransition(from, to)).toBe(expected);
      }
    }
  });

  test('OPEN ne peut jamais sauter directement à ORDERED ni à AWAITING_CHOICE', () => {
    expect(() => T.assertTransition(BUSINESS.OPEN, BUSINESS.ORDERED)).toThrow(/interdite/);
    expect(() => T.assertTransition(BUSINESS.OPEN, BUSINESS.AWAITING_CHOICE)).toThrow(/interdite/);
  });

  test('un panier fermé ne redevient jamais OPEN (doctrine : un panier fermé ne peut plus évoluer)', () => {
    expect(T.canTransition(BUSINESS.CLOSED, BUSINESS.OPEN)).toBe(false);
    expect(T.canTransition(BUSINESS.AWAITING_CHOICE, BUSINESS.OPEN)).toBe(false);
  });

  test("l'erreur de transition porte un code et un statut HTTP 409", () => {
    try {
      T.assertTransition(BUSINESS.ORDERED, BUSINESS.OPEN);
      throw new Error('aurait dû lever');
    } catch (e) {
      expect(e.code).toBe('INVALID_SHARED_CART_TRANSITION');
      expect(e.status).toBe(409);
    }
  });
});

describe('Fenêtre de paiement — défaut 48 h, presets fermés, prolongation unique', () => {
  const closedAt = new Date('2026-06-20T12:00:00Z');

  test('défaut : 48 h', () => {
    expect(T.paymentWindowHoursOf(cart('active'))).toBe(48);
    expect(T.computePaymentWindowEnd(closedAt, cart('active')).toISOString())
      .toBe('2026-06-22T12:00:00.000Z');
  });

  test('preset valide en metadata : respecté', () => {
    const c = cart('active', { payment_window_hours: 96 });
    expect(T.paymentWindowHoursOf(c)).toBe(96);
    expect(T.computePaymentWindowEnd(closedAt, c).toISOString())
      .toBe('2026-06-24T12:00:00.000Z');
  });

  test('valeur hors presets (saisie libre, 0, négatif, texte) : retombe sur 48 h', () => {
    for (const bad of [12, 50, 0, -48, 'demain', null, 10000]) {
      expect(T.paymentWindowHoursOf(cart('active', { payment_window_hours: bad }))).toBe(48);
    }
  });

  test('prolongation : une seule, +48 h, uniquement pendant CLOSED', () => {
    const closed = cart('closed_for_settlement');
    expect(T.canExtendWindow(closed)).toBe(true);

    const extended = cart('closed_for_settlement', { payment_window_extensions: 1 });
    expect(T.canExtendWindow(extended)).toBe(false);
    expect(T.computePaymentWindowEnd(closedAt, extended).toISOString())
      .toBe('2026-06-24T12:00:00.000Z');

    expect(T.canExtendWindow(cart('active'))).toBe(false);
    expect(T.canExtendWindow(cart('awaiting_choice'))).toBe(false);
  });

  test('délai AWAITING_CHOICE : 72 h (doctrine)', () => {
    expect(T.AWAITING_CHOICE_HOURS).toBe(72);
  });

  test('closedAt invalide : échec bruyant', () => {
    expect(() => T.computePaymentWindowEnd('pas-une-date', cart('active'))).toThrow(/invalide/);
  });
});

describe('Feature flag', () => {
  const saved = process.env.SHARED_CART_V41;
  afterAll(() => { process.env.SHARED_CART_V41 = saved; });

  test('inactif par défaut, actif avec SHARED_CART_V41=1', () => {
    delete process.env.SHARED_CART_V41;
    expect(T.isV41Enabled()).toBe(false);
    process.env.SHARED_CART_V41 = '1';
    expect(T.isV41Enabled()).toBe(true);
  });
});
