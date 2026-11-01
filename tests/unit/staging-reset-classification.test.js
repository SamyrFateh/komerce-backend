'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

const c = require('../../scripts/recette/staging-reset-classification');
const purge = require('../../scripts/controlled-business-purge');
const fixtures = require('../../scripts/recette/staging-reset-fixtures');

const CLASSES = ['purge_root', 'purge_via_fk', 'foundation', 'fixture_scoped'];

describe('staging reset classification : garde anti-derive', () => {
  const schema = c.listSchemaTablesStatic();

  test('le schema (snapshot + migrations) est reconstruit et non vide', () => {
    expect(schema.length).toBeGreaterThan(200);
    expect(schema).toEqual(expect.arrayContaining(['orders', 'users', 'wallets', 'shipments']));
  });

  test('CHAQUE table du schema est classee (une migration qui ajoute une table fait echouer ce test)', () => {
    const { unclassified, stale } = c.diffAgainstSchema(schema);
    expect({ unclassified }).toEqual({ unclassified: [] });
    expect({ stale }).toEqual({ stale: [] });
  });

  test('chaque entree a une classe valide et une justification', () => {
    for (const e of c.TABLES.values()) {
      expect(CLASSES).toContain(e.class);
      expect(e.why.length).toBeGreaterThan(3);
    }
    expect(c.TABLES.size).toBe(schema.length);
  });

  test('les 4 classes sont toutes utilisees et disjointes', () => {
    const seen = new Set();
    for (const cls of CLASSES) {
      const names = c.namesOf(cls);
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) { expect(seen.has(n)).toBe(false); seen.add(n); }
    }
  });

  test('constat Opus : toutes les tables metier hors purge sont des racines', () => {
    for (const t of [
      'shipments', 'shipment_batches', 'international_shipments', 'international_shipment_charges', 'international_shipment_events',
      'customs_shipments', 'customs_shipment_fees', 'customs_shipment_financial_audit', 'customs_shipment_parcel_events',
      'cash_reconciliation', 'order_cost_entry_events', 'wallets', 'wallet_transactions', 'wallet_credit_lots',
      'wallet_consumptions', 'stripe_events_processed', 'paypal_events_processed',
    ]) expect(c.classOf(t)).toBe('purge_root');
  });

  test('referentiels critiques et comptes : jamais purges', () => {
    for (const t of ['markets', 'finance_config', 'currency_parities', 'fx_pegs', 'schema_migrations', 'sourcing_sources', 'capability_registry']) {
      expect(c.classOf(t)).toBe('foundation');
    }
    for (const t of ['users', 'relais', 'partners']) expect(c.classOf(t)).toBe('fixture_scoped');
  });

  test('PROTECTED = foundation + fixture_scoped, sans intersection avec les racines', () => {
    expect(purge.PROTECTED_TABLES).toBe(c.PROTECTED);
    for (const t of c.ROOTS_TRUNCATE) expect(c.PROTECTED.has(t)).toBe(false);
    expect(purge.ROOT_CANDIDATES).toEqual(c.ROOTS_TRUNCATE);
    expect(purge.DELETE_ROOTS).toEqual(['sourcing_captures']);
    expect(c.ROOTS_TRUNCATE).not.toContain('sourcing_captures');
  });

  test('les tables a proprietaire fixture sont fixture_scoped et leurs colonnes sont listees', () => {
    for (const t of Object.keys(c.FIXTURE_OWNER_COLUMNS)) expect(c.classOf(t)).toBe('fixture_scoped');
    for (const t of c.FIXTURE_ROOT_TABLES) expect(c.classOf(t)).toBe('fixture_scoped');
  });

  test('les classements incertains sont exposes pour arbitrage', () => {
    expect(c.UNCERTAIN_FOUNDATION).toEqual(expect.arrayContaining(['providers', 'market_delivery_attestations', 'suppliers']));
    expect(c.UNCERTAIN_PURGE).toEqual(['economic_risk_watermark_events']);
  });

  test('doublon dans la classification : erreur de chargement impossible a contourner', () => {
    const names = c.ENTRIES.map((e) => e[0]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('staging reset : regles fixtures deterministes', () => {
  const allow = c.allowlistFrom({});

  test.each([
    ['rct1.client-km@recette.komerce.invalid'],
    ['e2e-cash.agent.abc@e2e-cash.test'],
    ['e2e@komerce.km'],
    ['golden.buyer@komerce.km'],
    ['a8-recette-1@whatever.org'],
    ['audit.probe@komerce.km'],
    ['x@komerce.test'],
    ['user123@e2e.invalid'],
    ['recette-admin@example.invalid'],
  ])('compte de test reconnu : %s', (email) => {
    expect(c.userFixtureReason({ email, full_name: 'Quelqu un' }, allow)).toBeTruthy();
  });

  test.each([
    [{ email: 'amina.said@gmail.com', full_name: 'Amina Said' }],
    [{ email: 'partner@societe-cameroun.cm', full_name: 'Partenaire' }],
    [{ email: null, full_name: 'Sans email' }],
    [{ email: 'admin@komerce.km', full_name: 'Admin Komerce' }],
    [{ email: 'transitaire@komerce.km', full_name: 'Transitaire Komerce' }],
  ])('compte reel ou allowliste conserve : %j', (u) => {
    expect(c.userFixtureReason(u, allow)).toBeNull();
  });

  test('un nom de fixture suffit meme sans e-mail de test', () => {
    expect(c.userFixtureReason({ email: 'op.cm@komerce.km', full_name: 'RCT1 Operateur CM' }, allow)).toBe('name_prefix');
  });

  test('allowlist etendue par KOMERCE_STAGING_RESET_KEEP_EMAILS (insensible a la casse) et prioritaire sur les motifs', () => {
    const a = c.allowlistFrom({ KOMERCE_STAGING_RESET_KEEP_EMAILS: ' Recette-Admin@example.invalid ,' });
    expect(a.has('recette-admin@example.invalid')).toBe(true);
    expect(c.userFixtureReason({ email: 'RECETTE-ADMIN@example.invalid' }, a)).toBeNull();
    expect(c.ALLOWLIST_EMAILS).toEqual(['admin@komerce.km', 'transitaire@komerce.km']);
  });

  test('relais et partenaires de test', () => {
    expect(c.relaisFixtureReason({ name: 'RCT1-REL-KM', address: 'x' })).toBe('name_prefix');
    expect(c.relaisFixtureReason({ name: 'A8-RECETTE-20261017-RELAIS', address: 'x' })).toBe('name_prefix');
    expect(c.relaisFixtureReason({ name: 'E2E-CASH Relais ab', address: 'x' })).toBe('name_prefix');
    expect(c.relaisFixtureReason({ name: 'Relais', address: 'Adresse recette' })).toBe('address_marker');
    expect(c.relaisFixtureReason({ name: 'Relais Komerce Yaoundé Centre', address: 'Yaoundé Centre, Cameroun' })).toBeNull();
    expect(c.partnerFixtureReason({ name: 'E2E Partner' })).toBe('name_prefix');
    expect(c.partnerFixtureReason({ name: 'Atelier', email: 'a@e2e.invalid' })).toBe('email_pattern');
    expect(c.partnerFixtureReason({ name: 'Atelier reel', email: 'a@atelier.km' })).toBeNull();
  });
});

describe('staging reset fixtures : graphe de suppression (pur)', () => {
  const e = (child, parent, cols, deltype, parentCols = ['id']) => ({ child, parent, cols, deltype, parent_cols: parentCols });

  test('proprietaire -> suppression, acteur NO ACTION -> garde, SET NULL -> null, purge -> ignore, enfant dependant -> suppression', () => {
    const edges = [
      e('webauthn_credentials', 'users', ['user_id'], 'c'),
      e('assignment_memberships', 'users', ['user_id'], 'a'),
      e('assignment_memberships', 'users', ['granted_by'], 'a'),
      e('membership_capabilities', 'assignment_memberships', ['membership_id'], 'c'),
      e('market_operating_assignments', 'users', ['granted_by'], 'a'),
      e('cost_components', 'users', ['created_by'], 'n'),
      e('orders', 'users', ['user_id'], 'a'),
      e('users', 'relais', ['relais_id'], 'a'),
    ];
    const g = fixtures.buildDeleteGraph(edges, new Set(['orders']));
    const act = (child, col) => g.classified.find((x) => x.child === child && x.cols[0] === col).action;
    expect(act('webauthn_credentials', 'user_id')).toBe('delete');
    expect(act('assignment_memberships', 'user_id')).toBe('delete');
    expect(act('assignment_memberships', 'granted_by')).toBe('guard');
    expect(act('membership_capabilities', 'membership_id')).toBe('delete');
    expect(act('market_operating_assignments', 'granted_by')).toBe('guard');
    expect(act('cost_components', 'created_by')).toBe('null');
    expect(act('orders', 'user_id')).toBe('ignore');
    expect(act('users', 'relais_id')).toBe('guard');
    expect([...g.predicates.keys()]).toEqual(['assignment_memberships', 'membership_capabilities', 'partners', 'relais', 'users', 'webauthn_credentials']);
    expect([...g.predicates.get('membership_capabilities')][0]).toContain('FROM "assignment_memberships"');
  });

  test('ordre de suppression : enfants avant parents, cycle refuse', () => {
    const edges = [e('users', 'relais', ['relais_id'], 'a'), e('membership_capabilities', 'assignment_memberships', ['membership_id'], 'c'),
      e('assignment_memberships', 'users', ['user_id'], 'a')];
    const order = fixtures.deleteOrder(['relais', 'users', 'assignment_memberships', 'membership_capabilities'], edges);
    expect(order.indexOf('membership_capabilities')).toBeLessThan(order.indexOf('assignment_memberships'));
    expect(order.indexOf('assignment_memberships')).toBeLessThan(order.indexOf('users'));
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('relais'));
    expect(() => fixtures.deleteOrder(['a', 'b'], [e('a', 'b', ['x'], 'a'), e('b', 'a', ['y'], 'a')])).toThrow(/FIXTURE_DELETE_CYCLE/);
  });

  test('masquage des e-mails dans les rapports', () => {
    expect(fixtures.maskEmail('amina.said@gmail.com')).toBe('am***@gmail.com');
    expect(fixtures.maskEmail(null)).toBeNull();
  });
});
