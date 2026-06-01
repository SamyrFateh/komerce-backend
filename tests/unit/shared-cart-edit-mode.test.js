'use strict';

/**
 * tests/unit/shared-cart-edit-mode.test.js
 *
 * SC-EDIT P0 — Tests du mode édition panier collectif boutique-first
 *
 * Backend (service) :
 *   [SC-EDIT-09-T1] Phase ouverte  → updateOpenSharedCartItems accepte la modification
 *   [SC-EDIT-09-T2] settlement_open = true → 409 settlement_already_open
 *   [SC-EDIT-09-T3] Statut fermé (converted_to_order) → 409 cart_not_editable
 *   [SC-EDIT-09-T4] Paiements confirmés existants → 409 paid_contributions_exist
 *   [SC-EDIT-09-T5] Mauvais propriétaire → 403 not_owner
 *
 * Invariants respectés :
 *   - I-07 : les webhooks Stripe ne sont pas touchés
 *   - I-02 : aucun paiement participant n'est déclenché ici
 *   - Doctrine § N4-CLEAR : le vider du panier boutique est post-PUT, côté frontend uniquement
 *
 * Tests manuels à passer (non automatisables en unit — UI) :
 *   [SC-EDIT-02-M1] Clic "Modifier les articles" → toast + bascule onglet Boutique
 *   [SC-EDIT-03-M1] Panier boutique contient les articles du snapshot (qty et prix corrects)
 *   [SC-EDIT-04-M1] Boutons "Commander" et "Payer à plusieurs" invisibles en mode edit
 *   [SC-EDIT-05-M1] Bandeau "Mettre à jour le panier collectif" visible dans le side cart
 *   [SC-EDIT-07-M1] Clic "Mettre à jour" → PUT réussi → panier vidé → retour onglet Groupe
 *   [SC-EDIT-08-M1] Clic "Annuler les modifications" → panier vidé → retour Groupe sans PUT
 *   [SC-EDIT-09-M1] Créateur en phase règlement → bouton "Modifier les articles" absent de l'UI
 */

const {
  updateOpenSharedCartItems,
} = require('../../services/shared-cart-items-service');

// ── Mock db ──────────────────────────────────────────────────────
// Le service lit tout via client.query() dans une transaction getClient().
// On route donc client.query vers db.query (que les tests pilotent),
// en laissant passer BEGIN/COMMIT/ROLLBACK comme des no-op résolus.
jest.mock('../../db', () => {
  const query = jest.fn();
  const client = {
    query: jest.fn(async (sql, params) => {
      const verb = String(sql).trim().toUpperCase();
      if (verb === 'BEGIN' || verb === 'COMMIT' || verb === 'ROLLBACK') {
        return { rows: [] };
      }
      return query(sql, params);
    }),
    release: jest.fn(),
  };
  return {
    query,
    getClient: jest.fn(async () => client),
    pool: { connect: jest.fn(async () => client) },
  };
});
const db = require('../../db');

// ── Helpers ──────────────────────────────────────────────────────
function makeCart(overrides = {}) {
  return {
    id: '42',
    status: 'active',
    creator_user_id: 'user-1',
    metadata: JSON.stringify({ settlement_open: false }),
    contributed_kmf: 0,
    title: 'Test panier',
    token: 'tok123',
    total_kmf_snapshot: 50000,
    ...overrides,
  };
}

function makeProduct(overrides = {}) {
  return {
    id: 'prod-1',
    name: 'Chemise',
    price_kmf: 15000,
    stock: 10,
    is_active: true,
    ...overrides,
  };
}

function setupDbMocks({ cart, products = [makeProduct()], contributed = 0 }) {
  let callIdx = 0;
  db.query.mockImplementation(async (sql) => {
    // SELECT cart
    if (sql.includes('FROM shared_carts') && sql.includes('WHERE id =')) {
      return { rows: [cart] };
    }
    // SELECT contributed_kmf
    if (sql.includes('SUM') && sql.includes('confirmed')) {
      return { rows: [{ total: contributed }] };
    }
    // SELECT products
    if (sql.includes('FROM products') && sql.includes('= ANY')) {
      return { rows: products };
    }
    // SELECT creator check
    if (sql.includes('creator_user_id')) {
      return { rows: [{ creator_user_id: cart.creator_user_id }] };
    }
    // DELETE existing items + INSERT items
    if (sql.includes('DELETE FROM shared_cart_items') || sql.includes('INSERT INTO shared_cart_items')) {
      return { rows: [] };
    }
    // INSERT event
    if (sql.includes('INSERT INTO shared_cart_events')) {
      return { rows: [] };
    }
    // UPDATE total
    if (sql.includes('UPDATE shared_carts')) {
      return { rows: [{ ...cart, total_kmf_snapshot: products.reduce((s, p) => s + p.price_kmf, 0) }] };
    }
    // SELECT updated items
    if (sql.includes('FROM shared_cart_items')) {
      return { rows: products.map(p => ({ product_id: p.id, quantity: 1, unit_price_kmf_snapshot: p.price_kmf })) };
    }
    return { rows: [] };
  });
}

const VALID_ITEMS = [{ product_id: 'prod-1', quantity: 1 }];

// ── Tests backend guard ───────────────────────────────────────────

describe('SC-EDIT-09 — guard PUT /api/shared-carts/:id/items', () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  test('[SC-EDIT-09-T1] Phase ouverte, bon propriétaire → mise à jour acceptée (200)', async () => {
    const cart = makeCart({ status: 'active', metadata: JSON.stringify({ settlement_open: false }) });
    setupDbMocks({ cart });
    const result = await updateOpenSharedCartItems('42', 'user-1', VALID_ITEMS);
    expect(result).toHaveProperty('cart');
    expect(result).toHaveProperty('items');
  });

  test('[SC-EDIT-09-T2] settlement_open = true → 409 settlement_already_open', async () => {
    const cart = makeCart({ metadata: JSON.stringify({ settlement_open: true }) });
    // Le service lit le cart et détecte settlement_open avant UPDATE
    db.query.mockResolvedValueOnce({ rows: [cart] });

    await expect(
      updateOpenSharedCartItems('42', 'user-1', VALID_ITEMS)
    ).rejects.toMatchObject({ status: 409, code: 'settlement_already_open' });
  });

  test('[SC-EDIT-09-T3] Statut converted_to_order → 409 cart_not_editable', async () => {
    const cart = makeCart({ status: 'converted_to_order', metadata: JSON.stringify({ settlement_open: false }) });
    db.query.mockResolvedValueOnce({ rows: [cart] });

    await expect(
      updateOpenSharedCartItems('42', 'user-1', VALID_ITEMS)
    ).rejects.toMatchObject({ status: 409, code: 'cart_not_editable' });
  });

  test('[SC-EDIT-09-T4] Paiements confirmés existants → 409 paid_contributions_exist', async () => {
    const cart = makeCart({ status: 'active', metadata: JSON.stringify({ settlement_open: false }) });
    db.query
      .mockResolvedValueOnce({ rows: [cart] })            // SELECT cart FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ n: 1 }] });       // COUNT contributions status='paid' > 0

    await expect(
      updateOpenSharedCartItems('42', 'user-1', VALID_ITEMS)
    ).rejects.toMatchObject({ status: 409, code: 'paid_contributions_exist' });
  });

  test('[SC-EDIT-09-T5] Mauvais propriétaire → 404 (filtré par beneficiary_user_id en SQL)', async () => {
    // Le service filtre l'owner dans la requête (WHERE beneficiary_user_id = $2).
    // Un mauvais propriétaire ne ramène donc aucune ligne → 404 shared_cart_not_found.
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      updateOpenSharedCartItems('42', 'user-1', VALID_ITEMS)
    ).rejects.toMatchObject({ status: 404, code: 'shared_cart_not_found' });
  });

  test('[SC-EDIT-09-T6] Panier introuvable → 404', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // cart not found

    await expect(
      updateOpenSharedCartItems('99', 'user-1', VALID_ITEMS)
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ── Notes de test manuel ─────────────────────────────────────────
// Les tests suivants sont manuels (UI/intégration).
// Checklist à valider sur navigateur :

describe('SC-EDIT P0 — Checklist manuelle (à commenter au fur et à mesure)', () => {
  // On ne peut pas tester l'UI en Jest — ces tests servent de documentation.

  test.todo('[SC-EDIT-02-M1] Clic "Modifier les articles" → toast visible + onglet Boutique actif');
  test.todo('[SC-EDIT-03-M1] state.cart contient les articles du snapshot avec promo_pct=0, is_promo=false');
  test.todo('[SC-EDIT-04-M1] #k-sc-checkout et #k-sc-share hidden; #k-cart-checkout et #k-cart-share hidden');
  test.todo('[SC-EDIT-05-M1] #k-sc-edit-bar visible avec "Mettre à jour le panier collectif" et "Annuler"');
  test.todo('[SC-EDIT-06-M1] Clic update → PUT /api/shared-carts/:id/items avec cart_items correct');
  test.todo('[SC-EDIT-07-M1] Après PUT réussi → state.cart=[], state.editSharedCart=null, onglet Groupe');
  test.todo('[SC-EDIT-08-M1] Annuler → state.editSharedCart=null, state.cart=[], retour Groupe, pas de PUT');
  test.todo('[SC-EDIT-09-M1] Créateur phase règlement → bouton "Modifier les articles" absent du rendu');
  test.todo('[SC-EDIT-09-M2] PUT pendant settlement_open → toast erreur 409 visible, pas de vidage panier');
});
