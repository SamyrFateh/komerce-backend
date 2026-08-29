'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — discovery-rail-composer.js
 *
 * Invariants couverts :
 *   productCard        : non exposable -> null ; produit introuvable/inactif -> null ;
 *                         nominal -> kind/title/subtitle/cta_label/cta_action_ref/image_ref
 *                         exacts, JAMAIS price_kmf/stock brut
 *   physicalOfferCard   : non exposable -> null ; nominal -> jamais provider_id
 *   serviceCard         : non exposable -> null ; nominal -> jamais provider_id ni téléphone
 *   composeDiscoveryRail : market_id requis ; candidats explicites uniquement (aucune
 *                         sélection autonome) ; omission silencieuse des non-exposables
 *                         (jamais un objet d'erreur dans le résultat) ; cas de vérité
 *                         samboussas mixé avec un produit et un service dans un même rail
 *
 * DB et services propriétaires mockés — aucune connexion Postgres, aucun SQL direct sur
 * les tables local_stock, services ou physical_offers (vérifié : composeDiscoveryRail ne
 * passe jamais par mockDbQuery pour ces domaines, uniquement via les fonctions
 * isXExposable/getX importées).
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

// ─── productCard ─────────────────────────────────────────────────────────────

describe('productCard', () => {
  it('non exposable -> null, jamais de requête produit inutile', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(false);
    const result = await c.productCard(PRODUCT_ID, MARKET_ID);
    expect(result).toBeNull();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('exposable mais produit introuvable/inactif -> null', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({ rows: [] });
    const result = await c.productCard(PRODUCT_ID, MARKET_ID);
    expect(result).toBeNull();
  });

  it('nominal : climatiseur — champs exacts, jamais price_kmf ni stock brut', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({
      rows: [{ id: PRODUCT_ID, name: 'Climatiseur 12000 BTU', image_url: 'https://cdn/clim.jpg' }],
    });

    const card = await c.productCard(PRODUCT_ID, MARKET_ID);

    expect(card).toEqual({
      kind: 'product',
      title: 'Climatiseur 12000 BTU',
      subtitle: 'Disponible maintenant',
      cta_label: 'Acheter',
      cta_action_ref: PRODUCT_ID,
      image_ref: 'https://cdn/clim.jpg',
    });
    expect(Object.keys(card)).not.toContain('price_kmf');
    expect(Object.keys(card)).not.toContain('stock');

    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/is_active = true/);
  });
});

// ─── physicalOfferCard ───────────────────────────────────────────────────────

describe('physicalOfferCard — cas de vérité samboussas', () => {
  it('non exposable -> null, jamais de lecture inutile', async () => {
    const c = loadComposer();
    mockIsPhysicalOfferExposable.mockResolvedValue(false);
    const result = await c.physicalOfferCard(OFFER_ID, MARKET_ID);
    expect(result).toBeNull();
    expect(mockGetPhysicalOffer).not.toHaveBeenCalled();
  });

  it('nominal : Samboussas mariage — jamais provider_id', async () => {
    const c = loadComposer();
    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({
      id: OFFER_ID, provider_id: PROVIDER_ID, title: 'Samboussas mariage',
      description: 'Plateau de 50, préparation sur commande', zone: 'Moroni',
      market_id: MARKET_ID, status: 'active', commercial_exposure: 'ENABLED',
    });

    const card = await c.physicalOfferCard(OFFER_ID, MARKET_ID);

    expect(card).toEqual({
      kind: 'physical_offer',
      title: 'Samboussas mariage',
      subtitle: 'Préparation sur commande',
      cta_label: 'Commander',
      cta_action_ref: OFFER_ID,
      image_ref: null,
    });
    expect(card.provider_id).toBeUndefined();
  });
});

// ─── serviceCard ─────────────────────────────────────────────────────────────

describe('serviceCard', () => {
  it('non exposable -> null', async () => {
    const c = loadComposer();
    mockIsServiceExposable.mockResolvedValue(false);
    const result = await c.serviceCard(SERVICE_ID, MARKET_ID);
    expect(result).toBeNull();
    expect(mockGetService).not.toHaveBeenCalled();
  });

  it('nominal : Installation climatiseur — jamais provider_id ni téléphone', async () => {
    const c = loadComposer();
    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({
      id: SERVICE_ID, provider_id: PROVIDER_ID, title: 'Installation climatiseur',
      description: 'Pose et raccordement', zone: 'Moroni', market_id: MARKET_ID,
    });

    const card = await c.serviceCard(SERVICE_ID, MARKET_ID);

    expect(card).toEqual({
      kind: 'service',
      title: 'Installation climatiseur',
      subtitle: 'Sur demande',
      cta_label: 'Demander',
      cta_action_ref: SERVICE_ID,
      image_ref: null,
    });
    expect(JSON.stringify(card)).not.toMatch(/phone|téléphone|provider/i);
  });
});

// ─── composeDiscoveryRail ─────────────────────────────────────────────────────

describe('composeDiscoveryRail — un rail, candidats explicites, jamais de sélection autonome', () => {
  it('lève si market_id manquant', async () => {
    const c = loadComposer();
    await expect(c.composeDiscoveryRail({})).rejects.toThrow(/market_id est requis/);
  });

  it('aucun candidat fourni -> tableau vide, aucune requête émise', async () => {
    const c = loadComposer();
    const rail = await c.composeDiscoveryRail({ marketId: MARKET_ID });
    expect(rail).toEqual([]);
    expect(mockIsStockExposable).not.toHaveBeenCalled();
    expect(mockIsServiceExposable).not.toHaveBeenCalled();
    expect(mockIsPhysicalOfferExposable).not.toHaveBeenCalled();
  });

  it('omet silencieusement les non-exposables — jamais un objet d\'erreur dans le résultat', async () => {
    const c = loadComposer();
    mockIsStockExposable.mockResolvedValue(false); // produit non exposable

    const rail = await c.composeDiscoveryRail({ marketId: MARKET_ID, productIds: [PRODUCT_ID] });

    expect(rail).toEqual([]); // omis, pas un objet { error: ... }
  });

  it('cas de vérité — rail mixte Product Komerce + samboussas + service, un seul appel composé', async () => {
    const c = loadComposer();

    mockIsStockExposable.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({
      rows: [{ id: PRODUCT_ID, name: 'Climatiseur 12000 BTU', image_url: 'https://cdn/clim.jpg' }],
    });

    mockIsPhysicalOfferExposable.mockResolvedValue(true);
    mockGetPhysicalOffer.mockResolvedValue({
      id: OFFER_ID, title: 'Samboussas mariage',
      description: 'Plateau de 50, préparation sur commande',
    });

    mockIsServiceExposable.mockResolvedValue(true);
    mockGetService.mockResolvedValue({ id: SERVICE_ID, title: 'Installation climatiseur' });

    const rail = await c.composeDiscoveryRail({
      marketId: MARKET_ID,
      productIds: [PRODUCT_ID],
      physicalOfferIds: [OFFER_ID],
      serviceIds: [SERVICE_ID],
    });

    expect(rail).toHaveLength(3);
    expect(rail.map(card => card.kind).sort()).toEqual(['physical_offer', 'product', 'service']);
    // Chaque kind route un CTA différent — la distinction n'est jamais une
    // taxonomie visible, juste le verbe (RECHALLENGE_DOCTRINE_DISCOVERY_LOCALE_V2.md §F).
    const ctaByKind = Object.fromEntries(rail.map(card => [card.kind, card.cta_label]));
    expect(ctaByKind).toEqual({ product: 'Acheter', physical_offer: 'Commander', service: 'Demander' });
    // Tous les sous-titres sont présents, jamais optionnels.
    expect(rail.every(card => typeof card.subtitle === 'string' && card.subtitle.length > 0)).toBe(true);
  });

  it('rail mixte partiellement exposable — un seul candidat non exposable est omis, les autres restent', async () => {
    const c = loadComposer();

    mockIsStockExposable.mockResolvedValue(true);
    mockDbQuery.mockResolvedValue({ rows: [{ id: PRODUCT_ID, name: 'X', image_url: null }] });

    mockIsPhysicalOfferExposable.mockResolvedValue(false); // ex. Fatima a suspendu son offre

    const rail = await c.composeDiscoveryRail({
      marketId: MARKET_ID,
      productIds: [PRODUCT_ID],
      physicalOfferIds: [OFFER_ID],
    });

    expect(rail).toHaveLength(1);
    expect(rail[0].kind).toBe('product');
  });
});
