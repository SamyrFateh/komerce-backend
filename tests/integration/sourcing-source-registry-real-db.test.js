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
// Clé maître du coffre (test) : jamais une vraie clé.
process.env.KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY = require('crypto').randomBytes(32).toString('hex');
delete process.env.CJ_ACCESS_TOKEN;
delete process.env.CJ_API_KEY;
const VAULT_SECRET = 'cj-e2e-vault-secret-7f3a91c2';
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

  test('3b — sans identifiants : À CONFIGURER, aucun test ni activation possible', async () => {
    const control = (await workspace.listSourceControls()).find((c) => c.source_ref === SOURCE);
    expect(control).toMatchObject({ state: 'to_configure', credential_status: 'missing', autopilot_ready: false });
    expect(control.auth).toMatchObject({ mode: 'api_key', scope: 'source' });
    await expect(workspace.activateSourceAutopilot(SOURCE, actor)).rejects.toBeTruthy();
    expect(cj.fetchProducts).not.toHaveBeenCalled();
  });

  test('3c — enregistrement : chiffré en base, jamais renvoyé, état À TESTER', async () => {
    const saved = await workspace.configureCredentials(SOURCE, { api_key: VAULT_SECRET }, actor);
    expect(JSON.stringify(saved)).not.toContain(VAULT_SECRET);
    expect(saved).toMatchObject({ configured: true, credential_status: 'untested', connected: false });
    const { rows } = await db.query(
      `SELECT pc.*, s.credential_ref AS linked FROM provider_credentials pc
         JOIN sourcing_sources s ON s.credential_ref = pc.credential_ref WHERE s.source_id = $1`, [SOURCE]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'active', auth_type: 'api_key', provider_key: 'cj', key_version: 1 });
    expect(JSON.stringify(rows[0])).not.toContain(VAULT_SECRET);
    expect(Buffer.from(rows[0].envelope_ciphertext, 'base64').toString('utf8')).not.toContain(VAULT_SECRET);
    // Un second enregistrement est refusé : le remplacement passe par la rotation testée.
    await expect(workspace.configureCredentials(SOURCE, { api_key: 'autre-secret-123' }, actor))
      .rejects.toMatchObject({ code: 'credentials_already_configured' });
    const events = await db.query(`SELECT reason FROM sourcing_provider_control_events WHERE source_id = $1 AND capability = 'credentials'`, [SOURCE]);
    expect(events.rows.map((r) => r.reason)).toContain('credentials_configured');
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
    // Le connecteur reçoit le secret du coffre hors-bande ; le résultat n'en contient aucune trace.
    expect(cj.testConnection).toHaveBeenCalledWith({ credentials: { api_key: VAULT_SECRET } });
    expect(JSON.stringify(result)).not.toContain(VAULT_SECRET);
    const vault = await db.query(`SELECT last_test_status FROM provider_credentials WHERE status = 'active' AND provider_key = 'cj'`);
    expect(vault.rows[0].last_test_status).toBe('ok');
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

  // ── Cycle de vie : renommer, archiver, restaurer — jamais de suppression ──────────────
  const counts = async () => {
    const one = async (sql, params = [SOURCE]) => Number((await db.query(sql, params)).rows[0].n);
    return {
      captures: await one('SELECT COUNT(*)::int AS n FROM sourcing_captures WHERE source_id = $1'),
      observations: await one('SELECT COUNT(*)::int AS n FROM sourcing_observations WHERE capture_id IN (SELECT capture_id FROM sourcing_captures WHERE source_id = $1)'),
      runs: await one('SELECT COUNT(*)::int AS n FROM import_runtime_runs WHERE source_ref = $1'),
    };
  };
  let before;

  test('9 — renommer : libellé opérateur, aucun état de sécurité modifié', async () => {
    const result = await workspace.updateSource(SOURCE, { label: '  CJ   principal ' });
    expect(result).toMatchObject({ source_ref: SOURCE, label: 'CJ principal', source: { label: 'CJ principal', state: 'active' } });
    const { rows } = await db.query('SELECT display_name, autopilot_enabled, production_enabled, adapter_type FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    expect(rows[0]).toMatchObject({ display_name: 'CJ principal', autopilot_enabled: true, production_enabled: true, adapter_type: 'cj' });
    await expect(workspace.updateSource(SOURCE, { label: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(workspace.updateSource(SOURCE, { adapter: 'ebay' })).rejects.toMatchObject({ status: 400 });
  });

  test('10 — archiver : autopilot OFF, source sortie du tableau, historique et certification intacts', async () => {
    before = await counts();
    expect(before.captures).toBeGreaterThan(0);
    expect(before.runs).toBeGreaterThan(0);
    const result = await workspace.archiveSource(SOURCE, actor);
    expect(result).toMatchObject({ archived: true, changed: true, source: { state: 'archived', archived: true, autopilot_enabled: false } });
    const { rows } = await db.query('SELECT * FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    expect(rows[0]).toMatchObject({
      status: 'disabled', autopilot_enabled: false, discovery_enabled: true, sync_enabled: true,
      import_enabled: true, production_enabled: true,
    });
    expect(rows[0].production_certified_capture_id).not.toBeNull();
    expect(await counts()).toEqual(before);
    const events = await db.query(`SELECT old_value, new_value, reason FROM sourcing_provider_control_events WHERE source_id = $1 AND capability = 'lifecycle'`, [SOURCE]);
    expect(events.rows).toEqual([{ old_value: true, new_value: false, reason: 'operator_source_archive' }]);
    // Idempotent.
    await expect(workspace.archiveSource(SOURCE, actor)).resolves.toMatchObject({ changed: false });
  });

  test('11 — une source archivée n’est jamais exécutée ni activable', async () => {
    const fetchesBefore = cj.fetchProducts.mock.calls.length;
    const run = await autopilot.runActiveSources({ reason: 'e2e_archived' });
    expect(run.results.find((r) => r.source_ref === SOURCE)).toBeUndefined();
    expect(cj.fetchProducts.mock.calls.length).toBe(fetchesBefore);
    await expect(workspace.activateSourceAutopilot(SOURCE, actor)).rejects.toMatchObject({ code: 'sourcing_source_activation_blocked' });
    await expect(workspace.runSourceImportNow(SOURCE, actor)).rejects.toMatchObject({ code: 'sourcing_source_lifecycle_disabled' });
    expect(cj.fetchProducts.mock.calls.length).toBe(fetchesBefore);
  });

  test('12 — le catalogue signale l’archive et refuse la recréation', async () => {
    const catalog = await workspace.getSourceCatalog();
    expect(catalog.connectors.find((c) => c.adapter === 'cj')).toMatchObject({ existing_source_ref: SOURCE, existing_archived: true, can_create: false });
    await expect(workspace.createSource({ adapter: 'cj' }, actor)).rejects.toMatchObject({ code: 'sourcing_source_already_exists' });
  });

  test('13 — restaurer : visible et PRÊTE (certification conservée), autopilot toujours OFF, rien n’est exécuté', async () => {
    const fetchesBefore = cj.fetchProducts.mock.calls.length;
    const result = await workspace.restoreSource(SOURCE, actor);
    expect(result).toMatchObject({ archived: false, changed: true, source: { state: 'ready', autopilot_enabled: false } });
    const { rows } = await db.query('SELECT status, autopilot_enabled FROM sourcing_sources WHERE source_id = $1', [SOURCE]);
    expect(rows[0]).toEqual({ status: 'active', autopilot_enabled: false });
    const run = await autopilot.runActiveSources({ reason: 'e2e_restored' });
    expect(run.results.find((r) => r.source_ref === SOURCE)).toBeUndefined();
    expect(cj.fetchProducts.mock.calls.length).toBe(fetchesBefore);
    expect(await counts()).toEqual(before);
    const events = await db.query(`SELECT new_value FROM sourcing_provider_control_events WHERE source_id = $1 AND capability = 'lifecycle' ORDER BY created_at`, [SOURCE]);
    expect(events.rows.map((r) => r.new_value)).toEqual([false, true]);
  });

  test('14 — demandes « connecteur requis » : modifier puis retirer, sans jamais toucher à une source', async () => {
    const sourceBefore = (await db.query('SELECT * FROM sourcing_sources WHERE source_id = $1', [SOURCE])).rows[0];
    const created = await workspace.createSourceRequest({ provider_name: 'BigBuy E2E', requested_label: 'BigBuy E2E' }, actor);
    const updated = await workspace.updateSourceRequest(created.request_ref, { requested_label: 'BigBuy Europe', reference_url: 'https://example.test' });
    expect(updated).toMatchObject({ requested_label: 'BigBuy Europe', reference_url: 'https://example.test', provider_name: 'BigBuy E2E' });
    await expect(workspace.updateSourceRequest(created.request_ref, {})).rejects.toMatchObject({ status: 400 });
    await expect(workspace.deleteSourceRequest(created.request_ref)).resolves.toMatchObject({ deleted: true });
    await expect(workspace.deleteSourceRequest(created.request_ref)).rejects.toMatchObject({ status: 404 });
    await expect(workspace.updateSourceRequest('not-a-uuid', { requested_label: 'Ok' })).rejects.toMatchObject({ status: 404 });
    const sourceAfter = (await db.query('SELECT * FROM sourcing_sources WHERE source_id = $1', [SOURCE])).rows[0];
    expect(sourceAfter).toEqual(sourceBefore);
  });
});

