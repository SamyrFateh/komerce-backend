'use strict';

/**
 * Tests unitaires — shared-cart-queries.js (R6)
 *
 * Chemins couverts :
 *
 *   getFxKmfToEur           → retourne le taux DB ou le fallback (0.00203)
 *   isStripeEventProcessed  → true si ligne trouvée, false sinon
 *   markStripeEventProcessed→ INSERT idempotent (pas d'erreur même si doublon)
 *   getSharedCartByToken    → cart ou null
 *   invalidatePendingContributions → UPDATE contributions pending → cancelled
 *   getParticipantsWithEstimation → liste de phones distincts
 *   getEstimants            → liste { phone, name }
 *   getPaidContributors     → liste { phone, first_name }
 *   getCartForAwaitingChoice→ cart minimal ou null
 *   getCartByOwner          → cart ou null (filtre user_id)
 *   extendPaymentWindow     → cart mis à jour ou null si statut incompatible
 *   logEvent                → INSERT sans retour
 *   adminListCarts          → liste avec filtres optionnels
 *   adminGetCartDetail      → { cart, items, contributions, estimations, events } ou null
 *   adminExpireCart         → cart ou null si statut incompatible
 *   adminExtendCartDate     → cart ou null si non OPEN
 */

// ─── Mock db ──────────────────────────────────────────────────────────────────

let mockDbQuery = jest.fn();

jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

// ─── Require après mock ───────────────────────────────────────────────────────

const {
  getFxKmfToEur,
  isStripeEventProcessed,
  markStripeEventProcessed,
  getSharedCartByToken,
  invalidatePendingContributions,
  getParticipantsWithEstimation,
  getEstimants,
  getPaidContributors,
  getCartForAwaitingChoice,
  getCartByOwner,
  extendPaymentWindow,
  logEvent,
  adminListCarts,
  adminGetCartDetail,
  adminExpireCart,
  adminExtendCartDate,
} = require('../../services/shared-cart-queries');

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeDbQueue(responses) {
  const queue = [...responses];
  return jest.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('No db.query mock remaining');
    if (next.error) throw next.error;
    return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows?.length ?? 0) };
  });
}

beforeEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════════
//   getFxKmfToEur
// ═══════════════════════════════════════════════════════════════════════════════

describe('getFxKmfToEur', () => {
  test('taux présent en DB → retourne la valeur parsée', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ value: '0.00215' }] }]);
    const rate = await getFxKmfToEur();
    expect(rate).toBeCloseTo(0.00215);
  });

  test('aucune ligne en DB → retourne le fallback 0.00203', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    const rate = await getFxKmfToEur();
    expect(rate).toBe(0.00203);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   isStripeEventProcessed
// ═══════════════════════════════════════════════════════════════════════════════

describe('isStripeEventProcessed', () => {
  const event = { id: 'evt_abc123', type: 'checkout.session.completed' };

  test('ligne trouvée → true', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ id: 1 }] }]);
    expect(await isStripeEventProcessed(event)).toBe(true);
  });

  test('pas de ligne → false', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await isStripeEventProcessed(event)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   markStripeEventProcessed
// ═══════════════════════════════════════════════════════════════════════════════

describe('markStripeEventProcessed', () => {
  test('INSERT idempotent — ne throw pas', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    const event = { id: 'evt_abc123', type: 'checkout.session.completed' };
    await expect(markStripeEventProcessed(event, 'cart=42,amount=5000')).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   getSharedCartByToken
// ═══════════════════════════════════════════════════════════════════════════════

describe('getSharedCartByToken', () => {
  test('token existant → retourne le panier', async () => {
    const cart = { id: 42, token: 'tok_xyz', status: 'open' };
    mockDbQuery = makeDbQueue([{ rows: [cart] }]);
    expect(await getSharedCartByToken('tok_xyz')).toEqual(cart);
  });

  test('token inconnu → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await getSharedCartByToken('tok_inconnu')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   invalidatePendingContributions
// ═══════════════════════════════════════════════════════════════════════════════

describe('invalidatePendingContributions', () => {
  test('UPDATE contributions pending → ne throw pas', async () => {
    mockDbQuery = makeDbQueue([{ rows: [], rowCount: 2 }]);
    await expect(invalidatePendingContributions(42)).resolves.toBeUndefined();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   Participants / Estimants / Contributeurs
// ═══════════════════════════════════════════════════════════════════════════════

describe('getParticipantsWithEstimation', () => {
  test('retourne la liste des phones distincts', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ phone: '+269600001' }, { phone: '+269600002' }] }]);
    const result = await getParticipantsWithEstimation(42);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('phone');
  });

  test('pas de participant → []', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await getParticipantsWithEstimation(42)).toEqual([]);
  });
});

describe('getEstimants', () => {
  test('retourne { phone, name }', async () => {
    mockDbQuery = makeDbQueue([
      { rows: [{ phone: '+269600001', name: 'Fatima Ali' }] },
    ]);
    const result = await getEstimants(42);
    expect(result[0]).toMatchObject({ phone: '+269600001', name: 'Fatima Ali' });
  });
});

describe('getPaidContributors', () => {
  test('retourne { phone, first_name }', async () => {
    mockDbQuery = makeDbQueue([
      { rows: [{ phone: '+269600001', first_name: 'Fatima' }] },
    ]);
    const result = await getPaidContributors(42);
    expect(result[0]).toMatchObject({ phone: '+269600001', first_name: 'Fatima' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   getCartForAwaitingChoice
// ═══════════════════════════════════════════════════════════════════════════════

describe('getCartForAwaitingChoice', () => {
  test('cart existant → retourne les champs nécessaires', async () => {
    const cart = { id: 42, status: 'awaiting_choice', token: 'tok', title: 'Cadeau',
                   beneficiary_name_snapshot: 'Ali', total_kmf_snapshot: 25000,
                   remaining_kmf: 5000, beneficiary_user_id: 7 };
    mockDbQuery = makeDbQueue([{ rows: [cart] }]);
    expect(await getCartForAwaitingChoice(42)).toEqual(cart);
  });

  test('cart introuvable → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await getCartForAwaitingChoice(999)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   getCartByOwner
// ═══════════════════════════════════════════════════════════════════════════════

describe('getCartByOwner', () => {
  test('cart appartient a l\'utilisateur -> retourne le cart', async () => {
    const cart = { id: 42, beneficiary_user_id: 7 };
    mockDbQuery = makeDbQueue([{ rows: [cart] }]);
    expect(await getCartByOwner(42, 7)).toEqual(cart);
  });

  test('mauvais user_id → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await getCartByOwner(42, 999)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   extendPaymentWindow
// ═══════════════════════════════════════════════════════════════════════════════

describe('extendPaymentWindow', () => {
  test('panier CLOSED → retourne le cart mis à jour', async () => {
    const updatedCart = { id: 42, status: 'closed', payment_window_ends_at: new Date() };
    mockDbQuery = makeDbQueue([{ rows: [updatedCart] }]);
    const result = await extendPaymentWindow(42, 24);
    expect(result).toEqual(updatedCart);
  });

  test('panier pas CLOSED → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await extendPaymentWindow(42, 24)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   logEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe('logEvent', () => {
  test('INSERT sans retour — ne throw pas', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    await expect(logEvent(42, 'cart_closed', 'system', null, { reason: 'timeout' }))
      .resolves.toBeUndefined();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   adminListCarts
// ═══════════════════════════════════════════════════════════════════════════════

describe('adminListCarts', () => {
  test('sans filtre → retourne toutes les lignes', async () => {
    const carts = [{ id: 1 }, { id: 2 }];
    mockDbQuery = makeDbQueue([{ rows: carts }]);
    const result = await adminListCarts();
    expect(result).toHaveLength(2);
  });

  test('filtre status → query paramétrée', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ id: 3 }] }]);
    const result = await adminListCarts({ status: 'open' });
    expect(result).toHaveLength(1);
    // Vérifier que le paramètre 'open' a bien été passé
    const callArgs = mockDbQuery.mock.calls[0];
    expect(callArgs[1]).toContain('open');
  });

  test('filtre user_id → query paramétrée', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ id: 4 }] }]);
    await adminListCarts({ user_id: 7 });
    const callArgs = mockDbQuery.mock.calls[0];
    expect(callArgs[1]).toContain(7);
  });

  test('filtres combinés (status + user_id)', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    const result = await adminListCarts({ status: 'closed', user_id: 7 });
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   adminGetCartDetail
// ═══════════════════════════════════════════════════════════════════════════════

describe('adminGetCartDetail', () => {
  test('cart existant → { cart, items, contributions, estimations, events }', async () => {
    const cart = { id: 42, status: 'open' };
    // SELECT cart + 4 queries Promise.all
    mockDbQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [cart] })
      .mockResolvedValueOnce({ rows: [{ id: 'item1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'contrib1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'est1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'evt1' }] });

    const result = await adminGetCartDetail(42);
    expect(result.cart).toEqual(cart);
    expect(result.items).toHaveLength(1);
    expect(result.contributions).toHaveLength(1);
    expect(result.estimations).toHaveLength(1);
    expect(result.events).toHaveLength(1);
  });

  test('cart introuvable → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await adminGetCartDetail(999)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   adminExpireCart
// ═══════════════════════════════════════════════════════════════════════════════

describe('adminExpireCart', () => {
  test('panier open/closed/awaiting_choice → retourne le cart expired', async () => {
    const expired = { id: 42, status: 'expired' };
    mockDbQuery = makeDbQueue([{ rows: [expired] }]);
    const result = await adminExpireCart(42);
    expect(result).toEqual(expired);
  });

  test('panier already expired (statut incompatible) → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await adminExpireCart(42)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//   adminExtendCartDate
// ═══════════════════════════════════════════════════════════════════════════════

describe('adminExtendCartDate', () => {
  test('panier OPEN → retourne le cart mis à jour', async () => {
    const updated = { id: 42, status: 'open', target_date: '2026-07-01' };
    mockDbQuery = makeDbQueue([{ rows: [updated] }]);
    const result = await adminExtendCartDate(42, 7);
    expect(result).toEqual(updated);
  });

  test('panier non OPEN (ex: closed) → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await adminExtendCartDate(42, 7)).toBeNull();
  });
});
