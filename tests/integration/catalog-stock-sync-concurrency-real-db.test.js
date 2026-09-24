'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * MISSION 1 — preuve de concurrence RÉELLE (deux connexions PostgreSQL
 * distinctes, deux transactions simultanées sur la MÊME ligne product_skus,
 * pas un enchaînement séquentiel qui ressemble à de la concurrence).
 * Disposable CI PostgreSQL only, entièrement synthétique.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('catalog stock sync concurrency: isolated CI DB required', () => {
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
  const { adjustStock } = require('../../services/product-stock-service');

  jest.setTimeout(30000);

  const proofDeps = {
    authorityFn: async () => ({ proved: true, proof_ref: 'itest-stock-read-proof' }),
    reconciliationFn: async () => ({ proved: true, proof_ref: 'itest-snapshot-reconciliation' }),
  };

  async function seedResolvedSkuLineage({ initialStock = 5 } = {}) {
    const q = db.query.bind(db);
    const provider = 'cc' + randomUUID().replace(/-/g, '').slice(0, 12);
    const sourceRef = 'api:' + provider;
    await q("INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
      "VALUES ($1,$2,'pull','recurring','active')", [sourceRef, provider]);
    const { rows: [catalogProduct] } = await q(
      "INSERT INTO products (name,price_kmf,stock,is_active,inventory_model) " +
      "VALUES ($1,1200,0,true,'SKU') RETURNING id", ['synthetic concurrency ' + provider]);
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
        "VALUES ('LINK',$1,$2,$3,'system','stock-concurrency-itest','synthetic exact source proof') " +
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

  async function cleanup({ catalogProduct, sourceRef }) {
    // sourcing_resolution_decisions et sourcing_resolution_bindings sont
    // append-only (garde-fou réel, confirmé en testant) : on ne tente pas de
    // les nettoyer — base CI isolée et jetable, les lignes orphelines n'ont
    // aucune conséquence. Chaque étape est défensive : un échec de nettoyage
    // ne doit jamais masquer le résultat réel du test qui vient de s'exécuter.
    await db.query('DELETE FROM catalog_stock_sync_state WHERE product_sku_id IN (SELECT id FROM product_skus WHERE product_id = $1)', [catalogProduct.id]).catch(() => {});
    await db.query('DELETE FROM purchase_orders WHERE product_sku_id IN (SELECT id FROM product_skus WHERE product_id = $1)', [catalogProduct.id]).catch(() => {});
    await db.query('DELETE FROM product_skus WHERE product_id = $1', [catalogProduct.id]).catch(() => {});
    await db.query('DELETE FROM sourcing_candidates WHERE product_id = $1', [catalogProduct.id]).catch(() => {});
    await db.query('DELETE FROM products WHERE id = $1', [catalogProduct.id]).catch(() => {});
    await db.query('DELETE FROM sourcing_canonical_entity_refs WHERE source_id = $1', [sourceRef]).catch(() => {});
    await db.query('DELETE FROM sourcing_captures WHERE source_id = $1', [sourceRef]).catch(() => {});
    await db.query('DELETE FROM sourcing_sources WHERE source_id = $1', [sourceRef]).catch(() => {});
  }

  /**
   * Décrémente le stock comme le ferait une confirmation de paiement réelle
   * (order-payment-confirmation.js -> adjustStock), mais retient
   * artificiellement la transaction ouverte (pg_sleep, verrou déjà acquis
   * par l'UPDATE) pour élargir la fenêtre de course et forcer une VRAIE
   * collision de verrou avec la synchronisation concurrente, plutôt qu'un
   * enchaînement séquentiel qui ressemblerait à de la concurrence sans en
   * être une.
   */
  async function delayedOrderPaymentDecrement({ catalogProduct, sku }, { quantity, delayMs }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await adjustStock(client, [{ product_id: catalogProduct.id, quantity,
        inventory_model: 'SKU', sku_id: sku.id }], 'decrement');
      await client.query(`SELECT pg_sleep($1)`, [delayMs / 1000]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  test('commande payée EN COURS pendant l\'application d\'une synchronisation : aucune perte, aucune corruption, le verrou sérialise réellement', async () => {
    const seed = await seedResolvedSkuLineage({ initialStock: 5 });
    const { sourceRef, provider, sku } = seed;
    try {
      const delta = await persistUnitStockChange(db, {
        sourceRef, envelope: {
          source: { provider, account_scope: 'default', source_ref: 'product-1' },
          method: 'PULL_EXACT', event_id: 'race-1',
          observed_at: new Date().toISOString(), // après le seeding, avant la course
          subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
          facts: { stock_available: { status: 'OBSERVED', value: 20 } },
        },
      });

      // Les deux opérations démarrent réellement en parallèle : la commande
      // retient son verrou 300ms (pg_sleep), le sync tente d'acquérir le
      // MÊME verrou FOR UPDATE immédiatement après. L'une des deux DOIT
      // attendre l'autre — c'est exactement ce qu'on vérifie ici, pas
      // seulement le résultat final.
      const orderPromise = delayedOrderPaymentDecrement(seed, { quantity: 2, delayMs: 300 });
      const syncPromise = new Promise((resolve) => setTimeout(resolve, 30))
        .then(() => applyStockSyncDecision(delta.observation_id, proofDeps).catch((e) => e));

      const [, syncOutcome] = await Promise.all([orderPromise, syncPromise]);

      const { rows: [finalRow] } = await db.query(
        'SELECT stock FROM product_skus WHERE id=$1', [sku.id]);

      // La commande a TOUJOURS le droit d'aboutir : 5 - 2 = 3 units restantes
      // AVANT tout sync. Le sync, lui, doit soit avoir vu le mouvement local
      // (REVIEW_REQUIRED / STALE selon l'ordre réel d'arrivée du verrou) et
      // n'avoir RIEN écrasé, soit s'être appliqué correctement AVANT la
      // commande — jamais une perte de la décrémentation de la commande.
      if (syncOutcome && syncOutcome.verdict) {
        // Le sync a été bloqué (cas attendu si la commande a pris le verrou
        // en premier, ou si updated_at a bougé entre-temps) : le stock doit
        // refléter EXACTEMENT le mouvement de la commande, jamais écrasé.
        expect(finalRow.stock).toBe(3); // 5 - 2, jamais 20
        expect([DECISION.REVIEW_REQUIRED, DECISION.STALE, DECISION.BLOCKED])
          .toContain(syncOutcome.verdict.decision);
      } else {
        // Le sync est passé AVANT la commande (verrou acquis en premier) :
        // stock = 20 après le sync, PUIS la commande décrémente sur CETTE
        // valeur (20 - 2 = 18) — jamais une perte de la décrémentation,
        // jamais 5 - 2 = 3 ignorant le sync, jamais 20 seul ignorant la commande.
        expect(finalRow.stock).toBe(18);
      }
    } finally {
      await cleanup(seed);
    }
  });

  test('deux applications concurrentes de LA MÊME observation : une seule écrit réellement, aucun double effet', async () => {
    const seed = await seedResolvedSkuLineage({ initialStock: 5 });
    const { sourceRef, provider, sku } = seed;
    try {
      const delta = await persistUnitStockChange(db, {
        sourceRef, envelope: {
          source: { provider, account_scope: 'default', source_ref: 'product-1' },
          method: 'PULL_EXACT', event_id: 'race-2',
          observed_at: new Date().toISOString(),
          subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
          facts: { stock_available: { status: 'OBSERVED', value: 11 } },
        },
      });

      const results = await Promise.allSettled([
        applyStockSyncDecision(delta.observation_id, proofDeps),
        applyStockSyncDecision(delta.observation_id, proofDeps),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      // Une seule écriture réelle ; le rejeu concurrent reste un résultat
      // idempotent NO_CHANGE, jamais une exception de succès déguisée.
      expect(fulfilled.length).toBe(2);
      expect(fulfilled.map((r) => r.value.verdict.decision).sort())
        .toEqual([DECISION.APPLY, DECISION.NO_CHANGE].sort());
      expect(fulfilled.filter((r) => r.value.applied === true)).toHaveLength(1);
      expect(fulfilled.filter((r) => r.value.applied === false)).toHaveLength(1);

      const { rows: [finalRow] } = await db.query(
        'SELECT stock FROM product_skus WHERE id=$1', [sku.id]);
      expect(finalRow.stock).toBe(11); // une seule écriture réelle, pas de double effet
    } finally {
      await cleanup(seed);
    }
  });

  afterAll(async () => db.pool.end());
}
