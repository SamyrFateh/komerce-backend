'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * P2A shadow continuity: two SYNTHETIC normalized Allegro-shaped reads are
 * persisted as separate immutable captures in CI's throwaway localhost DB.
 * This test NEVER authenticates, calls Allegro, publishes a SKU, invokes
 * Purchasing, runs a cron or promotes catalog state.
 * The live provider 3->1 observation is separately proved by Actions run
 * 35746258763; these fixtures do NOT re-create or replace that live evidence.
 */

const IS_ISOLATED_CI = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!IS_ISOLATED_CI) {
  describe.skip('Allegro 3->1 shadow DB proof (CI localhost test DB only)', () => {
    test('requires the isolated CI PostgreSQL contract', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');
  const { _persistShadow } = require('../../services/sourcing-observation-shadow-service');
  const { compareExactProduct } = require('../../scripts/sourcing-continuity-targeted-proof');
  const { buildCanonicalOfferProjection } = require('../../services/sourcing-canonical-offer-projection');
  const { buildCanonicalUnitProjection } = require('../../services/sourcing-canonical-unit-projection');

  const OFFER_REF = '7782259530'; // reference ONLY: synthetic fixtures, no supplier calls
  const WAIT_FOR_DISTINCT_TIMESTAMPS_MS = 15;

  // Mimics the V2 facts emitted by the existing Allegro connector, not a
  // provider response. Undefined means an absent observation, NEVER zero.
  function syntheticNormalizedAllegro(stock) {
    const optionalStock = stock === undefined ? {} : { stock_available: stock };
    return {
      schema_version: '2',
      supplier_name: 'Allegro Sandbox',
      supplier_product_id: OFFER_REF,
      product_name: 'CI SHADOW STOCK TEST ONLY',
      purchase_price: 39.90,
      currency: 'PLN',
      ...optionalStock,
      sellable_units: [{
        supplier_sku: 'allegro-sandbox:' + OFFER_REF,
        supplier_unit_ref: OFFER_REF,
        supplier_order_identity: {
          provider: 'allegro', version: 1,
          payload: { environment: 'sandbox', offer_id: OFFER_REF },
        },
        option_values: {},
        purchase_price: 39.90,
        currency: 'PLN',
        ...optionalStock,
        is_active: true,
      }],
      raw_payload: { ci_fixture_only: true }, // never a live provider payload
    };
  }

  async function persistedGrain(client, captureIds, grain, sourceRef) {
    const { rows } = await client.query(`
      SELECT o.observation_id, o.source_ref, o.principal_ref,
             o.observed_at, o.normalized, c.source_id
        FROM sourcing_observations o
        JOIN sourcing_captures c ON c.capture_id = o.capture_id
       WHERE o.capture_id = ANY($1::uuid[]) AND o.grain::text = $2
         AND ($3::text IS NULL OR o.source_ref = $3)
       ORDER BY o.observed_at, o.observation_id
    `, [captureIds, grain, sourceRef || null]);
    return rows;
  }

  test('CI DB retains two distinct 3->1 captures and the read-only Unit/Offer projections agree; missing stock is UNKNOWN', async () => {
    jest.setTimeout(20000);
    const client = await db.getClient();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      const ctx = {
        sourceType: 'api',
        supplierName: 'Allegro Sandbox',
        supplierId: 'allegro',
        // Isolates test source identity from the real api:allegro source.
        sourceInstanceKey: 'ci-shadow-three-to-one-' + randomUUID(),
      };
      const before = syntheticNormalizedAllegro(3);
      const after = syntheticNormalizedAllegro(1);

      const first = await _persistShadow(client, { ...ctx, products: [before] });
      await new Promise(resolve => setTimeout(resolve, WAIT_FOR_DISTINCT_TIMESTAMPS_MS));
      const second = await _persistShadow(client, { ...ctx, products: [after] });

      expect(first).toMatchObject({
        status: 'recorded', products: 1, offers: 1, units: 1, observations: 3,
      });
      expect(second).toMatchObject({
        status: 'recorded', products: 1, offers: 1, units: 1, observations: 3,
        source_id: first.source_id,
      });
      expect(second.capture_id).not.toBe(first.capture_id);

      const ids = [first.capture_id, second.capture_id];
      const unitRows = await persistedGrain(client, ids, 'unit', OFFER_REF);
      const offerRows = await persistedGrain(client, ids, 'offer', null);
      expect(unitRows).toHaveLength(2);
      expect(offerRows).toHaveLength(2);
      expect(unitRows.map(row => row.normalized.stock_available)).toEqual([3, 1]);
      expect(offerRows.map(row => row.normalized.stock_available)).toEqual([3, 1]);
      expect(unitRows.every(row => row.source_id === first.source_id
        && row.source_ref === OFFER_REF)).toBe(true);
      expect(offerRows.every(row => row.source_id === first.source_id)).toBe(true);

      // The canonical IDs below are read-only test harness identity labels;
      // this test does NOT create/prove a resolution binding or SKU promotion.
      const asProjectionRows = (rows, entity, parent) => rows.map(row => ({
        ...row, canonical_entity_id: entity, parent_entity_id: parent,
      }));
      const unit = buildCanonicalUnitProjection(
        asProjectionRows(unitRows, 'test-unit', 'test-offer'),
      );
      const offer = buildCanonicalOfferProjection(
        asProjectionRows(offerRows, 'test-offer', 'test-product'),
      );
      const exactReadDelta = compareExactProduct(before, after, first.source_id);
      for (const projection of [unit, offer]) {
        expect(projection.current_state.stock_available).toBe(1);
        expect(projection.last_observation_delta).toMatchObject({
          status: 'CHANGED',
          changes: [expect.objectContaining({
            field: 'stock_available', before: 3, after: 1,
          })],
        });
      }
      expect(exactReadDelta).toMatchObject({
        status: 'CHANGED',
        offer: { status: 'CHANGED', changes: [expect.objectContaining({
          field: 'stock_available', before: 3, after: 1,
        })] },
        units: [expect.objectContaining({
          status: 'CHANGED', changes: [expect.objectContaining({
            field: 'stock_available', before: 3, after: 1,
          })],
        })],
        removal_confirmed: false,
      });
      expect(unit.current_state).toMatchObject({
        stock_available: 1, purchase_price: 39.9, currency: 'PLN',
        is_active: true,
      });
      expect(unit).toMatchObject({
        authority: 'shadow_read_only',
        commandability: { ready_now: false, readiness_evaluated: false },
      });

      // No observation after a failed/missing supplier fact may be silently
      // interpreted as 0, a stockout or a confirmed removal.
      await new Promise(resolve => setTimeout(resolve, WAIT_FOR_DISTINCT_TIMESTAMPS_MS));
      const unknown = await _persistShadow(client, {
        ...ctx, products: [syntheticNormalizedAllegro(undefined)],
      });
      const lastTwo = await persistedGrain(client,
        [second.capture_id, unknown.capture_id], 'unit', OFFER_REF);
      const missing = buildCanonicalUnitProjection(
        asProjectionRows(lastTwo, 'test-unit', 'test-offer'),
      );
      expect(lastTwo).toHaveLength(2);
      expect(lastTwo[1].normalized).not.toHaveProperty('stock_available');
      expect(missing.current_state).not.toHaveProperty('stock_available');
      expect(missing.last_observation_delta).toMatchObject({
        status: 'UNKNOWN', unknown_fields: expect.arrayContaining(['stock_available']),
      });
      expect(missing.last_observation_delta.changes).not.toEqual(
        expect.arrayContaining([expect.objectContaining({
          field: 'stock_available', after: 0,
        })]),
      );
      expect(missing.commandability.ready_now).toBe(false);
    } finally {
      // One transaction, always rolled back: zero durable CI fixtures and no
      // prospect of cross-test contamination or access to Railway.
      if (started) await client.query('ROLLBACK');
      client.release();
    }
  });

  afterAll(async () => db.pool.end());
}
