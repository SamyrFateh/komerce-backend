'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Disposable CI Postgres; all synthetic source, identity and delta writes
 * are rolled back. No provider API, SKU, storefront, order or payment writes.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('canonical stock delta identity proof requires isolated CI database', () => {
    test('no non-isolated queries', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');
  const { persistUnitStockChange } = require('../../services/sourcing-catalog-change-observation');
  const { STATUS, proveExactCanonicalUnitForStockDelta } =
    require('../../services/sourcing-catalog-change-unit-resolution-proof');

  jest.setTimeout(30000);

  test('real DB: same exact source+product+unit, active bindings and hierarchy required', async () => {
    const client = await db.getClient();
    const provider = 'delta' + randomUUID().replace(/-/g, '').slice(0, 12);
    const sourceRef = 'api:' + provider;
    let begun = false;
    const q = client.query.bind(client);
    try {
      await q('BEGIN'); begun = true;
      await q("INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
        "VALUES ($1,$2,'pull','recurring','active')", [sourceRef, provider]);
      const change = (eventId, unitRef, fact) => ({
        source: { provider, account_scope: 'default', source_ref: 'product-1' },
        method: 'PULL_EXACT', event_id: eventId, observed_at: '2026-09-23T20:00:00Z',
        subject: { product_ref: 'product-1', unit_ref: unitRef },
        facts: { stock_available: fact },
      });
      const zero = await persistUnitStockChange(client, {
        sourceRef, envelope: change('stock-0', 'unit-1', {status:'OBSERVED',value:0}),
      });
      expect((await proveExactCanonicalUnitForStockDelta(zero.observation_id, q)).status)
        .toBe(STATUS.NO_EXACT_UNIT);

      // Full prior source observations, never fabricated from the partial delta.
      const { rows: [capture] } = await q(
        "INSERT INTO sourcing_captures (source_id,status,completed_at,stats) " +
        "VALUES ($1,'complete',NOW(),'{}'::jsonb) RETURNING capture_id", [sourceRef]);
      const { rows: [pObs] } = await q(
        "INSERT INTO sourcing_observations " +
        "(capture_id,grain,source_ref,observed_at,normalized,raw_fragment) " +
        "VALUES ($1,'product','product-1',NOW(),'{}'::jsonb,'{}'::jsonb) RETURNING observation_id",
        [capture.capture_id]);
      const { rows: [oObs] } = await q(
        "INSERT INTO sourcing_observations " +
        "(capture_id,grain,source_ref,parent_observation_id,observed_at,normalized,raw_fragment) " +
        "VALUES ($1,'offer','offer-1',$2,NOW(),'{}'::jsonb,'{}'::jsonb) RETURNING observation_id",
        [capture.capture_id,pObs.observation_id]);
      const { rows: [uObs] } = await q(
        "INSERT INTO sourcing_observations " +
        "(capture_id,grain,source_ref,parent_observation_id,observed_at,normalized,raw_fragment) " +
        "VALUES ($1,'unit','unit-1',$2,NOW(),'{}'::jsonb,'{}'::jsonb) RETURNING observation_id",
        [capture.capture_id,oObs.observation_id]);

      const {rows:[product]} = await q(
        "INSERT INTO sourcing_canonical_entities (grain) VALUES ('product') RETURNING canonical_entity_id");
      const {rows:[offer]} = await q(
        "INSERT INTO sourcing_canonical_entities (grain,parent_entity_id) " +
        "VALUES ('offer',$1) RETURNING canonical_entity_id", [product.canonical_entity_id]);
      const {rows:[unit]} = await q(
        "INSERT INTO sourcing_canonical_entities (grain,parent_entity_id) " +
        "VALUES ('unit',$1) RETURNING canonical_entity_id", [offer.canonical_entity_id]);
      for (const [observation,grain,entity] of [
        [pObs.observation_id,'product',product.canonical_entity_id],
        [oObs.observation_id,'offer',offer.canonical_entity_id],
        [uObs.observation_id,'unit',unit.canonical_entity_id],
      ]) {
        const {rows:[decision]} = await q(
          "INSERT INTO sourcing_resolution_decisions " +
          "(decision_type,grain,observation_id,canonical_entity_id,actor_type,actor_ref,rationale) " +
          "VALUES ('LINK',$1,$2,$3,'system','isolated-itest','exact synthetic source binding') " +
          "RETURNING decision_id", [grain,observation,entity]);
        await q("INSERT INTO sourcing_resolution_bindings " +
          "(observation_id,grain,canonical_entity_id,asserted_by_decision_id) " +
          "VALUES ($1,$2,$3,$4)", [observation,grain,entity,decision.decision_id]);
      }
      // Binding alone is insufficient: refs must prove the same source and grain.
      expect((await proveExactCanonicalUnitForStockDelta(zero.observation_id, q)).status)
        .toBe(STATUS.NO_EXACT_UNIT);
      await q("INSERT INTO sourcing_canonical_entity_refs " +
        "(canonical_entity_id,source_id,ref_kind,ref_value) " +
        "VALUES ($1,$2,'product.source_ref','product-1')",
      [product.canonical_entity_id,sourceRef]);
      expect((await proveExactCanonicalUnitForStockDelta(zero.observation_id, q)).status)
        .toBe(STATUS.NO_EXACT_UNIT);
      await q("INSERT INTO sourcing_canonical_entity_refs " +
        "(canonical_entity_id,source_id,ref_kind,ref_value) " +
        "VALUES ($1,$2,'unit.source_ref','unit-1')",
      [unit.canonical_entity_id,sourceRef]);

      const proof = await proveExactCanonicalUnitForStockDelta(zero.observation_id, q);
      expect(proof).toMatchObject({
        status: STATUS.EXACT_CANONICAL_UNIT, canonical_unit_id: unit.canonical_entity_id,
        canonical_product_id: product.canonical_entity_id,
        stock_available_observed: 0, applicable: false,
        application_status: 'NOT_EVALUATED', sku_resolution_evaluated: false,
      });
      const otherUnit = await persistUnitStockChange(client, {
        sourceRef, envelope: change('other-unit','unit-not-linked',{status:'OBSERVED',value:8}),
      });
      expect((await proveExactCanonicalUnitForStockDelta(otherUnit.observation_id,q)).status)
        .toBe(STATUS.NO_EXACT_UNIT);
      const unknown = await persistUnitStockChange(client, {
        sourceRef, envelope: change('unknown','unit-1',{status:'UNKNOWN',reason:'not returned'}),
      });
      expect((await proveExactCanonicalUnitForStockDelta(unknown.observation_id,q)).status)
        .toBe(STATUS.NOT_EXACT_STOCK_DELTA);
      const {rows: [unitAfter]} = await q(
        "SELECT COUNT(*)::int AS total FROM sourcing_resolution_bindings WHERE observation_id=$1",
        [zero.observation_id]);
      expect(unitAfter.total).toBe(0);
    } finally {
      if (begun) await q('ROLLBACK');
      client.release();
    }
  });
  afterAll(async () => db.pool.end());
}
