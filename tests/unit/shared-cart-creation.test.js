'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

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

const db = require('../../db');
const {
  createSharedCartFromBasket,
  createSharedCartFromCartItems,
  clearCreatorBasketInTx,
} = require('../../services/shared-cart-creation');

describe('shared-cart-creation', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('clearCreatorBasketInTx', () => {
    it('retourne 0 si aucun panier createur nettoyable', async () => {
      const client = makeClient([{ rows: [] }]);

      await expect(clearCreatorBasketInTx(client, 'user-001')).resolves.toBe(0);
      expect(client.query).toHaveBeenCalledTimes(1);
    });

    it('supprime les items des paniers non verrouilles puis met a jour les paniers', async () => {
      const client = makeClient([
        { rows: [{ id: 'basket-001' }, { id: 'basket-002' }] },
        { rows: [], rowCount: 3 },
        { rows: [], rowCount: 2 },
      ]);

      const deleted = await clearCreatorBasketInTx(client, 'user-001');

      expect(deleted).toBe(3);
      expect(client.calls[1].sql).toContain('DELETE FROM basket_items WHERE basket_id = ANY($1)');
      expect(client.calls[1].params).toEqual([['basket-001', 'basket-002']]);
      expect(client.calls[2].sql).toContain('UPDATE baskets SET updated_at = NOW() WHERE id = ANY($1)');
    });
  });

  describe('createSharedCartFromCartItems', () => {
    it('refuse un user_id absent avant de lire la DB', async () => {
      const client = makeClient([]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromCartItems(null, [{ product_id: 'p1', quantity: 1 }])).rejects.toThrow('user_id requis');
      expectTransactionRolledBack(client);
    });

    it('cree un panier partage depuis des items et snapshot les prix serveur', async () => {
      const product = {
        id: 'product-001', name: 'Riz', image_url: 'riz.jpg', category: 'maison',
        price_kmf: 1000, promo_pct: 10, is_promo: true,
        promo_until: new Date(Date.now() + 86_400_000).toISOString(), is_active: true,
      };
      const sharedCart = { id: 'cart-001', status: 'open', closed_at: null, payment_window_ends_at: null };
      const item = { id: 'sci-001', shared_cart_id: 'cart-001', product_id: 'product-001' };
      const client = makeClient([
        { rows: [] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'product-001', quantity: 2 }], {
        title: 'Course groupe',
        message: 'Merci',
      });

      expect(result.sharedCart).toBe(sharedCart);
      expect(result.items).toEqual([item]);
      expect(result.clearLocalCart).toBe(true);
      expect(result.token).toEqual(expect.any(String));
      expect(client.calls[5].sql).toContain('INSERT INTO shared_carts');
      expect(client.calls[5].params).toEqual([expect.any(String), 'user-001', 'Course groupe', 'Merci', null]);
      expect(client.calls[6].params).toEqual(['cart-001', 'product-001', null, null, 'Riz', 'riz.jpg', 'maison', 2, 900, 1800]);
      expect(client.calls[7].sql).toContain('INSERT INTO shared_cart_events');
      expectTransactionCommitted(client);
    });

    it("V1 — la requête de garde ne filtre que status='open' (jamais 'closed'), robuste au refactor", async () => {
      // Retrouve la requête de garde par son motif SELECT...token...status=open
      // plutôt que par index (robuste si des requêtes sont réordonnées).
      const client = makeClient([{ rows: [] }]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromCartItems('user-001', [])).rejects.toThrow('Le panier est vide');

      // La garde fait SELECT id, token WHERE status='open' LIMIT 1 (pas de COUNT).
      const guardCall = client.calls.find((c) => /SELECT.+token.+FROM shared_carts/i.test(c.sql));
      expect(guardCall).toBeDefined();
      const normalizedSql = guardCall.sql.replace(/\s+/g, ' ').trim();
      expect(normalizedSql).toContain("status = 'open'");
      expect(normalizedSql).not.toContain("IN ('open'");
      expect(normalizedSql).not.toContain("'closed'");
    });

    it('Règle V1 — leve si une liste OPEN existe déjà pour ce créateur', async () => {
      // La garde cherche SELECT id, token WHERE status='open' LIMIT 1.
      // Retourner une ligne simule l'existence d'une liste OPEN existante.
      const client = makeClient([{ rows: [{ id: 'cart-existing', token: 'tok-existing' }] }]);
      db.getClient.mockResolvedValue(client);

      const err = await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }])
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/Vous avez déjà une liste ouverte/);
      expect(err.code).toBe('open_list_exists');
      expect(err.existing_token).toBe('tok-existing');
      expectTransactionRolledBack(client);
      // La garde ne doit interroger que les listes 'open'.
      expect(client.calls[1].sql).toMatch(/status\s*=\s*'open'/);
      expect(client.calls[1].sql).not.toMatch(/status\s+IN\s*\(/i);
    });

    it('V1 — N listes closed : la creation reste autorisee (la query ne cherche que open)', async () => {
      // Le mock ne filtre pas réellement le SQL : la garantie vient de
      // l'assertion sur le SQL ci-dessous. rows:[] simule zéro liste OPEN.
      const product = {
        id: 'product-001', name: 'Riz', image_url: 'riz.jpg', category: 'maison',
        price_kmf: 1000, is_active: true,
      };
      const sharedCart = { id: 'cart-002', status: 'open' };
      const item = { id: 'sci-002', shared_cart_id: 'cart-002', product_id: 'product-001' };
      const client = makeClient([
        { rows: [] }, // aucune liste OPEN existante
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: 'product-001', quantity: 1 }])
      ).resolves.toMatchObject({ sharedCart });
      expect(client.calls[1].sql).toMatch(/status\s*=\s*'open'/);
      expectTransactionCommitted(client);
    });

    it('V1 — fermeture de la liste OPEN puis nouvelle creation autorisee immediatement', async () => {
      // Etape 1 : une liste OPEN existe -> refusé.
      const blockedClient = makeClient([{ rows: [{ id: 'c1', token: 'tok1' }] }]);
      db.getClient.mockResolvedValue(blockedClient);
      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }])
      ).rejects.toThrow('Vous avez déjà une liste ouverte');

      // Etape 2 : la liste est maintenant CLOSED -> rows vide -> creation autorisee.
      jest.clearAllMocks();
      const product = { id: 'p1', name: 'Riz', image_url: null, category: null, price_kmf: 1000, is_active: true };
      const sharedCart = { id: 'cart-003', status: 'open' };
      const item = { id: 'sci-003', shared_cart_id: 'cart-003', product_id: 'p1' };
      const freedClient = makeClient([
        { rows: [] }, // liste précédente est CLOSED -> absent du SELECT WHERE status='open'
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(freedClient);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }])
      ).resolves.toMatchObject({ sharedCart });
    });

    it('leve si cartItems vide', async () => {
      const client = makeClient([{ rows: [] }]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromCartItems('user-001', [])).rejects.toThrow('Le panier est vide');
      expectTransactionRolledBack(client);
    });

    it('leve si aucun product_id valide dans cartItems', async () => {
      const client = makeClient([{ rows: [] }]);
      db.getClient.mockResolvedValue(client);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: null, quantity: 1 }])
      ).rejects.toThrow('Aucun produit valide dans le panier');
      expectTransactionRolledBack(client);
    });

    it('leve si tous les produits sont inactifs/quantite nulle/prix nul (aucun item enrichi)', async () => {
      const client = makeClient([
        { rows: [] },
        { rows: [{ id: 'p1', name: 'X', price_kmf: 1000, is_active: false }] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }])
      ).rejects.toThrow('Aucun produit valide après vérification serveur');
      expectTransactionRolledBack(client);
    });

    it('leve si utilisateur introuvable', async () => {
      const product = { id: 'p1', name: 'X', price_kmf: 1000, is_active: true, is_promo: false };
      const client = makeClient([
        { rows: [] },
        { rows: [product] },
        { rows: [] }, // user introuvable
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(
        createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }])
      ).rejects.toThrow('Utilisateur introuvable');
      expectTransactionRolledBack(client);
    });

    it('promo expirée (promo_until dans le passe) → prix plein, pas de reduction', async () => {
      const product = {
        id: 'p1', name: 'Prod', image_url: 'x.jpg', category: 'cat',
        price_kmf: 2000, promo_pct: 20, is_promo: true,
        promo_until: new Date(Date.now() - 86_400_000).toISOString(), is_active: true,
      };
      const sharedCart = { id: 'cart-002', status: 'open', closed_at: null, payment_window_ends_at: null };
      const item = { id: 'sci-002' };
      const client = makeClient([
        { rows: [] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }]);

      expect(result.items).toEqual([item]);
      // ligne items insérée avec prix plein 2000 (pas de reduction promo expirée)
      expect(client.calls[6].params).toEqual(['cart-002', 'p1', null, null, 'Prod', 'x.jpg', 'cat', 1, 2000, 2000]);
    });

    it('ignore shareMode : le statut initial est toujours open (ASSUMPTION documentée dans le service réel — plus de fenêtre de paiement propre à la liste)', async () => {
      const product = { id: 'p1', name: 'X', image_url: null, category: 'cat', price_kmf: 1000, is_active: true, is_promo: false };
      const sharedCart = { id: 'cart-003', status: 'open', closed_at: null };
      const item = { id: 'sci-003' };
      const client = makeClient([
        { rows: [] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000' }] },
        { rows: [] },
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      // shareMode n'est plus un paramètre reconnu par la fonction réelle :
      // il est silencieusement ignoré, aucune branche ne le lit.
      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }], {
        shareMode: 'ready_to_pay',
      });

      expect(result.sharedCart.status).toBe('open');
      expect(client.calls[5].sql).toMatch(/'open'/);
      // Un seul événement d'audit (création) — pas de cart_closed automatique.
      const eventCalls = client.calls.filter(c => c.sql.includes('INSERT INTO shared_cart_events'));
      expect(eventCalls).toHaveLength(1);
    });

    it('genere un token unique en retentant si collision (attempt < 4)', async () => {
      const product = { id: 'p1', name: 'X', image_url: null, category: 'cat', price_kmf: 1000, is_active: true, is_promo: false };
      const sharedCart = { id: 'cart-005', status: 'open', closed_at: null, payment_window_ends_at: null };
      const item = { id: 'sci-005' };
      const client = makeClient([
        { rows: [] },
        { rows: [product] },
        { rows: [{ full_name: 'Creator', phone: '000' }] },
        { rows: [{ exists: 1 }] }, // collision sur 1ère tentative
        { rows: [] },              // pas de collision sur 2eme
        { rows: [sharedCart] },
        { rows: [item] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromCartItems('user-001', [{ product_id: 'p1', quantity: 1 }]);

      expect(result.token).toEqual(expect.any(String));
    });

    // GAP-07 §9.1 — le chemin vivant depuis le panier local doit préserver
    // l'unité vendable SKU : sku_id + variant_combo_snapshot, jamais
    // agrégé uniquement par product_id.
    describe('GAP-07 — unité vendable SKU', () => {
      const skuProduct = {
        id: 'prod-sku', name: 'Chemise', image_url: 'chemise.jpg', category: 'vetements',
        price_kmf: 10000, promo_pct: null, is_promo: false, promo_until: null,
        is_active: true, inventory_model: 'SKU', has_variants: true, stock: null,
      };

      it('resout le SKU actif, snapshot sku_id + variant_combo_snapshot, prix SKU (pas prix generique)', async () => {
        const sharedCart = { id: 'cart-sku', status: 'open' };
        const item = { id: 'sci-sku' };
        const client = makeClient([
          { rows: [] },
          { rows: [skuProduct] },                                            // SELECT products
          { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 5, price_kmf: 15000 }] }, // resolveActiveSku
          { rows: [] },                                                      // media (product_sku_media/catalog_media) — aucune, fallback image produit
          { rows: [{ full_name: 'Creator', phone: '000' }] },
          { rows: [] },
          { rows: [sharedCart] },
          { rows: [item] },
          { rows: [], rowCount: 1 },
        ]);
        db.getClient.mockResolvedValue(client);

        const result = await createSharedCartFromCartItems('user-001', [
          { product_id: 'prod-sku', quantity: 1, variant_combo: { couleur: 'Noir', taille: 'M' } },
        ]);

        expect(result.items).toEqual([item]);
        const insertCall = client.calls.find(c => /INSERT INTO shared_cart_items/.test(c.sql));
        expect(insertCall.params).toEqual([
          'cart-sku', 'prod-sku', 'sku-noir-m', JSON.stringify({ couleur: 'Noir', taille: 'M' }),
          'Chemise', 'chemise.jpg', 'vetements', 1, 15000, 15000,
        ]);
      });

      // Mandat §8/§9 — createSharedCartFromCartItems doit désormais consommer
      // resolveSellableUnit() en entier (pas seulement resolveActiveSku +
      // computeSellablePricing) : le média SKU explicite doit primer sur
      // products.image_url quand une association product_sku_media existe,
      // exactement comme lors de la création du snapshot partagé.
      it('média SKU explicite prioritaire sur products.image_url (mandat §8/§9)', async () => {
        const sharedCart = { id: 'cart-sku-media', status: 'open' };
        const item = { id: 'sci-sku-media' };
        const client = makeClient([
          { rows: [] },
          { rows: [skuProduct] },
          { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 5, price_kmf: 15000 }] },
          { rows: [{ url: 'https://cdn/chemise-noir-m-canonique.jpg' }] }, // média SKU explicite
          { rows: [{ full_name: 'Creator', phone: '000' }] },
          { rows: [] },
          { rows: [sharedCart] },
          { rows: [item] },
          { rows: [], rowCount: 1 },
        ]);
        db.getClient.mockResolvedValue(client);

        await createSharedCartFromCartItems('user-001', [
          { product_id: 'prod-sku', quantity: 1, variant_combo: { couleur: 'Noir', taille: 'M' } },
        ]);

        const insertCall = client.calls.find(c => /INSERT INTO shared_cart_items/.test(c.sql));
        expect(insertCall.params[5]).toBe('https://cdn/chemise-noir-m-canonique.jpg'); // product_image_snapshot
        expect(insertCall.params[5]).not.toBe('chemise.jpg'); // jamais l'image générique quand un média SKU explicite existe
      });

      it('deux variantes du meme produit restent deux lignes distinctes', async () => {
        const sharedCart = { id: 'cart-sku-2', status: 'open' };
        const client = makeClient([
          { rows: [] },
          { rows: [skuProduct] },
          { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 5, price_kmf: 15000 }] },
          { rows: [] },                          // media item 1 — fallback image produit
          { rows: [skuProduct] },                // SELECT products, item 2 (resolveSellableUnit — pas de fetch groupé)
          { rows: [{ id: 'sku-blanc-l', sku: 'CHEM-B-L', stock: 3, price_kmf: 16000 }] },
          { rows: [] },                          // media item 2 — fallback image produit
          { rows: [{ full_name: 'Creator', phone: '000' }] },
          { rows: [] },
          { rows: [sharedCart] },
          { rows: [{ id: 'sci-a' }] },
          { rows: [{ id: 'sci-b' }] },
          { rows: [], rowCount: 1 },
        ]);
        db.getClient.mockResolvedValue(client);

        const result = await createSharedCartFromCartItems('user-001', [
          { product_id: 'prod-sku', quantity: 1, variant_combo: { couleur: 'Noir', taille: 'M' } },
          { product_id: 'prod-sku', quantity: 1, variant_combo: { couleur: 'Blanc', taille: 'L' } },
        ]);

        expect(result.items).toHaveLength(2);
        const inserts = client.calls.filter(c => /INSERT INTO shared_cart_items/.test(c.sql));
        expect(inserts).toHaveLength(2);
        expect(inserts[0].params[2]).toBe('sku-noir-m');
        expect(inserts[1].params[2]).toBe('sku-blanc-l');
      });

      it('409 sellable_unit_not_found si la combinaison ne resout aucun SKU actif (jamais de skip silencieux)', async () => {
        const client = makeClient([
          { rows: [] },
          { rows: [skuProduct] },
          { rows: [] }, // resolveActiveSku → rien
        ]);
        db.getClient.mockResolvedValue(client);

        await expect(createSharedCartFromCartItems('user-001', [
          { product_id: 'prod-sku', quantity: 1, variant_combo: { couleur: 'Rose' } },
        ])).rejects.toMatchObject({ status: 409, code: 'sellable_unit_not_found' });
        expectTransactionRolledBack(client);
      });

      it('409 sellable_unit_out_of_stock si le stock du SKU resolu est insuffisant', async () => {
        const client = makeClient([
          { rows: [] },
          { rows: [skuProduct] },
          { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 1, price_kmf: 15000 }] },
        ]);
        db.getClient.mockResolvedValue(client);

        await expect(createSharedCartFromCartItems('user-001', [
          { product_id: 'prod-sku', quantity: 5, variant_combo: { couleur: 'Noir', taille: 'M' } },
        ])).rejects.toMatchObject({ status: 409, code: 'sellable_unit_out_of_stock' });
        expectTransactionRolledBack(client);
      });

      it('fallback vers le prix produit quand product_skus.price_kmf est null', async () => {
        const sharedCart = { id: 'cart-sku-3', status: 'open' };
        const item = { id: 'sci-sku-3' };
        const client = makeClient([
          { rows: [] },
          { rows: [skuProduct] },
          { rows: [{ id: 'sku-noir-m', sku: 'CHEM-N-M', stock: 5, price_kmf: null }] },
          { rows: [] },                          // media — aucune, fallback image produit
          { rows: [{ full_name: 'Creator', phone: '000' }] },
          { rows: [] },
          { rows: [sharedCart] },
          { rows: [item] },
          { rows: [], rowCount: 1 },
        ]);
        db.getClient.mockResolvedValue(client);

        const result = await createSharedCartFromCartItems('user-001', [
          { product_id: 'prod-sku', quantity: 1, variant_combo: { couleur: 'Noir', taille: 'M' } },
        ]);
        expect(result.items).toEqual([item]);
        const insertCall = client.calls.find(c => /INSERT INTO shared_cart_items/.test(c.sql));
        expect(insertCall.params[8]).toBe(10000); // unit_price_kmf_snapshot = prix produit générique (fallback)
      });
    });
  });

  describe('createSharedCartFromBasket', () => {
    it('leve si limite de paniers actifs atteinte (5 open)', async () => {
      // Règle V1 : retourner une liste OPEN existante déclenche le refus.
      const client = makeClient([{ rows: [{ id: 'c-existing', token: 'tok-existing' }] }]);
      db.getClient.mockResolvedValue(client);

      const err = await createSharedCartFromBasket('user-001', 'basket-001').catch((e) => e);
      expect(err.message).toMatch(/Vous avez déjà une liste ouverte/);
      expect(err.code).toBe('open_list_exists');
      expect(err.existing_token).toBe('tok-existing');
      expectTransactionRolledBack(client);
      expect(client.calls[1].sql).toMatch(/status\s*=\s*'open'/);
      expect(client.calls[1].sql).not.toMatch(/status\s+IN\s*\(/i);
    });

    it('leve si utilisateur introuvable', async () => {
      const client = makeClient([
        { rows: [] },
        { rows: [] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Utilisateur introuvable');
      expectTransactionRolledBack(client);
    });

    it('leve si panier introuvable ou non autorise', async () => {
      const client = makeClient([
        { rows: [] },
        { rows: [{ id: 'user-001', full_name: 'X', phone: '000' }] },
        { rows: [] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Panier introuvable ou non autorisé');
      expectTransactionRolledBack(client);
    });

    it('leve si panier vide', async () => {
      const client = makeClient([
        { rows: [] },
        { rows: [{ id: 'user-001', full_name: 'X', phone: '000' }] },
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] },
        { rows: [] },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Le panier est vide, impossible de partager');
      expectTransactionRolledBack(client);
    });

    it('cree un panier partage depuis un basket DB (happy path)', async () => {
      const items = [
        { product_id: 'p1', quantity: 2, name: 'Riz', image_url: 'riz.jpg', category: 'maison', price_kmf: 1000 },
        { product_id: 'p2', quantity: 1, name: 'Huile', image_url: 'huile.jpg', category: 'maison', price_kmf: 1500 },
      ];
      const sharedCart = { id: 'cart-basket-001', status: 'open' };

      const client = makeClient([
        { rows: [] },                                  // assertLimit
        { rows: [{ id: 'user-001' }] },                        // SELECT users
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] }, // SELECT baskets
        { rows: items },                                       // SELECT basket_items JOIN products
        { rows: [] },                                          // token collision check
        { rows: [sharedCart] },                                // INSERT shared_carts
        { rows: [{ id: 'sci-1' }] },                           // INSERT item 1
        { rows: [{ id: 'sci-2' }] },                           // INSERT item 2
        { rows: [], rowCount: 1 },                             // addEvent
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromBasket('user-001', 'basket-001', { title: 'Groupe' });

      expect(result.sharedCart).toBe(sharedCart);
      expect(result.items).toHaveLength(2);
      expect(result.token).toEqual(expect.any(String));
      expect(client.calls[6].sql).toContain('INSERT INTO shared_carts');
      // params réels : [token, userId, basketId, title, message, deliveryRelayId] — pas de colonne total.
      expect(client.calls[6].params).toEqual([expect.any(String), 'user-001', 'basket-001', 'Groupe', null, null]);
      expectTransactionCommitted(client);
    });

    it('leve si total panier invalide (prix tous nuls)', async () => {
      const items = [{ product_id: 'p1', quantity: 1, name: 'Gratuit', image_url: null, category: 'x', price_kmf: 0 }];
      const sharedCart = { id: 'cart-invalid', status: 'open' };
      const client = makeClient([
        { rows: [] },                                  // assertLimit
        { rows: [{ id: 'user-001' }] },                        // SELECT users
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] }, // SELECT baskets
        { rows: items },                                       // SELECT basket_items JOIN products
        { rows: [] },                                          // token collision check
        { rows: [sharedCart] },                                // INSERT shared_carts
        { rows: [{ id: 'sci-gratuit' }] },                     // INSERT item (prix 0, inséré quand même)
      ]);
      db.getClient.mockResolvedValue(client);

      // Le total est vérifié APRÈS la boucle d'insertion des items : la ligne
      // à prix 0 est bien insérée avant que la transaction ne soit rejetée.
      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toThrow('Total panier invalide');
      expectTransactionRolledBack(client);
    });

    // GAP-07 §9.4 — basket_items ne porte aucune colonne de variante :
    // un produit SKU dans un basket legacy doit être refusé explicitement,
    // jamais silencieusement dégradé vers un SKU deviné.
    it('refuse explicitement un produit SKU (basket_items ne conserve pas la variante)', async () => {
      const items = [
        { product_id: 'p1', quantity: 1, name: 'Robe', image_url: 'robe.jpg', category: 'vetements', price_kmf: 10000, inventory_model: 'SKU' },
      ];
      const client = makeClient([
        { rows: [] },
        { rows: [{ id: 'user-001' }] },
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] },
        { rows: items },
      ]);
      db.getClient.mockResolvedValue(client);

      await expect(createSharedCartFromBasket('user-001', 'basket-001')).rejects.toMatchObject({
        status: 409,
        code: 'sellable_unit_identity_missing',
      });
      expectTransactionRolledBack(client);
    });

    it('genere un token unique en retentant si collision (attempt < 4)', async () => {
      const items = [{ product_id: 'p1', quantity: 1, name: 'X', image_url: null, category: 'x', price_kmf: 1000 }];
      const sharedCart = { id: 'cart-basket-002', status: 'open' };
      const client = makeClient([
        { rows: [] },
        { rows: [{ id: 'user-001', full_name: 'X', phone: '000' }] },
        { rows: [{ id: 'basket-001', user_id: 'user-001' }] },
        { rows: items },
        { rows: [{ exists: 1 }] }, // collision
        { rows: [] },              // ok
        { rows: [sharedCart] },
        { rows: [{ id: 'sci-1' }] },
        { rows: [], rowCount: 1 },
      ]);
      db.getClient.mockResolvedValue(client);

      const result = await createSharedCartFromBasket('user-001', 'basket-001');

      expect(result.token).toEqual(expect.any(String));
    });
  });
});

  // ── Preuve concurrente V1 ───────────────────────────────────────────────
  // La vraie garantie est l'UNIQUE INDEX DB (migration 129) — ce test prouve
  // que le service interprète correctement la violation de contrainte en
  // erreur métier explicite (pas un 500 cryptique).

  it('V1 concurrence DB — 23505 est transformé en open_list_exists avec existing_token', async () => {
    // §4 mandat : après un 23505 sur shared_carts_one_open_per_organizer,
    // le service doit résoudre le token gagnant et remonter une erreur
    // applicative uniforme (code=open_list_exists + existing_token).
    // La route ne doit jamais voir un 23505 brut → jamais de 500.
    const dbUniqueErr = Object.assign(
      new Error('duplicate key value violates unique constraint "shared_carts_one_open_per_organizer"'),
      { code: '23505', constraint: 'shared_carts_one_open_per_organizer' }
    );
    const product = { id: 'p1', name: 'Riz', image_url: null, category: null, price_kmf: 1000, is_active: true };
    const WINNER_TOKEN = 'tok-winner';

    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })            // BEGIN
        .mockResolvedValueOnce({ rows: [] })            // garde V1 : 0 OPEN
        .mockResolvedValueOnce({ rows: [product] })     // resolveSellableUnit
        .mockResolvedValueOnce({ rows: [{ full_name: 'Ali', phone: '0' }] }) // user
        .mockResolvedValueOnce({ rows: [] })            // token unique check
        .mockRejectedValueOnce(dbUniqueErr),            // INSERT → 23505
      release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);
    // resolveExistingOpenToken utilise db.query directement (hors transaction)
    // après le rollback pour récupérer le token gagnant.
    db.query.mockResolvedValueOnce({ rows: [{ token: WINNER_TOKEN }] });

    const err = await createSharedCartFromCartItems(
      'user-001', [{ product_id: 'p1', quantity: 1 }]
    ).catch((e) => e);

    // Le 23505 est transformé — la route voit open_list_exists, pas 500.
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('open_list_exists');
    expect(err.existing_token).toBe(WINNER_TOKEN);
    expect(client.release).toHaveBeenCalled(); // transaction proprement libérée
  });
