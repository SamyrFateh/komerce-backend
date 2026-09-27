'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Isolated CI PostgreSQL only. Synthetic provider/source/units, every write
 * rolled back. No external provider API, publication, payment or Purchasing.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('catalog change unit stock: isolated CI database required', () => {
    test('never writes to non-isolated databases', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');
  const { persistUnitStockChange } = require('../../services/sourcing-catalog-change-observation');

  jest.setTimeout(30000);

  function change(provider, eventId, stock) {
    return {
      source: { provider, account_scope: 'default', source_ref: 'synthetic-product' },
      method: 'PULL_EXACT', event_id: eventId, observed_at: '2026-09-23T20:00:00Z',
      subject: { product_ref: 'synthetic-product', unit_ref: 'synthetic-unit' },
      facts: { stock_available: stock },
    };
  }

  test('exact 0, replay, collision and UNKNOWN persist as immutable, separate observations', async () => {
    const client = await db.getClient();
    const provider = 'delta' + randomUUID().replace(/-/g, '').slice(0, 12);
    const sourceRef = 'api:' + provider;
    let begun = false;
    try {
      await client.query('BEGIN');
      begun = true;
      await client.query(
        "INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
        "VALUES ($1,$2,'pull','recurring','active')",
        [sourceRef, provider]
      );
      const zero = change(provider, 'event-stock-zero', { status: 'OBSERVED', value: 0 });
      const first = await persistUnitStockChange(client, { sourceRef, envelope: zero });
      expect(first.status).toBe('recorded');
      expect(first.application_status).toBe('NOT_EVALUATED');
      const retry = await persistUnitStockChange(client, { sourceRef, envelope: zero });
      expect(retry).toMatchObject({ status: 'already_recorded', capture_id: first.capture_id });
      await expect(persistUnitStockChange(client, {
        sourceRef, envelope: change(provider, 'event-stock-zero', { status: 'OBSERVED', value: 5 }),
      })).rejects.toMatchObject({ code: 'catalog_change_event_collision', status: 409 });

      const unknown = await persistUnitStockChange(client, {
        sourceRef, envelope: change(provider, 'event-stock-unknown',
          { status: 'UNKNOWN', reason: 'supplier API returned no stock fact' }),
      });
      expect(unknown.status).toBe('recorded');
      const { rows } = await client.query(
        "SELECT c.capture_id, c.stats, o.grain, o.source_ref, " +
        "o.normalized, o.field_provenance, o.raw_fragment " +
        "FROM sourcing_captures c JOIN sourcing_observations o ON o.capture_id = c.capture_id " +
        "WHERE c.source_id = $1 ORDER BY c.created_at, c.capture_id",
        [sourceRef]
      );
      expect(rows).toHaveLength(2);
      const byCapture = new Map(rows.map(row => [row.capture_id, row]));
      const zeroRow = byCapture.get(first.capture_id);
      const unknownRow = byCapture.get(unknown.capture_id);
      expect(zeroRow).toBeDefined();
      expect(zeroRow.grain).toBe('unit');
      expect(zeroRow.source_ref).toBe('synthetic-unit');
      expect(zeroRow.normalized).toMatchObject({
        observation_kind: 'CATALOG_CHANGE_DELTA',
        product_ref: 'synthetic-product', unit_ref: 'synthetic-unit', stock_available: 0,
      });
      expect(zeroRow.field_provenance.stock_available.status).toBe('OBSERVED');
      expect(zeroRow.stats.application_status).toBe('NOT_EVALUATED');
      expect(unknownRow.normalized).not.toHaveProperty('stock_available');
      expect(unknownRow.field_provenance.stock_available.status).toBe('UNKNOWN');
      expect(unknownRow.raw_fragment.fact.reason).toBe('supplier API returned no stock fact');
      const { rows: provides } = await client.query(
        'SELECT layer FROM sourcing_source_provides WHERE source_id = $1', [sourceRef]
      );
      expect(provides).toEqual([{ layer: 'units' }]);
    } finally {
      if (begun) await client.query('ROLLBACK');
      client.release();
    }
  });

  afterAll(async () => db.pool.end());
}
