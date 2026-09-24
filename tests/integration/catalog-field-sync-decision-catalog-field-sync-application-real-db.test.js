'use strict';
/** @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * MISSION 2 — décideur et application contrôlée pour title/description
 * (products.name/description, protégés par catalog_field_overrides),
 * media (products.images/image_url, même garde), purchase_price
 * (catalog_field_sync_state uniquement, jamais products.cost_kmf) et
 * offer_status (decision-only, jamais d'écriture). Disposable CI
 * PostgreSQL only, entièrement synthétique.
 */
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === 'postgresql://komerce:komerce@localhost:5432/komerce_test';

if (!isolated) {
  describe.skip('catalog field sync: isolated CI DB required', () => {
    test('no non-isolated database writes', () => {});
  });
} else {
  const { randomUUID } = require('node:crypto');
  const db = require('../../db');
  const { persistCatalogChange } = require('../../services/sourcing-catalog-change-observation');
  const {
    DECISION, REASON, decideProductTextFieldSync, decideProductMediaSync,
    decidePurchasePriceSync, decideOfferLifecycleFieldSync,
  } = require('../../services/catalog-field-sync-decision');
  const {
    FieldSyncApplicationError, applyProductTextFieldSync, applyProductMediaSync, applyPurchasePriceSync,
  } = require('../../services/catalog-field-sync-application');

  jest.setTimeout(30000);

  /** Même chaîne d'identité que les tests Mission 1 — inchangée, réutilisée. */
  async function seedResolvedSkuLineage(q, { costKmf = null } = {}) {
    const provider = 'fld' + randomUUID().replace(/-/g, '').slice(0, 12);
    const sourceRef = 'api:' + provider;
    await q("INSERT INTO sourcing_sources (source_id,adapter_type,acquisition,continuity,status) " +
      "VALUES ($1,$2,'pull','recurring','active')", [sourceRef, provider]);
    const { rows: [catalogProduct] } = await q(
      "INSERT INTO products (name,description,price_kmf,cost_kmf,stock,is_active,inventory_model) " +
      "VALUES ($1,'Description initiale',1200,$2,0,true,'SKU') RETURNING id",
      ['Produit initial ' + provider, costKmf]);
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
        "VALUES ('LINK',$1,$2,$3,'system','field-sync-itest','synthetic exact source proof') " +
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
      "VALUES ($1,$2,0,true,'SUPPLIER','synthetic-sku','unit-1',$3::jsonb) RETURNING id",
      [catalogProduct.id, 'SYNTH-' + provider.slice(0, 8), JSON.stringify({
        provider, version: 1, payload: { pid: 'product-1', vid: 'unit-1' },
      })]);
    return { provider, sourceRef, catalogProduct, sku };
  }

  async function observeFact(q, { sourceRef, provider, eventId, observedAt, factName, fact }) {
    return persistCatalogChange(q, {
      sourceRef, envelope: {
        source: { provider, account_scope: 'default', source_ref: 'product-1' },
        method: 'PULL_EXACT', event_id: eventId, observed_at: observedAt,
        subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
        facts: { [factName]: fact },
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

  // Preuve d'autorité synthétique — n'est acceptée par le décideur QUE dans
  // ce contexte CI PostgreSQL jetable (isolatedFieldSyncProofTest()) : hors
  // de cette porte, injecter ce callback échouerait volontairement en
  // SYNTHETIC_PROOF_NOT_ALLOWED. Aucun résolveur d'autorité runtime
  // n'existe encore côté production.
  function syntheticAuthority(operationSuffix) {
    return async (ctx) => ({
      proved: true, operation: `${ctx.field_name}_${operationSuffix}`,
      source_id: ctx.source_id, catalog_product_id: ctx.catalog_product_id,
    });
  }

  describe('decideProductTextFieldSync — title/description', () => {
    test('APPLY : identité prouvée, fraîche, aucun override', async () => {
      await withTx(async (client, q) => {
        const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(q);
        const obs = await observeFact(client, {
          sourceRef, provider, eventId: 't1', observedAt: new Date().toISOString(),
          factName: 'title', fact: { status: 'OBSERVED', value: 'Nouveau titre fournisseur' },
        });
        const verdict = await decideProductTextFieldSync(
          obs.observation_ids.title, 'title', 'name', { query: q, authorityFn: syntheticAuthority('write') }
        );
        expect(verdict).toMatchObject({
          decision: DECISION.APPLY, reason: REASON.IDENTITY_PROVEN_AND_FRESH,
          catalog_product_id: catalogProduct.id, target_value: 'Nouveau titre fournisseur',
        });
      });
    });

    test('REVIEW_REQUIRED : un override manuel existant protège le champ, quelle que soit la fraîcheur', async () => {
      await withTx(async (client, q) => {
        const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(q);
        const adminId = randomUUID();
        await q(
          "INSERT INTO catalog_field_overrides (product_id, field_name, field_value, reason, set_by) " +
          "VALUES ($1,'name','Titre corrigé à la main','faute typo',$2)",
          [catalogProduct.id, adminId]
        );
        const obs = await observeFact(client, {
          sourceRef, provider, eventId: 't2', observedAt: new Date().toISOString(),
          factName: 'title', fact: { status: 'OBSERVED', value: 'Titre fournisseur qui tenterait d’écraser' },
        });
        const verdict = await decideProductTextFieldSync(
          obs.observation_ids.title, 'title', 'name', { query: q }
        );
        expect(verdict.decision).toBe(DECISION.REVIEW_REQUIRED);
        expect(verdict.reason).toBe(REASON.MANUAL_OVERRIDE_PROTECTED);
        expect(verdict.override_set_by).toBe(adminId);
      });
    });

    test('NO_CHANGE : la description observée égale déjà la valeur actuelle', async () => {
      await withTx(async (client, q) => {
        const { sourceRef, provider } = await seedResolvedSkuLineage(q);
        const obs = await observeFact(client, {
          sourceRef, provider, eventId: 't3', observedAt: new Date().toISOString(),
          factName: 'description', fact: { status: 'OBSERVED', value: 'Description initiale' },
        });
        const verdict = await decideProductTextFieldSync(
          obs.observation_ids.description, 'description', 'description', { query: q, authorityFn: syntheticAuthority('write') }
        );
        expect(verdict.decision).toBe(DECISION.NO_CHANGE);
        expect(verdict.reason).toBe(REASON.TARGET_EQUALS_CURRENT_VALUE);
      });
    });
  });

  describe('applyProductTextFieldSync — écriture contrôlée title/description', () => {
    test('écrit products.name pour de vrai et le prouve par lecture après écriture', async () => {
      const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(db.query.bind(db));
      try {
        const obs = await observeFact(db, {
          sourceRef, provider, eventId: 'w-t1', observedAt: new Date().toISOString(),
          factName: 'title', fact: { status: 'OBSERVED', value: 'Titre appliqué pour de vrai' },
        });
        const result = await applyProductTextFieldSync(obs.observation_ids.title, 'title', 'name', { authorityFn: syntheticAuthority('write') });
        expect(result.value_after).toBe('Titre appliqué pour de vrai');
        expect(result.read_after_write_verified).toBe(true);
        const { rows: [row] } = await db.query('SELECT name FROM products WHERE id=$1', [catalogProduct.id]);
        expect(row.name).toBe('Titre appliqué pour de vrai');
      } finally {
        await db.query('DELETE FROM catalog_field_sync_state WHERE subject_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM product_skus WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM sourcing_candidates WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM products WHERE id=$1', [catalogProduct.id]);
        // sourcing_observations et sourcing_captures sont append-only (garde-fou
        // réel, confirmé en testant) — base CI isolée et jetable, les lignes
        // orphelines n'ont aucune conséquence.
        await db.query('DELETE FROM sourcing_sources WHERE source_id=$1', [sourceRef]).catch(() => {});
      }
    });

    test('une relecture de titre incohérente provoque un ROLLBACK réel', async () => {
      const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(db.query.bind(db));
      try {
        const obs = await observeFact(db, {
          sourceRef, provider, eventId: 'w-t-readback', observedAt: new Date().toISOString(),
          factName: 'title', fact: { status: 'OBSERVED', value: 'Titre non commit' },
        });
        const originalQuery = db.query.bind(db);
        const injectedPool = {
          getClient: async () => {
            const client = await db.getClient();
            let wrote = false;
            return {
              query: async (sql, params) => {
                const result = await client.query(sql, params);
                if (String(sql).includes('UPDATE products SET name = $1')) wrote = true;
                if (wrote && String(sql).trim() === 'SELECT name AS value FROM products WHERE id = $1') {
                  return { rows: [{ value: 'MISMATCH' }] };
                }
                return result;
              },
              release: () => client.release(),
            };
          },
        };
        await expect(applyProductTextFieldSync(
          obs.observation_ids.title, 'title', 'name',
          { pool: injectedPool, authorityFn: syntheticAuthority('write') }
        )).rejects.toMatchObject({
          status: 500, verdict: expect.objectContaining({ reason: 'READ_AFTER_WRITE_MISMATCH' }),
        });
        expect((await originalQuery('SELECT name FROM products WHERE id=$1', [catalogProduct.id])).rows[0].name)
          .not.toBe('Titre non commit');
        expect((await originalQuery('SELECT COUNT(*)::int AS n FROM catalog_field_sync_state WHERE subject_id=$1',
          [catalogProduct.id])).rows[0].n).toBe(0);
      } finally {
        await db.query('DELETE FROM catalog_field_sync_state WHERE subject_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM product_skus WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM sourcing_candidates WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM products WHERE id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM sourcing_sources WHERE source_id=$1', [sourceRef]).catch(() => {});
      }
    });

    test('un override créé APRÈS la décision initiale mais AVANT l’écriture bloque sous verrou (réévaluation)', async () => {
      const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(db.query.bind(db));
      try {
        const obs = await observeFact(db, {
          sourceRef, provider, eventId: 'w-t2', observedAt: new Date().toISOString(),
          factName: 'title', fact: { status: 'OBSERVED', value: 'Titre qui devrait être bloqué' },
        });
        // Un admin pose un override juste après l'observation — avant toute application.
        await db.query(
          "INSERT INTO catalog_field_overrides (product_id, field_name, field_value, reason, set_by) " +
          "VALUES ($1,'name','Titre admin tardif','urgent',$2)",
          [catalogProduct.id, randomUUID()]
        );
        await expect(applyProductTextFieldSync(obs.observation_ids.title, 'title', 'name'))
          .rejects.toMatchObject({
            name: 'FieldSyncApplicationError',
            verdict: expect.objectContaining({ decision: DECISION.REVIEW_REQUIRED, reason: REASON.MANUAL_OVERRIDE_PROTECTED }),
          });
        const { rows: [row] } = await db.query('SELECT name FROM products WHERE id=$1', [catalogProduct.id]);
        expect(row.name).not.toBe('Titre qui devrait être bloqué');
      } finally {
        await db.query('DELETE FROM catalog_field_overrides WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM catalog_field_sync_state WHERE subject_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM product_skus WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM sourcing_candidates WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM products WHERE id=$1', [catalogProduct.id]);
        // sourcing_observations et sourcing_captures sont append-only (garde-fou
        // réel, confirmé en testant) — base CI isolée et jetable, les lignes
        // orphelines n'ont aucune conséquence.
        await db.query('DELETE FROM sourcing_sources WHERE source_id=$1', [sourceRef]).catch(() => {});
      }
    });

    test('rejeu de la même observation : pas de second effet', async () => {
      const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(db.query.bind(db));
      try {
        const obs = await observeFact(db, {
          sourceRef, provider, eventId: 'w-t3', observedAt: new Date().toISOString(),
          factName: 'title', fact: { status: 'OBSERVED', value: 'Titre une seule fois' },
        });
        await applyProductTextFieldSync(obs.observation_ids.title, 'title', 'name', { authorityFn: syntheticAuthority('write') });
        const replay = await applyProductTextFieldSync(obs.observation_ids.title, 'title', 'name');
        expect(replay).toMatchObject({
          applied: false, read_after_write_verified: false,
          verdict: expect.objectContaining({ decision: DECISION.NO_CHANGE }),
        });
        const { rows: [row] } = await db.query('SELECT name FROM products WHERE id=$1', [catalogProduct.id]);
        expect(row.name).toBe('Titre une seule fois');
      } finally {
        await db.query('DELETE FROM catalog_field_sync_state WHERE subject_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM product_skus WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM sourcing_candidates WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM products WHERE id=$1', [catalogProduct.id]);
        // sourcing_observations et sourcing_captures sont append-only (garde-fou
        // réel, confirmé en testant) — base CI isolée et jetable, les lignes
        // orphelines n'ont aucune conséquence.
        await db.query('DELETE FROM sourcing_sources WHERE source_id=$1', [sourceRef]).catch(() => {});
      }
    });
  });

  describe('media — décision et application', () => {
    test('APPLY puis écriture réelle de products.images, sans override', async () => {
      const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(db.query.bind(db));
      try {
        const obs = await observeFact(db, {
          sourceRef, provider, eventId: 'w-m1', observedAt: new Date().toISOString(),
          factName: 'media', fact: { status: 'OBSERVED', value: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'] },
        });
        const decided = await decideProductMediaSync(obs.observation_ids.media, { query: db.query.bind(db), authorityFn: syntheticAuthority('write') });
        expect(decided.decision).toBe(DECISION.APPLY);
        const result = await applyProductMediaSync(obs.observation_ids.media, { authorityFn: syntheticAuthority('write') });
        expect(result.value_after).toEqual(['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg']);
        const { rows: [row] } = await db.query('SELECT images, image_url FROM products WHERE id=$1', [catalogProduct.id]);
        expect(row.images).toEqual(['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg']);
        expect(row.image_url).toBe('https://example.com/photo1.jpg');
      } finally {
        await db.query('DELETE FROM catalog_field_sync_state WHERE subject_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM product_skus WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM sourcing_candidates WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM products WHERE id=$1', [catalogProduct.id]);
        // sourcing_observations et sourcing_captures sont append-only (garde-fou
        // réel, confirmé en testant) — base CI isolée et jetable, les lignes
        // orphelines n'ont aucune conséquence.
        await db.query('DELETE FROM sourcing_sources WHERE source_id=$1', [sourceRef]).catch(() => {});
      }
    });

    test('REVIEW_REQUIRED : un override existant sur image_url protège même sans mécanisme dédié à media', async () => {
      await withTx(async (client, q) => {
        const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(q);
        // Simule un override futur (jamais posé par catalog-overrides.js
        // aujourd'hui, mais ce décideur le respecterait déjà s'il existait).
        await q(
          "INSERT INTO catalog_field_overrides (product_id, field_name, field_value, reason, set_by) " +
          "VALUES ($1,'image_url','https://example.com/photo-admin.jpg','photo choisie à la main',$2)",
          [catalogProduct.id, randomUUID()]
        );
        const obs = await observeFact(client, {
          sourceRef, provider, eventId: 'm2', observedAt: new Date().toISOString(),
          factName: 'media', fact: { status: 'OBSERVED', value: ['https://example.com/photo-fournisseur.jpg'] },
        });
        const verdict = await decideProductMediaSync(obs.observation_ids.media, { query: q });
        expect(verdict.decision).toBe(DECISION.REVIEW_REQUIRED);
        expect(verdict.reason).toBe(REASON.MANUAL_OVERRIDE_PROTECTED);
      });
    });
  });

  describe('purchase_price — décision et application, jamais products.cost_kmf', () => {
    test('APPLY écrit catalog_field_sync_state, JAMAIS products.cost_kmf', async () => {
      const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(db.query.bind(db), { costKmf: 5000 });
      try {
        const obs = await observeFact(db, {
          sourceRef, provider, eventId: 'w-p1', observedAt: new Date().toISOString(),
          factName: 'purchase_price', fact: { status: 'OBSERVED', value: 7000 },
        });
        const result = await applyPurchasePriceSync(obs.observation_ids.purchase_price, { authorityFn: syntheticAuthority('write') });
        expect(result.value_after).toBe(7000);
        const { rows: [row] } = await db.query('SELECT cost_kmf FROM products WHERE id=$1', [catalogProduct.id]);
        // cost_kmf reste EXACTEMENT sa valeur d'origine — jamais touché,
        // même si un prix fournisseur différent a été observé et appliqué
        // dans la table de suivi. C'est le point central de cette politique.
        expect(Number(row.cost_kmf)).toBe(5000);
        const { rows: [tracked] } = await db.query(
          "SELECT applied_value FROM catalog_field_sync_state WHERE subject_id=$1 AND field_name='purchase_price'",
          [catalogProduct.id]
        );
        expect(tracked.applied_value).toBe(7000);
      } finally {
        await db.query('DELETE FROM catalog_field_sync_state WHERE subject_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM product_skus WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM sourcing_candidates WHERE product_id=$1', [catalogProduct.id]);
        await db.query('DELETE FROM products WHERE id=$1', [catalogProduct.id]);
        // sourcing_observations et sourcing_captures sont append-only (garde-fou
        // réel, confirmé en testant) — base CI isolée et jetable, les lignes
        // orphelines n'ont aucune conséquence.
        await db.query('DELETE FROM sourcing_sources WHERE source_id=$1', [sourceRef]).catch(() => {});
      }
    });
  });

  describe('offer_status — decision-only, jamais d’écriture', () => {
    test('identité prouvée mais toujours REVIEW_REQUIRED, jamais APPLY', async () => {
      await withTx(async (client, q) => {
        const { sourceRef, provider, catalogProduct } = await seedResolvedSkuLineage(q);
        const obs = await observeFact(client, {
          sourceRef, provider, eventId: 'o1', observedAt: new Date().toISOString(),
          factName: 'offer_status', fact: { status: 'OBSERVED', value: 'INACTIVE' },
        });
        const verdict = await decideOfferLifecycleFieldSync(
          obs.observation_ids.offer_status, 'offer_status', { query: q }
        );
        expect(verdict.decision).toBe(DECISION.REVIEW_REQUIRED);
        expect(verdict.reason).toBe(REASON.PUBLICATION_LINKED_DECISION_ONLY);
        expect(verdict.catalog_product_id).toBe(catalogProduct.id);
        // Preuve négative explicite : is_active n'a pas bougé.
        const { rows: [row] } = await q('SELECT is_active FROM products WHERE id=$1', [catalogProduct.id]);
        expect(row.is_active).toBe(true);
      });
    });
  });

  afterAll(async () => db.pool.end());
}
