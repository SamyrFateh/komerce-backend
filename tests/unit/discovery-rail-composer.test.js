'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockDbQuery;
let mockIsStockExposable;
let mockIsServiceExposable, mockGetService;
let mockIsPhysicalOfferExposable, mockGetPhysicalOffer;

function loadComposer() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
  jest.mock('../../services/local-stock-service', () => ({
    isStockExposable: (...a) => mockIsStockExposable(...a),
  }));
  jest.mock('../../services/providers-service', () => ({
    isServiceExposable: (...a) => mockIsServiceExposable(...a),
    getService: (...a) => mockGetService(...a),
    isPhysicalOfferExposable: (...a) => mockIsPhysicalOfferExposable(...a),
    getPhysicalOffer: (...a) => mockGetPhysicalOffer(...a),
  }));
  return require('../../services/discovery-rail-composer');
}

beforeEach(() => {
  mockDbQuery = jest.fn();
  mockIsStockExposable = jest.fn();
  mockIsServiceExposable = jest.fn();
  mockGetService = jest.fn();
  mockIsPhysicalOfferExposable = jest.fn();
  mockGetPhysicalOffer = jest.fn();
});

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const MARKET_ID  = '22222222-2222-2222-2222-222222222222';
const OFFER_ID   = '33333333-3333-3333-3333-333333333333';
const SERVICE_ID = '44444444-4444-4444-4444-444444444444';
const PROVIDER_ID = '55555555-5555-5555-5555-555555555555';

describe('productCard', () => {
  it('non exposable -> null, jamais de requête produit inutile', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(false);
    expect(await c.productCard(PRODUCT_ID, MARKET_ID)).toBeNull();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('exposable mais produit introuvable/inactif -> null', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({ rows: [] });
    expect(await c.productCard(PRODUCT_ID, MARKET_ID)).toBeNull();
  });

  it('nominal : champs exacts et image catalogue', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({
      rows: [{ id: PRODUCT_ID, name: 'Climatiseur 12000 BTU', image_url: 'https://cdn/clim.jpg', price_kmf: 195000 }],
    });

    expect(await c.productCard(PRODUCT_ID, MARKET_ID)).toEqual({
      kind: 'product',
      title: 'Climatiseur 12000 BTU',
      subtitle: 'Disponible maintenant',
      cta_label: 'Acheter',
      cta_action_ref: PRODUCT_ID,
      image_ref: 'https://cdn/clim.jpg',
      price: 195000,
      zone: null,
      provider_name: null,
      description: null,
    });
  });
});

describe('physicalOfferCard — cas de vérité samboussas', () => {
  it('non exposable -> null, jamais de lecture inutile', async () => {
    const c = loadComposer();
    mockIsPhysicalOfferExposable.mockResolvedValue(false);
    expect(await c.physicalOfferCard(OFFER_ID, MARKET_ID)).toBeNull();
    expect(mockGetPhysicalOffer).not.toHaveBeenCalled();
  });

  it('projette image_ref, zone, provider_name depuis providers-services, jamais provider_id', async () => {
    const c = loadComposer();
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({
      id: OFFER_ID,
      provider_id: PROVIDER_ID,
      title: 'Samboussas mariage',
      description: 'Plateau de 50 pièces',
      zone: 'Moroni',
      provider_name: 'Fatima Traiteur',
      image_ref: '/media/providers/samboussas.webp',
    });

    const card = await c.physicalOfferCard(OFFER_ID, MARKET_ID);
    expect(card).toEqual({
      kind: 'physical_offer',
      title: 'Samboussas mariage',
      subtitle: 'Préparation sur commande',
      cta_label: 'Commander',
      cta_action_ref: OFFER_ID,
      image_ref: '/media/providers/samboussas.webp',
      price: null,
      zone: 'Moroni',
      provider_name: 'Fatima Traiteur',
      description: 'Plateau de 50 pièces',
    });
    expect(card.provider_id).toBeUndefined();
  });

  it('image_ref absent reste null et laisse le renderer utiliser son fallback', async () => {
    const c = loadComposer();
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({ id: OFFER_ID, title: 'Samboussas mariage' });
    const card = await c.physicalOfferCard(OFFER_ID, MARKET_ID);
    expect(card.image_ref).toBeNull();
    expect(card.zone).toBeNull();
    expect(card.provider_name).toBeNull();
  });
});

describe('serviceCard', () => {
  it('non exposable -> null', async () => {
    const c = loadComposer();
    mockIsServiceExposable.mockResolvedValue(false);
    expect(await c.serviceCard(SERVICE_ID, MARKET_ID)).toBeNull();
    expect(mockGetService).not.toHaveBeenCalled();
  });

  it('projette image_ref, zone, provider_name depuis providers-services, jamais provider_id ni téléphone', async () => {
    const c = loadComposer();
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({
      id: SERVICE_ID,
      provider_id: PROVIDER_ID,
      phone: '+269000000000',
      title: 'Installation climatiseur',
      description: 'Pose et mise en service',
      zone: 'Mutsamudu',
      provider_name: 'Bâtir Anjouan',
      image_ref: '/media/providers/installateur.webp',
    });

    const card = await c.serviceCard(SERVICE_ID, MARKET_ID);
    expect(card).toEqual({
      kind: 'service',
      title: 'Installation climatiseur',
      subtitle: 'Sur demande',
      cta_label: 'Demander',
      cta_action_ref: SERVICE_ID,
      image_ref: '/media/providers/installateur.webp',
      price: null,
      zone: 'Mutsamudu',
      provider_name: 'Bâtir Anjouan',
      description: 'Pose et mise en service',
    });
    expect(card).not.toHaveProperty('provider_id');
    expect(card).not.toHaveProperty('phone');
    expect(card).not.toHaveProperty('requester_phone');
  });
});

describe('composeDiscoveryRail', () => {
  it('lève si market_id manquant', async () => {
    const c = loadComposer();
    await expect(c.composeDiscoveryRail({})).rejects.toThrow(/market_id est requis/);
  });

  it('aucun candidat fourni -> tableau vide', async () => {
    const c = loadComposer();
    expect(await c.composeDiscoveryRail({ marketId: MARKET_ID })).toEqual([]);
  });

  it('omet silencieusement les non-exposables', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(false);
    expect(await c.composeDiscoveryRail({ marketId: MARKET_ID, productIds: [PRODUCT_ID] })).toEqual([]);
  });

  it('rail mixte conserve les trois verbes, les médias source et les champs enrichis', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({
      rows: [{ id: PRODUCT_ID, name: 'Climatiseur', image_url: '/p.webp', price_kmf: 195000 }],
    });
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({
      id: OFFER_ID, title: 'Samboussas', image_ref: '/o.webp',
      zone: 'Moroni', provider_name: 'Fatima', description: 'Plateau',
    });
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({
      id: SERVICE_ID, title: 'Plombier', image_ref: '/s.webp',
      zone: 'Anjouan', provider_name: 'Ali', description: 'Dépannage',
    });

    const rail = await c.composeDiscoveryRail({
      marketId: MARKET_ID,
      productIds: [PRODUCT_ID],
      physicalOfferIds: [OFFER_ID],
      serviceIds: [SERVICE_ID],
    });

    expect(rail).toHaveLength(3);
    expect(Object.fromEntries(rail.map(card => [card.kind, card.cta_label]))).toEqual({
      product: 'Acheter',
      physical_offer: 'Commander',
      service: 'Demander',
    });
    expect(Object.fromEntries(rail.map(card => [card.kind, card.image_ref]))).toEqual({
      product: '/p.webp',
      physical_offer: '/o.webp',
      service: '/s.webp',
    });

    // Enriched fields
    const product = rail.find(c => c.kind === 'product');
    expect(product.price).toBe(195000);
    expect(product.provider_name).toBeNull();

    const offer = rail.find(c => c.kind === 'physical_offer');
    expect(offer.zone).toBe('Moroni');
    expect(offer.provider_name).toBe('Fatima');
    expect(offer.description).toBe('Plateau');

    const service = rail.find(c => c.kind === 'service');
    expect(service.zone).toBe('Anjouan');
    expect(service.provider_name).toBe('Ali');
  });
});
