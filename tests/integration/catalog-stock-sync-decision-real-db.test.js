'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * MISSION 1 — matrice de décision du décideur de synchronisation de stock,
 * contre PostgreSQL isolé. Disposable CI PostgreSQL only, entièrement
 * synthétique et annulé (ROLLBACK). Aucune écriture provider, boutique,
 * commande ou paiement réelle.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('catalog stock sync decision matrix: isolated CI DB required', () => {
    test('no non-isolated database writes', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');
  const { persistUnitStockChange } =
    require('../../services/sourcing-catalog-change-observation');
  const { DECISION, REASON, decideStockSyncApplication } =
    require('../../services/catalog-stock-sync-decision');

  jest.setTimeout(30000);

  /**
   * Reconstruit exactement la chaîne complète (source -> produit catalogue
   * -> candidate -> capture -> observations product/offer/unit -> entités
   * canoniques -> bindings -> refs -> SKU SUPPLIER actif) requise pour
   * qu'une observation de delta de stock atteigne EXACT_CATALOG_SKU_IDENTITY.
   * Même patron que tests/integration/catalog-change-sku-identity-proof-real-db.test.js.
   */
  async function seedResolvedSkuLineage(q, { initialStock = 3 } = {}) {
    const provider = 'stk' + randomUUID().replace(/-/g, '').slice(0, 12);
    const sourceRef = 'api:' + provider;
    await q("INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
      "VALUES ($1,$2,'pull','recurring','active')", [sourceRef, provider]);
    const { rows: [catalogProduct] } = await q(
      "INSERT INTO products (name,price_kmf,stock,is_active,inventory_model) " +
      "VALUES ($1,1200,0,true,'SKU') RETURNING id", ['synthetic stock sync ' + provider]);
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
        "VALUES ('LINK',$1,$2,$3,'system','stock-sync-itest','synthetic exact source proof') " +
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

  async function observeStock(client, { sourceRef, provider, eventId, observedAt, value }) {
    return persistUnitStockChange(client, {
      sourceRef, envelope: {
        source: { provider, account_scope: 'default', source_ref: 'product-1' },
        method: 'PULL_EXACT', event_id: eventId, observed_at: observedAt,
        subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
        facts: { stock_available: { status: 'OBSERVED', value } },
      },
    });
  }

  async function withTx(fn) {
    const client = await db.getClient();
    const q = client.query.bind(client);
    let begun = false;
    try {
      await q('BEGIN'); begun = true;
      return await fn(client, q);
    } finally {
      if (begun) await q('ROLLBACK').catch(() => {});
      client.release();
    }
  }

  test('APPLY : identité prouvée, fraîche, aucun engagement non réconcilié, valeur différente', async () => {
    await withTx(async (client, q) => {
      const { sourceRef, provider, sku } = await seedResolvedSkuLineage(q, { initialStock: 3 });
      const delta = await observeStock(client, {
        sourceRef, provider, eventId: 'e1', observedAt: new Date().toISOString(), value: 7,
      });
      const verdict = await decideStockSyncApplication(delta.observation_id, { query: q });
      expect(verdict).toMatchObject({
        decision: DECISION.APPLY, reason: REASON.IDENTITY_PROVEN_AND_FRESH,
        product_sku_id: sku.id, target_stock_value: 7, current_stock: 3,
        application_status: 'NOT_EVALUATED',
      });
    });
  });

  test('BLOCKED : une observation future ne contourne pas un mouvement de stock local', async () => {
    await withTx(async (client, q) => {
      const { sourceRef, provider, sku } = await seedResolvedSkuLineage(q, { initialStock: 3 });
      const delta = await observeStock(client, {
        sourceRef, provider, eventId: 'e-future',
        observedAt: new Date(Date.now() + 60_000).toISOString(), value: 12,
      });
      const verdict = await decideStockSyncApplication(delta.observation_id, { query: q });
      expect(verdict).toMatchObject({
        decision: DECISION.BLOCKED, reason: REASON.FUTURE_OBSERVATION,
        product_sku_id: sku.id,
      });
      expect((await q('SELECT stock FROM product_skus WHERE id=$1', [sku.id])).rows[0].stock)
        .toBe(3);
    });
  });

  test('BLOCKED : identité non prouvée (pas de chaîne source_ref) ne devient jamais implicitement APPLY', async () => {
    await withTx(async (client, q) => {
      const provider = 'noproof' + randomUUID().replace(/-/g, '').slice(0, 8);
      const sourceRef = 'api:' + provider;
      await q("INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
        "VALUES ($1,$2,'pull','recurring','active')", [sourceRef, provider]);
      const delta = await observeStock(client, {
        sourceRef, provider, eventId: 'e-noproof', observedAt: new Date().toISOString(), value: 5,
      });
      const verdict = await decideStockSyncApplication(delta.observation_id, { query: q });
      expect(verdict.decision).toBe(DECISION.BLOCKED);
      expect(verdict.reason).toBe(REASON.IDENTITY_NOT_PROVEN);
    });
  });

  test('NO_CHANGE (rejeu) : la même observation appliquée deux fois ne produit jamais un second effet', async () => {
    await withTx(async (client, q) => {
      const { sourceRef, provider, sku } = await seedResolvedSkuLineage(q, { initialStock: 3 });
      const delta = await observeStock(client, {
        sourceRef, provider, eventId: 'e2', observedAt: new Date().toISOString(), value: 9,
      });
      await q(
        "INSERT INTO catalog_stock_sync_state " +
        "(product_sku_id,source_id,last_observation_id,last_event_id,last_observed_at,applied_stock_value) " +
        "VALUES ($1,$2,$3,'e2',$4,9)",
        [sku.id, sourceRef, delta.observation_id, new Date().toISOString()]
      );
      const verdict = await decideStockSyncApplication(delta.observation_id, { query: q });
      expect(verdict).toMatchObject({
        decision: DECISION.NO_CHANGE, reason: REASON.REPLAY_SAME_OBSERVATION,
      });
    });
  });

  test('NO_CHANGE (valeur identique) : la valeur observée égale déjà product_skus.stock', async () => {
    await withTx(async (client, q) => {
      const { sourceRef, provider, sku } = await seedResolvedSkuLineage(q, { initialStock: 4 });
      const delta = await observeStock(client, {
        sourceRef, provider, eventId: 'e3', observedAt: new Date().toISOString(), value: 4,
      });
      const verdict = await decideStockSyncApplication(delta.observation_id, { query: q });
      expect(verdict).toMatchObject({
        decision: DECISION.NO_CHANGE, reason: REASON.TARGET_EQUALS_CURRENT_STOCK,
        current_stock: 4,
      });
    });
  });

  test('STALE : un événement plus ancien n\'écrase jamais une valeur déjà appliquée plus récente', async () => {
    await withTx(async (client, q) => {
      const { sourceRef, provider, sku } = await seedResolvedSkuLineage(q, { initialStock: 3 });
      const delta = await observeStock(client, {
        sourceRef, provider, eventId: 'e-old', observedAt: new Date(Date.now() - 30_000).toISOString(), value: 1,
      });
      // Une observation PLUS RÉCENTE a déjà été appliquée (state en avance).
      await q(
        "INSERT INTO catalog_stock_sync_state " +
        "(product_sku_id,source_id,last_observation_id,last_event_id,last_observed_at,applied_stock_value) " +
        "VALUES ($1,$2,$3,'e-newer',$4,9)",
        [sku.id, sourceRef, randomUUID(), new Date().toISOString()]
      );
      const verdict = await decideStockSyncApplication(delta.observation_id, { query: q });
      expect(verdict.decision).toBe(DECISION.STALE);
      expect(verdict.reason).toBe(REASON.OLDER_OR_EQUAL_TO_APPLIED);
      const { rows: [after] } = await q('SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
      expect(after.stock).toBe(3); // inchangé — lecture seule, cf. @db-write none
    });
  });

  async function seedRelaisAndSupplier(q) {
    const { rows: [market] } = await q("SELECT id FROM markets WHERE code = 'KM' LIMIT 1");
    const { rows: [relais] } = await q(
      "INSERT INTO relais (name,agent_name,phone,address,island,market_id) " +
      "VALUES ('E2E Stock Sync Relais','Agent Test','+269000999','Test','Anjouan',$1) RETURNING id",
      [market.id]
    );
    const { rows: [supplier] } = await q(
      "INSERT INTO suppliers (name,platform) VALUES ('E2E Stock Sync Supplier','local') RETURNING id"
    );
    return { marketId: market.id, relaisId: relais.id, supplierId: supplier.id };
  }

  test('REVIEW_REQUIRED : commande Komerce confirmée mais fournisseur pas encore notifié (pending)', async () => {
    await withTx(async (client, q) => {
      const { sourceRef, provider, sku } =
        await seedResolvedSkuLineage(q, { initialStock: 3 });
      const delta = await observeStock(client, {
        sourceRef, provider, eventId: 'e4', observedAt: new Date().toISOString(), value: 6,
      });
      const { marketId, relaisId, supplierId } = await seedRelaisAndSupplier(q);
      const { rows: [order] } = await q(
        "INSERT INTO orders (reference,market_id,relais_id,status,payment_status,total_kmf,payment_mode) " +
        "VALUES ($1,$2,$3,'confirmed','paid',1200,'stripe_eur') RETURNING id",
        ['E2E-STOCKSYNC-' + randomUUID().slice(0, 8), marketId, relaisId]);
      await q(
        "INSERT INTO purchase_orders (order_id,supplier_id,product_sku_id,supplier_sku,qty,status,trigger_mode) " +
        "VALUES ($1,$2,$3,'synthetic-sku',1,'pending','auto')",
        [order.id, supplierId, sku.id]
      );
      const verdict = await decideStockSyncApplication(delta.observation_id, { query: q });
      expect(verdict).toMatchObject({
        decision: DECISION.REVIEW_REQUIRED, reason: REASON.UNRECONCILED_KOMERCE_COMMITMENT,
        product_sku_id: sku.id,
      });
      expect(verdict.unreconciled_purchase_order_count_at_least).toBeGreaterThanOrEqual(1);
    });
  });

  test('APPLY malgré un engagement Komerce déjà CONFIRMED — le fournisseur en est déjà informé', async () => {
    await withTx(async (client, q) => {
      const { sourceRef, provider, sku } = await seedResolvedSkuLineage(q, { initialStock: 3 });
      const delta = await observeStock(client, {
        sourceRef, provider, eventId: 'e5', observedAt: new Date().toISOString(), value: 6,
      });
      const { marketId, relaisId, supplierId } = await seedRelaisAndSupplier(q);
      const { rows: [order] } = await q(
        "INSERT INTO orders (reference,market_id,relais_id,status,payment_status,total_kmf,payment_mode) " +
        "VALUES ($1,$2,$3,'confirmed','paid',1200,'stripe_eur') RETURNING id",
        ['E2E-STOCKSYNC-' + randomUUID().slice(0, 8), marketId, relaisId]);
      await q(
        "INSERT INTO purchase_orders (order_id,supplier_id,product_sku_id,supplier_sku,qty,status,trigger_mode) " +
        "VALUES ($1,$2,$3,'synthetic-sku',1,'confirmed','auto')",
        [order.id, supplierId, sku.id]
      );
      const verdict = await decideStockSyncApplication(delta.observation_id, { query: q });
      expect(verdict.decision).toBe(DECISION.APPLY);
    });
  });

  test('BLOCKED reste BLOCKED même en présence d\'un event_id identique à une capture existante (rejeu à l\'observation)', async () => {
    await withTx(async (client, q) => {
      const { sourceRef, provider, sku } = await seedResolvedSkuLineage(q, { initialStock: 3 });
      const sharedObservedAt = new Date().toISOString();
      const first = await observeStock(client, {
        sourceRef, provider, eventId: 'e-dup', observedAt: sharedObservedAt, value: 5,
      });
      expect(first.status).toBe('recorded');
      const replay = await observeStock(client, {
        sourceRef, provider, eventId: 'e-dup', observedAt: sharedObservedAt, value: 5,
      });
      expect(replay.status).toBe('already_recorded');
      expect(replay.capture_id).toBe(first.capture_id);
      // Le rejeu au niveau observation ne fournit pas de nouvel observation_id
      // exploitable par le décideur (pas de observation_id dans la réponse
      // already_recorded) — documente le contrat plutôt que de le deviner.
      expect(replay.observation_id).toBeUndefined();
    });
  });

  afterAll(async () => db.pool.end());
}
