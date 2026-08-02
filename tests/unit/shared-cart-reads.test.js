'use strict';

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
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('organizer_user_id = $1'), ['user-1']);
  });
});
