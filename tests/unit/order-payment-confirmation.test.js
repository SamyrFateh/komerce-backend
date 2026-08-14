'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/order-payment-confirmation.test.js
 * Couvre services/order-payment-confirmation.js
 *
 * ⚠️ FINANCIER — point d'entrée unique paiement → stock (pending→confirmed→ordered
 * + décrémentage stock FOR UPDATE). Une couverture complémentaire existe déjà
 * dans confirm-payment-cycle.test.js (FRESH-102) ; ce fichier suit la convention
 * de nommage exigée par le lot 4 et ajoute des cas non couverts ailleurs :
 * notes par défaut selon la source, alerte sur confirmed→ordered KO, items
 * multiples, variante introuvable, actor par défaut.
 *
 * Tester erreurs EN PREMIER.
 */

jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../db', () => ({ query: jest.fn() }));
const mockGetOrCreateInvoice = jest.fn().mockResolvedValue({ id: 'invoice-1' });
jest.mock('../../services/invoice-service', () => ({
  getOrCreateInvoice: (...args) => mockGetOrCreateInvoice(...args),
}));

const { transitionOrderStatus } = require('../../services/order-status-machine');
const db = require('../../db');
const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');

function makeDbClient(responses = []) {
  let i = 0;
  return {
    query: jest.fn(async () => {
      const resp = responses[i++];
      if (resp === undefined) return { rows: [] };
      if (resp instanceof Error) throw resp;
      return resp;
    }),
  };
}

function ok(extra = {}) {
  return { success: true, noop: false, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  transitionOrderStatus.mockResolvedValue(ok());
  db.query.mockResolvedValue({ rows: [] });
  mockGetOrCreateInvoice.mockResolvedValue({ id: 'invoice-1' });
});

describe('confirmPaymentCycle — gardes d\'entrée', () => {
  it('refuse si dbClient absent', async () => {
    await expect(confirmPaymentCycle({ orderId: 'o1', actor: { id: 'u1', role: 'admin' }, source: 'cash_confirm' }))
      .rejects.toThrow('[confirmPaymentCycle] dbClient requis — le service doit opérer dans une transaction active');
  });

  it('refuse si orderId absent', async () => {
    const dbClient = makeDbClient();
    await expect(confirmPaymentCycle({ actor: { id: 'u1', role: 'admin' }, source: 'cash_confirm', dbClient }))
      .rejects.toThrow('[confirmPaymentCycle] orderId requis');
  });
});

describe('confirmPaymentCycle — note par défaut selon la source', () => {
  it('source=stripe_webhook sans note → "Paiement Stripe reçu"', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([{ rows: [] }]);
    await confirmPaymentCycle({ orderId: 'o1', actor: { id: 'u1', role: 'system' }, source: 'stripe_webhook', dbClient });
    expect(transitionOrderStatus).toHaveBeenNthCalledWith(1, expect.objectContaining({ note: 'Paiement Stripe reçu' }));
  });

  it('source=cash_confirm sans note → "Paiement espèces confirmé par agent relais"', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([{ rows: [] }]);
    await confirmPaymentCycle({ orderId: 'o1', actor: { id: 'u1', role: 'agent' }, source: 'cash_confirm', dbClient });
    expect(transitionOrderStatus).toHaveBeenNthCalledWith(1, expect.objectContaining({ note: 'Paiement espèces confirmé par agent relais' }));
  });

  it('note explicite fournie → prioritaire sur le défaut', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([{ rows: [] }]);
    await confirmPaymentCycle({ orderId: 'o1', actor: { id: 'u1', role: 'agent' }, source: 'cash_confirm', dbClient, note: 'Note custom' });
    expect(transitionOrderStatus).toHaveBeenNthCalledWith(1, expect.objectContaining({ note: 'Note custom' }));
  });

  it('actor absent → fallback { id: null, role: "system" }', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([{ rows: [] }]);
    await confirmPaymentCycle({ orderId: 'o1', source: 'cash_confirm', dbClient });
    expect(transitionOrderStatus).toHaveBeenNthCalledWith(1, expect.objectContaining({ actor: { id: null, role: 'system' } }));
  });
});

describe('confirmPaymentCycle — idempotence (noop)', () => {
  it('confirmed→pending noop → retourne immédiatement, pas de requête stock', async () => {
    transitionOrderStatus.mockResolvedValueOnce({ success: true, noop: true });
    const dbClient = makeDbClient();
    const result = await confirmPaymentCycle({ orderId: 'o1', actor: { id: 'u1', role: 'agent' }, source: 'cash_confirm', dbClient });
    expect(result).toEqual({ success: true, noop: true, stockBlocked: false, insufficientItems: [] });
    expect(dbClient.query).not.toHaveBeenCalled();
    expect(transitionOrderStatus).toHaveBeenCalledTimes(1); // étape "ordered" jamais atteinte
  });
});

describe('confirmPaymentCycle — échec transition confirmed', () => {
  it('pending→confirmed échoue → success:false, error propagée, pas de requête stock', async () => {
    transitionOrderStatus.mockResolvedValueOnce({ success: false, noop: false, error: 'commande déjà annulée' });
    const dbClient = makeDbClient();
    const result = await confirmPaymentCycle({ orderId: 'o1', actor: { id: 'u1', role: 'agent' }, source: 'cash_confirm', dbClient });
    expect(result).toEqual({ success: false, noop: false, stockBlocked: false, insufficientItems: [], error: 'commande déjà annulée' });
    expect(dbClient.query).not.toHaveBeenCalled();
  });
});

describe('confirmPaymentCycle — confirmed→ordered non-fatal', () => {
  it('ordered échoue (non-noop) → continue, insère une alerte opérationnelle, stock décrémenté', async () => {
    transitionOrderStatus
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce({ success: false, noop: false, error: 'sourcing indisponible' });

    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p1', quantity: 1, variant_combo: null, stock: 5, has_variants: false, product_name: 'Produit C' }] },
      { rows: [] },
    ]);

    const result = await confirmPaymentCycle({ orderId: 'o7', actor: { id: 'u1', role: 'agent' }, source: 'cash_confirm', dbClient });

    expect(result.success).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO alerts'),
      [
        'payment_cycle_confirmed_to_ordered_rejected',
        'order',
        'o7',
        'medium',
        'confirmed→ordered rejeté — order o7',
        'error=sourcing indisponible',
      ]
    );
  });

  it('ordered noop (déjà ordered) → pas d\'alerte insérée', async () => {
    transitionOrderStatus
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce({ success: false, noop: true });

    const dbClient = makeDbClient([{ rows: [] }]);
    await confirmPaymentCycle({ orderId: 'o8', actor: { id: 'u1', role: 'agent' }, source: 'cash_confirm', dbClient });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('échec de l\'INSERT alerte → n\'interrompt pas le flux (catch silencieux)', async () => {
    transitionOrderStatus
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce({ success: false, noop: false, error: 'sourcing indisponible' });
    db.query.mockRejectedValue(new Error('alerts table down'));

    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p1', quantity: 1, variant_combo: null, stock: 5, has_variants: false, product_name: 'Produit C' }] },
      { rows: [] },
    ]);

    const result = await confirmPaymentCycle({ orderId: 'o9', actor: { id: 'u1', role: 'agent' }, source: 'cash_confirm', dbClient });
    expect(result.success).toBe(true);
  });
});

describe('confirmPaymentCycle — vérification stock (FOR UPDATE)', () => {
  it('aucun item avec stock géré → success, pas de décrémentation', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([{ rows: [] }]);
    const result = await confirmPaymentCycle({ orderId: 'o2', actor: { id: 'u1', role: 'system' }, source: 'stripe_webhook', dbClient });
    expect(result).toEqual({ success: true, noop: false, stockBlocked: false, insufficientItems: [] });
  });

  it('plusieurs items, tous suffisants → tous décrémentés', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([
      {
        rows: [
          { product_id: 'p1', quantity: 2, variant_combo: null, stock: 10, has_variants: false, product_name: 'A' },
          { product_id: 'p2', quantity: 1, variant_combo: null, stock: 3, has_variants: false, product_name: 'B' },
        ],
      },
      { rows: [] }, // UPDATE p1
      { rows: [] }, // UPDATE p2
    ]);

    const result = await confirmPaymentCycle({ orderId: 'o3', actor: { id: 'u1', role: 'system' }, source: 'stripe_webhook', dbClient });
    expect(result.success).toBe(true);
    expect(result.stockBlocked).toBe(false);
    const updateCalls = dbClient.query.mock.calls.filter(([sql]) => sql.includes('UPDATE products'));
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][1]).toEqual([2, 'p1']);
    expect(updateCalls[1][1]).toEqual([1, 'p2']);
  });

  it('stock global insuffisant → stockBlocked:true, insufficientItems peuplé, pas de décrémentation', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p1', quantity: 5, variant_combo: null, stock: 1, has_variants: false, product_name: 'Produit B' }] },
    ]);

    const result = await confirmPaymentCycle({ orderId: 'o5', actor: { id: 'u1', role: 'agent' }, source: 'cash_confirm', dbClient });
    expect(result.stockBlocked).toBe(true);
    expect(result.insufficientItems).toEqual([{ product_id: 'p1', product_name: 'Produit B', available: 1, needed: 5 }]);
    const updateCall = dbClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE products'));
    expect(updateCall).toBeUndefined();
  });

  it('stock variante insuffisant (produit avec has_variants) → stockBlocked:true, nom enrichi', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p2', quantity: 3, variant_combo: { taille: 'M' }, stock: 10, has_variants: true, product_name: 'T-shirt' }] },
      { rows: [{ id: 'v1', stock: 1 }] },
    ]);

    const result = await confirmPaymentCycle({ orderId: 'o6', actor: { id: 'u1', role: 'system' }, source: 'stripe_webhook', dbClient });
    expect(result.stockBlocked).toBe(true);
    expect(result.insufficientItems[0]).toEqual({
      product_id: 'p2', product_name: 'T-shirt (taille: M)', available: 1, needed: 3,
    });
  });

  it('variante stock NULL (non géré) → ne bloque pas même si quantité demandée', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p2', quantity: 3, variant_combo: { taille: 'M' }, stock: 10, has_variants: true, product_name: 'T-shirt' }] },
      { rows: [{ id: 'v1', stock: null }] },
      { rows: [] }, // UPDATE products
      { rows: [] }, // UPDATE product_variants (stock IS NOT NULL → no-op but query still runs)
    ]);

    const result = await confirmPaymentCycle({ orderId: 'o10', actor: { id: 'u1', role: 'system' }, source: 'stripe_webhook', dbClient });
    expect(result.stockBlocked).toBe(false);
  });

  it('variante introuvable en DB → warn et continue sans bloquer', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p2', quantity: 3, variant_combo: { taille: 'M' }, stock: 10, has_variants: true, product_name: 'T-shirt' }] },
      { rows: [] }, // variante introuvable
      { rows: [] }, // UPDATE products
    ]);

    const result = await confirmPaymentCycle({ orderId: 'o11', actor: { id: 'u1', role: 'system' }, source: 'stripe_webhook', dbClient });
    expect(result.stockBlocked).toBe(false);
    expect(result.insufficientItems).toEqual([]);
  });

  it('mix : un item global insuffisant + un item variante insuffisant → les deux dans insufficientItems', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([
      {
        rows: [
          { product_id: 'p1', quantity: 5, variant_combo: null, stock: 1, has_variants: false, product_name: 'Produit B' },
          { product_id: 'p2', quantity: 3, variant_combo: { taille: 'M' }, stock: 10, has_variants: true, product_name: 'T-shirt' },
        ],
      },
      { rows: [{ id: 'v1', stock: 0 }] },
    ]);

    const result = await confirmPaymentCycle({ orderId: 'o12', actor: { id: 'u1', role: 'system' }, source: 'stripe_webhook', dbClient });
    expect(result.stockBlocked).toBe(true);
    expect(result.insufficientItems).toHaveLength(2);
  });

  it('décrémentation : variante décrémentée après le produit global, conditions WHERE correctes', async () => {
    transitionOrderStatus.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    const dbClient = makeDbClient([
      { rows: [{ product_id: 'p2', quantity: 2, variant_combo: { taille: 'L' }, stock: 10, has_variants: true, product_name: 'T-shirt' }] },
      { rows: [{ id: 'v1', stock: 5 }] },
      { rows: [] }, // UPDATE products
      { rows: [] }, // UPDATE product_variants
    ]);

    await confirmPaymentCycle({ orderId: 'o13', actor: { id: 'u1', role: 'system' }, source: 'stripe_webhook', dbClient });
    const calls = dbClient.query.mock.calls;
    const productUpdate = calls.find(([sql]) => sql.includes('UPDATE products SET stock'));
    const variantUpdate = calls.find(([sql]) => sql.includes('UPDATE product_variants'));
    expect(productUpdate[1]).toEqual([2, 'p2']);
    expect(variantUpdate[1]).toEqual([2, 'p2', 'taille', 'L']);
  });
});
