'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('dashboard-admin-context-isolation (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db;
  let resolveDashboardAdminContext, provisioning;
  let delegationMembershipId = null;
  let createdAssignmentId = null;
  const PFX = 'itest-admin-context+';
  const CI_PLACEHOLDER_HASH = '$2a$04$AYmAyvzy6sAbPHhY01nPau5qvXBxnD/DFrgbpUzd5QXDR3VgjkISm';
  let adminCentral, adminCountry, adminNoScope, marketCM;

  beforeAll(async () => {
    db = require('../../db');
    ({ resolveDashboardAdminContext } = require('../../services/dashboard-admin-context'));
    provisioning = require('../../services/market-operator-provisioning');

    const market = await db.query(`SELECT id FROM markets WHERE code = 'CM' AND is_active = TRUE LIMIT 1`);
    if (!market.rows.length) throw new Error('CM market missing — migrations not applied');
    marketCM = market.rows[0].id;

    const email = label => `${PFX}${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@test.local`;
    const phone = () => `+2694${Math.floor(1000000 + Math.random() * 8999999)}`;

    async function createAdmin(label) {
      const r = await db.query(
        `INSERT INTO users (email, full_name, phone, role, password_hash)
         VALUES ($1, $2, $3, 'admin', $4)
         RETURNING id`,
        [email(label), `ITest AdminContext ${label}`, phone(), CI_PLACEHOLDER_HASH]
      );
      return r.rows[0].id;
    }

    adminCentral = await createAdmin('central');
    adminCountry = await createAdmin('country');
    adminNoScope = await createAdmin('noscope');

    await db.query(
      `INSERT INTO dashboard_global_access_grants (user_id, reason)
       VALUES ($1, 'integration-admin-context')`,
      [adminCentral]
    );
    const existingAssignment = await db.query(
      `SELECT id FROM market_operating_assignments WHERE market_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [marketCM]
    );
    const delegated = await provisioning.ensureOperatorMembership(db, {
      userId: adminCountry,
      marketId: marketCM,
      marketCode: 'CM',
      scope: 'manager',
      allowRoleChange: true,
    });
    delegationMembershipId = delegated.membershipId;
    if (!existingAssignment.rows.length) createdAssignmentId = delegated.assignmentId;
  });

  afterAll(async () => {
    const ids = [adminCentral, adminCountry, adminNoScope].filter(Boolean);
    if (ids.length) {
      await db.query(`DELETE FROM dashboard_global_access_grants WHERE user_id = ANY($1)`, [ids]);
      if (delegationMembershipId) {
        await db.query('DELETE FROM operator_market_scopes WHERE projected_from_membership_id = $1', [delegationMembershipId]);
        await db.query('DELETE FROM market_delegation_audit WHERE membership_id = $1', [delegationMembershipId]);
        await db.query('DELETE FROM membership_capabilities WHERE membership_id = $1', [delegationMembershipId]);
        await db.query('DELETE FROM assignment_memberships WHERE id = $1', [delegationMembershipId]);
      }
      if (createdAssignmentId) {
        await db.query('DELETE FROM assignment_capability_ceiling WHERE assignment_id = $1', [createdAssignmentId]);
        await db.query('DELETE FROM market_operating_assignments WHERE id = $1', [createdAssignmentId]);
      }
      await db.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
    }
  });

  test('central explicite => mode global et marchés actifs sans UUID', async () => {
    const context = await resolveDashboardAdminContext({ id: adminCentral, role: 'admin' });

    expect(context.access.mode).toBe('global');
    expect(context.access.defaultMarket).toBeNull();
    expect(context.access.allowedMarkets).toContain('CM');
    expect(context.access.capabilities).toContain('dashboard.global.read');
    expect(JSON.stringify(context)).not.toContain(marketCM);
    expect(JSON.stringify(context)).not.toContain('market_id');
  });

  test('opérateur CM => mode market enfermé dans CM', async () => {
    const context = await resolveDashboardAdminContext({ id: adminCountry, role: 'admin' });

    expect(context.access.mode).toBe('market');
    expect(context.access.allowedMarkets).toEqual(['CM']);
    expect(context.access.defaultMarket).toBe('CM');
    expect(context.access.capabilities).toEqual(['pilotage.read']);
    // B2 : un scope actif n'est plus fabricable sans membership. Le contexte
    // pays doit donc refléter la vraie délégation qui porte la projection.
    expect(context.access.delegatedCapabilities.CM).toContain('dashboard.market.read');
  });

  test('admin sans grant => aucun contexte — absence de scope != global', async () => {
    await expect(resolveDashboardAdminContext({ id: adminNoScope, role: 'admin' }))
      .rejects.toMatchObject({ code: 'dashboard_access_denied' });
  });
}
