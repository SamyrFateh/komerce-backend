'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * Feature proprietaire : infrastructure (reset Staging, LOT 1-PREP).
 * Preuve sur PostgreSQL EPHEMERE (base creee et detruite par le test, schema canonique + bootstrap CI) :
 * jeu de donnees sale representatif -> dry-run (0 mutation, rapport exact) -> execute -> verify vert ->
 * 2e execute = 0 suppression ; admin et fondation intacts ; blocage FK, derive de schema et gardes sans effet.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('STAGING RESET — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const path = require('path');
  const { spawnSync } = require('child_process');
  const { Client } = require('pg');
  const helpers = require('../helpers/stagingResetDirtyData');
  const classification = require('../../scripts/recette/staging-reset-classification');
  const { databasePin, ACK_VALUE } = require('../../scripts/recette/staging-reset');
  const { CONFIRM_TOKEN } = require('../../scripts/controlled-business-purge');

  const { insertRow, fingerprintAll } = helpers;
  const DRIVER = path.join(helpers.ROOT, 'tests', 'helpers', 'stagingResetDriver.js');

  jest.setTimeout(240000);

  function envFor(url, extra = {}) {
    return {
      ...process.env,
      NODE_ENV: 'test',
      KOMERCE_ENV: 'staging',
      DATABASE_URL: url,
      STAGING_BASE_URL: 'https://staging.example.invalid',
      EXPECTED_RAILWAY_ENVIRONMENT: 'staging',
      KOMERCE_STAGING_RESET_DB_PIN: databasePin(url),
      KOMERCE_STAGING_RESET_ACK: ACK_VALUE,
      KOMERCE_CONTROLLED_PURGE_CONFIRM: CONFIRM_TOKEN,
      ...extra,
    };
  }
  function drive(url, mode, extra) {
    const r = spawnSync(process.execPath, [DRIVER, mode], { cwd: helpers.ROOT, env: envFor(url, extra), encoding: 'utf8' });
    const line = r.stdout.trim().split('\n').filter(Boolean).pop();
    if (!line) throw new Error(`driver sans sortie: ${r.stderr}`);
    return JSON.parse(line);
  }

  const purgeTables = () => [...classification.namesOf('purge_root'), ...classification.namesOf('purge_via_fk')];
  const sameExcept = (a, b, skip) => Object.keys(a).filter((t) => !skip.has(t) && a[t] !== b[t]);

  async function seedDirty(c) {
    const rows = {};
    const user = async (email, role, full_name, extra = {}) => insertRow(c, 'users', { email, role, full_name, ...extra });
    rows.admin = await user('admin@komerce.km', 'admin', 'Admin Komerce');
    rows.real = await user('amina.said@gmail.com', 'client', 'Amina Said');
    rows.f1 = await user('rct1.client-km@recette.komerce.invalid', 'client', 'RCT1 Client KM');
    rows.f2 = await user('e2e-cash.agent.1@e2e-cash.test', 'agent_relais', 'E2E-CASH Agent');
    rows.f3 = await user('golden.buyer@komerce.km', 'client', 'Golden Buyer');
    rows.f4 = await user('op.cm@komerce.km', 'market_operator', 'RCT1 Operateur CM');

    const market = (await c.query('SELECT id FROM markets ORDER BY code LIMIT 1')).rows[0];
    rows.relFix = await insertRow(c, 'relais', { name: 'RCT1-REL-KM', market_id: market.id });
    rows.relReal = await insertRow(c, 'relais', { name: 'Relais Komerce Moroni Centre', market_id: market.id });
    await c.query('UPDATE users SET relais_id = $1 WHERE id = $2', [rows.relFix.id, rows.f2.id]);
    await c.query('UPDATE users SET relais_id = $1 WHERE id = $2', [rows.relReal.id, rows.real.id]);
    rows.partFix = await insertRow(c, 'partners', { name: 'E2E Partner' });
    rows.partReal = await insertRow(c, 'partners', { name: 'Atelier Couture Mutsamudu' });

    // Comptes : droits portes par des fixtures (a retirer) et par l'admin (a conserver).
    rows.memFix = await insertRow(c, 'assignment_memberships', { user_id: rows.f4.id });
    rows.memAdmin = await insertRow(c, 'assignment_memberships', { user_id: rows.admin.id });
    rows.passkeyFix = await insertRow(c, 'webauthn_credentials', { user_id: rows.f1.id });
    rows.passkeyAdmin = await insertRow(c, 'webauthn_credentials', { user_id: rows.admin.id });
    rows.grantFix = await insertRow(c, 'catalog_global_access_grants', { user_id: rows.f1.id });
    rows.grantAdmin = await insertRow(c, 'catalog_global_access_grants', { user_id: rows.admin.id });
    rows.scopeFix = await insertRow(c, 'operator_market_scopes', { user_id: rows.f4.id });
    rows.inviteFix = await insertRow(c, 'market_team_invitations', { invited_by_user_id: rows.f4.id });

    // Donnees metier / test (toutes classees purge_*).
    rows.order = await insertRow(c, 'orders', { user_id: rows.f1.id });
    await insertRow(c, 'orders', { user_id: rows.real.id });
    await insertRow(c, 'order_items', { order_id: rows.order.id });
    await insertRow(c, 'products');
    for (const t of [
      'purchase_orders', 'supplier_execution_orders', 'hub_physical_units', 'parcels', 'shipments', 'shipment_batches',
      'international_shipments', 'customs_shipments', 'customs_shipment_fees', 'cash_collections', 'cash_reconciliation',
      'order_cost_entry_events', 'wallets', 'wallet_transactions', 'wallet_credit_lots', 'stripe_events_processed',
      'paypal_events_processed', 'otp_codes', 'alerts', 'webauthn_challenges', 'client_notifications', 'financial_movements',
      'risk_provisions', 'sourcing_captures',
    ]) await insertRow(c, t);
    await insertRow(c, 'wallets', { user_id: rows.f3.id });
    await insertRow(c, 'user_pickup_authorizations', { user_id: rows.f1.id });
    // Fondation mise en place par le jeu de donnees (rattachee a l'admin conserve, jamais a une fixture).
    await insertRow(c, 'market_delivery_attestations', { attested_by: rows.admin.id });
    return rows;
  }

  describe('STAGING RESET — REAL_DB — dry-run, execute, idempotence', () => {
    let eph; let c; let rows; let baseline;
    beforeAll(async () => {
      eph = await helpers.createEphemeralDatabase(process.env.DATABASE_URL);
      c = new Client({ connectionString: eph.url });
      await c.connect();
      rows = await seedDirty(c);
      baseline = await fingerprintAll(c);
    });
    afterAll(async () => {
      if (c) await c.end().catch(() => {});
      if (eph) await eph.drop().catch(() => {});
    });

    test('classification exhaustive contre le schema reel et fermeture FK identique aux classes purge_*', async () => {
      const { rows: tr } = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
      const live = tr.map((r) => r.tablename);
      expect(classification.diffAgainstSchema(live)).toEqual({ unclassified: [], stale: [] });
      expect(classification.listSchemaTablesStatic()).toEqual(live.sort());
    });

    test('le jeu de donnees est sale partout ou le reset doit agir', () => {
      const dirty = purgeTables().filter((t) => !baseline[t].startsWith('0:'));
      for (const t of ['orders', 'order_items', 'products', 'purchase_orders', 'supplier_execution_orders', 'hub_physical_units',
        'parcels', 'shipments', 'international_shipments', 'customs_shipments', 'cash_collections', 'wallets',
        'stripe_events_processed', 'paypal_events_processed', 'sourcing_captures']) expect(dirty).toContain(t);
    });

    test('dry-run : 0 mutation et rapport exact', () => {
      const out = drive(eph.url, 'dry-run');
      expect(out.ok).toBe(true);
      const { report } = out;
      expect(report.status).toBe('DRY_RUN_OK');
      const expected = {};
      for (const t of purgeTables()) { const n = Number(baseline[t].split(':')[0]); if (n) expected[t] = n; }
      expect(report.tables_emptied).toEqual(expected);
      expect(report.fixtures.summary).toMatchObject({ users: 4, relais: 1, partners: 1 });
      expect(report.fixtures.summary.users_kept_allowlisted).toHaveLength(1);
      expect(report.fixtures.summary.users_kept_unmatched).toHaveLength(1);
      expect(report.fixtures.blockers).toEqual([]);
      expect(report.fixtures.would_delete).toMatchObject({
        users: 4, relais: 1, partners: 1, assignment_memberships: 1, webauthn_credentials: 1,
        catalog_global_access_grants: 1, operator_market_scopes: 1, market_team_invitations: 1,
      });
      return fingerprintAll(c).then((after) => expect(sameExcept(baseline, after, new Set())).toEqual([]));
    });

    test('execute : verify vert, fixtures retirees, admin/fondation intacts', async () => {
      const out = drive(eph.url, 'execute');
      expect(out.ok).toBe(true);
      expect(out.report.status).toBe('RESET_OK');
      expect(out.report.verify.ok).toBe(true);
      expect(out.report.reference_seeded).toBe('skipped_already_canonical');
      const after = await fingerprintAll(c);

      // toutes les tables purge_* sont vides
      for (const t of purgeTables()) expect({ t, n: after[t].split(':')[0] }).toEqual({ t, n: '0' });
      // fondation : contenu strictement identique (hors updated_at)
      expect(sameExcept(baseline, after, new Set([...purgeTables(), ...classification.namesOf('fixture_scoped')]))).toEqual([]);
      // comptes : seuls l'admin allowlist et le compte reel non reconnu subsistent
      const { rows: users } = await c.query('SELECT email FROM users ORDER BY email');
      expect(users.map((u) => u.email)).toEqual(['admin@komerce.km', 'amina.said@gmail.com']);
      expect((await c.query('SELECT name FROM relais ORDER BY name')).rows.map((r) => r.name)).toEqual(['Relais Komerce Moroni Centre']);
      expect((await c.query('SELECT name FROM partners ORDER BY name')).rows.map((r) => r.name)).toEqual(['Atelier Couture Mutsamudu']);
      // droits de l'admin conserves, ceux des fixtures retires
      expect((await c.query('SELECT user_id FROM assignment_memberships')).rows.map((r) => r.user_id)).toEqual([rows.admin.id]);
      expect((await c.query('SELECT user_id FROM webauthn_credentials')).rows.map((r) => r.user_id)).toEqual([rows.admin.id]);
      expect((await c.query('SELECT user_id FROM catalog_global_access_grants')).rows.map((r) => r.user_id)).toEqual([rows.admin.id]);
      // referentiels presents
      const { rows: [m] } = await c.query('SELECT COUNT(*)::int AS n FROM markets');
      expect(m.n).toBeGreaterThanOrEqual(5);
    });

    test('2e execute : 0 suppression, 0 mutation', async () => {
      const before = await fingerprintAll(c);
      const out = drive(eph.url, 'execute');
      expect(out.ok).toBe(true);
      expect(out.report.status).toBe('RESET_OK');
      expect(out.report.tables_emptied).toEqual({});
      expect(out.report.fixtures_deleted).toEqual({});
      expect(sameExcept(before, await fingerprintAll(c), new Set())).toEqual([]);
    });
  });

  describe('STAGING RESET — REAL_DB — refus sans effet', () => {
    let eph; let c; let baseline;
    beforeAll(async () => {
      eph = await helpers.createEphemeralDatabase(process.env.DATABASE_URL);
      c = new Client({ connectionString: eph.url });
      await c.connect();
      const admin = await insertRow(c, 'users', { email: 'admin@komerce.km', role: 'admin', full_name: 'Admin Komerce' });
      const fx = await insertRow(c, 'users', { email: 'rct1.operator@recette.komerce.invalid', role: 'market_operator', full_name: 'RCT1 Op' });
      await insertRow(c, 'orders', { user_id: admin.id });
      // fondation (RESTRICT sur users) ecrite par une fixture : retrait impossible sans toucher la fondation.
      await insertRow(c, 'economic_structure_cost_events', { recorded_by: fx.id });
      baseline = await fingerprintAll(c);
    });
    afterAll(async () => {
      if (c) await c.end().catch(() => {});
      if (eph) await eph.drop().catch(() => {});
    });

    test('fixture referencee par la fondation : dry-run BLOCKED, execute refuse, rien ne bouge', async () => {
      const dry = drive(eph.url, 'dry-run');
      expect(dry.report.status).toBe('DRY_RUN_BLOCKED');
      expect(dry.report.fixture_blockers).toEqual([expect.objectContaining({ table: 'economic_structure_cost_events', columns: ['recorded_by'], rows: 1 })]);
      const run = drive(eph.url, 'execute');
      expect(run.ok).toBe(false);
      expect(run.message).toMatch(/FIXTURE_RETIREMENT_BLOCKED/);
      expect(sameExcept(baseline, await fingerprintAll(c), new Set())).toEqual([]);
    });

    test('gardes : ACK absent, jeton absent, epingle de base fausse, production -> refus sans effet', async () => {
      for (const [extra, code] of [
        [{ KOMERCE_STAGING_RESET_ACK: '' }, 'STAGING_RESET_ACK_MISSING'],
        [{ KOMERCE_CONTROLLED_PURGE_CONFIRM: '' }, 'STAGING_RESET_PURGE_TOKEN_MISSING'],
        [{ KOMERCE_STAGING_RESET_DB_PIN: 'autre-hote:5432/autre' }, 'STAGING_RESET_DATABASE_NOT_PINNED'],
        [{ KOMERCE_ENV: 'production' }, 'STAGING_RESET_REFUSED_PRODUCTION'],
      ]) {
        const out = drive(eph.url, 'execute', extra);
        expect(out).toMatchObject({ ok: false, code });
      }
      expect(sameExcept(baseline, await fingerprintAll(c), new Set())).toEqual([]);
    });

    test('table non classee (derive de schema) : dry-run et execute refuses, verify rouge', async () => {
      await c.query('CREATE TABLE zz_unclassified_new_table (id int)');
      try {
        const dry = drive(eph.url, 'dry-run');
        expect(dry.ok).toBe(false);
        expect(dry.message).toMatch(/PURGE_ABORTED_CLASSIFICATION_DRIFT.*zz_unclassified_new_table/);
        const run = drive(eph.url, 'execute');
        expect(run.ok).toBe(false);
        const { verify } = require('../../scripts/recette/staging-verify-empty');
        const v = await verify(c, { env: envFor(eph.url) });
        expect(v.checks.find((x) => x.id === 'classification_complete').ok).toBe(false);
      } finally {
        await c.query('DROP TABLE zz_unclassified_new_table');
      }
    });
  });

  describe('STAGING RESET — REAL_DB — mode full', () => {
    let eph; let c; let rows; let baseline;
    beforeAll(async () => {
      eph = await helpers.createEphemeralDatabase(process.env.DATABASE_URL);
      c = new Client({ connectionString: eph.url });
      await c.connect();
      const market = (await c.query('SELECT id FROM markets ORDER BY code LIMIT 1')).rows[0];
      rows = {};
      rows.admin = await insertRow(c, 'users', { email: 'admin@komerce.km', role: 'admin', full_name: 'Admin Komerce' });
      rows.client = await insertRow(c, 'users', { email: '26912345678@komerce.km', role: 'client', full_name: 'Client reel' });
      rows.fix = await insertRow(c, 'users', { email: 'rct1.op@recette.komerce.invalid', role: 'market_operator', full_name: 'RCT1 Op' });
      rows.fix2 = await insertRow(c, 'users', { email: 'e2e.two@e2e-cash.test', role: 'admin', full_name: 'E2E Two' });
      rows.rel = await insertRow(c, 'relais', { name: 'RCT1-REL-KM', market_id: market.id });
      rows.assign = await insertRow(c, 'market_operating_assignments', { market_id: market.id, granted_by: rows.fix.id });
      rows.ceil = await insertRow(c, 'assignment_capability_ceiling', { assignment_id: rows.assign.id, granted_by: rows.fix.id });
      rows.policy = await insertRow(c, 'market_cash_control_policies', { assignment_id: rows.assign.id, market_id: market.id });
      rows.audit = await insertRow(c, 'market_delegation_audit', { actor_user_id: rows.fix.id });
      rows.auditKeep = await insertRow(c, 'market_delegation_audit', { actor_user_id: rows.admin.id });
      rows.dest = await insertRow(c, 'market_cash_destinations', { market_id: market.id, proposed_by: rows.fix.id });
      await c.query(`UPDATE market_cash_destinations SET status='ACTIVE', activated_by=$1, activated_at=NOW() WHERE id=$2`, [rows.fix2.id, rows.dest.id]);
      await insertRow(c, 'orders', { user_id: rows.client.id });
      await insertRow(c, 'stripe_events_processed');
      baseline = await fingerprintAll(c);
    });
    afterAll(async () => {
      if (c) await c.end().catch(() => {});
      if (eph) await eph.drop().catch(() => {});
    });

    test('prudent (defaut) : les 5 blocages sont rapportes, le client reel est conserve', () => {
      const dry = drive(eph.url, 'dry-run');
      expect(dry.report.status).toBe('DRY_RUN_BLOCKED');
      expect(dry.report.fixture_blockers.map((b) => `${b.table}.${b.columns.join('+')}`).sort()).toEqual([
        'assignment_capability_ceiling.granted_by', 'market_cash_destinations.activated_by', 'market_cash_destinations.proposed_by',
        'market_delegation_audit.actor_user_id', 'market_operating_assignments.granted_by',
      ]);
      expect(dry.report.fixtures.summary.users_kept_unmatched.map((u) => u.role)).toEqual(['client']);
      expect(dry.report.scope).toBe('prudent');
    });

    test('full dry-run : 0 blocage, 0 mutation, rapport exact (relais, diff referentiel, stripe)', async () => {
      const dry = drive(eph.url, 'dry-run', { KOMERCE_STAGING_RESET_MODE: 'full' });
      expect(dry.ok).toBe(true);
      const r = dry.report;
      expect(r.scope).toBe('full');
      expect(r.status).toBe('DRY_RUN_OK');
      expect(r.fixtures.blockers).toEqual([]);
      expect(r.fixtures.summary).toMatchObject({ users: 3, relais: 1 });
      expect(r.fixtures.summary.users_kept_by_role).toEqual({ admin: 1 });
      expect(r.fixtures.summary.relais_removed).toEqual([expect.objectContaining({ name: 'RCT1-REL-KM', market: expect.any(String) })]);
      expect(r.fixtures.would_delete).toMatchObject({
        users: 3, assignment_capability_ceiling: 1, market_operating_assignments: 1, market_cash_control_policies: 1,
        market_cash_destinations: 1, market_delegation_audit: 1,
      });
      expect(r.reference_drift).toEqual({});
      expect(r.stripe_events_processed).toMatchObject({ total: 1, stored: 'not_stored' });
      expect(r.rows_to_purge_total).toBeGreaterThan(0);
      expect(sameExcept(baseline, await fingerprintAll(c), new Set())).toEqual([]);
      // repetition generale : joue la purge complete (dont TRUNCATE de la table append-only) puis annule
      const sim = drive(eph.url, 'dry-run', { KOMERCE_STAGING_RESET_MODE: 'full', KOMERCE_STAGING_RESET_SIMULATE: '1' });
      expect(sim.report.simulation).toMatchObject({ ok: true, rolled_back: true });
      expect(sim.report.simulation.fixtures_deleted).toMatchObject({ users: 3, market_cash_destinations: 1 });
      expect(sameExcept(baseline, await fingerprintAll(c), new Set())).toEqual([]);
    });

    test('full execute : seul l admin subsiste, lignes d auteurs retires purgees, ligne de l admin conservee, verify vert, idempotent', async () => {
      const out = drive(eph.url, 'execute', { KOMERCE_STAGING_RESET_MODE: 'full' });
      expect({ ok: out.ok, message: out.message }).toEqual({ ok: true, message: undefined });
      expect(out.report.status).toBe('RESET_OK');
      expect((await c.query('SELECT email FROM users')).rows.map((u) => u.email)).toEqual(['admin@komerce.km']);
      expect(Number((await c.query('SELECT COUNT(*) FROM market_operating_assignments')).rows[0].count)).toBe(0);
      expect(Number((await c.query('SELECT COUNT(*) FROM market_cash_destinations')).rows[0].count)).toBe(0);
      expect((await c.query('SELECT actor_user_id FROM market_delegation_audit')).rows.map((a) => a.actor_user_id)).toEqual([rows.admin.id]);
      expect(Number((await c.query('SELECT COUNT(*) FROM relais')).rows[0].count)).toBe(0);
      const after = await fingerprintAll(c);
      const again = drive(eph.url, 'execute', { KOMERCE_STAGING_RESET_MODE: 'full' });
      expect(again.report.status).toBe('RESET_OK');
      expect(again.report.fixtures_deleted).toEqual({});
      expect(sameExcept(after, await fingerprintAll(c), new Set())).toEqual([]);
    });

    test('full ne force pas une colonne hors liste nominative (economic_structure_cost_events.recorded_by)', async () => {
      const u = await insertRow(c, 'users', { email: 'x@komerce.km', role: 'client', full_name: 'X' });
      await insertRow(c, 'economic_structure_cost_events', { recorded_by: u.id });
      const dry = drive(eph.url, 'dry-run', { KOMERCE_STAGING_RESET_MODE: 'full' });
      expect(dry.report.status).toBe('DRY_RUN_BLOCKED');
      expect(dry.report.fixture_blockers).toEqual([expect.objectContaining({ table: 'economic_structure_cost_events', columns: ['recorded_by'] })]);
    });
  });
}
