'use strict';

/**
 * @test-kind integration
 * @test-requires postgres
 * L7 — Migration 372 : garde hors encaissement, avoir sur coûts, rejeu idempotent.
 * Transactions ROLLBACK : aucun résidu dans la base d'essai.
 */
const { randomUUID } = require('crypto');
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
describeDb('journal L7 — PostgreSQL 16 (migration 372)', () => {
  const db = require('../../db');
  const journal = require('../../services/financial-journal');

  afterAll(async () => { await db.pool.end(); });

  test('deux détenteurs, un transfert neutre ; coût et avoir d’expédition sans double écriture', async () => {
    const client = await db.pool.connect();
    await client.query('BEGIN');
    try {
      const eventId = randomUUID();
      const shipmentCostId = randomUUID();
      const market = (await client.query("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
      const occurredAt = '2026-11-03T12:00:00+00:00';
      const transfer = facet => ({
        sourceKind: 'cash_custody_movement', sourceId: eventId, facet,
        direction: 'custody', category: 'cash_custody_transfer', state: 'observed',
        links: { marketId: market }, amountNative: '2500', currency: 'KMF',
        occurredAt, provenance: { source: 'cash_custody_movements', delta_sign: facet === 'OUT' ? -1 : 1 },
      });
      const first = await journal.recordMovement(client, transfer('OUT'));
      await journal.recordMovement(client, transfer('IN'));
      const again = await journal.recordMovement(client, transfer('OUT'));
      expect(first.outcome).toBe('created');
      expect(again.outcome).toBe('replayed');
      const source = (await client.query(
        'SELECT direction, COUNT(*)::int AS n FROM financial_movements WHERE source_id = $1 GROUP BY direction',
        [eventId])).rows;
      expect(source).toEqual([{ direction: 'custody', n: 2 }]);

      const credit = {
        sourceKind: 'shipment_charge', sourceId: shipmentCostId,
        direction: 'cost_reversal', category: 'cost:shipment_handling',
        state: 'observed', links: { marketId: market },
        amountNative: '350', currency: 'KMF', occurredAt,
        provenance: { source: 'international_shipment_charges', kind: 'credit' },
      };
      await journal.recordMovement(client, credit);
      await journal.recordMovement(client, credit);
      const checks = (await client.query(
        'SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_native),0)::numeric AS total FROM financial_movements WHERE source_id=$1 AND direction=$2',
        [shipmentCostId, 'cost_reversal'])).rows[0];
      expect(checks.n).toBe(1);
      expect(Number(checks.total)).toBe(350);
      const phantomSales = (await client.query(
        "SELECT COUNT(*)::int AS n FROM financial_movements WHERE source_id = $1 AND direction = 'inflow'",
        [eventId])).rows[0].n;
      expect(phantomSales).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
