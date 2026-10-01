'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * Mission « gestion canonique des sources » — E2E serveur sur vraie base :
 *   création opérateur → test de connexion → préparation/certification (premier import
 *   réel) → activation → runActiveSources voit la source → nouveau KIR → handoff normal,
 *   sans aucune publication marché.
 * Le fournisseur est simulé au niveau connecteur ; tout le reste (registre, politique de
 * capacités, import, capture, certification) tourne contre Postgres.
 */

const { describeE2E } = require('../helpers/e2eDbKit');

jest.mock('../../services/suppliers/connectors/cj-connector', () => {
  const state = { counter: 0, products: [] };
  const buildProduct = (n) => ({
    schema_version: '2',
    supplier_name: 'CJdropshipping',
    supplier_product_id: `E2E-REG-${n}`,
    product_name: `E2E Registry Gadgets ${n}`,
    description: 'E2E Registry Gadgets',
    currency: 'USD',
    source_locale: 'en',
    purchase_price: 4,
    supplier_category: 'E2E Registry Gadgets',
    weight_kg: 0.3,
    media: [
      { supplier_media_id: `m-${n}-a`, url: `https://cdn.example.com/e2e-reg-${n}-a.jpg`, role: 'PRODUCT', option_values: { Couleur: 'Noir' }, display_order: 1 },
      { supplier_media_id: `m-${n}-b`, url: `https://cdn.example.com/e2e-reg-${n}-b.jpg`, role: 'PRODUCT', option_values: { Couleur: 'Blanc' }, display_order: 2 },
    ],
    option_axes: [{ key: 'Couleur', display_name: 'Couleur', values: ['Noir', 'Blanc'], display_order: 1 }],
    sellable_units: [
      { supplier_sku: `E2E-REG-${n}-NOI`, option_values: { Couleur: 'Noir' }, stock_available: 5, media_refs: [`m-${n}-a`] },
      { supplier_sku: `E2E-REG-${n}-BLA`, option_values: { Couleur: 'Blanc' }, stock_available: 3, media_refs: [`m-${n}-b`] },
    ],
    raw_payload: { id: `E2E-REG-${n}`, e2e: true },
  });
  return {
    IS_ACTIVE: true,
    INACTIVE_REASON: null,
    __state: state,
    testConnection: jest.fn(async () => ({ ok: true })),
    fetchProducts: jest.fn(async () => {
      state.counter += 1;
      return { products: [buildProduct(state.counter)], invalid: [], total: 1 };
    }),
  };
});

process.env.KOMERCE_SOURCE_AUTOPILOT = '1';
process.env.KOMERCE_SOURCE_AUTOPILOT_TRANSIENT_RETRIES = '0';

describeE2E('Registre des sources — création → certification → activation', ({ db }) => {
  jest.setTimeout(60000);
  const SOURCE = 'api:cj';
  const actor = { id: null, role: 'admin' };
  let workspace;
  let autopilot;
  let cj;

  beforeAll(async () => {
    workspace = require('../../services/sourcing-workspace');
    autopilot = require('../../services/sourcing-source-autopilot');
    cj = require('../../services/suppliers/connectors/cj-connector');
    // Les observations sont append-only par doctrine : le test ne purge jamais l'historique.
    // Il exige une base de test vierge pour cette source (CI : schéma frais à chaque run).
    // Catégorie Komerce de test (supprimée en fin de scénario) : sans elle le scanner refuse
    // légitimement de décider et la certification reste bloquée (fail-closed).
    await db.query(
      `INSERT INTO customs_categories (key, label, douane_pct, tva_pct, default_margin_pct, is_active)
       VALUES ('e2e_registry_gadgets', 'E2E Registry Gadgets', 5, 10, 40, true)
       ON CONFLICT (key) DO NOTHING`
    );
    const { rows } = await db.query('SELECT 1 FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    if (rows.length) throw new Error('Base de test non vierge pour api:cj — recréer la base de test');
  });

  test('1 — la source n’existe pas tant que l’opérateur ne l’a pas ajoutée (aucune auto-création)', async () => {
    await autopilot.refreshRegisteredPullSources();
    const { rows } = await db.query('SELECT 1 FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    expect(rows).toHaveLength(0);
    const catalog = await workspace.getSourceCatalog();
    expect(catalog.connectors.find((c) => c.adapter === 'cj')).toMatchObject({ can_create: true, existing_source_ref: null });
  });

  test('2 — création fail-closed : OFF, aucune capacité, aucune certification, aucun import', async () => {
    const created = await workspace.createSource({ adapter: 'cj' }, actor);
    expect(created).toMatchObject({ source_ref: SOURCE, created: true });
    const { rows } = await db.query('SELECT * FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    expect(rows[0]).toMatchObject({
      autopilot_enabled: false, discovery_enabled: false, sync_enabled: false,
      import_enabled: false, production_enabled: false, production_certified_capture_id: null,
    });
    expect(cj.fetchProducts).not.toHaveBeenCalled();
    const captures = await db.query('SELECT 1 FROM sourcing_captures WHERE source_id = $1', [SOURCE]);
    expect(captures.rows).toHaveLength(0);
  });

  test('3 — doublon refusé, sans second enregistrement', async () => {
    await expect(workspace.createSource({ adapter: 'cj' }, actor)).rejects.toMatchObject({
      status: 409, code: 'sourcing_source_already_exists',
    });
  });

  test('4 — préparer sans test de connexion est refusé', async () => {
    await expect(workspace.prepareSourceForCertification(SOURCE, actor)).rejects.toMatchObject({
      code: 'sourcing_source_connection_untested',
    });
    expect(cj.fetchProducts).not.toHaveBeenCalled();
  });

  test('5 — le test de connexion n’est pas une certification', async () => {
    const result = await workspace.testSourceConnection(SOURCE);
    expect(result).toMatchObject({ ok: true, source_ref: SOURCE });
    const { rows } = await db.query('SELECT * FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    expect(rows[0].connection_test_status).toBe('ok');
    expect(rows[0].production_certified_capture_id).toBeNull();
    expect(rows[0].autopilot_enabled).toBe(false);
    expect(cj.fetchProducts).not.toHaveBeenCalled();
  });

  test('6 — préparation : capacités + premier import réel + certification, autopilot toujours OFF', async () => {
    const prepared = await workspace.prepareSourceForCertification(SOURCE, actor);
    expect(prepared.autopilot_enabled).toBe(false);
    expect(prepared.certification_run).toMatchObject({ status: 'certified' });
    const { rows } = await db.query('SELECT * FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    expect(rows[0]).toMatchObject({
      autopilot_enabled: false, discovery_enabled: true, sync_enabled: true,
      import_enabled: true, production_enabled: true,
    });
    expect(rows[0].production_certified_capture_id).not.toBeNull();
    expect(rows[0].production_certified_at).not.toBeNull();
  });

  let kirCountBefore;
  test('7 — activation explicite, puis runActiveSources voit la source et crée un nouveau KIR', async () => {
    const activated = await workspace.activateSourceAutopilot(SOURCE, actor);
    expect(activated).toBeTruthy();
    const { rows } = await db.query('SELECT autopilot_enabled FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    expect(rows[0].autopilot_enabled).toBe(true);

    kirCountBefore = Number((await db.query('SELECT COUNT(*)::int AS n FROM import_runtime_runs')).rows[0].n);
    const run = await autopilot.runActiveSources({ reason: 'e2e_registry' });
    expect(run.status).toBe('ok');
    const mine = run.results.find((r) => r.source_ref === SOURCE);
    expect(mine).toBeTruthy();
    expect(['completed', 'certified', 'ok']).toContain(mine.status);
    const kirCountAfter = Number((await db.query('SELECT COUNT(*)::int AS n FROM import_runtime_runs')).rows[0].n);
    expect(kirCountAfter).toBeGreaterThan(kirCountBefore);
  });

  afterAll(async () => {
    await db.query("DELETE FROM customs_categories WHERE key = 'e2e_registry_gadgets'").catch(() => {});
  });

  test('8 — handoff Catalogue normal, aucune publication marché', async () => {
    const { rows } = await db.query(
      `SELECT is_active, lifecycle_status FROM products WHERE name LIKE 'E2E Registry Gadgets %'`
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.is_active).toBe(false);
      expect(row.lifecycle_status).toBe('candidate');
    }
  });
});
