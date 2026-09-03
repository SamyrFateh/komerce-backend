'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/discovery-rail-composer', () => ({
  composeDiscoveryRail: jest.fn(),
}));

const db = require('../../db');
const { composeDiscoveryRail } = require('../../services/discovery-rail-composer');
const {
  isEnabled,
  parseEditorialCandidates,
  getDiscoveryRail,
} = require('../../services/discovery-rail-service');

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const OFFER_ID   = '22222222-2222-2222-2222-222222222222';
const SERVICE_ID = '33333333-3333-3333-3333-333333333333';
const MARKET_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DISCOVERY_RAIL_ENABLED;
  delete process.env.DISCOVERY_RAIL_CANDIDATES;
});

describe('discovery-rail-service — activation', () => {
  it('est OFF par défaut', () => {
    expect(isEnabled()).toBe(false);
  });

  it('accepte uniquement une activation serveur explicite', () => {
    process.env.DISCOVERY_RAIL_ENABLED = 'true';
    expect(isEnabled()).toBe(true);
    process.env.DISCOVERY_RAIL_ENABLED = '0';
    expect(isEnabled()).toBe(false);
  });

  it('rail OFF -> [] sans DB ni composeur', async () => {
    process.env.DISCOVERY_RAIL_CANDIDATES = `product:${PRODUCT_ID}`;
    await expect(getDiscoveryRail({ marketCode: 'KM' })).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
    expect(composeDiscoveryRail).not.toHaveBeenCalled();
  });
});

describe('discovery-rail-service — politique éditoriale', () => {
  it('filtre les kinds/UUID invalides et conserve ordre + compatibilité sans scope', () => {
    const parsed = parseEditorialCandidates([
      `physical_offer:${OFFER_ID}`,
      'marketplace_item:44444444-4444-4444-4444-444444444444',
      `service:${SERVICE_ID}`,
      `physical_offer:${OFFER_ID}`,
      'product:not-a-uuid',
      `product:${PRODUCT_ID}`,
    ].join(','));

    expect(parsed.map(candidate => candidate.key)).toEqual([
      `physical_offer:${OFFER_ID}`,
      `service:${SERVICE_ID}`,
      `product:${PRODUCT_ID}`,
    ]);
    expect(parsed.every(candidate => candidate.categoryKeys.length === 0)).toBe(true);
  });

  it('fusionne les scopes catégorie d un même candidat sans dupliquer son ordre', () => {
    const parsed = parseEditorialCandidates([
      `service:${SERVICE_ID}@Maison|Bricolage`,
      `product:${PRODUCT_ID}`,
      `service:${SERVICE_ID}@Tech|Maison`,
    ].join(','));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(expect.objectContaining({
      kind: 'service',
      id: SERVICE_ID,
      key: `service:${SERVICE_ID}`,
      categoryKeys: ['Maison', 'Bricolage', 'Tech'],
    }));
    expect(parsed[1].categoryKeys).toEqual([]);
  });

  it('réapplique exactement l ordre éditorial et fusionne contexte source + contexte recommendations', async () => {
    process.env.DISCOVERY_RAIL_ENABLED = '1';
    process.env.DISCOVERY_RAIL_CANDIDATES = [
      `physical_offer:${OFFER_ID}@Maison`,
      `service:${SERVICE_ID}@Tech|Maison`,
      `product:${PRODUCT_ID}`,
    ].join(',');

    db.query.mockResolvedValue({ rows: [{ id: MARKET_ID }] });
    composeDiscoveryRail.mockResolvedValue([
      { kind: 'product', cta_action_ref: PRODUCT_ID, title: 'Climatiseur', category_keys: ['Tech'] },
      { kind: 'physical_offer', cta_action_ref: OFFER_ID, title: 'Samboussas', category_keys: [] },
      { kind: 'service', cta_action_ref: SERVICE_ID, title: 'Installation', category_keys: ['Bricolage'] },
    ]);

    const cards = await getDiscoveryRail({ marketCode: 'KM' });

    expect(db.query).toHaveBeenCalledWith(
      'SELECT id FROM markets WHERE code = $1 AND is_active = true',
      ['KM']
    );
    expect(composeDiscoveryRail).toHaveBeenCalledWith({
      marketId: MARKET_ID,
      productIds: [PRODUCT_ID],
      physicalOfferIds: [OFFER_ID],
      serviceIds: [SERVICE_ID],
    });
    expect(cards.map(card => card.kind)).toEqual(['physical_offer', 'service', 'product']);
    expect(cards[0].category_keys).toEqual(['Maison']);
    expect(cards[1].category_keys).toEqual(['Bricolage', 'Tech', 'Maison']);
    expect(cards[2].category_keys).toEqual(['Tech']);
  });

  it('market inconnu -> [] sans composition', async () => {
    process.env.DISCOVERY_RAIL_ENABLED = '1';
    process.env.DISCOVERY_RAIL_CANDIDATES = `product:${PRODUCT_ID}`;
    db.query.mockResolvedValue({ rows: [] });

    await expect(getDiscoveryRail({ marketCode: 'XX' })).resolves.toEqual([]);
    expect(composeDiscoveryRail).not.toHaveBeenCalled();
  });
});
