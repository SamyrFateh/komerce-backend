'use strict';

/**
 * tests/unit/shared-cart-v4-2-creation.test.js
 *
 * Doctrine v4.2 — N4-SNAPSHOT / N4-CLEAR
 *
 * createSharedCartFromCartItems :
 *   ✅ [N4-SNAP-T1] Snapshot sauvegardé avant vidage — clearLocalCart: true dans le retour
 *   ✅ [N4-SNAP-T2] Échec snapshot (INSERT shared_cart_items) → ROLLBACK, basket intact
 *   ✅ [N4-CLEAR-T1] Après création réussie → basket_items supprimés, event creator_basket_cleared logué
 *   ✅ [N4-CLEAR-T2] Aucun basket actif → clearCreatorBasketInTx retourne 0, pas d'event basket_cleared
 *
 * clearCreatorBasketInTx (helper isolé) :
 *   ✅ [N4-CLEAR-T3] Ne touche pas les baskets gift (type='gift')
 *   ✅ [N4-CLEAR-T4] Ne touche pas les baskets is_locked=TRUE
 *   ✅ [N4-CLEAR-T5] Sans baskets actifs → retourne 0 sans appel DELETE
 *
 * Strategy : mock db.getClient() (withTransaction) + db.query
 * Séquence createSharedCartFromCartItems :
 *   BEGIN
 *   → SELECT COUNT active carts     (limite paniers)
 *   → SELECT products               (vérif prix DB)
 *   → SELECT user                   (bénéficiaire)
 *   → SELECT token collision ×1     (generateToken)
 *   → INSERT shared_carts           (création cart)
 *   → INSERT shared_cart_items ×N   (snapshot items)
 *   → INSERT shared_cart_events     (audit created)
 *   → SELECT baskets                (clearCreatorBasketInTx)
 *   → DELETE basket_items           (clearCreatorBasketInTx — si baskets trouvés)
 *   → UPDATE baskets updated_at     (clearCreatorBasketInTx — si baskets trouvés)
 *   → INSERT shared_cart_events     (audit creator_basket_cleared — si items supprimés)
 *   COMMIT
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
// Mocks des dépendances du engine non utilisées dans ces tests
jest.mock('../../services/order-service', () => ({
  getUniqueRef: jest.fn(), generatePickupCode: jest.fn(),
}));
jest.mock('../../services/routing', () => ({
  resolveRoutingFromRelais: jest.fn(), RoutingError: class RoutingError extends Error {},
}));
jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn(),
}));
jest.mock('../../utils/rates', () => ({ getRates: jest.fn() }));

const db = require('../../db');
const { createSharedCartFromCartItems, clearCreatorBasketInTx } = require('../../services/shared-cart-engine');

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CART_ITEMS = [{ product_id: 'prod-001', quantity: 2 }];
const USER_ID = 'user-abc';

function makeProduct(overrides = {}) {
  return {
    id: 'prod-001',
    name: 'Riz parfumé 5kg',
    image_url: '/img/riz.jpg',
    category: 'Alimentation',
    price_kmf: 5000,
    promo_pct: 0,
    is_promo: false,
    promo_until: null,
    is_active: true,
    ...overrides,
  };
}

function makeSharedCart(overrides = {}) {
  return {
    id: 'sc-001',
    token: 'AbCd1234EfGh5678',
    beneficiary_user_id: USER_ID,
    total_kmf_snapshot: 10000,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    status: 'active',
    ...overrides,
  };
}

function makeSharedCartItem() {
  return {
    id: 'sci-001',
    shared_cart_id: 'sc-001',
    product_id: 'prod-001',
    quantity: 2,
    unit_price_kmf_snapshot: 5000,
    line_total_kmf_snapshot: 10000,
  };
}

/**
 * Monte db.getClient pour withTransaction.
 * responses = liste ordonnée des valeurs retournées par client.query().
 * Une entrée Error → throw.
 */
function mockWithTransaction(responses) {
  let idx = 0;
  const queries = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql: sql.trim().slice(0, 60), params });
      const r = responses[idx++];
      if (r instanceof Error) throw r;
      return r ?? { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValue(client);
  return { client, queries };
}

/**
 * Séquence standard complète pour une création réussie avec 1 item et 1 basket à vider.
 */
function standardSuccessResponses() {
  return [
    // BEGIN
    { rows: [] },
    // SELECT COUNT active carts → 0
    { rows: [{ n: 0 }] },
    // SELECT products
    { rows: [makeProduct()] },
    // SELECT user
    { rows: [{ full_name: 'Fatima Ali', phone: '+2697001234' }] },
    // SELECT token collision → pas de collision
    { rows: [] },
    // INSERT shared_carts
    { rows: [makeSharedCart()] },
    // INSERT shared_cart_items (1 item)
    { rows: [makeSharedCartItem()] },
    // INSERT shared_cart_events (shared_cart_created)
    { rows: [] },
    // SELECT baskets (clearCreatorBasketInTx) → 1 basket trouvé
    { rows: [{ id: 'basket-001' }] },
    // DELETE basket_items
    { rows: [], rowCount: 3 },
    // UPDATE baskets updated_at
    { rows: [] },
    // INSERT shared_cart_events (creator_basket_cleared)
    { rows: [] },
    // COMMIT
    { rows: [] },
  ];
}

/**
 * Séquence sans basket actif à vider.
 */
function successNoBasketResponses() {
  return [
    { rows: [] },                          // BEGIN
    { rows: [{ n: 0 }] },                  // SELECT COUNT active carts
    { rows: [makeProduct()] },             // SELECT products
    { rows: [{ full_name: 'Ali', phone: '+2697001234' }] }, // SELECT user
    { rows: [] },                          // SELECT token collision
    { rows: [makeSharedCart()] },          // INSERT shared_carts
    { rows: [makeSharedCartItem()] },      // INSERT shared_cart_items
    { rows: [] },                          // INSERT events created
    { rows: [] },                          // SELECT baskets → aucun
    { rows: [] },                          // COMMIT
  ];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createSharedCartFromCartItems — Doctrine v4.2', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // [N4-SNAP-T1] Le retour contient clearLocalCart: true
  test('[N4-SNAP-T1] clearLocalCart: true présent dans le retour après création réussie', async () => {
    mockWithTransaction(standardSuccessResponses());

    const result = await createSharedCartFromCartItems(USER_ID, VALID_CART_ITEMS, {});

    expect(result.clearLocalCart).toBe(true);
    expect(result.sharedCart).toBeDefined();
    expect(result.token).toBeDefined();
    expect(result.items).toHaveLength(1);
  });

  // [N4-SNAP-T2] Échec INSERT shared_cart_items → ROLLBACK, pas de vidage basket
  test('[N4-SNAP-T2] Échec snapshot items → ROLLBACK → basket non vidé', async () => {
    const { client } = mockWithTransaction([
      { rows: [] },                          // BEGIN
      { rows: [{ n: 0 }] },                  // SELECT COUNT
      { rows: [makeProduct()] },             // SELECT products
      { rows: [{ full_name: 'Ali', phone: '+2697001234' }] },
      { rows: [] },                          // token
      { rows: [makeSharedCart()] },          // INSERT shared_carts OK
      new Error('DB error: disk full'),      // INSERT shared_cart_items → FAIL
    ]);

    await expect(
      createSharedCartFromCartItems(USER_ID, VALID_CART_ITEMS, {})
    ).rejects.toThrow('DB error: disk full');

    // ROLLBACK doit avoir été appelé
    const rollbackCall = client.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.toUpperCase().includes('ROLLBACK')
    );
    expect(rollbackCall).toBeDefined();

    // Aucun DELETE basket_items ne doit avoir été appelé
    const deleteCall = client.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.toUpperCase().includes('DELETE FROM BASKET_ITEMS')
    );
    expect(deleteCall).toBeUndefined();
  });

  // [N4-CLEAR-T1 → LOT 2] Le flux from-cart-items ne vide AUCUN basket DB.
  // Le panier vient du localStorage mobile : seul le signal clearLocalCart: true
  // est renvoyé au front. (Test 9.6 du brief BUSINESS+UX V4.)
  test('[LOT2-T1] from-cart-items ne vide pas les baskets DB, clearLocalCart=true', async () => {
    const { client } = mockWithTransaction(standardSuccessResponses());

    const result = await createSharedCartFromCartItems(USER_ID, VALID_CART_ITEMS, {});

    expect(result.clearLocalCart).toBe(true);

    const queries = client.query.mock.calls.map(([sql]) =>
      typeof sql === 'string' ? sql.trim() : ''
    );

    // Aucun DELETE basket_items ne doit apparaître dans ce flux
    expect(queries.some(q => q.toUpperCase().includes('DELETE FROM BASKET_ITEMS'))).toBe(false);

    // Aucun event creator_basket_cleared ne doit être inséré
    const eventInserts = client.query.mock.calls.filter(([sql, params]) =>
      typeof sql === 'string' &&
      sql.includes('shared_cart_events') &&
      Array.isArray(params) &&
      params.includes('creator_basket_cleared')
    );
    expect(eventInserts.length).toBe(0);
  });

  // [N4-CLEAR-T2] Aucun basket actif → pas de DELETE, pas d'event basket_cleared
  test('[N4-CLEAR-T2] Aucun basket actif → 0 suppression, pas d\'event basket_cleared', async () => {
    const { client } = mockWithTransaction(successNoBasketResponses());

    const result = await createSharedCartFromCartItems(USER_ID, VALID_CART_ITEMS, {});

    expect(result.clearLocalCart).toBe(true);

    const deleteCall = client.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.toUpperCase().includes('DELETE FROM BASKET_ITEMS')
    );
    expect(deleteCall).toBeUndefined();

    const basketClearedEvent = client.query.mock.calls.find(([sql, params]) =>
      typeof sql === 'string' &&
      sql.includes('shared_cart_events') &&
      Array.isArray(params) &&
      params.includes('creator_basket_cleared')
    );
    expect(basketClearedEvent).toBeUndefined();
  });

});

// ── Tests helper clearCreatorBasketInTx isolé ────────────────────────────────

describe('clearCreatorBasketInTx — helper isolé', () => {

  function mockClient(responses) {
    let idx = 0;
    return {
      query: jest.fn(async () => {
        const r = responses[idx++];
        if (r instanceof Error) throw r;
        return r ?? { rows: [], rowCount: 0 };
      }),
    };
  }

  // [N4-CLEAR-T3] Ne touche pas les baskets gift — filtrés par WHERE type != 'gift'
  // (testé via le SQL émis : le WHERE doit contenir type != 'gift')
  test('[N4-CLEAR-T3] La requête SELECT exclut les baskets de type gift', async () => {
    const client = mockClient([
      { rows: [] },  // SELECT baskets → aucun (on vérifie juste le SQL)
    ]);

    await clearCreatorBasketInTx(client, USER_ID);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/type\s*!=\s*'gift'/);
    expect(params).toContain(USER_ID);
  });

  // [N4-CLEAR-T4] La requête exclut les baskets verrouillés
  test('[N4-CLEAR-T4] La requête SELECT exclut les baskets is_locked = TRUE', async () => {
    const client = mockClient([{ rows: [] }]);

    await clearCreatorBasketInTx(client, USER_ID);

    const [sql] = client.query.mock.calls[0];
    expect(sql).toMatch(/is_locked\s*=\s*FALSE/);
  });

  // [N4-CLEAR-T5] Sans baskets → retourne 0 sans DELETE
  test('[N4-CLEAR-T5] Aucun basket actif → retourne 0, aucun DELETE', async () => {
    const client = mockClient([{ rows: [] }]);

    const result = await clearCreatorBasketInTx(client, USER_ID);

    expect(result).toBe(0);
    expect(client.query).toHaveBeenCalledTimes(1); // uniquement le SELECT
  });

  // Cas nominal : 2 baskets trouvés → DELETE + UPDATE + retourne rowCount
  test('[N4-CLEAR] 2 baskets actifs → DELETE + UPDATE, retourne rowCount', async () => {
    const client = mockClient([
      { rows: [{ id: 'b-001' }, { id: 'b-002' }] },  // SELECT baskets
      { rows: [], rowCount: 5 },                       // DELETE basket_items
      { rows: [] },                                    // UPDATE updated_at
    ]);

    const result = await clearCreatorBasketInTx(client, USER_ID);

    expect(result).toBe(5);

    const [deleteSql, deleteParams] = client.query.mock.calls[1];
    expect(deleteSql.toUpperCase()).toContain('DELETE FROM BASKET_ITEMS');
    expect(deleteParams[0]).toEqual(['b-001', 'b-002']);
  });

});
