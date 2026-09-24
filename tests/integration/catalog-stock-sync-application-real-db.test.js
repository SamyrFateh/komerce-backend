'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * MISSION 1 — écriture contrôlée. Disposable CI PostgreSQL only,
 * entièrement synthétique. Aucune écriture provider, boutique, commande ou
 * paiement réelle. product_skus.stock n'est modifié que sur des lignes
 * synthétiques créées par ce test, jamais annulé (pas de ROLLBACK ici :
 * applyStockSyncDecision gère sa propre transaction) — nettoyage explicite
 * en afterEach.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('catalog stock sync application: isolated CI DB required', () => {
    test('no non-isolated database writes', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');
  const { persistUnitStockChange } =
    require('../../services/sourcing-catalog-change-observation');
  const { DECISION } = require('../../services/catalog-stock-sync-decision');
  const { applyStockSyncDecision } =
    require('../../services/catalog-stock-sync-application');

  jest.setTimeout(30000);

  const cleanupProductIds = [];
  const cleanupSourceIds = [];

  afterEach(async () => {
    while (cleanupProductIds.length) {
      const id = cleanupProductIds.pop();
      await db.query('DELETE FROM catalog_stock_sync_state WHERE product_sku_id IN (SELECT id FROM product_skus WHERE product_id = $1)', [id]).catch(() => {});
      await db.query('DELETE FROM purchase_orders WHERE product_sku_id IN (SELECT id FROM product_skus WHERE product_id = $1)', [id]).catch(() => {});
      await db.query('DELETE FROM product_skus WHERE product_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM sourcing_candidates WHERE product_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM products WHERE id = $1', [id]).catch(() => {});
    }
    while (cleanupSourceIds.length) {
      const sourceId = cleanupSourceIds.pop();
      await db.query(
        `DELETE FROM sourcing_resolution_bindings WHERE observation_id IN (
           SELECT o.observation_id FROM sourcing_observations o
           JOIN sourcing_captures c ON c.capture_id = o.capture_id WHERE c.source_id = $1)`,
        [sourceId]).catch(() => {});
      await db.query(
        `DELETE FROM sourcing_resolution_decisions WHERE observation_id IN (
           SELECT o.observation_id FROM sourcing_observations o
           JOIN sourcing_captures c ON c.capture_id = o.capture_id WHERE c.source_id = $1)`,
        [sourceId]).catch(() => {});
      await db.query(
        `DELETE FROM sourcing_observations WHERE capture_id IN (
           SELECT capture_id FROM sourcing_captures WHERE source_id = $1)`,
        [sourceId]).catch(() => {});
      await db.query('DELETE FROM sourcing_canonical_entity_refs WHERE source_id = $1', [sourceId]).catch(() => {});
      await db.query('DELETE FROM sourcing_captures WHERE source_id = $1', [sourceId]).catch(() => {});
      await db.query('DELETE FROM sourcing_sources WHERE source_id = $1', [sourceId]).catch(() => {});
    }
  });

  /** Même chaîne que catalog-stock-sync-decision-real-db.test.js, hors transaction. */
  async function seedResolvedSkuLineage({ initialStock = 3 } = {}) {
    const q = db.query.bind(db);
    const provider = 'wr' + randomUUID().replace(/-/g, '').slice(0, 12);
    const sourceRef = 'api:' + provider;
    await q("INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
      "VALUES ($1,$2,'pull','recurring','active')", [sourceRef, provider]);
    cleanupSourceIds.push(sourceRef);
    const { rows: [catalogProduct] } = await q(
      "INSERT INTO products (name,price_kmf,stock,is_active,inventory_model) " +
      "VALUES ($1,1200,0,true,'SKU') RETURNING id", ['synthetic stock write ' + provider]);
    cleanupProductIds.push(catalogProduct.id);
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
      [productObs.observation_id, 'product', productEntity.canonical_entity_id],
      [offerObs.observation_id, 'offer', offerEntity.canonical_entity_id],
      [unitObs.observation_id, 'unit', unitEntity.canonical_entity_id],
    ]) {
      const { rows: [decision] } = await q(
        "INSERT INTO sourcing_resolution_decisions " +
        "(decision_type,grain,observation_id,canonical_entity_id,actor_type,actor_ref,rationale) " +
        "VALUES ('LINK',$1,$2,$3,'system','stock-write-itest','synthetic exact source proof') " +
        "RETURNING decision_id", [grain, obs, entityId]);
      await q("INSERT INTO sourcing_resolution_bindings " +
        "(observation_id,grain,canonical_entity_id,asserted_by_decision_id) " +
        "VALUES ($1,$2,$3,$4)", [obs, grain, entityId, decision.decision_id]);
    }
    for (const [entityId, kind, ref] of [
      [productEntity.canonical_entity_id, 'product.source_ref', 'product-1'],
      [unitEntity.canonical_entity_id, 'unit.source_ref', 'unit-1'],
    ]) {
      await q("INSERT INTO sourcing_canonical_entity_refs " +
        "(canonical_entity_id,source_id,ref_kind,ref_value) VALUES ($1,$2,$3,$4)",
        [entityId, sourceRef, kind, ref]);
    }
    const { rows: [sku] } = await q(
      "INSERT INTO product_skus " +
      "(product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity) " +
      "VALUES ($1,$2,$3,true,'SUPPLIER','synthetic-sku','unit-1',$4::jsonb) RETURNING id",
      [catalogProduct.id, 'SYNTH-' + provider.slice(0, 8), initialStock, JSON.stringify({
        provider, version: 1, payload: { pid: 'product-1', vid: 'unit-1' },
      })]);
    return { provider, sourceRef, catalogProduct, sku };
  }

  async function observeStock({ sourceRef, provider, eventId, observedAt, value }) {
    return persistUnitStockChange(db, {
      sourceRef, envelope: {
        source: { provider, account_scope: 'default', source_ref: 'product-1' },
        method: 'PULL_EXACT', event_id: eventId, observed_at: observedAt,
        subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
        facts: { stock_available: { status: 'OBSERVED', value } },
      },
    });
  }

  test('APPLY écrit la valeur exacte et le prouve par lecture après écriture', async () => {
    const { sourceRef, provider, sku } = await seedResolvedSkuLineage({ initialStock: 3 });
    const delta = await observeStock({
      sourceRef, provider, eventId: 'w1', observedAt: new Date().toISOString(), value: 8,
    });
    const result = await applyStockSyncDecision(delta.observation_id);
    expect(result.verdict.decision).toBe(DECISION.APPLY);
    expect(result.stock_before).toBe(3);
    expect(result.stock_after).toBe(8);
    expect(result.read_after_write_verified).toBe(true);

    const { rows: [row] } = await db.query('SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
    expect(row.stock).toBe(8);
    const { rows: [state] } = await db.query(
      'SELECT applied_stock_value, last_observation_id FROM catalog_stock_sync_state WHERE product_sku_id=$1',
      [sku.id]);
    expect(state.applied_stock_value).toBe(8);
    expect(state.last_observation_id).toBe(delta.observation_id);
  });

  test('lecture après écriture incohérente : rollback du stock ET du watermark', async () => {
    const { sourceRef, provider, sku } = await seedResolvedSkuLineage({ initialStock: 3 });
    const delta = await observeStock({
      sourceRef, provider, eventId: 'readback-mismatch',
      observedAt: new Date().toISOString(), value: 8,
    });
    // Injectable readback fault: all real PostgreSQL queries execute unchanged,
    // except the final verification read which returns an inconsistent value.
    const injectedPool = {
      getClient: async () => {
        const client = await db.getClient();
        const originalQuery = client.query.bind(client);
        let stockUpdated = false;
        return {
          query: async (sql, params) => {
            const result = await originalQuery(sql, params);
            if (String(sql).includes('UPDATE product_skus SET stock = $1')) {
              stockUpdated = true;
            }
            if (stockUpdated && String(sql).trim() ===
                'SELECT stock FROM product_skus WHERE id = $1') {
              return { rows: [{ stock: -1 }] };
            }
            return result;
          },
          release: () => client.release(),
        };
      },
    };
    await expect(applyStockSyncDecision(delta.observation_id, { pool: injectedPool }))
      .rejects.toMatchObject({
        status: 500,
        verdict: expect.objectContaining({ reason: 'READ_AFTER_WRITE_MISMATCH' }),
      });
    expect((await db.query('SELECT stock FROM product_skus WHERE id=$1', [sku.id])).rows[0].stock)
      .toBe(3);
    expect((await db.query(
      'SELECT COUNT(*)::int AS total FROM catalog_stock_sync_state WHERE product_sku_id=$1',
      [sku.id]
    )).rows[0].total).toBe(0);
  });

  test('rejeu de la même observation : pas de second effet, retourne NO_CHANGE', async () => {
    const { sourceRef, provider, sku } = await seedResolvedSkuLineage({ initialStock: 3 });
    const delta = await observeStock({
      sourceRef, provider, eventId: 'w2', observedAt: new Date().toISOString(), value: 5,
    });
    const first = await applyStockSyncDecision(delta.observation_id);
    expect(first.stock_after).toBe(5);

    const replay = await applyStockSyncDecision(delta.observation_id);
    expect(replay).toMatchObject({
      applied: false,
      verdict: expect.objectContaining({ decision: DECISION.NO_CHANGE }),
    });

    const { rows: [row] } = await db.query('SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
    expect(row.stock).toBe(5); // toujours 5, jamais un second mouvement
  });

  test('événement ancien après une application plus récente : STALE, écriture refusée', async () => {
    const { sourceRef, provider, sku } = await seedResolvedSkuLineage({ initialStock: 3 });
    const older = await observeStock({
      sourceRef, provider, eventId: 'w-old', observedAt: new Date(Date.now() - 30_000).toISOString(), value: 1,
    });
    const newer = await observeStock({
      sourceRef, provider, eventId: 'w-new', observedAt: new Date().toISOString(), value: 9,
    });
    await applyStockSyncDecision(newer.observation_id);
    const { rows: [afterNewer] } = await db.query('SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
    expect(afterNewer.stock).toBe(9);

    await expect(applyStockSyncDecision(older.observation_id))
      .rejects.toMatchObject({ verdict: expect.objectContaining({ decision: DECISION.STALE }) });

    const { rows: [afterOld] } = await db.query('SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
    expect(afterOld.stock).toBe(9); // l'ancien événement n'a rien écrasé
  });

  test('commande confirmée pendant la fenêtre entre décision et application : REVIEW_REQUIRED réévalué sous verrou', async () => {
    const { sourceRef, provider, sku } = await seedResolvedSkuLineage({ initialStock: 3 });
    const delta = await observeStock({
      sourceRef, provider, eventId: 'w3', observedAt: new Date().toISOString(), value: 6,
    });
    const { rows: [market] } = await db.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
    const { rows: [relais] } = await db.query(
      "INSERT INTO relais (name,agent_name,phone,address,island,market_id) " +
      "VALUES ('E2E Write Relais','Agent','+269000998','Test','Anjouan',$1) RETURNING id",
      [market.id]);
    const { rows: [supplier] } = await db.query(
      "INSERT INTO suppliers (name,platform) VALUES ('E2E Write Supplier','local') RETURNING id");
    const { rows: [order] } = await db.query(
      "INSERT INTO orders (reference,market_id,relais_id,status,payment_status,total_kmf,payment_mode) " +
      "VALUES ($1,$2,$3,'confirmed','paid',1200,'stripe_eur') RETURNING id",
      ['E2E-WRITE-' + randomUUID().slice(0, 8), market.id, relais.id]);
    await db.query(
      "INSERT INTO purchase_orders (order_id,supplier_id,product_sku_id,supplier_sku,qty,status,trigger_mode) " +
      "VALUES ($1,$2,$3,'synthetic-sku',1,'pending','auto')",
      [order.id, supplier.id, sku.id]);

    await expect(applyStockSyncDecision(delta.observation_id))
      .rejects.toMatchObject({
        status: 409,
        verdict: expect.objectContaining({ decision: DECISION.REVIEW_REQUIRED }),
      });
    const { rows: [row] } = await db.query('SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
    expect(row.stock).toBe(3);

    await db.query('DELETE FROM purchase_orders WHERE order_id=$1', [order.id]);
    await db.query('DELETE FROM orders WHERE id=$1', [order.id]);
    await db.query('DELETE FROM relais WHERE id=$1', [relais.id]);
    await db.query('DELETE FROM suppliers WHERE id=$1', [supplier.id]);
  });

  test('annulation (adjustStock increment) après une application : un rejeu ultérieur ne recouvre jamais ce mouvement local', async () => {
    const { sourceRef, provider, sku, catalogProduct } = await seedResolvedSkuLineage({ initialStock: 5 });
    const delta = await observeStock({
      sourceRef, provider, eventId: 'w4', observedAt: new Date().toISOString(), value: 5,
    });
    expect(await applyStockSyncDecision(delta.observation_id))
      .toMatchObject({ applied: false, verdict: expect.objectContaining({ decision: DECISION.NO_CHANGE }) });

    const { adjustStock } = require('../../services/product-stock-service');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await adjustStock(client, [{ product_id: catalogProduct.id, quantity: 2,
        inventory_model: 'SKU', sku_id: sku.id }], 'increment');
      await client.query('COMMIT');
    } finally { client.release(); }
    const { rows: [afterCancel] } = await db.query('SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
    expect(afterCancel.stock).toBe(7);

    expect(await applyStockSyncDecision(delta.observation_id))
      .toMatchObject({ applied: false, verdict: expect.objectContaining({ decision: DECISION.NO_CHANGE }) });
    const { rows: [final] } = await db.query('SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
    expect(final.stock).toBe(7); // jamais écrasé par le sync
  });

  afterAll(async () => db.pool.end());
}
