'use strict';

/**
 * tests/unit/shared-cart-lifecycle.test.js
 *
 * Couvre cancelSharedCart + expireOldCarts — A-BE-09 (2026-05-26)
 *
 * cancelSharedCart :
 *   ✅ Panier introuvable/non autorisé       → throw 'Panier introuvable ou non autorisé'
 *   ✅ Panier au statut cancelled            → throw (statut inéligible)
 *   ✅ Panier au statut expired              → throw (statut inéligible)
 *   ✅ Panier active                         → statut → cancelled, event cart_cancelled
 *   ✅ Panier partially_funded               → statut → cancelled, event cart_cancelled
 *   ✅ Panier fully_funded                   → statut → cancelled, event cart_cancelled
 *   ✅ Raison passée → payload.reason non null
 *   ✅ Raison null → payload.reason null
 *
 * expireOldCarts :
 *   ✅ Aucun panier expiré                   → retourne 0, zéro INSERT event
 *   ✅ 2 paniers expirés                     → UPDATE + 2 INSERT events, retourne 2
 *
 * Strategy: mock db.getClient() (withTransaction) + db.query (expireOldCarts).
 * withTransaction émet BEGIN + COMMIT : les queryResponses en tiennent compte.
 * Séquence cancelSharedCart : [BEGIN, SELECT, UPDATE, addEvent INSERT, COMMIT]
 */

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
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../services/whatsapp-meta', () => ({
  sendTemplateWhatsApp: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/order-service', () => ({
  getUniqueRef: jest.fn().mockResolvedValue('KMC-0001'),
  generatePickupCode: jest.fn().mockReturnValue('PICKUP123'),
}));
jest.mock('../../services/routing', () => {
  class RoutingError extends Error {}
  return {
    resolveRoutingFromRelais: jest.fn().mockReturnValue({
      destination_island: 'Ngazidja', routing_mode: 'direct', transit_hub: null,
    }),
    RoutingError,
  };
});
jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../../utils/rates', () => ({
  getRates: jest.fn().mockResolvedValue({ eur_kmf: 492 }),
}));
jest.mock('../../services/customs-classification', () => ({
  resolveFrozenClassification: jest.fn().mockResolvedValue({
    customs_category_key: 'general', sh_code: '0000.00', douane_pct: 10, tva_pct: 5, taxe_add_pct: 0, classification_defaulted: false,
  }),
}));

const db = require('../../db');
const { cancelSharedCart, expireOldCarts } = require('../../services/shared-cart-engine');
const {
  closeCart,
  convertSharedCartToOrder,
  runSharedCartStateMachineTick,
} = require('../../services/shared-cart-lifecycle');
const { sendTemplateWhatsApp } = require('../../services/whatsapp-meta');
const { resolveRoutingFromRelais, RoutingError } = require('../../services/routing');
const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCart(overrides = {}) {
  return {
    id: 'cart-001',
    beneficiary_user_id: 'user-001',
    status: 'open',
    contributed_kmf: 15000,
    ...overrides,
  };
}

/**
 * Monte db.getClient pour withTransaction.
 * responses = liste ordonnée des valeurs retournées par client.query().
 * Séquence standard : [BEGIN, SELECT, UPDATE, INSERT-event, COMMIT]
 */
function mockWithTransaction(responses) {
  const calls = [];
  let idx = 0;
  const client = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      const r = responses[idx++];
      if (r instanceof Error) throw r;
      return r ?? { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
    _calls: calls,
  };
  db.getClient.mockResolvedValue(client);
  return client;
}

const OK = { rows: [], rowCount: 1 };

// ── cancelSharedCart ─────────────────────────────────────────────────────────

describe('cancelSharedCart', () => {
  beforeEach(() => jest.clearAllMocks());

  test('panier introuvable → throw', async () => {
    // BEGIN, SELECT (vide), ROLLBACK
    mockWithTransaction([OK, { rows: [] }]);

    await expect(cancelSharedCart('cart-999', 'user-001', null))
      .rejects.toThrow('Panier introuvable ou non autorisé');
  });

  test('panier au statut cancelled → throw statut inéligible', async () => {
    const cart = makeCart({ status: 'cancelled' });
    // BEGIN, SELECT, ROLLBACK
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(cancelSharedCart('cart-001', 'user-001', null))
      .rejects.toThrow(/Impossible d'annuler un panier au statut cancelled/);
  });

  test('panier au statut expired → throw statut inéligible', async () => {
    const cart = makeCart({ status: 'expired' });
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(cancelSharedCart('cart-001', 'user-001', null))
      .rejects.toThrow(/Impossible d'annuler un panier au statut expired/);
  });

  test('panier active → cancelled + event cart_cancelled', async () => {
    const cart = makeCart({ status: 'open' });
    const client = mockWithTransaction([
      OK,          // BEGIN
      { rows: [cart] },  // SELECT FOR UPDATE
      OK,          // UPDATE shared_carts
      OK,          // INSERT shared_cart_events (addEvent)
      OK,          // COMMIT
    ]);

    const result = await cancelSharedCart('cart-001', 'user-001', null);

    expect(result).toMatchObject({ id: 'cart-001', status: 'open' });

    // call[2] = UPDATE
    const updateCall = client._calls[2];
    expect(updateCall.sql).toMatch(/UPDATE shared_carts/);
    expect(updateCall.sql).toMatch(/status = 'cancelled'/);

    // call[3] = addEvent INSERT ($2 = eventType, $5 = payload)
    const eventCall = client._calls[3];
    expect(eventCall.sql).toMatch(/INSERT INTO shared_cart_events/);
    expect(eventCall.params[1]).toBe('cart_cancelled');
  });

  test('panier partially_funded → cancelled, contributed_kmf dans payload', async () => {
    const cart = makeCart({ status: 'closed', contributed_kmf: 5000 });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', null);

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.contributed_kmf).toBe(5000);
  });

  test('panier fully_funded → cancelled', async () => {
    const cart = makeCart({ status: 'closed', contributed_kmf: 30000 });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', "acheteur a changé d'avis");

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.reason).toBe("acheteur a changé d'avis");
    expect(eventPayload.contributed_kmf).toBe(30000);
  });

  test('raison null → payload.reason null', async () => {
    const cart = makeCart({ status: 'open' });
    const client = mockWithTransaction([OK, { rows: [cart] }, OK, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', null);

    const eventPayload = client._calls[3].params[4];
    expect(eventPayload.reason).toBeNull();
  });
});

// ── expireOldCarts ───────────────────────────────────────────────────────────

describe('expireOldCarts — alias V4.1 vers runSharedCartStateMachineTick', () => {
  beforeEach(() => jest.clearAllMocks());

  test('aucune transition → retourne 0, aucun INSERT event', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const count = await expireOldCarts();

    expect(count).toBe(0);
    const sqls = db.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some(sql => /INSERT INTO shared_cart_events/.test(sql))).toBe(false);
    // Le tick couvre bien T1 (auto-close), T2 (awaiting), T4 (expired)
    expect(sqls.some(sql => /status = 'closed'/.test(sql))).toBe(true);
    expect(sqls.some(sql => /status = 'awaiting_choice'/.test(sql))).toBe(true);
    expect(sqls.some(sql => /status = 'expired'/.test(sql))).toBe(true);
  });

  test('2 paniers AWAITING_CHOICE dépassés → expired + INSERT event chacun', async () => {
    const expiredCarts = [
      { id: 'cart-exp-1', contributed_kmf: 10000 },
      { id: 'cart-exp-2', contributed_kmf: 0 },
    ];

    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/SET status = 'expired'/.test(text)) {
        return { rows: expiredCarts };
      }
      return { rows: [] };
    });

    const count = await expireOldCarts();
    expect(count).toBe(2);

    const eventCalls = db.query.mock.calls.filter(
      ([sql]) => /INSERT INTO shared_cart_events/.test(String(sql))
    );
    expect(eventCalls).toHaveLength(2);
    eventCalls.forEach(([sql, params]) => {
      expect(sql).toMatch(/cart_expired/);
      expect(['cart-exp-1', 'cart-exp-2']).toContain(params[0]);
    });
  });

  test('T1 — panier OPEN + target_date atteinte → CLOSED + event cart_auto_closed', async () => {
    const autoClosed = [{ id: 'cart-auto-1', contributed_kmf: 0 }];
    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/SET status = 'closed'/.test(text)) return { rows: autoClosed };
      return { rows: [] };
    });

    const count = await runSharedCartStateMachineTick();

    expect(count).toBe(1);
    const eventCalls = db.query.mock.calls.filter(([sql]) => /cart_auto_closed/.test(String(sql)));
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0][1]).toEqual(['cart-auto-1', { reason: 'target_date_reached' }]);
  });

  test('T2 — panier CLOSED + fenêtre expirée + remaining>0 → AWAITING_CHOICE + notif WhatsApp', async () => {
    const awaiting = [{
      id: 'cart-aw-1', remaining_kmf: 3000, contributed_kmf: 7000,
      title: 'Panier X', creator_phone: '+269123', creator_name: 'Ali',
    }];
    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/awaiting_choice_started_at/.test(text)) return { rows: awaiting };
      return { rows: [] };
    });

    const count = await runSharedCartStateMachineTick();

    expect(count).toBe(1);
    expect(sendTemplateWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+269123', templateName: 'shared_cart_awaiting_choice' })
    );
  });

  test('T2 — pas de notif WhatsApp si creator_phone absent', async () => {
    const awaiting = [{ id: 'cart-aw-2', remaining_kmf: 1000, contributed_kmf: 500, title: null, creator_phone: null, creator_name: null }];
    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/awaiting_choice_started_at/.test(text)) return { rows: awaiting };
      return { rows: [] };
    });

    await runSharedCartStateMachineTick();

    expect(sendTemplateWhatsApp).not.toHaveBeenCalled();
  });

  test('T2 — échec notif WhatsApp est avalé (non bloquant)', async () => {
    sendTemplateWhatsApp.mockRejectedValueOnce(new Error('whatsapp down'));
    const awaiting = [{ id: 'cart-aw-3', remaining_kmf: 1000, contributed_kmf: 500, title: 'X', creator_phone: '+269999', creator_name: 'Y' }];
    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/awaiting_choice_started_at/.test(text)) return { rows: awaiting };
      return { rows: [] };
    });

    await expect(runSharedCartStateMachineTick()).resolves.toBe(1);
  });

  test('T3 — panier CLOSED + remaining=0 → event cart_ready_to_order + notif', async () => {
    const ready = [{ id: 'cart-ready-1', contributed_kmf: 10000, title: 'Y', creator_phone: '+269555', creator_name: 'Fatima' }];
    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/sc.remaining_kmf = 0/.test(text)) return { rows: ready };
      return { rows: [] };
    });

    const count = await runSharedCartStateMachineTick();

    // T3 n'incremente pas `transitions` (evenement seul, pas de changement de statut ici)
    expect(count).toBe(0);
    const eventCalls = db.query.mock.calls.filter(([sql]) => /cart_ready_to_order/.test(String(sql)));
    expect(eventCalls).toHaveLength(1);
    expect(sendTemplateWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'shared_cart_ready_to_order' })
    );
  });

  test('T3 — échec notif WhatsApp est avalé (non bloquant)', async () => {
    sendTemplateWhatsApp.mockRejectedValueOnce(new Error('whatsapp down'));
    const ready = [{ id: 'cart-ready-2', contributed_kmf: 5000, title: 'Z', creator_phone: '+269777', creator_name: 'Omar' }];
    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/sc.remaining_kmf = 0/.test(text)) return { rows: ready };
      return { rows: [] };
    });

    await expect(runSharedCartStateMachineTick()).resolves.toBe(0);
  });

  test('T5 — paniers expired archivés après ARCHIVE_AFTER_DAYS', async () => {
    db.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/SET status = 'archived'/.test(text)) return { rows: [{ id: 'cart-arc-1' }, { id: 'cart-arc-2' }] };
      return { rows: [] };
    });

    const count = await runSharedCartStateMachineTick();

    expect(count).toBe(2);
  });
});

// ── closeCart ─────────────────────────────────────────────────────────────

describe('closeCart', () => {
  beforeEach(() => jest.clearAllMocks());

  test('panier introuvable/non autorisé → throw', async () => {
    mockWithTransaction([OK, { rows: [] }]);

    await expect(closeCart('cart-999', 'user-001')).rejects.toThrow('Panier introuvable ou non autorisé');
  });

  test('panier pas en statut open → throw', async () => {
    const cart = makeCart({ status: 'closed' });
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(closeCart('cart-001', 'user-001')).rejects.toThrow(/Impossible de fermer un panier au statut closed/);
  });

  test('ferme le panier open : statut closed + fenêtre 48h + event cart_closed', async () => {
    const cart = makeCart({ status: 'open' });
    const updated = { id: 'cart-001', status: 'closed', closed_at: '2026-07-01T00:00:00Z', payment_window_ends_at: '2026-07-03T00:00:00Z' };
    const client = mockWithTransaction([
      OK,               // BEGIN
      { rows: [cart] }, // SELECT FOR UPDATE
      { rows: [updated] }, // UPDATE
      OK,               // addEvent INSERT
      OK,               // COMMIT
    ]);

    const result = await closeCart('cart-001', 'user-001');

    expect(result).toBe(updated);
    expect(client._calls[2].sql).toMatch(/UPDATE shared_carts/);
    expect(client._calls[3].sql).toMatch(/INSERT INTO shared_cart_events/);
    expect(client._calls[3].params[1]).toBe('cart_closed');
  });
});

// ── convertSharedCartToOrder ─────────────────────────────────────────────

describe('convertSharedCartToOrder', () => {
  beforeEach(() => jest.clearAllMocks());
  sendTemplateWhatsApp.mockResolvedValue({});

  function makeFinalizableCart(overrides = {}) {
    return {
      id: 'cart-001',
      beneficiary_user_id: 'user-001',
      status: 'ready_to_finalize',
      finalized_order_id: null,
      remaining_kmf: 0,
      contributed_kmf: 20000,
      total_kmf_snapshot: 20000,
      delivery_relay_id: 'relais-1',
      beneficiary_name_snapshot: 'Snapshot Name',
      beneficiary_phone_snapshot: '+269000',
      ...overrides,
    };
  }

  const item1 = {
    product_id: 'p1', product_name_snapshot: 'Riz', product_category_snapshot: 'maison',
    quantity: 2, unit_price_kmf_snapshot: 1000,
  };

  test('panier introuvable/non autorisé → throw', async () => {
    mockWithTransaction([OK, { rows: [] }]);

    await expect(convertSharedCartToOrder('cart-999', 'user-001')).rejects.toThrow('Panier partagé introuvable ou non autorisé');
  });

  test('statut non finalisable → throw', async () => {
    const cart = makeFinalizableCart({ status: 'open' });
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow(/veuillez d'abord passer au paiement/);
  });

  test('déjà finalisé → throw', async () => {
    const cart = makeFinalizableCart({ finalized_order_id: 'order-existing' });
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('Ce panier est déjà finalisé');
  });

  test('reste à financer sans creatorCoversGap → throw', async () => {
    const cart = makeFinalizableCart({ remaining_kmf: 5000 });
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow(/Il reste 5000 KMF à financer/);
  });

  test('total panier invalide (<=0) → throw', async () => {
    const cart = makeFinalizableCart({ total_kmf_snapshot: 0 });
    mockWithTransaction([OK, { rows: [cart] }]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('Total panier invalide');
  });

  test('panier sans articles → throw', async () => {
    const cart = makeFinalizableCart();
    mockWithTransaction([OK, { rows: [cart] }, { rows: [] }]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('panier sans articles');
  });

  test('stock insuffisant sans acceptStockIssues → throw JSON stock_issues', async () => {
    const cart = makeFinalizableCart();
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },                                             // items
      { rows: [{ id: 'p1', name: 'Riz', stock: 1, is_active: true }] }, // products — stock 1 < quantite 2
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow(/stock_issues/);
  });

  test('produit inactif/manquant sans acceptStockIssues → throw', async () => {
    const cart = makeFinalizableCart();
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [] }, // aucun produit trouvé → inactif/manquant
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow(/stock_issues/);
  });

  test('pas de delivery_relay_id (ni cart ni options) → throw', async () => {
    const cart = makeFinalizableCart({ delivery_relay_id: null });
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('delivery_relay_id requis');
  });

  test('relais introuvable/inactif → throw', async () => {
    const cart = makeFinalizableCart();
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [] }, // relais not found
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('Relais introuvable ou inactif');
  });

  test('RoutingError → relance avec le message', async () => {
    resolveRoutingFromRelais.mockImplementationOnce(() => { throw new RoutingError('île inconnue'); });
    const cart = makeFinalizableCart();
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [{ id: 'relais-1', is_active: true }] },
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('île inconnue');
  });

  test('erreur non-RoutingError issue du routing → relancée telle quelle', async () => {
    resolveRoutingFromRelais.mockImplementationOnce(() => { throw new Error('boom inattendu'); });
    const cart = makeFinalizableCart();
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [{ id: 'relais-1', is_active: true }] },
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('boom inattendu');
  });

  test('utilisateur introuvable → throw', async () => {
    const cart = makeFinalizableCart();
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [{ id: 'relais-1', is_active: true }] },
      { rows: [] }, // user introuvable
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('Utilisateur introuvable');
  });

  test('happy path complet (100% financé) : order créé, panier ordered, event émis', async () => {
    const cart = makeFinalizableCart();
    const order = { id: 'order-1', reference: 'KMC-0001' };
    const client = mockWithTransaction([
      OK, { rows: [cart] },                                              // BEGIN, SELECT cart
      { rows: [item1] },                                                 // SELECT items
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] }, // SELECT products
      { rows: [{ id: 'relais-1', is_active: true }] },                   // SELECT relais
      { rows: [{ id: 'user-001', full_name: 'Ali', phone: '+269000' }] }, // SELECT user
      { rows: [] },                                                      // SELECT existingRecipient → aucun
      { rows: [{ id: 'recipient-1' }] },                                 // INSERT recipients
      { rows: [order] },                                                 // INSERT orders
      OK,                                                                // INSERT order_status_history
      OK,                                                                // INSERT order_items (item1)
      OK,                                                                // UPDATE shared_carts (ordered)
      OK,                                                                // addEvent cart_converted_to_order
      { rows: [order] },                                                 // SELECT finalOrder
      OK,                                                                // COMMIT
    ]);

    const result = await convertSharedCartToOrder('cart-001', 'user-001');

    expect(result.order).toBe(order);
    expect(result.sharedCart.status).toBe('ordered');
    expect(result.sharedCart.finalized_order_id).toBe('order-1');
    expect(confirmPaymentCycle).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'order-1' }));
    expect(client._calls[8].sql).toMatch(/INSERT INTO orders/);
  });

  test('recipient existant réutilisé (pas d\'INSERT recipients)', async () => {
    const cart = makeFinalizableCart();
    const order = { id: 'order-2', reference: 'KMC-0002' };
    const client = mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [{ id: 'relais-1', is_active: true }] },
      { rows: [{ id: 'user-001', full_name: 'Ali', phone: '+269000' }] },
      { rows: [{ id: 'recipient-existing' }] }, // existingRecipient trouvé
      { rows: [order] },                        // INSERT orders (pas d'INSERT recipients entre les deux)
      OK, OK, OK, OK, { rows: [order] }, OK,
    ]);

    await convertSharedCartToOrder('cart-001', 'user-001');

    const insertRecipientCalls = client._calls.filter(c => c.sql.includes('INSERT INTO recipients'));
    expect(insertRecipientCalls).toHaveLength(0);
  });

  test('creatorCoversGap avec reste>0 : pas de confirmPaymentCycle, remaining_cash_kmf > 0', async () => {
    const cart = makeFinalizableCart({ remaining_kmf: 4000, total_kmf_snapshot: 20000, contributed_kmf: 16000 });
    const order = { id: 'order-3', reference: 'KMC-0003' };
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [{ id: 'relais-1', is_active: true }] },
      { rows: [{ id: 'user-001', full_name: 'Ali', phone: '+269000' }] },
      { rows: [{ id: 'recipient-existing' }] },
      { rows: [order] },
      OK, OK, OK, OK, { rows: [order] }, OK,
    ]);

    const result = await convertSharedCartToOrder('cart-001', 'user-001', { creatorCoversGap: true });

    expect(result.remainingCashKmf).toBe(4000);
    expect(confirmPaymentCycle).not.toHaveBeenCalled();
  });

  test('confirmPaymentCycle échoue (success=false, noop=false) → throw', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({ success: false, error: 'paiement refusé' });
    const cart = makeFinalizableCart();
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [{ id: 'relais-1', is_active: true }] },
      { rows: [{ id: 'user-001', full_name: 'Ali', phone: '+269000' }] },
      { rows: [{ id: 'recipient-existing' }] },
      { rows: [{ id: 'order-4' }] },
      OK, OK, OK,
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow('paiement refusé');
  });

  test('confirmPaymentCycle stockBlocked → throw JSON stock_issues', async () => {
    confirmPaymentCycle.mockResolvedValueOnce({ success: true, stockBlocked: true, insufficientItems: [{ product_id: 'p1' }] });
    const cart = makeFinalizableCart();
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [{ id: 'relais-1', is_active: true }] },
      { rows: [{ id: 'user-001', full_name: 'Ali', phone: '+269000' }] },
      { rows: [{ id: 'recipient-existing' }] },
      { rows: [{ id: 'order-5' }] },
      OK, OK, OK,
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001')).rejects.toThrow(/stock_issues/);
  });

  test('pas de recipientPhone (user + snapshot sans téléphone) : aucune query recipients', async () => {
    const cart = makeFinalizableCart({ beneficiary_phone_snapshot: null });
    const order = { id: 'order-6' };
    const client = mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 10, is_active: true }] },
      { rows: [{ id: 'relais-1', is_active: true }] },
      { rows: [{ id: 'user-001', full_name: 'Ali', phone: null }] }, // pas de tel
      { rows: [order] }, // INSERT orders directement (pas de query recipients)
      OK, OK, OK, OK, { rows: [order] }, OK,
    ]);

    await convertSharedCartToOrder('cart-001', 'user-001');

    const recipientQueries = client._calls.filter(c => c.sql.includes('recipients'));
    expect(recipientQueries).toHaveLength(0);
  });

  test('stock issues acceptées via acceptStockIssues=true → finalise quand même', async () => {
    const cart = makeFinalizableCart();
    const order = { id: 'order-7' };
    mockWithTransaction([
      OK, { rows: [cart] },
      { rows: [item1] },
      { rows: [{ id: 'p1', name: 'Riz', stock: 0, is_active: true }] }, // stock insuffisant
      { rows: [{ id: 'relais-1', is_active: true }] },
      { rows: [{ id: 'user-001', full_name: 'Ali', phone: '+269000' }] },
      { rows: [{ id: 'recipient-existing' }] },
      { rows: [order] },
      OK, OK, OK, OK, { rows: [order] }, OK,
    ]);

    await expect(convertSharedCartToOrder('cart-001', 'user-001', { acceptStockIssues: true }))
      .resolves.toMatchObject({ order });
  });
});
