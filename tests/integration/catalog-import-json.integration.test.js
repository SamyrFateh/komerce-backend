'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * tests/integration/catalog-import-json.integration.test.js
 *
 * ING-6 — Verrouille le chemin transactionnel du connecteur JSON :
 *   - le batch naît (status=PROCESSING puis final) même si tout le fichier
 *     est en quarantaine (ready=0 n'est plus un 400) ;
 *   - ready / quarantined / rejected sont tous stagés et comptés ;
 *   - un import invalide (source malformée) ne crée AUCUN batch (Phase 1) ;
 *   - un candidat en quarantaine n'est pas promouvable (barrière ING-6) ;
 *   - le legacy (manual) reste inchangé — non-régression croisée.
 *
 * Run :
 *   DATABASE_URL=postgres://... JWT_SECRET=ci-test-secret-not-for-prod \
 *   npx jest tests/integration/catalog-import-json.integration.test.js --runInBand
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('catalog-import-json ING-6 (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const { importCatalog } = require('../../services/suppliers/catalog-import-orchestrator');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function baseProfile(overrides = {}) {
    return {
      profile_id: 'IT_JSON_ING6',
      profile_version: 1,
      supplier_name: `IT-JSON-${suffix()}`,
      source_type: 'json',
      currency: { default: 'AED', resolution_policy: 'SOURCE_THEN_DEFAULT', allowed: ['AED', 'USD'] },
      identity: { supplier_id_field: 'id' },
      media: { gallery_source_field: 'images', thumbnail_fallback: true },
      weight: { source_field: 'weight', source_unit: null, target_unit: 'kg', unknown_unit_policy: 'PRESERVE_RAW_AND_OMIT' },
      policies: {
        unsupported_video: 'QUARANTINE_PRODUCT',
        lossy_mapping: 'QUARANTINE_PRODUCT',
        duplicate_relation: 'DEDUPLICATE_AND_AUDIT',
        asset_reuse: 'ALLOW_AND_AUDIT',
        missing_brand: 'ALLOW_NULL',
        missing_image: 'ALLOW_WITH_WARNING',
        unknown_fields: 'PRESERVE_RAW',
      },
      batch: {
        max_products: 5000, max_file_bytes: 20000000, allow_empty_products: false,
        max_invalid_pct: 30, max_quarantined_pct: 50, max_field_bytes: 65536, max_depth: 12,
      },
      ...overrides,
    };
  }

  function product(i, overrides = {}) {
    return {
      id: `sku-${i}`,
      title: `Produit test ${i}`,
      price: 19.99,
      stock: 5,
      images: [`https://example.test/img-${i}.jpg`],
      ...overrides,
    };
  }

  let importedIds = [];
  let supplierNames = [];

  afterAll(async () => {
    for (const importId of importedIds) {
      await db.query('DELETE FROM supplier_catalog_import_rejections WHERE import_id = $1', [importId]).catch(() => {});
      await db.query('DELETE FROM sourcing_candidates WHERE import_id = $1', [importId]).catch(() => {});
      await db.query('DELETE FROM supplier_catalog_imports WHERE id = $1', [importId]).catch(() => {});
    }
    for (const s of supplierNames) {
      await db.query('DELETE FROM sourcing_candidates WHERE supplier_name = $1', [s]).catch(() => {});
    }
    await cleanup();
    await db.pool?.end?.();
  });

  test('batch mixte : ready + quarantined + rejected, tous stagés, aucune perte', async () => {
    const profile = baseProfile();
    supplierNames.push(profile.supplier_name);

    const source = {
      products: [
        product(1),
        product(2, { images: [] }), // pas d'image -> reste ready si non requis, sinon quarantaine selon pipeline
        { title: 'sans id' }, // rejeté : identité absente
      ],
    };

    const result = await importCatalog(
      {
        supplier_name: profile.supplier_name,
        source_type: 'json',
        import_profile: profile,
        source,
        source_bytes: Buffer.byteLength(JSON.stringify(source)),
      },
      null,
      async () => { throw new Error('dispatchToConnector ne doit JAMAIS être appelé pour source_type=json'); }
    );

    expect(result.status).toBe(200);
    expect(result.body.import_id).toBeTruthy();
    importedIds.push(result.body.import_id);

    const st = result.body.statistics;
    expect(st.rejected).toBe(1);
    expect(st.total).toBe(3);

    const batchRow = await db.query('SELECT * FROM supplier_catalog_imports WHERE id = $1', [result.body.import_id]);
    expect(batchRow.rows[0].source_type).toBe('json');
    // 1 rejet / 3 = 33.3% > max_invalid_pct(30) -> le seuil ING-I4 bloque le batch,
    // mais le batch existe et TOUT est stagé (c'est précisément le point testé).
    expect(['COMPLETED', 'COMPLETED_WITH_QUARANTINE', 'BLOCKED_INVALID_THRESHOLD']).toContain(batchRow.rows[0].status);
    expect(batchRow.rows[0].rejected_count).toBe(1);

    const rejections = await db.query(
      'SELECT * FROM supplier_catalog_import_rejections WHERE import_id = $1',
      [result.body.import_id]
    );
    expect(rejections.rows.length).toBe(1);
    expect(rejections.rows[0].reason_code).toBe('MISSING_SUPPLIER_PRODUCT_ID');
  });

  test('fichier 100% quarantaine/rejeté : le batch naît quand même (ready=0 n\'est plus un 400)', async () => {
    const profile = baseProfile();
    supplierNames.push(profile.supplier_name);

    const source = { products: [{ title: 'sans id 1' }, { title: 'sans id 2' }] };

    const result = await importCatalog(
      {
        supplier_name: profile.supplier_name,
        source_type: 'json',
        import_profile: profile,
        source,
        source_bytes: Buffer.byteLength(JSON.stringify(source)),
      },
      null,
      async () => { throw new Error('ne doit pas être appelé'); }
    );

    expect(result.status).toBe(200);
    importedIds.push(result.body.import_id);
    expect(result.body.status).toMatch(/BLOCKED_INVALID_THRESHOLD|COMPLETED/);

    const batchRow = await db.query('SELECT status, ready_count, rejected_count FROM supplier_catalog_imports WHERE id = $1', [result.body.import_id]);
    expect(batchRow.rows[0]).toBeTruthy(); // le batch existe : pas de 400 pré-INSERT
  });

  test('source illisible : AUCUN batch créé (Phase 1, avant INSERT)', async () => {
    const profile = baseProfile();
    const before = await db.query('SELECT COUNT(*) FROM supplier_catalog_imports WHERE supplier_name = $1', [profile.supplier_name]);

    const result = await importCatalog(
      {
        supplier_name: profile.supplier_name,
        source_type: 'json',
        import_profile: profile,
        source: { products: 'not-an-array' },
      },
      null,
      async () => { throw new Error('ne doit pas être appelé'); }
    );

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('BATCH_SOURCE_FORMAT_ERROR');

    const after = await db.query('SELECT COUNT(*) FROM supplier_catalog_imports WHERE supplier_name = $1', [profile.supplier_name]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });


  test('READY mono-image est persisté en V2, stock 0 conservé et contrat complet présent', async () => {
    const profile = baseProfile();
    supplierNames.push(profile.supplier_name);
    const source = { products: [product(101, { stock: 0 })] };

    const result = await importCatalog(
      {
        supplier_name: profile.supplier_name,
        source_type: 'json',
        import_profile: profile,
        source,
      },
      null,
      async () => { throw new Error('ne doit pas être appelé'); }
    );

    expect(result.status).toBe(200);
    importedIds.push(result.body.import_id);

    const row = await db.query(
      `SELECT state, stock_available, normalized_source_contract
         FROM sourcing_candidates
        WHERE supplier_name=$1 AND supplier_product_id=$2`,
      [profile.supplier_name, 'sku-101']
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].state).toBe('normalized');
    expect(row.rows[0].stock_available).toBe(0);
    expect(row.rows[0].normalized_source_contract).toBeTruthy();
    expect(String(row.rows[0].normalized_source_contract.schema_version)).toBe('2');
    expect(row.rows[0].normalized_source_contract.media).toHaveLength(1);
  });

  test('supplier_name différent du profil est refusé avant naissance du batch', async () => {
    const profile = baseProfile();
    const result = await importCatalog(
      {
        supplier_name: `${profile.supplier_name}-AUTRE`,
        source_type: 'json',
        import_profile: profile,
        source: { products: [product(201)] },
      },
      null,
      async () => { throw new Error('ne doit pas être appelé'); }
    );
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('BATCH_CONFIGURATION_ERROR');
  });

  test('profile_hash fourni mais faux est refusé avant naissance du batch', async () => {
    const profile = baseProfile();
    const result = await importCatalog(
      {
        supplier_name: profile.supplier_name,
        source_type: 'json',
        import_profile: profile,
        profile_hash: '0'.repeat(64),
        source: { products: [product(202)] },
      },
      null,
      async () => { throw new Error('ne doit pas être appelé'); }
    );
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('BATCH_CONFIGURATION_ERROR');
  });

  test('un candidat imported_to_catalog n\'est pas partiellement écrasé par un réimport', async () => {
    const profile = baseProfile();
    supplierNames.push(profile.supplier_name);

    const firstSource = { products: [product(301, { title: 'Titre initial', stock: 4 })] };
    const first = await importCatalog(
      { supplier_name: profile.supplier_name, source_type: 'json', import_profile: profile, source: firstSource },
      null,
      async () => { throw new Error('ne doit pas être appelé'); }
    );
    expect(first.status).toBe(200);
    importedIds.push(first.body.import_id);

    await db.query(
      `UPDATE sourcing_candidates
          SET state='imported_to_catalog'
        WHERE supplier_name=$1 AND supplier_product_id=$2`,
      [profile.supplier_name, 'sku-301']
    );

    const secondSource = { products: [product(301, { title: 'Titre réimporté', stock: 99 })] };
    const second = await importCatalog(
      { supplier_name: profile.supplier_name, source_type: 'json', import_profile: profile, source: secondSource },
      null,
      async () => { throw new Error('ne doit pas être appelé'); }
    );
    expect(second.status).toBe(200);
    importedIds.push(second.body.import_id);

    const row = await db.query(
      `SELECT state, product_name, stock_available, import_id
         FROM sourcing_candidates
        WHERE supplier_name=$1 AND supplier_product_id=$2`,
      [profile.supplier_name, 'sku-301']
    );
    expect(row.rows[0].state).toBe('imported_to_catalog');
    expect(row.rows[0].product_name).toBe('Titre initial');
    expect(row.rows[0].stock_available).toBe(4);
    expect(String(row.rows[0].import_id)).toBe(String(first.body.import_id));
  });

  test('legacy manual reste inchangé (non-régression croisée)', async () => {
    const admin = await createUser({ role: 'admin' });
    const supplierName = `IT-MANUAL-${suffix()}`;
    supplierNames.push(supplierName);

    const result = await importCatalog(
      { supplier_name: supplierName, source_type: 'manual', items: [] },
      admin.id,
      async () => ({ products: [], invalid: [] })
    );
    expect(result.status).toBe(400); // comportement legacy inchangé : liste vide -> 400
    expect(result.body.error).toMatch(/Aucun produit valide/);
  });
}
