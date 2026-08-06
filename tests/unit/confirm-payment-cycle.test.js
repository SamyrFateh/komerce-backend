'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/confirm-payment-cycle.test.js
 *
 * Fix FRESH-102 — confirmPaymentCycle (services/order-payment-confirmation.js)
 * n'avait aucun test unitaire malgré 4 consommateurs critiques :
 *   • routes/payments.js   (webhook Stripe + cash confirm)
 *   • services/shared-cart-engine.js
 *   • services/confirm-pickup-cash-payment.js
 *
 * Stratégie : mock de transitionOrderStatus et du dbClient (pool simulé).
 * On ne touche pas à la DB — les tests restent rapides et déterministes.
 *
 * Couverture :
 *   ✓ Lève si dbClient absent
 *   ✓ Lève si orderId absent
 *   ✓ Retourne noop=true si la transition renvoie noop
 *   ✓ Retourne success=false si confirmed→pending échoue
 *   ✓ Chemin heureux : stock suffisant → décrémente, retourne success
 *   ✓ stockBlocked=true si stock insuffisant (produit simple)
 *   ✓ stockBlocked=true si stock variante insuffisant
 *   ✓ confirmed→ordered non-fatal (warn + continue)
 *   ✓ Produits sans stock (stock IS NULL) ignorés côté vérification
 */

jest.mock('../../services/order-status-machine');
jest.mock('../../utils/logger', () => ({
  child: () => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
// db.query utilisé pour l'alerte INSERT — on le mock silencieusement
jest.mock('../../db', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));

const { transitionOrderStatus } = require('../../services/order-status-machine');
const { confirmPaymentCycle }   = require('../../services/order-payment-confirmation');

// ── Helper : fabrique un dbClient mock ──────────────────────────────────────

function makeDbClient(queryResponses = []) {
  let callIndex = 0;
  return {
    query: jest.fn(async (sql) => {
      const resp = queryResponses[callIndex++];
      if (resp === undefined) return { rows: [] };
      if (resp instanceof Error) throw resp;
      return resp;
    }),
  };
}

// ── Setup par défaut de transitionOrderStatus ────────────────────────────────

function okTransition(extra = {}) {
  return { success: true, noop: false, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Par défaut : toutes les transitions réussissent
  transitionOrderStatus.mockResolvedValue(okTransition());
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Gardes d'entrée
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmPaymentCycle — gardes d\'entrée', () => {
  test('lève si dbClient est absent', async () => {
    await expect(
      confirmPaymentCycle({ orderId: 'ord-1', actor: {}, source: 'cash_confirm', dbClient: null })
    ).rejects.toThrow('dbClient requis');
  });

  test('lève si orderId est absent', async () => {
    const dbClient = makeDbClient();
    await expect(
      confirmPaymentCycle({ orderId: '', actor: {}, source: 'cash_confirm', dbClient })
    ).rejects.toThrow('orderId requis');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Idempotence — noop
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmPaymentCycle — idempotence', () => {
  test('retourne noop=true si confirmed→pending renvoie noop (déjà confirmé)', async () => {
    transitionOrderStatus.mockResolvedValueOnce({ success: true, noop: true });
    const dbClient = makeDbClient();

    const result = await confirmPaymentCycle({
      orderId: 'ord-1',
      actor: { id: 'u1', role: 'agent' },
      source: 'cash_confirm',
      dbClient,
    });

    expect(result).toEqual({ success: true, noop: true, stockBlocked: false, insufficientItems: [] });
    // Aucune requête DB directe ne doit avoir été émise (pas de SELECT stock)
    expect(dbClient.query).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Échec transition confirmed
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmPaymentCycle — échec transition confirmed', () => {
  test('retourne success=false si pending→confirmed échoue', async () => {
    transitionOrderStatus.mockResolvedValueOnce({
      success: false, noop: false, error: 'transition refusée'
    });
    const dbClient = makeDbClient();

    const result = await confirmPaymentCycle({
      orderId: 'ord-2',
      actor: { id: 'u1', role: 'agent' },
      source: 'stripe_webhook',
      dbClient,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('transition refusée');
    expect(dbClient.query).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Chemin heureux — stock suffisant
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmPaymentCycle — stock suffisant', () => {
  test('décrémente le stock et retourne success=true', async () => {
    // confirmed OK, ordered OK
    transitionOrderStatus
      .mockResolvedValueOnce(okTransition()) // confirmed
      .mockResolvedValueOnce(okTransition()); // ordered

    // SELECT order_items → 1 produit, stock=10, besoin=2
    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p1', quantity: 2, variant_combo: null, stock: 10, has_variants: false, product_name: 'Produit A' }] },
      { rows: [] }, // UPDATE products
    ]);

    const result = await confirmPaymentCycle({
      orderId: 'ord-3',
      actor: { id: 'u1', role: 'system' },
      source: 'stripe_webhook',
      dbClient,
    });

    expect(result).toEqual({ success: true, noop: false, stockBlocked: false, insufficientItems: [] });

    // La requête UPDATE stock doit avoir été appelée
    const updateCall = dbClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE products'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual([2, 'p1']); // quantity=2, product_id=p1
  });

  test('ignore les produits avec stock IS NULL (stock non géré)', async () => {
    transitionOrderStatus
      .mockResolvedValueOnce(okTransition())
      .mockResolvedValueOnce(okTransition());

    // stock IS NULL → la requête SQL les filtre, SELECT renvoie 0 lignes
    const dbClient = makeDbClient([{ rows: [] }]);

    const result = await confirmPaymentCycle({
      orderId: 'ord-4',
      actor: { id: null, role: 'system' },
      source: 'cash_confirm',
      dbClient,
    });

    expect(result.success).toBe(true);
    expect(result.stockBlocked).toBe(false);
    // Aucun UPDATE de stock ne doit avoir été émis (le SELECT ... FOR UPDATE OF p
    // est un verrou de ligne en lecture, pas une instruction UPDATE)
    const updateCall = dbClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE products'));
    expect(updateCall).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. stockBlocked — stock insuffisant
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmPaymentCycle — stockBlocked', () => {
  test('retourne stockBlocked=true si stock insuffisant (produit simple)', async () => {
    transitionOrderStatus
      .mockResolvedValueOnce(okTransition())
      .mockResolvedValueOnce(okTransition());

    // stock=1, besoin=5
    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p1', quantity: 5, variant_combo: null, stock: 1, has_variants: false, product_name: 'Produit B' }] },
    ]);

    const result = await confirmPaymentCycle({
      orderId: 'ord-5',
      actor: { id: 'u1', role: 'agent' },
      source: 'cash_confirm',
      dbClient,
    });

    expect(result.stockBlocked).toBe(true);
    expect(result.insufficientItems).toHaveLength(1);
    expect(result.insufficientItems[0]).toMatchObject({
      product_id: 'p1',
      available: 1,
      needed: 5,
    });
    // Aucun UPDATE de stock ne doit avoir été émis (on ne décrémente pas si bloqué ;
    // le SELECT ... FOR UPDATE est un verrou de ligne en lecture, pas une UPDATE)
    const updateCall = dbClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE products'));
    expect(updateCall).toBeUndefined();
  });

  test('retourne stockBlocked=true si stock variante insuffisant', async () => {
    transitionOrderStatus
      .mockResolvedValueOnce(okTransition())
      .mockResolvedValueOnce(okTransition());

    const dbClient = makeDbClient([
      // SELECT order_items : produit avec variant_combo + stock global OK
      {
        rows: [{
          product_id: 'p2', quantity: 3,
          variant_combo: { taille: 'M' },
          stock: 10, has_variants: true, product_name: 'T-shirt',
        }],
      },
      // SELECT product_variants FOR UPDATE : stock variante = 1 < 3
      { rows: [{ id: 'v1', stock: 1 }] },
    ]);

    const result = await confirmPaymentCycle({
      orderId: 'ord-6',
      actor: { id: 'u1', role: 'system' },
      source: 'stripe_webhook',
      dbClient,
    });

    expect(result.stockBlocked).toBe(true);
    expect(result.insufficientItems[0].product_name).toContain('taille: M');
    expect(result.insufficientItems[0].available).toBe(1);
    expect(result.insufficientItems[0].needed).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. confirmed→ordered non-fatal
// ─────────────────────────────────────────────────────────────────────────────

describe('confirmPaymentCycle — confirmed→ordered non-fatal', () => {
  test('continue et décrémente le stock même si confirmed→ordered échoue', async () => {
    transitionOrderStatus
      .mockResolvedValueOnce(okTransition())                           // confirmed → OK
      .mockResolvedValueOnce({ success: false, noop: false, error: 'statut invalide' }); // ordered → KO

    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p1', quantity: 1, variant_combo: null, stock: 5, has_variants: false, product_name: 'Produit C' }] },
      { rows: [] }, // UPDATE products
    ]);

    const result = await confirmPaymentCycle({
      orderId: 'ord-7',
      actor: { id: 'u1', role: 'agent' },
      source: 'cash_confirm',
      dbClient,
    });

    // Le service ne doit pas bloquer — confirmed + stock ok = succès opérationnel
    expect(result.success).toBe(true);
    expect(result.stockBlocked).toBe(false);
    const updateCall = dbClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE products'));
    expect(updateCall).toBeDefined();
  });
});
