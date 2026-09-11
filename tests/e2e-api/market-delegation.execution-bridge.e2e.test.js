'use strict';
/** @test-kind e2e @test-runner jest @test-requires postgres */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const { createMarketDelegationFixture, makeApp } = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(60000);
const ROOT = path.join(__dirname, '..', '..');
const EXEC = ["execution.order.mark_ordered","execution.distribution.run","execution.parcel.ship","execution.inventory.assign","execution.parcel.receive","execution.parcel.collect","execution.cash.confirm"];

describeE2E('E2E-MA-EXEC — délégation terrain explicite', ({ db }) => {
  let fx;
  let app;
  let terrainMembershipId;

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    app = makeApp([
      { mount: '/api/market-delegation', modulePath: '../../routes/market-delegation-team' },
      { mount: '/api/admin/workspaces/operations', modulePath: '../../routes/admin-operations-workspace' },
    ]);
  });

  afterAll(async () => {
    if (fx) {
      await db.query("DELETE FROM market_delegation_audit WHERE assignment_id IN ($1,$2)", [fx.assignmentA.id, fx.assignmentB.id]);
      await fx.cleanup.run();
    }
  });

  test('1 — migration 212 ouvre EXECUTION dans le ceiling sans auto-grant manager/viewer et reste idempotente', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', '212_market_delegation_execution_ceiling.sql'), 'utf8');
    await db.query(sql);
    const ceiling = await db.query(
      "SELECT capability FROM assignment_capability_ceiling WHERE assignment_id=$1 AND revoked_at IS NULL AND capability = ANY($2::text[]) ORDER BY capability",
      [fx.assignmentA.id, EXEC]
    );
    expect(ceiling.rows.map(row => row.capability)).toEqual([...EXEC].sort());
    for (const membershipId of [fx.managerAMembership.id, fx.viewerAMembership.id]) {
      const grants = await db.query(
        "SELECT capability FROM membership_capabilities WHERE membership_id=$1 AND revoked_at IS NULL AND capability = ANY($2::text[])",
        [membershipId, EXEC]
      );
      expect(grants.rows).toHaveLength(0);
    }
    const auditBefore = await db.query(
      "SELECT COUNT(*)::int AS n FROM market_delegation_audit WHERE assignment_id=$1 AND action='EXECUTION_CEILING_OPENED_BY_MIGRATION'",
      [fx.assignmentA.id]
    );
    expect(auditBefore.rows[0].n).toBe(EXEC.length);
    await db.query(sql);
    const auditAfter = await db.query(
      "SELECT COUNT(*)::int AS n FROM market_delegation_audit WHERE assignment_id=$1 AND action='EXECUTION_CEILING_OPENED_BY_MIGRATION'",
      [fx.assignmentA.id]
    );
    expect(auditAfter.rows[0].n).toBe(auditBefore.rows[0].n);
  });

  test('2 — le manager délègue execution.distribution.run à un membre terrain sans se l’auto-accorder', async () => {
    const res = await request(app)
      .post('/api/market-delegation/markets/' + fx.marketA.code + '/team/invitations')
      .set('Authorization', fx.managerA.token)
      .send({ email: fx.outsider.email, capabilities: ['execution.distribution.run'] });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('membership');
    expect(res.body.capabilities).toContain('execution.distribution.run');
    terrainMembershipId = res.body.membership.id;

    const managerGrant = await db.query(
      "SELECT 1 FROM membership_capabilities WHERE membership_id=$1 AND capability='execution.distribution.run' AND revoked_at IS NULL",
      [fx.managerAMembership.id]
    );
    expect(managerGrant.rows).toHaveLength(0);
  });

  test('3 — le membre terrain exécute son action sur A sans scope legacy et l’autorisation est auditée', async () => {
    const projected = await db.query(
      'SELECT 1 FROM operator_market_scopes WHERE projected_from_membership_id=$1 AND revoked_at IS NULL',
      [terrainMembershipId]
    );
    expect(projected.rows).toHaveLength(0);

    const res = await request(app)
      .post('/api/admin/workspaces/operations/market/' + fx.marketA.code + '/distribution/run')
      .set('Authorization', fx.outsider.token)
      .set('x-correlation-id', 'e2e-exec-distribution')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('run_distribution');

    const audit = await db.query(
      "SELECT actor_user_id, membership_id, capability, action, correlation_id FROM market_delegation_audit WHERE assignment_id=$1 AND actor_user_id=$2 AND capability='execution.distribution.run' AND action='EXECUTION_AUTHORIZED' AND correlation_id='e2e-exec-distribution'",
      [fx.assignmentA.id, fx.outsider.id]
    );
    expect(audit.rows).toHaveLength(1);
    expect(String(audit.rows[0].membership_id)).toBe(String(terrainMembershipId));
  });

  test('4 — le même membre est refusé sur B et le manager reste sans autorité terrain implicite', async () => {
    const cross = await request(app)
      .post('/api/admin/workspaces/operations/market/' + fx.marketB.code + '/distribution/run')
      .set('Authorization', fx.outsider.token)
      .send({});
    expect(cross.status).toBe(403);

    const manager = await request(app)
      .post('/api/admin/workspaces/operations/market/' + fx.marketA.code + '/distribution/run')
      .set('Authorization', fx.managerA.token)
      .send({});
    expect(manager.status).toBe(403);
  });

  test('5 — market_id navigateur reste refusé avant toute action terrain', async () => {
    const res = await request(app)
      .post('/api/admin/workspaces/operations/market/' + fx.marketA.code + '/distribution/run')
      .set('Authorization', fx.outsider.token)
      .send({ market_id: fx.marketB.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
  });
});
