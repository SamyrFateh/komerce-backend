'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('dashboard-global-authority-isolation (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db;
  let requireDashboardGlobalAuthority;
  const PFX = 'itest-dash-global+';
  const CI_PLACEHOLDER_HASH = '$2a$04$AYmAyvzy6sAbPHhY01nPau5qvXBxnD/DFrgbpUzd5QXDR3VgjkISm';
  let adminCentral, adminCountry, adminNoScope, marketCM;

  beforeAll(async () => {
    db = require('../../db');
    ({ requireDashboardGlobalAuthority } = require('../../middleware/require-dashboard-global-authority'));

    const market = await db.query(
      `SELECT id FROM markets WHERE code = 'CM' LIMIT 1`
    );
    if (!market.rows.length) throw new Error('CM market missing — migrations not applied');
    marketCM = market.rows[0].id;

    const email = label => `${PFX}${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@test.local`;
    const phone = () => `+2693${Math.floor(1000000 + Math.random() * 8999999)}`;

    async function createAdmin(label) {
      const r = await db.query(
        `INSERT INTO users (email, full_name, phone, role, password_hash)
         VALUES ($1, $2, $3, 'admin', $4)
         RETURNING id`,
        [email(label), `ITest ${label}`, phone(), CI_PLACEHOLDER_HASH]
      );
      return r.rows[0].id;
    }

    adminCentral = await createAdmin('central');
    adminCountry = await createAdmin('country');
    adminNoScope = await createAdmin('noscope');

    await db.query(
      `INSERT INTO operator_market_scopes (user_id, market_id, role)
       VALUES ($1, $2, 'manager')`,
      [adminCountry, marketCM]
    );
  });

  afterAll(async () => {
    const ids = [adminCentral, adminCountry, adminNoScope].filter(Boolean);
    if (ids.length) {
      await db.query(`DELETE FROM dashboard_global_access_grants WHERE user_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM operator_market_scopes WHERE user_id = ANY($1)`, [ids]);
      await db.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
    }
  });

  function reqRes(userId) {
    const req = { user: { id: userId, role: 'admin' } };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const next = jest.fn();
    return { req, res, next };
  }

  test('admin pays avec scope CM mais sans grant global => 403', async () => {
    const { req, res, next } = reqRes(adminCountry);
    await requireDashboardGlobalAuthority(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
    expect(next).not.toHaveBeenCalled();
  });

  test('admin sans aucun scope ET sans grant global => 403 — absence de scope != global', async () => {
    const { req, res, next } = reqRes(adminNoScope);
    await requireDashboardGlobalAuthority(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
    expect(next).not.toHaveBeenCalled();
  });

  test('grant global explicite => autorisé', async () => {
    const grant = await db.query(
      `INSERT INTO dashboard_global_access_grants (user_id, reason)
       VALUES ($1, 'integration-test')
       RETURNING id`,
      [adminCentral]
    );

    const { req, res, next } = reqRes(adminCentral);
    await requireDashboardGlobalAuthority(req, res, next);
    expect(res.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);

    await db.query(
      `UPDATE dashboard_global_access_grants SET revoked_at = now() WHERE id = $1`,
      [grant.rows[0].id]
    );
  });

  test('grant révoqué => 403, historique conservé', async () => {
    const { req, res, next } = reqRes(adminCentral);
    await requireDashboardGlobalAuthority(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();

    const { rows } = await db.query(
      `SELECT revoked_at FROM dashboard_global_access_grants WHERE user_id = $1`,
      [adminCentral]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).not.toBeNull();
  });
}
