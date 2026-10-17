'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const sc = require('../../scripts/audit-golden-staging-deep-clean');

const policy = sc.loadPolicy();
const NOW = Date.parse('2026-10-17T12:00:00Z');
const live = { system_identifier: '7001', database_name: 'railway', counts: { orders: 2, users: 3 }, plan_sha256: 'abc', retention_rows: 5, immutability_tables_sha256: 'imm' };
const manifest = () => ({
  identity: { system_identifier: '7001', database_name: 'railway', production_system_identifiers: ['9999'],
    railway: { project_id: 'p', environment: 'staging', service: 'Postgres', attested_by: 'op', attested_at: '2026-10-17T10:00:00Z' } },
  backup: { artifact: 'b.dump', sha256: 'a'.repeat(64), restore_target: 'scratch', restore_verified_at: '2026-10-17T09:00:00Z', table_counts: { orders: 2, users: 3 } },
  retention: { waiver_ref: 'W-1', export_sha256: 'b'.repeat(64), immutability_bypass_tables_sha256: 'imm' },
  admin: { admin_email: 'a@k.km', rebootstrap_ready: true, session_revocation: 'JWT_SECRET rotation' },
});
const flags = { planSha: 'abc', confirm: sc.CONFIRM_TOKEN };
const prereq = (over = {}) => sc.evaluatePrerequisites({ manifest: over.manifest === undefined ? manifest() : over.manifest, flags: over.flags || flags,
  env: over.env || { RAILWAY_ENVIRONMENT_NAME: 'staging' }, live: over.live || live, now: NOW });
const missing = (r) => r.filter((p) => p.status !== 'MET').map((p) => p.id);

describe('politique de classification', () => {
  it('chaque table du schéma live est classée, sans doublon ni entrée périmée', () => {
    const dump = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'db', 'railway-live-schema.sql'), 'utf8');
    const tables = [...new Set([...dump.matchAll(/^CREATE TABLE public\.([a-z0-9_]+) \(/gm)].map((m) => m[1]))];
    const r = sc.classifyTables(tables, policy);
    expect(r.unclassified).toEqual([]);
    expect(r.duplicates).toEqual([]);
    expect(r.stale).toEqual([]);
  });
  it('fondations jamais supprimées : mappings, taxonomie, règles, pays, habilitations, migrations', () => {
    ['supplier_commercial_category_mappings', 'boutique_categories', 'boutique_subcategories', 'business_rules', 'finance_config', 'markets',
      'capability_registry', 'ceiling_templates', 'schema_migrations', 'sourcing_sources', 'supplier_oauth_connections', 'relais', 'products']
      .forEach((t) => expect(policy.classes.preserve).toContain(t));
    expect([...policy.classes.delete_all, ...policy.classes.retention_financial]).not.toContain('business_rules_history');
  });
  it('une nouvelle table non classée est détectée', () => {
    expect(sc.classifyTables(['orders', 'brand_new_table'], policy).unclassified).toEqual(['brand_new_table']);
  });
});

describe('classification des comptes', () => {
  const users = [
    { id: 1, email: 'admin@komerce.km', role: 'admin' }, { id: 2, email: 'e2e_test_x@example.com', role: 'client' },
    { id: 3, email: 'real.agent@komerce.km', role: 'agent_hub' }, { id: 4, email: 'fatima@gmail.com', role: 'client' },
  ];
  it('admin conservé, motifs de test supprimés, inconnus bloquants', () => {
    const r = sc.classifyUsers(users, policy);
    expect(r.keep.map((u) => u.id)).toEqual([1]);
    expect(r.test.map((u) => u.id)).toEqual([2]);
    expect(r.unclassified.map((u) => u.id)).toEqual([3, 4]);
  });
  it('listes explicites de l’opérateur', () => {
    const r = sc.classifyUsers(users, policy, { keepEmails: ['real.agent@komerce.km'], testEmails: ['fatima@gmail.com'] });
    expect(r.keep.map((u) => u.id)).toEqual([1, 3]);
    expect(r.test.map((u) => u.id)).toEqual([2, 4]);
    expect(r.unclassified).toEqual([]);
  });
});

describe('ordre de suppression et TRUNCATE de liste', () => {
  it('enfants avant parents, auto-références ignorées, cycle signalé', () => {
    const edges = [{ child: 'order_items', parent: 'orders' }, { child: 'orders', parent: 'recipients' }, { child: 'orders', parent: 'orders' }];
    expect(sc.deletionOrder(['recipients', 'orders', 'order_items'], edges).order).toEqual(['order_items', 'orders', 'recipients']);
    expect(sc.deletionOrder(['a', 'b'], [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }]).cycle).toEqual(['a', 'b']);
  });
  it('fermeture : table gardée + tables supprimées qui la référencent ; jamais les tables conservées', () => {
    const edges = [{ child: 'order_items', parent: 'orders' }, { child: 'orders', parent: 'parcels' }, { child: 'products', parent: 'order_items' }];
    expect(sc.truncateSet(['parcels', 'orders', 'order_items', 'free'], ['parcels'], edges)).toEqual(['order_items', 'orders', 'parcels']);
    expect(sc.truncateSet(['free'], [], edges)).toEqual([]);
  });
});

describe('prérequis d’exécution', () => {
  it('tous satisfaits avec un manifest complet', () => expect(missing(prereq())).toEqual([]));
  it('sans manifest : identité, sauvegarde, rétention, admin manquants', () => {
    expect(missing(prereq({ manifest: null }))).toEqual(expect.arrayContaining(['IDENTITY_ATTESTED', 'IDENTITY_MATCHES_DB', 'BACKUP_RESTORABLE_VERIFIED', 'BACKUP_EQUALS_CURRENT_STATE', 'RETENTION_WAIVER_EXPORTED', 'IMMUTABILITY_BYPASS_ACKNOWLEDGED', 'ADMIN_REBOOTSTRAP_AND_SESSIONS']));
  });
  it('NODE_ENV, nom de base ou IP ne prouvent rien : seul le runtime Railway + manifest comptent', () => {
    expect(missing(prereq({ env: { NODE_ENV: 'staging' } }))).toContain('RUNTIME_RAILWAY_STAGING');
    const m = manifest(); m.identity.database_name = 'other';
    expect(missing(prereq({ manifest: m }))).toContain('IDENTITY_MATCHES_DB');
  });
  it('base déclarée production, sauvegarde périmée ou différente, plan dérivé, confirmation absente', () => {
    expect(missing(prereq({ live: { ...live, system_identifier: '9999' } }))).toEqual(expect.arrayContaining(['NOT_DECLARED_PRODUCTION', 'IDENTITY_MATCHES_DB']));
    const old = manifest(); old.backup.restore_verified_at = '2026-10-15T09:00:00Z';
    expect(missing(prereq({ manifest: old }))).toContain('BACKUP_RESTORABLE_VERIFIED');
    const drift = manifest(); drift.backup.table_counts.orders = 1;
    expect(missing(prereq({ manifest: drift }))).toContain('BACKUP_EQUALS_CURRENT_STATE');
    expect(missing(prereq({ flags: { planSha: 'zzz', confirm: sc.CONFIRM_TOKEN } }))).toContain('PLAN_REVIEWED');
    expect(missing(prereq({ flags: { planSha: 'abc' } }))).toContain('OPERATOR_CONFIRMATION');
  });
  it('rétention et immutabilité : renonciation exportée et empreinte exacte exigées', () => {
    const m = manifest(); delete m.retention.export_sha256; m.retention.immutability_bypass_tables_sha256 = 'other';
    expect(missing(prereq({ manifest: m }))).toEqual(expect.arrayContaining(['RETENTION_WAIVER_EXPORTED', 'IMMUTABILITY_BYPASS_ACKNOWLEDGED']));
  });
});

describe('garde-fous du script', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'audit-golden-staging-deep-clean.js'), 'utf8');
  it('lecture seule imposée hors --execute, jamais de CASCADE ni de session_replication_role dans le SQL', () => {
    expect(process.env.PGOPTIONS).toContain('default_transaction_read_only=on');
    const truncates = src.match(/`TRUNCATE[^`]*`/g) || [];
    expect(truncates.length).toBeGreaterThan(0);
    truncates.forEach((sql) => expect(sql).not.toMatch(/CASCADE|RESTART/i));
    expect(src).not.toMatch(/(?:SET|set_config)[^\n]*session_replication_role/);
    expect(src).not.toMatch(/DISABLE\s+TRIGGER/i);
  });
  it('execute() refuse sans toucher la base si blocage ou prérequis manquant', async () => {
    const db = { pool: { connect: jest.fn() } };
    await expect(sc.execute(db, { blockers: [{ code: 'X' }], execute_prerequisites: [] }, {}, policy)).rejects.toThrow('EXECUTION_REFUSED');
    await expect(sc.execute(db, { blockers: [], execute_prerequisites: [{ id: 'P', status: 'MISSING' }] }, {}, policy)).rejects.toThrow('EXECUTION_REFUSED');
    expect(db.pool.connect).not.toHaveBeenCalled();
  });
  it('le plan est déterministe', () => {
    const plan = { policy_sha256: 'p', steps: [{ table: 'a', rows: 1 }], preserved_counts: { b: 2 }, users_plan: { delete: 1 } };
    expect(sc.hashPlan(plan)).toBe(sc.hashPlan(JSON.parse(JSON.stringify(plan))));
    expect(sc.hashPlan({ ...plan, steps: [{ table: 'a', rows: 2 }] })).not.toBe(sc.hashPlan(plan));
  });
});
