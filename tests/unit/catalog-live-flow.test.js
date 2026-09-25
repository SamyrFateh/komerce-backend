'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockListSources = jest.fn();
const mockConnectorCatalog = jest.fn();
const mockSourceAutomationDescriptor = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/sourcing-source-autopilot', () => ({
  listSources: (...args) => mockListSources(...args),
}));
jest.mock('../../services/sourcing-import-dispatch', () => ({
  connectorCatalog: (...args) => mockConnectorCatalog(...args),
  sourceAutomationDescriptor: (...args) => mockSourceAutomationDescriptor(...args),
}));

const liveFlow = require('../../services/catalog-live-flow');

function validCandidate() {
  return {
    id: 'p-ready',
    product_ref: 'KPR-READY',
    name: 'Produit prêt',
    description: 'Description client suffisamment longue.',
    category: 'Maison',
    price_kmf: 5000,
    stock: 4,
    lifecycle_status: 'candidate',
    is_active: false,
    is_available: true,
    content_source: 'manual',
    source_locale: 'fr',
    catalog_media_count: 1,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConnectorCatalog.mockReturnValue({
    api_suppliers: [
      { supplier: 'cj', label: 'CJdropshipping API', active: true, reason: null },
      { supplier: 'noon', label: 'Noon API', active: false, reason: 'credentials missing' },
    ],
    sources: [{ type: 'manual', label: 'Saisie manuelle', active: true }],
  });
  mockSourceAutomationDescriptor.mockImplementation((adapter) => (
    String(adapter).toLowerCase() === 'cj' ? { adapter: 'cj' } : null
  ));
});

test('le compteur technique sans marché ne prétend plus être une vérité boutique', () => {
  const sql = liveFlow._test.boutiqueEffectiveSql('p');
  expect(sql).toContain('p.is_active = TRUE');
  expect(sql).toContain('p.is_available = TRUE');
  expect(sql).toContain('product_skus');
  expect(sql).not.toContain('product_market_exposure');
  expect(sql).not.toContain('product_market_price_drafts');
});

test.each([
  [{ state: 'raw_imported' }, 'captured'],
  [{ state: 'normalized' }, 'normalized'],
  [{ state: 'scanned' }, 'qualified'],
  [{ state: 'imported_to_catalog', product_ref: 'KPR-1', content_source: 'connector_raw', needs_review: false }, 'curation'],
  [{ state: 'imported_to_catalog', product_ref: 'KPR-1', content_source: 'ai_enriched', needs_review: false }, 'fr_ready'],
  [{ state: 'imported_to_catalog', product_ref: 'KPR-2', content_source: 'manual', needs_review: false }, 'fr_ready'],
  [{ state: 'imported_to_catalog', product_ref: 'KPR-3', content_source: 'connector_raw', source_locale: 'fr', needs_review: false }, 'fr_ready'],
  [{ product_ref: 'KPR-1', product_is_active: true }, 'catalog'],
])('conserve les états techniques pour le drill-down sans en faire le vocabulaire principal', (row, expected) => {
  expect(liveFlow._test.stageFromRow(row)).toBe(expected);
});

test('Prêt à publier réutilise le vrai guard de première publication', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    validCandidate(),
    { ...validCandidate(), id: 'p-no-media', product_ref: 'KPR-NO-MEDIA', catalog_media_count: 0 },
  ] });

  await expect(liveFlow._test.queryReadyToPublish()).resolves.toBe(1);
});

test('Visible par marché réutilise exactement le prédicat public market-scoped', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'm-km', code: 'KM', name: 'Comores', currency: 'KMF' }] })
    .mockResolvedValueOnce({ rows: [{ count: 3 }] });

  const rows = await liveFlow._test.queryMarketVisibility();
  expect(rows).toEqual([expect.objectContaining({ market_code: 'KM', visible: 3 })]);

  const [sql, params] = mockQuery.mock.calls[1];
  expect(params).toEqual(['KM']);
  expect(sql).toContain('product_market_exposure');
  expect(sql).toContain("commercial_exposure = 'ENABLED'");
  expect(sql).toContain('product_market_price_drafts');
  expect(sql).toContain("status = 'LOCAL_ACTIVE'");
  expect(sql).toContain('product_skus');
  expect(sql).toContain('supplier_order_identity');
});

test('la projection principale expose Sourcé → Prêt à publier → Publié → Visible', async () => {
  mockListSources.mockResolvedValue([
    {
      source_ref: 'api:cj', adapter_type: 'cj', supplier_name: 'CJdropshipping', label: 'CJdropshipping API',
      autopilot_enabled: true, connector_ready: true, runtime_enabled: true,
    },
  ]);

  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('COUNT(DISTINCT COALESCE(sc.product_id::text, sc.candidate_ref))')) {
      return { rows: [{ count: 5 }] };
    }
    if (text.includes('LEFT JOIN catalog_media cm')) {
      return { rows: [validCandidate()] };
    }
    if (text.includes('FROM products\n     WHERE is_active = TRUE')) {
      return { rows: [{ count: 2 }] };
    }
    if (text.includes('FROM markets') && text.includes('ORDER BY name ASC')) {
      return { rows: [{ id: 'm-km', code: 'KM', name: 'Comores', currency: 'KMF' }] };
    }
    if (text.includes('SELECT COUNT(*)::int AS count FROM products p WHERE')) {
      return { rows: [{ count: 1 }] };
    }
    if (text.includes('GROUP BY sc.supplier_name')) {
      return { rows: [{ supplier_name: 'CJdropshipping', captured: 5, normalized: 4, qualified: 3, fr_ready: 2, curation: 1, catalog: 2, boutique: 1 }] };
    }
    if (text.includes('ORDER BY sc.updated_at DESC')) {
      return { rows: [{
        candidate_ref: 'KSC-1', supplier_name: 'CJdropshipping', supplier_product_id: 'CJ-1', product_name: 'Produit',
        purchase_price: 12, purchase_price_kmf: 1500, currency: 'USD', stock_available: 8, state: 'scanned',
        product_ref: null, content_source: null, needs_review: false, product_is_active: false, boutique_effective: false,
        updated_at: '2026-09-16T00:00:00Z',
      }] };
    }
    if (text.includes('COUNT(*) FILTER') && text.includes('FROM sourcing_candidates sc')) {
      return { rows: [{ captured: 5, normalized: 4, qualified: 3, fr_ready: 2, curation: 1, catalog: 2, boutique: 1 }] };
    }
    throw new Error(`SQL mock non prévu: ${text.slice(0, 120)}`);
  });

  const projection = await liveFlow.buildProjection({ incomingLimit: 5 });
  expect(projection.mode).toBe('live_catalog_flow');
  expect(projection.business).toEqual(expect.objectContaining({
    mode: 'business_truth',
    stages: { sourced: 5, ready_to_publish: 1, published: 2 },
    vocabulary: {
      sourced: 'Sourcé',
      ready_to_publish: 'Prêt à publier',
      published: 'Publié',
      visible: 'Visible',
    },
  }));
  expect(projection.business.markets).toEqual([
    expect.objectContaining({ market_code: 'KM', visible: 1 }),
  ]);
  expect(projection.incoming[0]).toEqual(expect.objectContaining({ stage: 'qualified' }));
  expect(projection.source_toggle_endpoint).toContain('/api/admin/workspaces/sourcing/sources/');
});
