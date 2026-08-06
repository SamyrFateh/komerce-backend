'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const {
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
} = require('../../services/shared-cart-reads');

describe('shared-cart-reads (Boutique First, domaine minimal)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getSharedCartForPublic retourne null si le token est inconnu', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(getSharedCartForPublic('missing')).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('getSharedCartForPublic expose shared_cart_item_id par article, aucun total monétaire, aucune identité créateur brute', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: 'Merci', status: 'open', delivery_relay_id: 'r1', created_at: '2026-01-01', organizer_user_id: 'user-organizer', organizer_full_name: 'Aïcha Said' };
    const items = [
      { id: 'sci-1', name: 'Riz', image: null, quantity: 2, unit_price_kmf: 1000, line_total_kmf: 2000, claimed: true },
      { id: 'sci-2', name: 'Sucre', image: null, quantity: 1, unit_price_kmf: 500, line_total_kmf: 500, claimed: false },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1');

    expect(result.cart.token).toBe('tok-1');
    // Boutique First : aucun nom/téléphone créateur exposé publiquement.
    expect(result.cart.organizer_user_id).toBeUndefined();
    expect(result.cart.beneficiary_name_snapshot).toBeUndefined();
    // Storyboard §8 : seul le prénom est dérivé, jamais le nom complet.
    expect(result.cart.creator_first_name).toBe('Aïcha');
    // Contrat API §1 : total_kmf retiré, aucun usage identifié dans le contrat UX.
    expect(result.total_kmf).toBeUndefined();
    expect(result.items_count).toBe(2);
    expect(result.claimed_count).toBe(1);
    // Contrat API §5 point 1 (bug) : shared_cart_item_id (ici `id`) doit être exposé,
    // sinon aucun achat n'est constructible depuis cet écran.
    expect(result.items[0].id).toBe('sci-1');
    expect(result.items[0].claimed).toBe(true);
    // Aucun viewerUserId transmis -> is_creator false, jamais indetermine.
    expect(result.is_creator).toBe(false);
  });

  it('getSharedCartForPublic expose product_id par article (amendement V2 §B — fiche produit depuis la liste)', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    const items = [
      { id: 'sci-1', product_id: 'prod-42', name: 'Riz', image: null, quantity: 2, unit_price_kmf: 1000, line_total_kmf: 2000, claimed: false },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1');

    expect(result.items[0].product_id).toBe('prod-42');
    // Les autres champs snapshot restent la source d'affichage, inchangés.
    expect(result.items[0].name).toBe('Riz');
    expect(result.items[0].unit_price_kmf).toBe(1000);
  });

  // GAP-07 §10/§11 — la combinaison doit être disponible côté public pour
  // afficher la variante et distinguer deux lignes du même produit.
  it('getSharedCartForPublic expose variant_combo par article (GAP-07)', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    const items = [
      { id: 'sci-1', product_id: 'prod-42', name: 'Veste saharienne', image: null, variant_combo: { couleur: 'Noir', taille: 'M' }, quantity: 1, unit_price_kmf: 15000, line_total_kmf: 15000, claimed: false },
      { id: 'sci-2', product_id: 'prod-99', name: 'Sac', image: null, variant_combo: null, quantity: 1, unit_price_kmf: 5000, line_total_kmf: 5000, claimed: false },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1');

    expect(result.items[0].variant_combo).toEqual({ couleur: 'Noir', taille: 'M' });
    expect(result.items[1].variant_combo).toBeNull();
    // sku_id interne n'est jamais exposé côté public (§10).
    expect(result.items[0].sku_id).toBeUndefined();
  });

  it('getSharedCartForPublic creator_first_name est null si le créateur n\'a pas de nom exploitable', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer', organizer_full_name: null };
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: [] });

    const result = await getSharedCartForPublic('tok-1');

    expect(result.cart.creator_first_name).toBeNull();
  });

  it('getSharedCartPublic is_creator=true quand viewerUserId correspond a organizer_user_id, sans jamais exposer ce dernier (Contrat API section 5 point 2)', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: [] });

    const result = await getSharedCartForPublic('tok-1', 'user-organizer');

    expect(result.is_creator).toBe(true);
    expect(result.cart.organizer_user_id).toBeUndefined();
    // cart.id interne exposé au créateur : nécessaire pour appeler les
    // endpoints unitaires (POST/DELETE .../items, POST .../close).
    expect(result.cart.id).toBe('cart-1');
  });

  it('getSharedCartPublic is_creator=false quand viewerUserId ne correspond pas, cart.id jamais exposé', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: [] });

    const result = await getSharedCartForPublic('tok-1', 'user-autre-visiteur');

    expect(result.is_creator).toBe(false);
    expect(result.cart.id).toBeUndefined();
  });

  it('getSharedCartForPublic n\'expose plus la catégorie par article (aucun usage identifié dans le contrat UX)', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: null, message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    const items = [{ id: 'sci-1', name: 'Riz', image: null, quantity: 1, unit_price_kmf: 1000, line_total_kmf: 1000, claimed: false }];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1');

    expect(result.items[0].category).toBeUndefined();
  });

  it('getSharedCartForPublic n\'a pas besoin d\'un titre pour retourner une réponse normale (Invariant 5)', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: null, message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: [] });

    const result = await getSharedCartForPublic('tok-1');

    expect(result.cart.title).toBeNull();
    expect(result.items_count).toBe(0);
  });

  it('getSharedCartForPublic expose buyer_first_name par ligne réclamée au créateur (temps réel, lot 2026-08)', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer', organizer_full_name: 'Aïcha Said' };
    const items = [
      { id: 'sci-1', name: 'Riz', image: null, quantity: 2, unit_price_kmf: 1000, line_total_kmf: 2000, claimed: true, buyer_full_name: 'Karim Ali' },
      { id: 'sci-2', name: 'Sucre', image: null, quantity: 1, unit_price_kmf: 500, line_total_kmf: 500, claimed: false, buyer_full_name: null },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1', 'user-organizer');

    expect(result.is_creator).toBe(true);
    expect(result.items[0].buyer_first_name).toBe('Karim');
    expect(result.items[1].buyer_first_name).toBeNull();
  });

  it('getSharedCartForPublic ne mappe jamais buyer_first_name pour un participant, même si la jointure renvoie une identité (doctrine : jamais dans le payload participant)', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    const items = [
      { id: 'sci-1', name: 'Riz', image: null, quantity: 2, unit_price_kmf: 1000, line_total_kmf: 2000, claimed: true, buyer_full_name: 'Karim Ali' },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    // Participant (viewerUserId absent ou différent de l'organisateur).
    const result = await getSharedCartForPublic('tok-1', 'user-autre-visiteur');

    expect(result.is_creator).toBe(false);
    expect(result.items[0].buyer_first_name).toBeUndefined();
    expect(Object.keys(result.items[0])).not.toContain('buyer_full_name');
  });

  it('getSharedCartForPublic agrège les contributeurs pour le créateur (GAP-05, lot 2026-08) : plusieurs lignes du même acheteur → une seule entrée', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer', organizer_full_name: 'Aïcha Said' };
    const items = [
      { id: 'sci-1', name: 'Riz', image: null, quantity: 2, unit_price_kmf: 1000, line_total_kmf: 2000, claimed: true, buyer_user_id: 'user-karim', buyer_full_name: 'Karim Ali' },
      { id: 'sci-2', name: 'Sucre', image: null, quantity: 1, unit_price_kmf: 500, line_total_kmf: 500, claimed: true, buyer_user_id: 'user-karim', buyer_full_name: 'Karim Ali' },
      { id: 'sci-3', name: 'Huile', image: null, quantity: 1, unit_price_kmf: 3000, line_total_kmf: 3000, claimed: true, buyer_user_id: 'user-fatima', buyer_full_name: 'Fatima Boina' },
      { id: 'sci-4', name: 'Thé', image: null, quantity: 1, unit_price_kmf: 800, line_total_kmf: 800, claimed: false, buyer_user_id: null, buyer_full_name: null },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1', 'user-organizer');

    expect(result.contributors).toEqual([
      { first_name: 'Karim', items_count: 2 },
      { first_name: 'Fatima', items_count: 1 },
    ]);
  });

  it('getSharedCartForPublic ne mappe jamais contributors pour un participant (doctrine : jamais dans le payload participant)', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    const items = [
      { id: 'sci-1', name: 'Riz', image: null, quantity: 2, unit_price_kmf: 1000, line_total_kmf: 2000, claimed: true, buyer_user_id: 'user-karim', buyer_full_name: 'Karim Ali' },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1', 'user-autre-visiteur');

    expect(result.is_creator).toBe(false);
    expect(result.contributors).toBeUndefined();
    expect(Object.keys(result)).not.toContain('contributors' in result && result.contributors !== undefined ? '' : 'contributors-absent-check');
  });

  it('getSharedCartForPublic contributeur sans nom exploitable → "Un participant" ; deux acheteurs distincts partageant un prénom restent distincts', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: null, status: 'open', created_at: '2026-01-01', organizer_user_id: 'user-organizer' };
    const items = [
      { id: 'sci-1', name: 'Riz', image: null, quantity: 1, unit_price_kmf: 1000, line_total_kmf: 1000, claimed: true, buyer_user_id: 'user-x', buyer_full_name: null },
      { id: 'sci-2', name: 'Sucre', image: null, quantity: 1, unit_price_kmf: 500, line_total_kmf: 500, claimed: true, buyer_user_id: 'user-ali-1', buyer_full_name: 'Ali Msa' },
      { id: 'sci-3', name: 'Huile', image: null, quantity: 1, unit_price_kmf: 3000, line_total_kmf: 3000, claimed: true, buyer_user_id: 'user-ali-2', buyer_full_name: 'Ali Bacar' },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1', 'user-organizer');

    expect(result.contributors).toEqual([
      { first_name: 'Un participant', items_count: 1 },
      { first_name: 'Ali', items_count: 1 },
      { first_name: 'Ali', items_count: 1 },
    ]);
  });

  it('getSharedCartForOwner retourne null si la liste ne correspond pas à l\'organisateur', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(getSharedCartForOwner('cart-1', 'user-1')).resolves.toBeNull();
    expect(db.query.mock.calls[0][0]).toContain('organizer_user_id');
  });

  it('getSharedCartForOwner expose claimed_by_order_id et total_kmf calculé', async () => {
    const cart = { id: 'cart-1', organizer_user_id: 'user-1' };
    const items = [
      { id: 'sci-1', line_total_kmf_snapshot: 1000, claimed: true, claimed_by_order_id: 'order-1' },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForOwner('cart-1', 'user-1');

    expect(result.cart.total_kmf).toBe(1000);
    expect(result.items[0].claimed_by_order_id).toBe('order-1');
    expect(result.claimed_count).toBe(1);
  });

  it('listMySharedCarts agrège total_kmf/items_count/claimed_count par liste', async () => {
    const rows = [{ id: 'cart-1', total_kmf: 3000, items_count: 2, claimed_count: 1 }];
    db.query.mockResolvedValueOnce({ rows });

    await expect(listMySharedCarts('user-1')).resolves.toBe(rows);

    const [query, params] = db.query.mock.calls[0];
    expect(query).toContain("NULLIF(to_jsonb(sc)->>'organizer_user_id', '')::uuid");
    expect(query).toContain("NULLIF(to_jsonb(sc)->>'beneficiary_user_id', '')::uuid");
    expect(params).toEqual(['user-1']);
  });
});
