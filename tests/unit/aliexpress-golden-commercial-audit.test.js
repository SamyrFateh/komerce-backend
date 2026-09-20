/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const audit = require('../../scripts/aliexpress-golden-commercial-audit');

function candidate(overrides = {}) {
  return {
    id: audit.CANDIDATE_ID,
    supplier_name: 'AliExpress',
    supplier_product_id: audit.SUPPLIER_PRODUCT_ID,
    state: 'scanned', product_id: null, import_id: 'batch-1',
    purchase_price: 2.85, purchase_price_kmf: 1300, currency: 'USD',
    estimated_weight_kg: 0.1, estimated_volume_m3: 0.001,
    normalized_source_contract: {
      sellable_units: [{
        is_active: true, stock_available: 10, supplier_sku: 'SKU-1',
        supplier_unit_ref: 'UNIT-1',
        supplier_order_identity: {
          provider: 'aliexpress', version: 1, payload: { sku_id: '1234' },
        },
      }],
    },
    scan_result: {
      sourcing_decision: 'TEST',
      recommended_price_kmf: 4990,
      test_price_kmf: 4990,
      eligibility: null,
    },
    ...overrides,
  };
}

test('pre-commercial scan never turns a recommended price into a decided price', () => {
  const report = audit.reportCandidate(candidate(), 'COMPLETED');
  expect(report.scanner.recommended_price_kmf).toBe(4990);
  expect(report).not.toHaveProperty('price_kmf');
  expect(report.blockers).toContain('EXPLICIT_PRICE_AND_CATALOG_DRAFT_DECISION_PENDING');
  expect(report.source.identity.complete).toBe(true);
});

test('the exact read-only candidate audit reports pending commercial decision without any write', async () => {
  const q = {
    query: jest.fn(async (sql) => {
      if (String(sql).includes('FROM sourcing_candidates')) return { rows: [candidate()] };
      if (String(sql).includes('FROM supplier_catalog_imports')) return { rows: [{ status: 'COMPLETED' }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const result = await audit.run({
    env: { KOMERCE_ENV: 'staging', DATABASE_URL: 'test-only' },
    executor: { getClient: async () => q },
  });
  expect(result).toMatchObject({
    writes: false,
    commercial_verdict: 'NOT_YET_VISIBLE_OR_SELLABLE',
    purchase_invoked: false,
    publication_performed: false,
    product: { found: false, market: { currently_visible: false } },
  });
  expect(q.query.mock.calls.map(([sql]) => String(sql))).toEqual([
    'BEGIN TRANSACTION READ ONLY',
    expect.stringContaining('FROM sourcing_candidates'),
    expect.stringContaining('FROM supplier_catalog_imports'),
    'COMMIT',
  ]);
  expect(q.release).toHaveBeenCalledTimes(1);
});

test('audit fails closed outside staging and for wrong candidate identity', async () => {
  await expect(audit.run({ env: { KOMERCE_ENV: 'production', DATABASE_URL: 'test-only' } }))
    .rejects.toThrow('ALI_COMMERCIAL_AUDIT_STAGING_ONLY');
  const q = {
    query: jest.fn(async (sql) => {
      if (String(sql).includes('FROM sourcing_candidates')) {
        return { rows: [candidate({ supplier_product_id: '9999999999' })] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  await expect(audit.run({
    env: { KOMERCE_ENV: 'staging', DATABASE_URL: 'test-only' },
    executor: { getClient: async () => q },
  })).rejects.toThrow('ALI_COMMERCIAL_AUDIT_EXACT_CANDIDATE_NOT_FOUND');
  expect(q.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  expect(q.release).toHaveBeenCalledTimes(1);
});
