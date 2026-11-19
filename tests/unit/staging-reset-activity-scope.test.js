'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

const c = require('../../scripts/recette/staging-reset-classification');
const purge = require('../../scripts/controlled-business-purge');
const { assertResetAllowed, databasePin } = require('../../scripts/recette/staging-reset');

const schema = c.listSchemaTablesStatic();
// Arbitrage FK : ces tables « catalogue » referencent des commandes -> ACTIVITE (purgees), jamais preservees.
const ACTIVITY_EXCEPTIONS = ['catalog_product_quality_notes', 'pricing_maturity_disposition_events'];
const CATALOG_NAME = /^(products?|product_|catalog_|sourcing_|supplier_catalog_|import_runtime_|pricing_strateg|price_history|competitor_prices|market_price_obs|local_stock$)/;

describe('staging reset : portee activity (catalogue et sourcing preserves)', () => {
  test('la portee activity est declaree', () => {
    expect(c.RESET_SCOPES).toEqual(['prudent', 'full', 'activity']);
    expect(c.resetScope({ KOMERCE_STAGING_RESET_MODE: 'ACTIVITY' })).toBe('activity');
  });

  test('toute table preservee existe dans le schema et est purgee par prudent/full (comportement inchange)', () => {
    for (const t of c.ACTIVITY_PRESERVED) {
      expect({ t, inSchema: schema.includes(t) }).toEqual({ t, inSchema: true });
      expect({ t, purgeClass: c.isPurgeClass(t) }).toEqual({ t, purgeClass: true });
      expect({ t, purgeClassActivity: c.isPurgeClass(t, 'activity') }).toEqual({ t, purgeClassActivity: false });
    }
    expect(c.rootsTruncate('prudent')).toEqual(c.ROOTS_TRUNCATE);
    expect(c.rootsTruncate('full')).toEqual(c.ROOTS_TRUNCATE);
    expect(c.protectedSet('prudent')).toBe(c.PROTECTED);
  });

  test('aucune table catalogue/sourcing/prix/media n est purgee en activity (hors les 2 exceptions FK documentees)', () => {
    const purged = schema.filter((t) => c.isPurgeClass(t, 'activity'));
    expect(purged.filter((t) => CATALOG_NAME.test(t) && !ACTIVITY_EXCEPTIONS.includes(t))).toEqual([]);
    for (const t of ['products', 'product_skus', 'product_variants', 'product_attributes', 'catalog_media', 'product_sku_media',
      'product_market_exposure', 'product_market_price_drafts', 'product_market_price_draft_events', 'product_suppliers',
      'product_content_profile', 'product_content_sections', 'catalog_field_overrides', 'catalog_publication_decision_audit',
      'catalog_media_visual_fr_reviews', 'supplier_catalog_imports', 'sourcing_candidates', 'sourcing_captures', 'sourcing_observations',
      'local_stock']) {
      expect({ t, purged: purged.includes(t), kept: c.protectedSet('activity').has(t) }).toEqual({ t, purged: false, kept: true });
    }
    for (const t of ACTIVITY_EXCEPTIONS) expect(purged).toContain(t);
  });

  test('l activite est purgee : commandes, achats, Hub, expeditions, douane, cash, paiements, ecritures, alertes, SAV', () => {
    for (const t of ['orders', 'order_items', 'baskets', 'purchase_orders', 'purchase_lines', 'hub_physical_units', 'hub_box_bags',
      'hub_purchase_allocations', 'shipments', 'international_shipments', 'customs_shipments', 'parcels', 'cash_collections',
      'cash_deposits', 'cash_custody_receipts', 'cash_reconciliation', 'refunds', 'wallets', 'financial_movements', 'alerts',
      'client_notifications', 'local_stock_allocations', 'disputes', 'unsold_items', 'inventory_items', 'pickup_print_tokens']) {
      expect({ t, purged: c.isPurgeClass(t, 'activity') }).toEqual({ t, purged: true });
    }
  });

  test('partition : chaque table du schema est soit purgee soit protegee en activity, jamais les deux (derive)', () => {
    const prot = c.protectedSet('activity');
    const { unclassified } = c.diffAgainstSchema(schema);
    expect(unclassified).toEqual([]);
    for (const t of schema) {
      expect({ t, purge: c.isPurgeClass(t, 'activity'), prot: prot.has(t) }).not.toEqual({ t, purge: true, prot: true });
      expect({ t, either: c.isPurgeClass(t, 'activity') || prot.has(t) }).toEqual({ t, either: true });
    }
    expect(schema.filter((t) => c.isPurgeClass(t, 'activity')).length + schema.filter((t) => prot.has(t)).length).toBe(schema.length);
  });

  test('racines activity : aucune racine preservee ; fondation et comptes restent proteges', () => {
    for (const t of [...c.rootsTruncate('activity'), ...c.rootsDelete('activity')]) expect(c.ACTIVITY_PRESERVED.has(t)).toBe(false);
    expect(c.rootsDelete('activity')).not.toContain('sourcing_captures');
    for (const t of c.PROTECTED) expect(c.protectedSet('activity').has(t)).toBe(true);
  });

  // Plan reel sur un faux PostgreSQL : schema statique + aretes FK fournies.
  function fakeDb(edges) {
    return {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM pg_tables')) return { rows: schema.map((tablename) => ({ tablename })) };
        if (sql.includes('FROM pg_constraint')) return { rows: edges };
        if (/COUNT\(\*\)::bigint AS c FROM/.test(sql)) return { rows: [{ c: 0 }] };
        if (sql.includes('net AS (')) return { rows: [] };
        if (sql.includes('local_stock_allocations')) return { rows: [{ local_stock_rows: 0, units: 0 }] };
        throw new Error(`UNEXPECTED_QUERY:${sql.slice(0, 80)}`);
      }),
    };
  }
  const env = { KOMERCE_STAGING_RESET_MODE: 'activity' };

  test('buildPlan activity : cascade sans table preservee, preservees comptees comme protegees', async () => {
    const plan = await purge.buildPlan(fakeDb([
      { referenced_table: 'orders', referencing_table: 'order_items' },
      { referenced_table: 'products', referencing_table: 'order_items' }, // enfant d un parent preserve : sans effet
    ]), { env });
    expect(plan.scope).toBe('activity');
    expect(plan.roots).toContain('orders');
    expect(plan.roots).not.toContain('products');
    expect(plan.cascade_tables.filter((t) => c.ACTIVITY_PRESERVED.has(t))).toEqual([]);
    expect(plan.protected_cascade_hits).toEqual([]);
    expect(Object.keys(plan.protected_before)).toEqual(expect.arrayContaining(['products', 'sourcing_captures', 'catalog_media']));
    expect(plan.classification_drift).toEqual({ unclassified_tables: [], purge_class_outside_closure: expect.any(Array), closure_outside_purge_class: [] });
    expect(plan.stock_restoration).toBeDefined();
  });

  test('une table preservee qui referencerait l activite ferait avorter la purge (cascade protegee)', async () => {
    const plan = await purge.buildPlan(fakeDb([{ referenced_table: 'orders', referencing_table: 'product_skus' }]), { env });
    expect(plan.protected_cascade_hits).toEqual(['product_skus']);
    const noDrift = { unclassified_tables: [], purge_class_outside_closure: [], closure_outside_purge_class: [] };
    expect(() => purge.assertPlanSafe({ ...plan, classification_drift: noDrift }, {})).toThrow(/PURGE_ABORTED_PROTECTED_CASCADE:product_skus/);
    const run = purge.run({ execute: false, env, q: fakeDb([{ referenced_table: 'orders', referencing_table: 'product_skus' }]) });
    await expect(run).rejects.toThrow(/PURGE_ABORTED_/); // fail-closed, meme en dry-run
  });

  test('prudent : le meme plan garde le catalogue dans la purge (comportement inchange)', async () => {
    const plan = await purge.buildPlan(fakeDb([]), { env: {} });
    expect(plan.scope).toBe('prudent');
    expect(plan.roots).toContain('products');
    expect(plan.preserved_activity_tables).toBeUndefined();
  });

  test('gardes inchangees : execute exige jeton et confirmation, portee activity acceptee', async () => {
    const url = 'postgres://u:p@db.example.invalid:5432/komerce';
    const base = {
      KOMERCE_ENV: 'staging', NODE_ENV: 'test', DATABASE_URL: url, STAGING_BASE_URL: 'https://s.example.invalid',
      EXPECTED_RAILWAY_ENVIRONMENT: 'staging', KOMERCE_STAGING_RESET_DB_PIN: databasePin(url), KOMERCE_STAGING_RESET_MODE: 'activity',
    };
    expect(() => assertResetAllowed('dry-run', base)).not.toThrow();
    expect(() => assertResetAllowed('execute', base)).toThrow(/STAGING_RESET_ACK_MISSING/);
    expect(() => assertResetAllowed('execute', { ...base, KOMERCE_STAGING_RESET_ACK: 'RESET-STAGING-BUSINESS-DATA' })).toThrow(/PURGE_TOKEN_MISSING/);
    expect(() => assertResetAllowed('execute', { ...base, KOMERCE_STAGING_RESET_ACK: 'RESET-STAGING-BUSINESS-DATA', KOMERCE_CONTROLLED_PURGE_CONFIRM: purge.CONFIRM_TOKEN })).not.toThrow();
  });
});
