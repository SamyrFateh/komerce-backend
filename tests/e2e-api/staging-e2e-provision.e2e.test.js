'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * Provisionnement E2E staging : writers canoniques réels sur PostgreSQL. Tout se déroule dans UNE transaction
 * externe annulée en fin de test (le COMMIT du script est neutralisé) : aucune donnée ne subsiste.
 */
const bcrypt = require('bcryptjs');
const { describeE2E, tag, uuid } = require('../helpers/e2eDbKit');
const { ACK_VALUE, PROFILES, run } = require('../../scripts/recette/staging-e2e-provision');

jest.setTimeout(120000);

describeE2E('Provisionnement identités E2E — writers canoniques', ({ db }) => {
  let client; let proxyDb; let env; let adminEmail;
  const pw = (k) => `Zz9-${k}-${tag('p')}`;

  beforeAll(async () => {
    client = await db.getClient();
    await client.query('BEGIN');
    // Les 5 marchés actifs (état du staging après reset).
    await client.query("UPDATE markets SET is_active = true, lifecycle_status = 'ACTIVE' WHERE code IN ('KM','CM','CG','DJ','YT')");
    adminEmail = `${tag('adm')}@komerce.test`.toLowerCase();
    await client.query("INSERT INTO users (id, full_name, email, phone, role) VALUES ($1,'E2E admin',$2,$3,'admin')", [uuid(), adminEmail, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    const u = new URL(process.env.DATABASE_URL);
    env = {
      KOMERCE_ENV: 'staging', NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, STAGING_BASE_URL: 'https://staging.example',
      EXPECTED_RAILWAY_ENVIRONMENT: 'staging', KOMERCE_STAGING_RESET_DB_PIN: `${u.hostname}:${u.port || '5432'}${u.pathname}`,
      KOMERCE_STAGING_E2E_PROVISION_ACK: ACK_VALUE,
    };
    for (const p of PROFILES) {
      env[`E2E_${p.prefix}_EMAIL`] = p.key === 'admin' ? adminEmail : `${tag(p.key)}@komerce.test`.toLowerCase();
      env[`E2E_${p.prefix}_PASSWORD`] = pw(p.key);
    }
    // COMMIT/ROLLBACK du script neutralisés : la transaction externe reste ouverte jusqu'à afterAll.
    const wrapped = { query: (sql, ...a) => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? Promise.resolve({ rows: [] }) : client.query(sql, ...a)), release() {} };
    proxyDb = { getClient: async () => wrapped };
  });
  afterAll(async () => {
    if (client) { await client.query('ROLLBACK'); client.release(); }
  });

  const guard = async () => ({ confirmed: true });
  const q = (sql, params) => client.query(sql, params).then((r) => r.rows);

  it('execute : comptes, droits, relais ; second passage sans doublon', async () => {
    const first = await run({ db: proxyDb, mode: 'execute', env, guard });
    expect(first.profiles.map((p) => p.profile)).toEqual(PROFILES.map((p) => p.key));
    const emails = PROFILES.map((p) => env[`E2E_${p.prefix}_EMAIL`]);
    const users = await q('SELECT id, email, role::text AS role, password_hash, relais_id, account_activation_required FROM users WHERE email = ANY($1)', [emails]);
    expect(users).toHaveLength(PROFILES.length);
    const byEmail = (p) => users.find((u) => u.email === env[`E2E_${p}_EMAIL`]);
    for (const p of PROFILES.filter((x) => x.key !== 'admin')) {
      const u = byEmail(p.prefix);
      expect(u.role).toBe(p.role);
      expect(u.account_activation_required).toBeFalsy();
      expect(await bcrypt.compare(env[`E2E_${p.prefix}_PASSWORD`], u.password_hash)).toBe(true);
    }
    // Un relais actif par marché ; l'agent relais est rattaché à celui de KM.
    const relais = await q("SELECT r.id, m.code, r.is_active FROM relais r JOIN markets m ON m.id = r.market_id WHERE r.name LIKE 'E2E Relais %'");
    expect(relais.map((r) => r.code).sort()).toEqual(['CG', 'CM', 'DJ', 'KM', 'YT']);
    expect(relais.every((r) => r.is_active)).toBe(true);
    expect(byEmail('AGENT_RELAIS').relais_id).toBe(relais.find((r) => r.code === 'KM').id);
    // Délégation réelle sur KM (market_operator, finance, transitaire) : membership ACTIVE + capacités.
    for (const p of ['MARKET_OPERATOR', 'FINANCE', 'AGENT_TRANSITAIRE']) {
      const caps = await q(`SELECT mc.capability FROM assignment_memberships am JOIN market_operating_assignments a ON a.id = am.assignment_id
        JOIN markets m ON m.id = a.market_id JOIN membership_capabilities mc ON mc.membership_id = am.id AND mc.revoked_at IS NULL
        WHERE am.user_id = $1 AND am.status = 'ACTIVE' AND a.status = 'ACTIVE' AND m.code = 'KM'`, [byEmail(p).id]);
      expect(caps.map((c) => c.capability)).toEqual(expect.arrayContaining(['dashboard.market.read', 'operations.read']));
    }
    const mo = await q(`SELECT mc.capability FROM assignment_memberships am JOIN membership_capabilities mc ON mc.membership_id = am.id AND mc.revoked_at IS NULL WHERE am.user_id = $1`, [byEmail('MARKET_OPERATOR').id]);
    expect(mo.length).toBeGreaterThan(8);
    // Sourcing : autorité globale explicite, et AUCUNE délégation marché.
    expect(await q('SELECT 1 FROM sourcing_global_access_grants WHERE user_id = $1 AND revoked_at IS NULL', [byEmail('SOURCING').id])).toHaveLength(1);
    expect(await q('SELECT 1 FROM assignment_memberships WHERE user_id = $1', [byEmail('SOURCING').id])).toHaveLength(0);
    // Responsable Hub : les deux autorisations distinctes ; l'agent Hub simple n'en a aucune.
    const grants = await q('SELECT authorization_type FROM hub_authorization_grants WHERE user_id = $1 AND revoked_at IS NULL ORDER BY 1', [byEmail('HUB_DIRECTOR').id]);
    expect(grants.map((g) => g.authorization_type)).toEqual(['purchase_commitment', 'supplier_payment']);
    expect(await q('SELECT 1 FROM hub_authorization_grants WHERE user_id = $1', [byEmail('AGENT_HUB').id])).toHaveLength(0);
    // Aucune donnée métier.
    expect(await q("SELECT 1 FROM orders WHERE user_id = ANY($1)", [users.map((u) => u.id)])).toHaveLength(0);

    const count = async () => (await q('SELECT (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM relais)::int r, (SELECT count(*) FROM assignment_memberships)::int m, (SELECT count(*) FROM hub_authorization_grants)::int g'))[0];
    const before = await count();
    const hashes = (await q('SELECT id, password_hash FROM users WHERE email = ANY($1) ORDER BY id', [emails]));
    const second = await run({ db: proxyDb, mode: 'execute', env, guard });
    expect(await count()).toEqual(before);
    expect(await q('SELECT id, password_hash FROM users WHERE email = ANY($1) ORDER BY id', [emails])).toEqual(hashes);
    expect(second.profiles.filter((p) => p.profile !== 'admin').every((p) => p.user === 'existing' && p.password === 'unchanged')).toBe(true);
    expect(Object.values(second.relais).every((r) => r.status === 'unchanged')).toBe(true);
    expect(JSON.stringify(second)).not.toMatch(/Zz9-/);
  });
});
