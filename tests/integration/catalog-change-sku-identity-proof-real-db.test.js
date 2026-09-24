'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Disposable CI PostgreSQL only, entirely synthetic and rolled back.
 * No provider, storefront, order, catalog stock or payment write.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('catalog SKU source lineage proof: isolated CI DB required', () => {
    test('no non-isolated database writes', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');
  const { persistUnitStockChange } =
    require('../../services/sourcing-catalog-change-observation');
  const { STATUS, proveExactCatalogSkuForStockDelta } =
    require('../../services/sourcing-catalog-change-sku-identity-proof');

  jest.setTimeout(30000);

  test('only full exact source lineage and one active SKU prove identity; another source blocks', async () => {
    const client = await db.getClient();
    const q = client.query.bind(client);
    const provider = 'sku' + randomUUID().replace(/-/g, '').slice(0, 12);
    const sourceRef = 'api:' + provider;
    let begun = false;
    try {
      await q('BEGIN'); begun = true;
      await q("INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
        "VALUES ($1,$2,'pull','recurring','active')", [sourceRef, provider]);
      const { rows: [catalogProduct] } = await q(
        "INSERT INTO products (name,price_kmf,stock,is_active,inventory_model) " +
        "VALUES ($1,1200,0,true,'SKU') RETURNING id", ['synthetic sku delta ' + provider]);
      const { rows: [catalogImport] } = await q(
        "INSERT INTO supplier_catalog_imports (supplier_name,source_type,total_items) " +
        "VALUES ($1,'api',1) RETURNING id", [provider]);
      await q("INSERT INTO sourcing_candidates " +
        "(import_id,supplier_name,supplier_product_id,product_name,state,product_id) " +
        "VALUES ($1,$2,'product-1','Synthetic product','imported_to_catalog',$3)",
      [catalogImport.id, provider, catalogProduct.id]);

      const { rows: [capture] } = await q(
        "INSERT INTO sourcing_captures (source_id,status,completed_at,stats) " +
        "VALUES ($1,'complete',NOW(),$2::jsonb) RETURNING capture_id",
        [sourceRef, JSON.stringify({ import_id: catalogImport.id })]);
      const { rows: [productObs] } = await q(
        "INSERT INTO sourcing_observations " +
        "(capture_id,grain,source_ref,observed_at,normalized,raw_fragment) " +
        "VALUES ($1,'product','product-1',NOW(),'{}'::jsonb,'{}'::jsonb) RETURNING observation_id",
        [capture.capture_id]);
      const { rows: [offerObs] } = await q(
        "INSERT INTO sourcing_observations " +
        "(capture_id,grain,source_ref,parent_observation_id,observed_at,normalized,raw_fragment) " +
        "VALUES ($1,'offer','offer-1',$2,NOW(),'{}'::jsonb,'{}'::jsonb) RETURNING observation_id",
        [capture.capture_id, productObs.observation_id]);
      const { rows: [unitObs] } = await q(
        "INSERT INTO sourcing_observations " +
        "(capture_id,grain,source_ref,parent_observation_id,observed_at,normalized,raw_fragment) " +
        "VALUES ($1,'unit','unit-1',$2,NOW(),'{}'::jsonb,'{}'::jsonb) RETURNING observation_id",
        [capture.capture_id, offerObs.observation_id]);
      const { rows: [productEntity] } = await q(
        "INSERT INTO sourcing_canonical_entities (grain) VALUES ('product') RETURNING canonical_entity_id");
      const { rows: [offerEntity] } = await q(
        "INSERT INTO sourcing_canonical_entities (grain,parent_entity_id) " +
        "VALUES ('offer',$1) RETURNING canonical_entity_id", [productEntity.canonical_entity_id]);
      const { rows: [unitEntity] } = await q(
        "INSERT INTO sourcing_canonical_entities (grain,parent_entity_id) " +
        "VALUES ('unit',$1) RETURNING canonical_entity_id", [offerEntity.canonical_entity_id]);
      for (const [obs, grain, entityId] of [
        [productObs.observation_id,'product',productEntity.canonical_entity_id],
        [offerObs.observation_id,'offer',offerEntity.canonical_entity_id],
        [unitObs.observation_id,'unit',unitEntity.canonical_entity_id],
      ]) {
        const { rows: [decision] } = await q(
          "INSERT INTO sourcing_resolution_decisions " +
          "(decision_type,grain,observation_id,canonical_entity_id,actor_type,actor_ref,rationale) " +
          "VALUES ('LINK',$1,$2,$3,'system','sku-identity-itest','synthetic exact source proof') " +
          "RETURNING decision_id", [grain,obs,entityId]);
        await q("INSERT INTO sourcing_resolution_bindings " +
          "(observation_id,grain,canonical_entity_id,asserted_by_decision_id) " +
          "VALUES ($1,$2,$3,$4)", [obs,grain,entityId,decision.decision_id]);
      }
      for (const [entityId, kind, ref] of [
        [productEntity.canonical_entity_id,'product.source_ref','product-1'],
        [unitEntity.canonical_entity_id,'unit.source_ref','unit-1'],
      ]) {
        await q("INSERT INTO sourcing_canonical_entity_refs " +
          "(canonical_entity_id,source_id,ref_kind,ref_value) VALUES ($1,$2,$3,$4)",
          [entityId,sourceRef,kind,ref]);
      }
      const { rows: [sku] } = await q(
        "INSERT INTO product_skus " +
        "(product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity) " +
        "VALUES ($1,'SYNTH-DELTA',3,true,'SUPPLIER','synthetic-sku','unit-1',$2::jsonb) RETURNING id",
        [catalogProduct.id, JSON.stringify({
          provider, version: 1, payload: { pid: 'product-1', vid: 'unit-1' },
        })]);
      const delta = await persistUnitStockChange(client, {
        sourceRef, envelope: {
          source: { provider, account_scope: 'default', source_ref: 'product-1' },
          method: 'PULL_EXACT', event_id: 'synthetic-zero',
          observed_at: '2026-09-23T20:00:00Z',
          subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
          facts: { stock_available: { status: 'OBSERVED', value: 0 } },
        },
      });
      const exact = await proveExactCatalogSkuForStockDelta(delta.observation_id, q);
      expect(exact).toMatchObject({
        status: STATUS.EXACT_CATALOG_SKU_IDENTITY, product_sku_id: sku.id,
        canonical_unit_id: unitEntity.canonical_entity_id,
        stock_available_observed: 0, applicable: false, freshness_evaluated: false,
        application_status: 'NOT_EVALUATED',
      });
      const { rows: [skuBefore] } = await q(
        'SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
      expect(skuBefore.stock).toBe(3);

      // A second source attached to the same catalog product invalidates
      // account/source ownership; textual unit ref equality must not win.
      const otherProvider = 'other' + provider;
      const otherSource = 'api:' + otherProvider;
      await q("INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
        "VALUES ($1,$2,'pull','recurring','active')", [otherSource, otherProvider]);
      const { rows: [otherImport] } = await q(
        "INSERT INTO supplier_catalog_imports (supplier_name,source_type,total_items) " +
        "VALUES ($1,'api',1) RETURNING id", [otherProvider]);
      await q("INSERT INTO sourcing_candidates " +
        "(import_id,supplier_name,supplier_product_id,product_name,state,product_id) " +
        "VALUES ($1,$2,'other-product','Synthetic other product','imported_to_catalog',$3)",
        [otherImport.id,otherProvider,catalogProduct.id]);
      await q("INSERT INTO sourcing_captures (source_id,status,completed_at,stats) " +
        "VALUES ($1,'complete',NOW(),$2::jsonb)",
        [otherSource,JSON.stringify({ import_id: otherImport.id })]);
      const ambiguous = await proveExactCatalogSkuForStockDelta(delta.observation_id, q);
      expect(ambiguous).toMatchObject({
        status: STATUS.SOURCE_LINEAGE_AMBIGUOUS, applicable: false,
      });
      const { rows: [skuAfter] } = await q(
        'SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
      expect(skuAfter.stock).toBe(3);
    } finally {
      if (begun) await q('ROLLBACK');
      client.release();
    }
  });
  afterAll(async () => db.pool.end());
}
