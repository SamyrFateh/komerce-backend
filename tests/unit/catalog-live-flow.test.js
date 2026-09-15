'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockListSources = jest.fn();
const mockConnectorCatalog = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/sourcing-source-autopilot', () => ({
  listSources: (...args) => mockListSources(...args),
}));
jest.mock('../../services/sourcing-import-dispatch', () => ({
  connectorCatalog: (...args) => mockConnectorCatalog(...args),
}));

const liveFlow = require('../../services/catalog-live-flow');

beforeEach(() => {
  jest.clearAllMocks();
  mockConnectorCatalog.mockReturnValue({
    api_suppliers: [
      { supplier: 'cj', label: 'CJdropshipping API', active: true, automation_available: true, reason: null },
      { supplier: 'noon', label: 'Noon API', active: false, automation_available: false, reason: 'credentials missing' },
    ],
    sources: [{ type: 'manual', label: 'Saisie manuelle', active: true }],
  });
});

test('le prédicat boutique live réutilise exposition ENABLED + prix LOCAL_ACTIVE', () => {
  const sql = liveFlow._test.boutiqueEffectiveSql('p');
  expect(sql).toContain('product_market_exposure');
  expect(sql).toContain("commercial_exposure = 'ENABLED'");
  expect(sql).toContain('product_market_price_drafts');
  expect(sql).toContain("status = 'LOCAL_ACTIVE'");
  expect(sql).toContain('p.is_active = TRUE');
  expect(sql).toContain('p.is_available = TRUE');
});

test.each([
  [{ state: 'raw_imported' }, 'captured'],
  [{ state: 'normalized' }, 'normalized'],
  [{ state: 'scanned' }, 'qualified'],
  [{ state: 'imported_to_catalog', product_ref: 'KPR-1', content_source: 'connector_raw', needs_review: false }, 'curation'],
  [{ state: 'imported_to_catalog', product_ref: 'KPR-1', content_source: 'ai_enriched', needs_review: false }, 'fr_ready'],
  [{ product_ref: 'KPR-1', product_is_active: true }, 'catalog'],
  [{ product_ref: 'KPR-1', product_is_active: true, boutique_effective: true }, 'boutique'],
])('projette une étape lisible sans inventer un état métier', (row, expected) => {
  expect(liveFlow._test.stageFromRow(row)).toBe(expected);
});

test('les totaux aval dédupliquent les produits canoniques multi-source', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    captured: 9, normalized: 8, qualified: 7, fr_ready: 4, curation: 3, catalog: 2, boutique: 1,
  }] });
  const totals = await liveFlow._test.queryPipelineTotals();
  expect(totals).toEqual({ captured: 9, normalized: 8, qualified: 7, fr_ready: 4, curation: 3, catalog: 2, boutique: 1 });
  expect(mockQuery.mock.calls[0][0]).toContain('COUNT(DISTINCT p.id)');
});

test('la projection compose source, raffinerie et catalogue de connectivité', async () => {
  mockListSources.mockResolvedValue([
    {
      source_ref: 'api:cj', adapter_type: 'cj', supplier_name: 'CJdropshipping', label: 'CJdropshipping API',
      autopilot_enabled: true, connector_ready: true, runtime_enabled: true,
    },
  ]);
  mockQuery
    .mockResolvedValueOnce({ rows: [{ captured: 5, normalized: 4, qualified: 3, fr_ready: 2, curation: 2, catalog: 1, boutique: 1 }] })
    .mockResolvedValueOnce({ rows: [{ supplier_name: 'CJdropshipping', captured: 5, normalized: 4, qualified: 3, fr_ready: 2, curation: 2, catalog: 1, boutique: 1 }] })
    .mockResolvedValueOnce({ rows: [{
      candidate_ref: 'KSC-1', supplier_name: 'CJdropshipping', supplier_product_id: 'CJ-1', product_name: 'Produit',
      purchase_price: 12, purchase_price_kmf: 1500, currency: 'USD', stock_available: 8, state: 'scanned',
      product_ref: null, content_source: null, needs_review: false, product_is_active: false, boutique_effective: false,
      updated_at: '2026-09-16T00:00:00Z',
    }] });

  const projection = await liveFlow.buildProjection({ incomingLimit: 5 });
  expect(projection.mode).toBe('live_catalog_flow');
  expect(projection.sources[0]).toEqual(expect.objectContaining({
    source_ref: 'api:cj',
    autopilot_enabled: true,
    pipeline: expect.objectContaining({ captured: 5, boutique: 1 }),
  }));
  expect(projection.incoming[0]).toEqual(expect.objectContaining({ stage: 'qualified', next_step: 'Promotion catalogue' }));
  expect(projection.source_catalog).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'cj', automation_available: true }),
    expect.objectContaining({ key: 'noon', automation_available: false, connector_ready: false }),
  ]));
  expect(projection.source_toggle_endpoint).toContain('/api/admin/workspaces/sourcing/sources/');
});
