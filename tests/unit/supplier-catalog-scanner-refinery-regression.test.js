'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: jest.fn(),
  recommend: jest.fn(),
}));

const pricingEngine = require('../../services/pricing-engine');
const {
  normalizeCandidate,
  scanCandidate,
  mapProductCategory,
  economicTestHealth,
} = require('../../services/supplier-catalog-scanner');

const config = {
  finance: {
    taux_aed_kmf: 138,
    taux_change_eur_kmf: 492,
    target_marge_brute_pct: 40,
  },
  categories: {
    phones: { key: 'phones', default_margin_pct: 30 },
    vetements: { key: 'vetements', default_margin_pct: 45 },
    ceremonie: { key: 'ceremonie', default_margin_pct: 55 },
    electro: { key: 'electro', default_margin_pct: 32 },
    cosmetiques: { key: 'cosmetiques', default_margin_pct: 50 },
    mariage: { key: 'mariage', default_margin_pct: 55 },
    enfants: { key: 'enfants', default_margin_pct: 32 },
    materiels: { key: 'materiels', default_margin_pct: 35 },
  },
};

const cats = Object.values(config.categories);

describe('AliExpress refinery canonical regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pricingEngine.loadGlobalConfig.mockResolvedValue(config);
  });

  it('preserve la segmentation de découverte au lieu de tomber silencieusement sur phones', () => {
    expect(mapProductCategory({
      supplier_category: 'AliExpress category 63705',
      product_name: 'Women Summer Dress',
      raw_payload: {
        discovery: {
          segment_id: 'mode-femme',
          target_category: 'Mode & Beauté',
          target_subcategory: 'Femme',
          keyword: 'women dress',
        },
      },
    }, cats)).toEqual({ key: 'vetements', source: 'mapped', confidence: 'high' });

    expect(mapProductCategory({
      supplier_category: 'AliExpress category 440504',
      product_name: 'Cordless Drill',
      raw_payload: { discovery: { segment_id: 'bricolage-outillage', keyword: 'power tools' } },
    }, cats)).toEqual({ key: 'materiels', source: 'mapped', confidence: 'high' });
  });

  it('normalise un candidat AliExpress avec la categorie Komerce issue de la provenance', async () => {
    const candidate = await normalizeCandidate({
      supplier_name: 'AliExpress',
      supplier_product_id: '1005007228440475',
      product_name: 'Women Summer Dress',
      supplier_category: 'AliExpress category 63705',
      purchase_price: 4.55,
      currency: 'USD',
      weight_kg: 0.053,
      dimensions: { l_cm: 20, w_cm: 10, h_cm: 3.4 },
      raw_payload: { discovery: { segment_id: 'mode-femme', keyword: 'women dress' } },
    }, { config });

    expect(candidate.komerce_category).toBe('vetements');
    expect(candidate.data_sources.category).toBe('mapped');
    expect(candidate.target_margin_pct).toBe(45);
  });

  it('qualifie TEST sur la reference economique sans inventer un prix marche', async () => {
    pricingEngine.recommend.mockResolvedValue({
      health_status: 'unknown',
      market_confidence: 'unknown',
      sourcing_decision: 'TEST',
      variable_cost_complete_kmf: 1800,
      test_price_kmf: 3000,
      recommended_price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
      price_decision_status: 'MARKET_OR_HUMAN_DECISION_REQUIRED',
    });

    const result = await scanCandidate({
      komerce_category: 'vetements',
      purchase_price_kmf: 1000,
      estimated_weight_kg: 0.3,
      estimated_volume_m3: 0.002,
      data_sources: { category: 'mapped' },
      confidence: 'high',
    }, { config });

    expect(result.sourcing_decision).toBe('TEST');
    expect(result.scan_result.health_status).toBe('unknown');
    expect(result.scan_result.economic_test_health_status).toBe('healthy');
    expect(result.scan_result.economic_test_margin_pct).toBe(40);
    expect(result.scan_result.recommended_price_authority).toBe('ECONOMIC_REFERENCE_NOT_MARKET_DECISION');
    expect(result.reason).toMatch(/sans traiter cette référence comme un prix marché/i);
  });

  it('bloque un candidat dont la categorie reste un fallback par defaut', async () => {
    const result = await scanCandidate({
      komerce_category: 'phones',
      purchase_price_kmf: 1000,
      data_sources: { category: 'default' },
    }, { config });

    expect(result.sourcing_decision).toBe('WATCH');
    expect(result.reason).toMatch(/Catégorie Komerce non résolue/);
    expect(pricingEngine.recommend).not.toHaveBeenCalled();
  });

  it('classe la sante economique de la reference test indépendamment du prix marché', () => {
    expect(economicTestHealth({ variable_cost_complete_kmf: 1800, test_price_kmf: 3000 }))
      .toEqual({ status: 'healthy', margin_pct: 40 });
    expect(economicTestHealth({ variable_cost_complete_kmf: 3100, test_price_kmf: 3000 }).status)
      .toBe('loss');
  });
});