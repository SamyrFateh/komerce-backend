'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db');

const db = require('../../db');
const {
  CatalogChangeObservationError,
  validateUnitStockChange,
  persistUnitStockChange,
  recordUnitStockChange,
} = require('../../services/sourcing-catalog-change-observation');

function envelope(fact = { status: 'OBSERVED', value: 0 }) {
  return {
    source: { provider: 'cj', account_scope: 'default', source_ref: 'cj-product-1' },
    method: 'PULL_EXACT', event_id: 'supplier-event-1',
    observed_at: '2026-09-23T20:00:00Z',
    subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
    facts: { stock_available: fact },
  };
}

function clientWithSource() {
  const seen = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      seen.push({ sql: String(sql), params });
      if (String(sql).includes('FROM sourcing_sources')) {
        return { rows: [{ source_id: 'api:cj', adapter_type: 'cj', status: 'active' }] };
      }
      if (String(sql).includes('FROM sourcing_captures')) return { rows: [] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return { client, seen };
}

beforeEach(() => jest.clearAllMocks());

test('exact OBSERVED zero preserves zero, provenance, and no application to Catalog', async () => {
  const { client, seen } = clientWithSource();
  const result = await persistUnitStockChange(client, {
    sourceRef: 'api:cj', envelope: envelope(),
  });
  expect(result).toMatchObject({ status: 'recorded', observations: 1,
    application_status: 'NOT_EVALUATED' });
  const inserted = seen.find(c => c.sql.includes('INSERT INTO sourcing_observations'));
  const normalized = JSON.parse(inserted.params[4]);
  const provenance = JSON.parse(inserted.params[5]);
  expect(normalized).toMatchObject({ observation_kind: 'CATALOG_CHANGE_DELTA',
    product_ref: 'product-1', unit_ref: 'unit-1', stock_available: 0 });
  expect(provenance.stock_available).toMatchObject({
    status: 'OBSERVED', provider: 'cj', account_scope: 'default',
    event_id: 'supplier-event-1',
  });
  expect(seen.some(c => /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*(?:products|product_skus|orders)\b/i.test(c.sql))).toBe(false);
  expect(seen.some(c => c.sql.includes('sourcing_resolution'))).toBe(false);
});

test('UNKNOWN does not become zero or a stock value', async () => {
  const { client, seen } = clientWithSource();
  await persistUnitStockChange(client, {
    sourceRef: 'api:cj', envelope: envelope({ status: 'UNKNOWN', reason: 'stock not exposed' }),
  });
  const inserted = seen.find(c => c.sql.includes('INSERT INTO sourcing_observations'));
  const normalized = JSON.parse(inserted.params[4]);
  const provenance = JSON.parse(inserted.params[5]);
  expect(normalized).not.toHaveProperty('stock_available');
  expect(provenance.stock_available.status).toBe('UNKNOWN');
});

test.each([
  ['inconsistent source/account', 'api:allegro', envelope(), 'catalog_change_source_mismatch'],
  ['missing exact unit', 'api:cj', { ...envelope(), subject: { product_ref: 'product-1' } },
    'catalog_change_exact_identity_required'],
  ['mixed stock and price', 'api:cj', { ...envelope(),
    facts: { stock_available: { status: 'OBSERVED', value: 0 },
      purchase_price: { status: 'OBSERVED', value: 10 } } }, 'catalog_change_stock_only'],
  ['unsupported manual source', 'api:cj', { ...envelope(), method: 'MANUAL' },
    'catalog_change_api_source_only'],
  ['no event ID', 'api:cj', { ...envelope(), event_id: null },
    'catalog_change_exact_identity_required'],
])('%s fails before DB writes', async (_label, sourceRef, change, code) => {
  const { client } = clientWithSource();
  await expect(persistUnitStockChange(client, { sourceRef, envelope: change }))
    .rejects.toMatchObject({ code });
  expect(client.query).not.toHaveBeenCalled();
});

test('source missing or disabled refuses to persist an observation', async () => {
  const { client, seen } = clientWithSource();
  client.query.mockImplementation(async (sql) => {
    seen.push({ sql: String(sql) });
    return { rows: [] };
  });
  await expect(persistUnitStockChange(client, { sourceRef: 'api:cj', envelope: envelope() }))
    .rejects.toMatchObject({ status: 409, code: 'catalog_change_source_unavailable' });
  expect(seen.some(c => c.sql.includes('INSERT'))).toBe(false);
});

test('event ID replay is idempotent only for an identical fact', async () => {
  const { client, seen } = clientWithSource();
  let firstDigest = null;
  client.query.mockImplementation(async (sql, params) => {
    seen.push({ sql: String(sql), params });
    if (String(sql).includes('FROM sourcing_sources')) {
      return { rows: [{ source_id: 'api:cj', adapter_type: 'cj', status: 'active' }] };
    }
    if (String(sql).includes('INSERT INTO sourcing_captures')) {
      firstDigest = JSON.parse(params[3]).fingerprint;
    }
    if (String(sql).includes('FROM sourcing_captures')) {
      return { rows: firstDigest ? [{ capture_id: 'first-capture', fingerprint: firstDigest }] : [] };
    }
    return { rows: [] };
  });
  await persistUnitStockChange(client, { sourceRef: 'api:cj', envelope: envelope() });
  const retry = await persistUnitStockChange(client, { sourceRef: 'api:cj', envelope: envelope() });
  expect(retry).toMatchObject({ status: 'already_recorded', capture_id: 'first-capture' });
  const changed = envelope({ status: 'OBSERVED', value: 2 });
  await expect(persistUnitStockChange(client, { sourceRef: 'api:cj', envelope: changed }))
    .rejects.toMatchObject({ code: 'catalog_change_event_collision' });
  expect(seen.filter(c => c.sql.includes('INSERT INTO sourcing_observations'))).toHaveLength(1);
});

test('owner commits the observation transaction and always releases the client', async () => {
  const { client, seen } = clientWithSource();
  db.getClient.mockResolvedValue(client);
  const result = await recordUnitStockChange({ sourceRef: 'api:cj', envelope: envelope() });
  expect(result.status).toBe('recorded');
  expect(seen[0].sql).toBe('BEGIN');
  expect(seen[seen.length - 1].sql).toBe('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('owner rolls back and never commits when the source or event is rejected', async () => {
  const { client, seen } = clientWithSource();
  db.getClient.mockResolvedValue(client);
  client.query.mockImplementation(async (sql) => {
    seen.push({ sql: String(sql) });
    if (String(sql).includes('FROM sourcing_sources')) return { rows: [] };
    return { rows: [] };
  });
  await expect(recordUnitStockChange({ sourceRef: 'api:cj', envelope: envelope() }))
    .rejects.toBeInstanceOf(CatalogChangeObservationError);
  expect(seen.map(x => x.sql)).toContain('ROLLBACK');
  expect(seen.map(x => x.sql)).not.toContain('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('input validation rejects a forged value for UNKNOWN', () => {
  expect(() => validateUnitStockChange('api:cj', envelope({
    status: 'UNKNOWN', value: 0, reason: 'not exposed',
  }))).toThrow(CatalogChangeObservationError);
});
