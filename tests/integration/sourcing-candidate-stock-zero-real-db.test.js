'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * One synthetic exact supplier candidate; three re-imports 3->1->0.
 * CI localhost DB only, all writes rolled back. No provider GET,
 * promotion, public catalog, payment, Purchasing or Railway writes.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('Supplier zero stock reimport: isolated CI DB required', () => {
    test('no non-isolated writes', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');
  const { upsertCandidateFromCatalogImport } = require('../../services/sourcing-candidate-import-service');

  function input(supplierName, stockAvailable) {
    return {
      importId: null,
      supplierName,
      product: {
        supplier_product_id: 'exact-test-offer-1',
        supplier_name: supplierName,
        product_name: 'Synthetic supplier offer / never publish',
        purchase_price: 12.30,
        currency: 'PLN',
        stock_available: stockAvailable,
        min_order_qty: 1,
      },
      normalized: {
        komerce_category: 'autre',
        purchase_price_kmf: 1800,
        target_margin_pct: 40,
        data_sources: { purchase_price: 'supplier' },
        confidence: 'high',
      },
      normalizedSourceContract: null,
      scan: {
        scan_result: {},
        sourcing_decision: 'WATCHLIST',
        reason: 'CI only',
        recommended_action: 'none',
        confidence: 'high',
      },
      verdict: null,
      autoState: 'scanned',
      autoRejectedReason: null,
      userId: null,
    };
  }

  test('one candidate identity persists reimports 3 -> 1 -> explicit 0, distinct from UNKNOWN', async () => {
    const client = await db.getClient();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      const supplierName = 'CI Supplier Zero ' + randomUUID();
      let candidateId = null;
      for (const [observed, expected] of [[3, 3], [1, 1], [0, 0], [null, null]]) {
        const result = await upsertCandidateFromCatalogImport(
          client, input(supplierName, observed),
        );
        if (candidateId === null) {
          candidateId = result.row.id;
          expect(result.wasUpdated).toBe(false);
        } else {
          expect(result.row.id).toBe(candidateId);
          expect(result.wasUpdated).toBe(true);
        }
        const { rows } = await client.query(
          'SELECT stock_available, state FROM sourcing_candidates WHERE id = $1',
          [candidateId],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].stock_available).toBe(expected);
        // Import NEVER publishes an existing or new candidate.
        expect(rows[0].state).toBe('scanned');
      }
      const { rows: events } = await client.query(
        'SELECT event_type FROM sourcing_candidate_events WHERE candidate_id = $1',
        [candidateId],
      );
      expect(events.filter(e => e.event_type === 'data_correction')).toHaveLength(3);
    } finally {
      if (started) await client.query('ROLLBACK');
      client.release();
    }
  });

  afterAll(async () => db.pool.end());
}
