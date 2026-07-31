'use strict';

/**
 * tests/unit/shared-cart-lot9-business.test.js
 *
 * Brief BUSINESS + UX FIX PANIER PARTAGÉ V4 — LOT 9 (tests métier backend)
 * ═════════════════════════════════════════════════════════════════════════
 *
 *   ✅ [LOT9-T1] Finalisation directe interdite depuis phase ouverte
 *               (status=active, settlement_open absent, accept_partial=true)
 *               → erreur, aucune commande créée, panier non converti
 *   ([LOT9-T2] openSettlement — supprimé le 2026-07 avec shared-cart-v4-settlement.js,
 *    code mort jamais branché sur aucune route ; cf. migration 099)
 *   ✅ [LOT9-T3] Webhook Stripe, paiement partiel sur panier en règlement
 *               → contribution paid, cart.status = settlement_in_progress,
 *                 remaining_kmf correct
 *   ✅ [LOT9-T4] Webhook Stripe, dernier paiement
 *               → cart.status = ready_to_finalize, remaining_kmf = 0
 *   ✅ [LOT9-T5] Finalisation avec solde couvert par le créateur
 *               → commande créée, remaining_cash_kmf JAMAIS masqué :
 *                 orders.remaining_cash_kmf, event cart_converted_to_order,
 *                 retour de convertSharedCartToOrder, shared_carts.remaining_kmf
 *
 *   ([LOT9-T6] from-cart-items ne vide pas les baskets DB → couvert par
 *    [LOT2-T1] dans shared-cart-v4-2-creation.test.js)
 *
 * Strategy : mock db.getClient() via makeClient() du test-harness,
 * même convention que shared-cart-v4.test.js / shared-cart-financial-guard.test.js.
 */

const {
  makeClient,
  expectTransactionCommitted,
  expectTransactionRolledBack,
} = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => {
  const getClient = jest.fn();
  return {
    getClient,
    query: jest.fn(),
    // P5-N3 : primitive partagée, calquée sur l'implémentation réelle (db.js).
    withTransaction: async (callback) => {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
});
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../services/order-service', () => ({
  getUniqueRef: jest.fn().mockResolvedValue('KMR-TEST-0001'),
  generatePickupCode: jest.fn().mockReturnValue('123456'),
}));
jest.mock('../../services/routing', () => ({
  resolveRoutingFromRelais: jest.fn().mockReturnValue({
    destination_island: 'NGAZIDJA',
    routing_mode: 'direct',
    transit_hub: null,
  }),
  RoutingError: class RoutingError extends Error {},
}));
jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../../utils/rates', () => ({
  getRates: jest.fn().mockResolvedValue({ eur_kmf: 492 }),
}));
const db = require('../../db');
const engine = require('../../services/shared-cart-engine');
const { confirmContributionFromStripeSafely } = require('../../services/shared-cart-financial-guard');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeCart(overrides = {}) {
  return {
    id: 'cart-001',
    token: 'tok-abc',
    beneficiary_user_id: 'user-001',
    beneficiary_name_snapshot: 'Ali',
    beneficiary_phone_snapshot: '+2697001234',
    status: 'active',
    total_kmf_snapshot: 30000,
    contributed_kmf: 0,
    remaining_kmf: 30000,
    delivery_relay_id: 'relay-001',
    finalized_order_id: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    metadata: {},
    ...overrides,
  };
}

function makeContribution(overrides = {}) {
  return {
    id: 'contrib-001',
    shared_cart_id: 'cart-001',
    stripe_session_id: 'cs_test_001',
    commitment_id: null,
    status: 'pending',
    amount_kmf: 10000,
    amount_paid: 20,
    currency_paid: 'EUR',
    ...overrides,
  };
}

const SESSION_PAID = {
  id: 'cs_test_001',
  payment_status: 'paid',
  payment_intent: 'pi_test_001',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// [LOT9-T1] Finalisation directe interdite depuis phase ouverte
// ═════════════════════════════════════════════════════════════════════════════

describe('[LOT9-T1] convertSharedCartToOrder — finalisation directe interdite', () => {
  test('active + settlement_open absent + accept_partial=true → erreur, aucune commande', async () => {
    const cart = makeCart({ status: 'active', metadata: {} });
    const client = makeClient([
      { rows: [cart] }, // SELECT shared_carts FOR UPDATE
    ]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(
      engine.convertSharedCartToOrder('cart-001', 'user-001', { creatorCoversGap: true })
    ).rejects.toThrow(/passer au paiement/);

    expectTransactionRolledBack(client);

    // Aucune commande créée, aucun panier converti
    const writes = client.calls.filter(c => /^\s*(INSERT|UPDATE)\s/i.test(String(c.sql)));
    expect(writes.length).toBe(0);
  });

  test('active + metadata.settlement_open=false → erreur identique', async () => {
    const cart = makeCart({ status: 'active', metadata: { settlement_open: false } });
    const client = makeClient([{ rows: [cart] }]);
    db.getClient.mockResolvedValueOnce(client);

    await expect(
      engine.convertSharedCartToOrder('cart-001', 'user-001', {})
    ).rejects.toThrow(/passer au paiement/);

    expectTransactionRolledBack(client);
  });
});

// [LOT9-T2] openSettlement était testé ici — supprimé le 2026-07 avec
// services/shared-cart-v4-settlement.js (code mort, orphelin, jamais
// branché sur aucune route ; cf. migration 099 et
// docs/chantier/BACKEND_FIXES_REGISTER.md).

// ═════════════════════════════════════════════════════════════════════════════
// [LOT9-T3] Webhook Stripe — paiement partiel en règlement
// ═════════════════════════════════════════════════════════════════════════════

describe('[LOT9-T3] webhook Stripe — paiement partiel (flux v4)', () => {
  test('closed_for_settlement + paiement partiel → settlement_in_progress, remaining correct', async () => {
    const contribution = makeContribution({ amount_kmf: 10000 });
    const cart = makeCart({
      status: 'closed_for_settlement',
      total_kmf_snapshot: 30000,
      contributed_kmf: 0,
      remaining_kmf: 30000,
      metadata: { settlement_open: true },
    });

    const updatedContribution = { ...contribution, status: 'paid' };
    const updatedCart = {
      ...cart,
      contributed_kmf: 10000,
      remaining_kmf: 20000,
      status: 'settlement_in_progress',
    };

    const client = makeClient([
      { rows: [contribution] },        // SELECT contribution FOR UPDATE
      { rows: [cart] },                // SELECT cart FOR UPDATE
      { rows: [updatedContribution] }, // UPDATE contribution → paid
      { rows: [updatedCart] },         // UPDATE cart
      { rows: [] },                    // INSERT event contribution_paid
      { rows: [] },                    // INSERT event cart_partially_funded (branche else)
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);

    expect(result.contribution.status).toBe('paid');
    expect(result.cart.status).toBe('settlement_in_progress');
    expect(result.cart.remaining_kmf).toBe(20000);

    // Le statut envoyé à la DB doit être settlement_in_progress (pas partially_funded)
    const cartUpdate = client.calls.find(c =>
      String(c.sql).includes('UPDATE shared_carts') && String(c.sql).includes('contributed_kmf')
    );
    expect(cartUpdate.params).toContain('settlement_in_progress');
    expect(cartUpdate.params).toContain(20000);

    expectTransactionCommitted(client);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [LOT9-T4] Webhook Stripe — dernier paiement → ready_to_finalize
// ═════════════════════════════════════════════════════════════════════════════

describe('[LOT9-T4] webhook Stripe — paiement complet (flux v4)', () => {
  test('settlement_in_progress + dernier paiement → ready_to_finalize, remaining=0', async () => {
    const contribution = makeContribution({ amount_kmf: 20000 });
    const cart = makeCart({
      status: 'settlement_in_progress',
      total_kmf_snapshot: 30000,
      contributed_kmf: 10000,
      remaining_kmf: 20000,
      metadata: { settlement_open: true },
    });

    const updatedContribution = { ...contribution, status: 'paid' };
    const updatedCart = {
      ...cart,
      contributed_kmf: 30000,
      remaining_kmf: 0,
      status: 'ready_to_finalize',
    };

    const client = makeClient([
      { rows: [contribution] },
      { rows: [cart] },
      { rows: [updatedContribution] },
      { rows: [updatedCart] },
      { rows: [] }, // event contribution_paid
      { rows: [] }, // event cart_partially_funded (branche else, status non fully_funded)
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await confirmContributionFromStripeSafely(SESSION_PAID);

    expect(result.cart.status).toBe('ready_to_finalize');
    expect(result.cart.remaining_kmf).toBe(0);

    const cartUpdate = client.calls.find(c =>
      String(c.sql).includes('UPDATE shared_carts') && String(c.sql).includes('contributed_kmf')
    );
    expect(cartUpdate.params).toContain('ready_to_finalize');
    expect(cartUpdate.params).toContain(0);

    // Pas de retour aux statuts legacy dans le flux v4
    expect(cartUpdate.params).not.toContain('fully_funded');
    expect(cartUpdate.params).not.toContain('partially_funded');

    expectTransactionCommitted(client);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [LOT9-T5] Finalisation avec solde — remaining_cash_kmf jamais masqué
// ═════════════════════════════════════════════════════════════════════════════

describe('[LOT9-T5] convertSharedCartToOrder — solde restant fidèle', () => {
  test('settlement_in_progress + remaining 10000 + creatorCoversGap → vraie valeur partout', async () => {
    const REMAINING = 10000;
    const cart = makeCart({
      status: 'settlement_in_progress',
      total_kmf_snapshot: 30000,
      contributed_kmf: 20000,
      remaining_kmf: REMAINING,
      metadata: { settlement_open: true },
    });

    const item = {
      id: 'item-001',
      shared_cart_id: 'cart-001',
      product_id: 'prod-001',
      product_name_snapshot: 'Produit test',
      quantity: 2,
      unit_price_kmf_snapshot: 15000,
      line_total_kmf_snapshot: 30000,
    };
    const product = { id: 'prod-001', name: 'Produit test', stock: 10, is_active: true };
    const relais = { id: 'relay-001', is_active: true, island: 'NGAZIDJA' };
    const user = { id: 'user-001', full_name: 'Ali', phone: '+2697001234' };

    // L'INSERT orders renvoie la ligne avec le remaining réel passé en param
    const orderRow = (sql, params) => ({
      rows: [{
        id: params[0],
        reference: params[1],
        remaining_cash_kmf: params[11], // $12 = remainingCashKmf
        prepaid_amount_kmf: params[10],
      }],
    });

    const client = makeClient([
      { rows: [cart] },                       // 1. SELECT shared_carts FOR UPDATE
      { rows: [item] },                       // 2. SELECT shared_cart_items
      { rows: [product] },                    // 3. SELECT products FOR UPDATE
      { rows: [relais] },                     // 4. SELECT relais
      { rows: [user] },                       // 5. SELECT users
      { rows: [{ id: 'recipient-001' }] },    // 6. SELECT recipients (existant)
      orderRow,                               // 7. INSERT orders RETURNING
      { rows: [] },                           // 8. INSERT order_status_history
      { rows: [] },                           // 9. resolveFrozenClassification — customs_categories default (manquant → repli zéro, non-bloquant)
      { rows: [] },                           // 10. INSERT order_items (+ champs clf)
      // remaining > 0 → PAS de confirmPaymentCycle (cas B doctrine §5.7)
      { rows: [] },                           // 10. UPDATE shared_carts → converted_to_order
      { rows: [] },                           // 11. INSERT event cart_converted_to_order
      (sql, params) => ({                     // 12. SELECT orders WHERE id
        rows: [{
          id: params[0],
          reference: 'KMR-TEST-0001',
          remaining_cash_kmf: REMAINING,
          prepaid_amount_kmf: 20000,
        }],
      }),
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const result = await engine.convertSharedCartToOrder('cart-001', 'user-001', {
      creatorCoversGap: true,
    });

    // 1. Retour de la fonction (→ réponse API remaining_cash_kmf)
    expect(result.remainingCashKmf).toBe(REMAINING);
    expect(result.remainingCashKmf).not.toBe(0);

    // 2. La commande porte la vraie valeur
    expect(result.order.remaining_cash_kmf).toBe(REMAINING);

    // 3. L'INSERT orders a reçu la vraie valeur en paramètre
    const orderInsert = client.calls.find(c => String(c.sql).includes('INSERT INTO orders'));
    expect(orderInsert.params).toContain(REMAINING);

    // 4. L'event cart_converted_to_order contient la vraie valeur
    const eventInsert = client.calls.find(c =>
      String(c.sql).includes('shared_cart_events') &&
      JSON.stringify(c.params).includes('cart_converted_to_order')
    );
    expect(eventInsert).toBeDefined();
    expect(JSON.stringify(eventInsert.params)).toContain(`"remaining_cash_kmf":${REMAINING}`);

    // 5. Option A LOT 1.2 — shared_carts.remaining_kmf garde le solde visible
    const cartUpdate = client.calls.find(c =>
      String(c.sql).includes('UPDATE shared_carts') &&
      String(c.sql).includes("converted_to_order")
    );
    expect(cartUpdate).toBeDefined();
    expect(String(cartUpdate.sql)).toMatch(/remaining_kmf\s*=\s*\$3/);
    expect(cartUpdate.params).toContain(REMAINING);

    expectTransactionCommitted(client);
  });

  test('panier 100 % payé → remaining_cash_kmf = 0 légitime, cycle paiement déclenché', async () => {
    const cart = makeCart({
      status: 'ready_to_finalize',
      total_kmf_snapshot: 30000,
      contributed_kmf: 30000,
      remaining_kmf: 0,
      metadata: { settlement_open: true },
    });

    const item = {
      id: 'item-001', shared_cart_id: 'cart-001', product_id: 'prod-001',
      product_name_snapshot: 'Produit test', quantity: 1,
      unit_price_kmf_snapshot: 30000, line_total_kmf_snapshot: 30000,
    };

    const client = makeClient([
      { rows: [cart] },
      { rows: [item] },
      { rows: [{ id: 'prod-001', name: 'Produit test', stock: 10, is_active: true }] },
      { rows: [{ id: 'relay-001', is_active: true }] },
      { rows: [{ id: 'user-001', full_name: 'Ali', phone: '+2697001234' }] },
      { rows: [{ id: 'recipient-001' }] },
      (sql, params) => ({ rows: [{ id: params[0], reference: params[1], remaining_cash_kmf: params[11] }] }),
      { rows: [] }, // order_status_history
      { rows: [] }, // resolveFrozenClassification — customs_categories default
      { rows: [] }, // order_items (+ champs clf)
      { rows: [{}] }, // ensureSecretGenerated: SELECT pickup_secret_hash/last4 (aucun existant)
      { rows: [] }, // generateAndStoreSecret: SELECT id anti-collision (pas de doublon)
      { rows: [] }, // generateAndStoreSecret: UPDATE orders (stockage du secret)
      { rows: [] }, // UPDATE shared_carts converted
      { rows: [] }, // event
      (sql, params) => ({ rows: [{ id: params[0], reference: 'KMR-TEST-0001', remaining_cash_kmf: 0 }] }),
    ]);
    db.getClient.mockResolvedValueOnce(client);

    const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');

    const result = await engine.convertSharedCartToOrder('cart-001', 'user-001', {});

    expect(result.remainingCashKmf).toBe(0);
    expect(confirmPaymentCycle).toHaveBeenCalled(); // cas A : 100 % payé
    expectTransactionCommitted(client);
  });
});
