'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn() }));

const db = require('../../db');

jest.mock('../../services/shared-cart-internals', () => {
  const actual = jest.requireActual('../../services/shared-cart-internals');
  return {
    ...actual,
    withTransaction: async (callback) => {
      const dbMod = require('../../db');
      const client = await dbMod.getClient();
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

const {
  updateOpenSharedCartItems,
  addSharedCartItem,
  removeSharedCartItem,
  updateSharedCartItemQuantity,
} = require('../../services/shared-cart-items-service');

describe('shared-cart-items-service (Boutique First, domaine minimal)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse cart_items vide avant transaction', async () => {
    await expect(updateOpenSharedCartItems('cart-1', 'user-1', [])).rejects.toMatchObject({
      code: 'cart_items_required', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('met à jour les items d\'un panier open, calcule le total, ne vérifie aucun paiement', async () => {
    const cart = { id: 'cart-1', status: 'open' };
    const product = { id: 'p1', name: 'Riz', image_url: 'riz.jpg', category: 'food', price_kmf: 1000, is_active: true, is_promo: false, promo_pct: 0, promo_until: null };
    const inserted = { id: 'item-1', product_id: 'p1', quantity: 3 };
    const updatedCart = { id: 'cart-1', status: 'open', updated_at: '2026-08-01' };
    const client = makeClient([
      { rows: [cart] },          // SELECT ... FOR UPDATE
      { rows: [] },               // mandat §7 : SELECT lignes claimed (aucune)
      { rows: [product] },       // SELECT products
      { rows: [], rowCount: 1 }, // DELETE shared_cart_items
      { rows: [inserted] },      // INSERT shared_cart_items
      { rows: [updatedCart] },   // UPDATE shared_carts RETURNING *
      { rows: [], rowCount: 1 }, // addEvent
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await updateOpenSharedCartItems('cart-1', 'user-1', [
      { product_id: 'p1', quantity: 1 }, { product_id: 'p1', quantity: 2 },
    ]);

    expect(result.cart.total_kmf).toBe(3000);
    expect(result.items).toEqual([inserted]);
    expect(client.calls.some(c => String(c.sql).includes('shared_cart_contributions'))).toBe(false);
    expectTransactionCommitted(client);
  });

  it('refuse si le panier n\'est plus open', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-1', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateOpenSharedCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'cart_not_editable', status: 409 });
    expectTransactionRolledBack(client);
  });

  it('panier introuvable ou non autorisé → 404', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateOpenSharedCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'shared_cart_not_found', status: 404 });
  });

  it('aucun produit actif valide → 400 no_active_items', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [] }, // mandat §7 : SELECT lignes claimed (aucune)
      { rows: [{ id: 'p1', name: 'X', price_kmf: 1000, is_active: false }] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(updateOpenSharedCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'no_active_items', status: 400 });
  });

  // GAP-07 §9.3 — remplacement intégral, unité vendable SKU-safe.
  describe('GAP-07 — unité vendable SKU', () => {
    const skuProduct = {
      id: 'p-sku', name: 'Chemise', image_url: 'chemise.jpg', category: 'vetements',
      price_kmf: 10000, is_active: true, is_promo: false, promo_pct: 0, promo_until: null,
      inventory_model: 'SKU', has_variants: true, stock: null,
    };

    it('resout le SKU actif et snapshot sku_id + variant_combo_snapshot (jamais product-first)', async () => {
      const cart = { id: 'cart-1', status: 'open' };
      const inserted = { id: 'item-1', product_id: 'p-sku' };
      const updatedCart = { id: 'cart-1', status: 'open' };
      const client = makeClient([
        { rows: [cart] },
        { rows: [] }, // mandat §7 : SELECT lignes claimed (aucune)
        { rows: [skuProduct] },       // resolveSellableUnit → SELECT products
        { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 5, price_kmf: 15000 }] }, // resolveActiveSku
        { rows: [] },                 // mandat §8/§9 : _resolveCanonicalImage (aucun média SKU → fallback products.image_url)
        { rows: [], rowCount: 1 },
        { rows: [inserted] },
        { rows: [updatedCart] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await updateOpenSharedCartItems('cart-1', 'user-1', [
        { product_id: 'p-sku', quantity: 1, variant_combo: { couleur: 'Noir', taille: 'M' } },
      ]);

      expect(result.cart.total_kmf).toBe(15000);
      const insertCall = client.calls.find(c => /INSERT INTO shared_cart_items/.test(c.sql));
      expect(insertCall.params[2]).toBe('sku-noir-m');
      expect(insertCall.params[3]).toBe(JSON.stringify({ couleur: 'Noir', taille: 'M' }));
      expect(insertCall.params[8]).toBe(15000); // unit_price_kmf_snapshot = prix SKU
    });

    // Mandat §8/§9 — c'est la valeur réelle de la boundary : un média SKU
    // canonique (product_sku_media → catalog_media) doit primer sur
    // products.image_url, que ce fichier ne snapshottait jamais avant ce lot.
    it('snapshot le média SKU canonique quand il existe, pas products.image_url', async () => {
      const cart = { id: 'cart-1', status: 'open' };
      const inserted = { id: 'item-1', product_id: 'p-sku' };
      const updatedCart = { id: 'cart-1', status: 'open' };
      const client = makeClient([
        { rows: [cart] },
        { rows: [] },
        { rows: [skuProduct] },
        { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 5, price_kmf: 15000 }] },
        { rows: [{ url: 'https://cdn.komerce.co/sku/sku-noir-m/canonical.jpg' }] }, // média SKU trouvé
        { rows: [], rowCount: 1 },
        { rows: [inserted] },
        { rows: [updatedCart] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      await updateOpenSharedCartItems('cart-1', 'user-1', [
        { product_id: 'p-sku', quantity: 1, variant_combo: { couleur: 'Noir', taille: 'M' } },
      ]);

      const insertCall = client.calls.find(c => /INSERT INTO shared_cart_items/.test(c.sql));
      expect(insertCall.params[5]).toBe('https://cdn.komerce.co/sku/sku-noir-m/canonical.jpg');
    });

    it('409 sellable_unit_not_found si la combinaison ne resout aucun SKU actif', async () => {
      const client = makeClient([
        { rows: [{ id: 'cart-1', status: 'open' }] },
        { rows: [] }, // mandat §7 : SELECT lignes claimed (aucune)
        { rows: [skuProduct] },
        { rows: [] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(updateOpenSharedCartItems('cart-1', 'user-1', [
        { product_id: 'p-sku', quantity: 1, variant_combo: { couleur: 'Rose' } },
      ])).rejects.toMatchObject({ status: 409, code: 'sellable_unit_not_found' });
      expectTransactionRolledBack(client);
    });

    it('409 sellable_unit_out_of_stock si le stock du SKU resolu est insuffisant', async () => {
      const client = makeClient([
        { rows: [{ id: 'cart-1', status: 'open' }] },
        { rows: [] }, // mandat §7 : SELECT lignes claimed (aucune)
        { rows: [skuProduct] },
        { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 1, price_kmf: 15000 }] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(updateOpenSharedCartItems('cart-1', 'user-1', [
        { product_id: 'p-sku', quantity: 5, variant_combo: { couleur: 'Noir', taille: 'M' } },
      ])).rejects.toMatchObject({ status: 409, code: 'sellable_unit_out_of_stock' });
      expectTransactionRolledBack(client);
    });
  });

  // Mandat §7 — PUT /:id/items ne doit jamais pouvoir détacher une ligne
  // déjà réclamée par une commande (order_items.shared_cart_item_id) via le
  // DELETE+INSERT du remplacement intégral. Régression : avant ce correctif,
  // aucune vérification n'existait ici (voir docstring en tête de fichier
  // source, ASSUMPTION désormais levée).
  describe('§7 — refus si la liste contient une ligne déjà réclamée (claimed)', () => {
    it('409 shared_cart_contains_claimed_items si au moins une ligne existante est claimed, avant toute lecture produit', async () => {
      const cart = { id: 'cart-1', status: 'open' };
      const client = makeClient([
        { rows: [cart] },        // SELECT ... FOR UPDATE
        { rows: [{ 1: 1 }] },    // SELECT claimed JOIN order_items -> au moins une ligne
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(updateOpenSharedCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
        .rejects.toMatchObject({ status: 409, code: 'shared_cart_contains_claimed_items' });

      // Jamais de DELETE ni de lecture produits une fois le refus posé.
      expect(client.calls.some(c => /DELETE FROM shared_cart_items/.test(c.sql))).toBe(false);
      expect(client.calls.some(c => /SELECT id, name, image_url/.test(c.sql))).toBe(false);
      expectTransactionRolledBack(client);
    });

    it('procède normalement si aucune ligne existante n\'est claimed (liste vide ou 100% disponible)', async () => {
      const cart = { id: 'cart-1', status: 'open' };
      const product = { id: 'p1', name: 'Riz', image_url: 'riz.jpg', category: 'food', price_kmf: 1000, is_active: true, is_promo: false, promo_pct: 0, promo_until: null };
      const inserted = { id: 'item-1', product_id: 'p1', quantity: 1 };
      const updatedCart = { id: 'cart-1', status: 'open' };
      const client = makeClient([
        { rows: [cart] },
        { rows: [] }, // aucune ligne claimed
        { rows: [product] },
        { rows: [], rowCount: 1 },
        { rows: [inserted] },
        { rows: [updatedCart] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await updateOpenSharedCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]);

      expect(result.items).toEqual([inserted]);
      expectTransactionCommitted(client);
    });
  });
});

describe('addSharedCartItem (Contrat API §2/§5 point 4 — ajout unitaire, immédiat)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse sans product_id, avant toute transaction', async () => {
    await expect(addSharedCartItem('cart-1', 'user-1', undefined)).rejects.toMatchObject({
      code: 'product_id_required', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une quantité invalide, avant toute transaction', async () => {
    await expect(addSharedCartItem('cart-1', 'user-1', 'p1', 0)).rejects.toMatchObject({
      code: 'invalid_quantity', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('panier introuvable ou non autorisé → 404', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(addSharedCartItem('cart-1', 'user-1', 'p1', 1)).rejects.toMatchObject({
      code: 'shared_cart_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('refuse si le panier n\'est plus open', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-1', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(addSharedCartItem('cart-1', 'user-1', 'p1', 1)).rejects.toMatchObject({
      code: 'cart_not_editable', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('produit introuvable ou inactif → 404 (mandat §8, aligné sur resolveSellableUnit)', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    // Mandat §8 — resolveSellableUnit() est désormais la boundary unique ;
    // son code product_not_found documenté est 404 (product-admin-service.js),
    // alignement volontaire remplaçant l'ancien statut ad hoc 400 de ce fichier.
    await expect(addSharedCartItem('cart-1', 'user-1', 'p1', 1)).rejects.toMatchObject({
      code: 'product_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('insère un article unique, applique la promo active, journalise l\'événement, commit', async () => {
    const cart = { id: 'cart-1', status: 'open' };
    const product = {
      id: 'p1', name: 'Riz', image_url: 'riz.jpg', category: 'food',
      price_kmf: 1000, is_active: true, is_promo: true, promo_pct: 10, promo_until: null,
    };
    const inserted = { id: 'item-1', product_id: 'p1', quantity: 2, unit_price_kmf_snapshot: 900 };
    const client = makeClient([
      { rows: [cart] },          // SELECT ... FOR UPDATE
      { rows: [product] },       // SELECT products
      { rows: [inserted] },      // INSERT shared_cart_items
      { rows: [], rowCount: 1 }, // UPDATE shared_carts
      { rows: [], rowCount: 1 }, // addEvent
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await addSharedCartItem('cart-1', 'user-1', 'p1', 2);

    expect(result.item).toEqual(inserted);
    expect(result.cart).toEqual(cart);
    expectTransactionCommitted(client);
  });

  // GAP-07 §9.2 — accepte la combinaison canonique, résolution serveur.
  describe('GAP-07 — unité vendable SKU', () => {
    const skuProduct = {
      id: 'p-sku', name: 'Chemise', image_url: 'chemise.jpg', category: 'vetements',
      price_kmf: 10000, is_active: true, is_promo: false, promo_pct: 0, promo_until: null,
      inventory_model: 'SKU', has_variants: true, stock: null,
    };

    it('resout le SKU et snapshot sku_id + variant_combo_snapshot — jamais un prix/sku_id fourni par le client', async () => {
      const cart = { id: 'cart-1', status: 'open' };
      const inserted = { id: 'item-1', product_id: 'p-sku' };
      const client = makeClient([
        { rows: [cart] },
        { rows: [skuProduct] },       // resolveSellableUnit → SELECT products
        { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 5, price_kmf: 15000 }] }, // resolveActiveSku
        { rows: [] },                 // mandat §8/§9 : _resolveCanonicalImage (aucun média SKU → fallback products.image_url)
        { rows: [inserted] },
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await addSharedCartItem(
        'cart-1', 'user-1', 'p-sku', 1, { couleur: 'Noir', taille: 'M' }
      );

      expect(result.item).toEqual(inserted);
      const insertCall = client.calls.find(c => /INSERT INTO shared_cart_items/.test(c.sql));
      expect(insertCall.params).toEqual([
        'cart-1', 'p-sku', 'sku-noir-m', JSON.stringify({ couleur: 'Noir', taille: 'M' }),
        'Chemise', 'chemise.jpg', 'vetements', 1, 15000, 15000,
      ]);
    });

    // Mandat §8/§9 — même garantie que côté updateOpenSharedCartItems : un
    // média SKU canonique doit être snapshoté ici, plus jamais products.image_url
    // en dur quand une image SKU explicite existe.
    it('snapshot le média SKU canonique quand il existe, pas products.image_url', async () => {
      const cart = { id: 'cart-1', status: 'open' };
      const inserted = { id: 'item-1', product_id: 'p-sku' };
      const client = makeClient([
        { rows: [cart] },
        { rows: [skuProduct] },
        { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 5, price_kmf: 15000 }] },
        { rows: [{ url: 'https://cdn.komerce.co/sku/sku-noir-m/canonical.jpg' }] }, // média SKU trouvé
        { rows: [inserted] },
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      await addSharedCartItem('cart-1', 'user-1', 'p-sku', 1, { couleur: 'Noir', taille: 'M' });

      const insertCall = client.calls.find(c => /INSERT INTO shared_cart_items/.test(c.sql));
      expect(insertCall.params[5]).toBe('https://cdn.komerce.co/sku/sku-noir-m/canonical.jpg');
    });

    it('409 sellable_unit_not_found si la combinaison ne resout aucun SKU actif', async () => {
      const client = makeClient([
        { rows: [{ id: 'cart-1', status: 'open' }] },
        { rows: [skuProduct] },
        { rows: [] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(addSharedCartItem('cart-1', 'user-1', 'p-sku', 1, { couleur: 'Rose' }))
        .rejects.toMatchObject({ status: 409, code: 'sellable_unit_not_found' });
      expectTransactionRolledBack(client);
    });

    it('409 sellable_unit_out_of_stock si le stock du SKU resolu est insuffisant', async () => {
      const client = makeClient([
        { rows: [{ id: 'cart-1', status: 'open' }] },
        { rows: [skuProduct] },
        { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 1, price_kmf: 15000 }] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(addSharedCartItem('cart-1', 'user-1', 'p-sku', 5, { couleur: 'Noir', taille: 'M' }))
        .rejects.toMatchObject({ status: 409, code: 'sellable_unit_out_of_stock' });
      expectTransactionRolledBack(client);
    });
  });
});

describe('removeSharedCartItem (Contrat API §2/§5 point 4 — retrait unitaire, garde-fou item déjà acheté)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse sans item_id, avant toute transaction', async () => {
    await expect(removeSharedCartItem('cart-1', 'user-1', undefined)).rejects.toMatchObject({
      code: 'item_id_required', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('panier introuvable ou non autorisé → 404', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(removeSharedCartItem('cart-1', 'user-1', 'item-1')).rejects.toMatchObject({
      code: 'shared_cart_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('refuse si le panier n\'est plus open', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-1', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(removeSharedCartItem('cart-1', 'user-1', 'item-1')).rejects.toMatchObject({
      code: 'cart_not_editable', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('article introuvable dans ce panier → 404', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(removeSharedCartItem('cart-1', 'user-1', 'item-1')).rejects.toMatchObject({
      code: 'item_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('article déjà acheté (order_items.shared_cart_item_id non-NULL) → 409, jamais de détachement silencieux', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [{ id: 'item-1', claimed: true }] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(removeSharedCartItem('cart-1', 'user-1', 'item-1')).rejects.toMatchObject({
      code: 'item_already_claimed', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('retire un article non réclamé, journalise l\'événement, commit', async () => {
    const cart = { id: 'cart-1', status: 'open' };
    const client = makeClient([
      { rows: [cart] },                          // SELECT ... FOR UPDATE
      { rows: [{ id: 'item-1', claimed: false }] }, // SELECT item + claim check
      { rows: [], rowCount: 1 },                 // DELETE shared_cart_items
      { rows: [], rowCount: 1 },                 // UPDATE shared_carts
      { rows: [], rowCount: 1 },                 // addEvent
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await removeSharedCartItem('cart-1', 'user-1', 'item-1');

    expect(result.cart).toEqual(cart);
    expectTransactionCommitted(client);
  });
});

describe('updateSharedCartItemQuantity (amendement V2 §B — modification unitaire de quantité)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse sans item_id, avant toute transaction', async () => {
    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', undefined, 2)).rejects.toMatchObject({
      code: 'item_id_required', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une quantité invalide (<= 0), avant toute transaction', async () => {
    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 0)).rejects.toMatchObject({
      code: 'invalid_quantity', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une quantité non numérique, avant toute transaction', async () => {
    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 'abc')).rejects.toMatchObject({
      code: 'invalid_quantity', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('refuse une quantité non entière (ex. 2.5), avant toute transaction — correctif V2-B.1 §6', async () => {
    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 2.5)).rejects.toMatchObject({
      code: 'invalid_quantity', status: 400,
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('panier introuvable ou non autorisé → 404', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 2)).rejects.toMatchObject({
      code: 'shared_cart_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('refuse si le panier n\'est plus open', async () => {
    const client = makeClient([{ rows: [{ id: 'cart-1', status: 'closed' }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 2)).rejects.toMatchObject({
      code: 'cart_not_editable', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('article introuvable dans ce panier → 404', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 2)).rejects.toMatchObject({
      code: 'item_not_found', status: 404,
    });
    expectTransactionRolledBack(client);
  });

  it('article déjà acheté → 409, quantité jamais modifiée', async () => {
    const client = makeClient([
      { rows: [{ id: 'cart-1', status: 'open' }] },
      { rows: [{ id: 'item-1', quantity: 1, unit_price_kmf_snapshot: 1000, claimed: true }] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 3)).rejects.toMatchObject({
      code: 'item_already_claimed', status: 409,
    });
    expectTransactionRolledBack(client);
  });

  it('modifie la quantité, recalcule uniquement line_total_kmf_snapshot, journalise previous_quantity, commit', async () => {
    const cart = { id: 'cart-1', status: 'open' };
    const updatedItem = { id: 'item-1', quantity: 3, unit_price_kmf_snapshot: 1000, line_total_kmf_snapshot: 3000 };
    const client = makeClient([
      { rows: [cart] },                                                              // SELECT ... FOR UPDATE
      { rows: [{ id: 'item-1', quantity: 1, unit_price_kmf_snapshot: 1000, claimed: false }] }, // SELECT item FOR UPDATE OF sci
      { rows: [updatedItem] },                                                       // UPDATE shared_cart_items RETURNING *
      { rows: [], rowCount: 1 },                                                     // UPDATE shared_carts
      { rows: [], rowCount: 1 },                                                     // addEvent
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await updateSharedCartItemQuantity('cart-1', 'user-1', 'item-1', 3);

    expect(result.cart).toEqual(cart);
    expect(result.item).toEqual(updatedItem);
    const updateCall = client.calls.find(c => String(c.sql).includes('UPDATE shared_cart_items'));
    expect(updateCall.params).toEqual([3, 3000, 'item-1']);
    expectTransactionCommitted(client);
  });
});
