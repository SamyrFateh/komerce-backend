'use strict';
/** @test-kind integration @test-runner jest @test-requires DATABASE_URL */
if (!process.env.DATABASE_URL) {
  describe.skip('customs financial audit REAL_DB (requires DATABASE_URL)', () => {
    test('requires database', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  jest.setTimeout(20000);

  describe('customs financial correction audit — REAL_DB', () => {
    test('records actor, reason and before/after atomically; prevents tampering', async () => {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [ship] } = await client.query(
          `INSERT INTO customs_shipments
             (id, reference, shipment_date, cif_value_kmf, customs_paid_kmf,
              freight_kmf, allocation_method, status)
           VALUES ($1, $2, CURRENT_DATE, 10000, 100, 20, 'by_cif_value', 'pending')
           RETURNING id`,
          [crypto.randomUUID(), 'audit-proof-' + crypto.randomUUID()]
        );
        await client.query(
          "SELECT set_config('komerce.actor_id', $1, true), set_config('komerce.change_reason', $2, true)",
          ['test-admin', 'facture transitaire rectifiée']
        );
        await client.query('UPDATE customs_shipments SET customs_paid_kmf = 120, freight_kmf = 25 WHERE id = $1', [ship.id]);
        const { rows } = await client.query(
          'SELECT actor_id, reason, old_values, new_values FROM customs_shipment_financial_audit WHERE shipment_id = $1',
          [ship.id]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].actor_id).toBe('test-admin');
        expect(rows[0].reason).toBe('facture transitaire rectifiée');
        expect(Number(rows[0].old_values.customs_paid_kmf)).toBe(100);
        expect(Number(rows[0].new_values.customs_paid_kmf)).toBe(120);
        expect(Number(rows[0].old_values.freight_kmf)).toBe(20);
        expect(Number(rows[0].new_values.freight_kmf)).toBe(25);
        const { rows: [audit] } = await client.query(
          'SELECT id FROM customs_shipment_financial_audit WHERE shipment_id = $1', [ship.id]
        );
        await client.query('SAVEPOINT audit_immutability');
        await expect(client.query('DELETE FROM customs_shipment_financial_audit WHERE id = $1', [audit.id]))
          .rejects.toThrow(/append-only/);
        await client.query('ROLLBACK TO SAVEPOINT audit_immutability');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });
}
