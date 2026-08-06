'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db');
jest.mock('../../services/supplier-catalog-scanner');
jest.mock('../../services/pricing-engine');
jest.mock('../../services/catalog-eligibility');

const db = require('../../db');
const scanner = require('../../services/supplier-catalog-scanner');
const pricingEngine = require('../../services/pricing-engine');
const eligibility = require('../../services/catalog-eligibility');
const { importCatalog } = require('../../services/suppliers/catalog-import-orchestrator');

function richSourceProduct() {
  return {
    schema_version: '2',
    supplier_name: 'Dubai Fashion',
    supplier_product_id: 'ROB-001',
    product_name: 'Dubai dress',
    currency: 'AED',
    media: [{
      supplier_media_id: 'scene-brown',
      url: 'https://cdn.example.com/scene-brown.jpg',
      role: 'SCENE',
      option_values: { Couleur: 'Marron' },
    }],
    option_axes: [
      { key: 'Couleur', values: ['Marron'] },
      { key: 'Taille', values: ['M', 'L'] },
    ],
    sellable_units: [
      {
        supplier_sku: 'ROB-MAR-M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
        stock_available: 4,
        media_refs: ['scene-brown'],
      },
      {
        supplier_sku: 'ROB-MAR-L',
        option_values: { Couleur: 'Marron', Taille: 'L' },
        stock_available: 0,
        media_refs: ['scene-brown'],
      },
    ],
    raw_payload: {
      supplierId: 'ROB-001',
      originalMedia: [{ kind: 'lifestyle', src: 'scene-brown.jpg' }],
      variants: [{ code: 'ROB-MAR-M' }, { code: 'ROB-MAR-L' }],
    },
  };
}

function setupHappyPathCapture() {
  let candidateSql = null;
  let candidateParams = null;

  db.query.mockImplementation((sql, params) => {
    if (sql.includes('SELECT key, value FROM business_rules')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('INSERT INTO supplier_catalog_imports')) {
      return Promise.resolve({ rows: [{ id: 'import-v2' }] });
    }
    if (sql.includes('INSERT INTO sourcing_candidates')) {
      candidateSql = sql;
      candidateParams = params;
      return Promise.resolve({
        rows: [{ id: 'candidate-v2', data_sources: {}, was_updated: false }],
      });
    }
    return Promise.resolve({ rows: [] });
  });

  scanner.normalizeCandidate.mockResolvedValue({
    komerce_category: 'vetements',
    estimated_weight_kg: 0.4,
    estimated_volume_m3: 0.005,
    purchase_price_kmf: 5000,
    target_margin_pct: 40,
    data_sources: {},
    confidence: 'high',
  });
  scanner.scanCandidate.mockResolvedValue({
    scan_result: { score: 0.9 },
    sourcing_decision: 'TEST',
    reason: 'ok',
    recommended_action: 'tester',
    confidence: 'high',
  });
  pricingEngine.loadGlobalConfig.mockResolvedValue({ categories: {}, finance: {} });
  eligibility.loadActiveExclusions.mockResolvedValue([]);
  eligibility.checkEligibility.mockReturnValue({ layer: null, eligible: true });

  return {
    getCandidateSql: () => candidateSql,
    getCandidateParams: () => candidateParams,
  };
}

describe('catalog source V2 persistence contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    require('../../utils/rules').invalidateCache();
  });

  test('persiste séparément le brut exact et le snapshot normalisé riche', async () => {
    const product = richSourceProduct();
    const capture = setupHappyPathCapture();

    const result = await importCatalog(
      { supplier_name: 'Dubai Fashion', source_type: 'manual' },
      'user-1',
      jest.fn().mockResolvedValue({ products: [product], invalid: [] })
    );

    expect(result.status).toBe(200);
    expect(capture.getCandidateSql()).toContain('normalized_source_contract');

    const params = capture.getCandidateParams();
    expect(params).toContain(JSON.stringify(product.raw_payload));

    const snapshotRaw = params[29];
    const snapshot = JSON.parse(snapshotRaw);
    expect(snapshot.schema_version).toBe('2');
    expect(snapshot.media).toEqual(product.media);
    expect(snapshot.option_axes).toEqual(product.option_axes);
    expect(snapshot.sellable_units).toEqual(product.sellable_units);
    expect(snapshot).not.toHaveProperty('raw_payload');
  });

  test('un produit V1 garde normalized_source_contract à NULL', async () => {
    const product = {
      supplier_name: 'Legacy',
      supplier_product_id: 'LEG-1',
      product_name: 'Produit plat',
      currency: 'AED',
      raw_payload: { ref: 'LEG-1' },
    };
    const capture = setupHappyPathCapture();

    const result = await importCatalog(
      { supplier_name: 'Legacy', source_type: 'manual' },
      'user-1',
      jest.fn().mockResolvedValue({ products: [product], invalid: [] })
    );

    expect(result.status).toBe(200);
    expect(capture.getCandidateParams()[29]).toBeNull();
  });

  test('le re-import remplace le snapshot normalisé sans toucher à la sémantique du raw_payload', async () => {
    const product = richSourceProduct();
    const capture = setupHappyPathCapture();

    await importCatalog(
      { supplier_name: 'Dubai Fashion', source_type: 'manual' },
      'user-1',
      jest.fn().mockResolvedValue({ products: [product], invalid: [] })
    );

    expect(capture.getCandidateSql()).toContain(
      'normalized_source_contract = EXCLUDED.normalized_source_contract'
    );
    expect(capture.getCandidateSql()).toContain('raw_payload         = EXCLUDED.raw_payload');
  });
});
