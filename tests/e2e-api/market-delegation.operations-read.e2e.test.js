'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-MA-07 — Workspace Opérations : supervision pays sans autorité terrain implicite
 *
 * Feature propriétaire : market-delegation
 * Feature traversée    : operations
 *
 * Prouve :
 * - manager et viewer lisent les opérations de leur Market ID ;
 * - A ne lit jamais B et market_id navigateur est rejeté ;
 * - être manager pays ne transforme pas silencieusement l'utilisateur en agent_hub/agent_relais.
 *
 * Les actions terrain execution.* font l'objet d'un lane séparé : elles doivent
 * être explicitement déléguées, jamais héritées du simple statut de manager.
 */

const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const {
  createMarketDelegationFixture,
  makeApp,
  bearer,
  uuid,
} = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(30000);

describeE2E('E2E-MA-07 — market-delegation · opérations lecture', ({ db }) => {
  let fx;
  let app;

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    fx.cleanup.trackSql('DELETE FROM market_delegation_audit WHERE market_id IN ($1,$2)', [fx.marketA.id, fx.marketB.id]);
    app = makeApp([
      { mount: '/api/admin/workspaces/operations', modulePath: '../../routes/admin-operations-workspace' },
    ]);
  });

  afterAll(async () => {
    if (fx) await fx.cleanup.run();
  });

  it('1 — manager et viewer lisent le workspace Opérations de A', async () => {
    for (const actor of [fx.managerA, fx.viewerA]) {
      const res = await request(app)
        .get(`/api/admin/workspaces/operations/market/${fx.marketA.code}`)
        .set('Authorization', actor.token);
      expect(res.status).toBe(200);
    }
  });

  it('2 — le manager A ne peut lire le workspace de B', async () => {
    const res = await request(app)
      .get(`/api/admin/workspaces/operations/market/${fx.marketB.code}`)
      .set('Authorization', fx.managerA.token);
    expect(res.status).toBe(403);
  });

  it('3 — market_id navigateur est refusé avant le workspace', async () => {
    const res = await request(app)
      .get(`/api/admin/workspaces/operations/market/${fx.marketA.code}?market_id=${fx.marketB.id}`)
      .set('Authorization', fx.managerA.token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
  });

  it('4 — le manager pays n’hérite d’aucune action terrain par son rôle projeté', async () => {
    const hubAction = await request(app)
      .post(`/api/admin/workspaces/operations/market/${fx.marketA.code}/distribution/run`)
      .set('Authorization', fx.managerA.token)
      .send({});
    expect(hubAction.status).toBe(403);

    const relayAction = await request(app)
      .post(`/api/admin/workspaces/operations/market/${fx.marketA.code}/orders/DOES-NOT-MATTER/confirm-cash`)
      .set('Authorization', fx.managerA.token)
      .send({});
    expect(relayAction.status).toBe(403);
  });

  async function mkUser(role) {
    const id = uuid();
    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role) VALUES ($1,$2,$3,$4,$5)`,
      [id, `E2E ${role}`, `e2e-${role}-${id.slice(0, 8)}@komerce.test`, `+2693${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, role]
    );
    fx.cleanup.track('users', 'id', id);
    fx.cleanup.trackSql('DELETE FROM market_delegation_audit WHERE actor_user_id = $1', [id]);
    return bearer(id, role);
  }

  it('5 — Hub central : agent_hub sans aucune membership lit et agit sur tout marché ACTIVE ; finance et sourcing restent refusés', async () => {
    const hub = await mkUser('agent_hub');
    for (const code of [fx.marketA.code, fx.marketB.code]) {
      const read = await request(app).get(`/api/admin/workspaces/operations/market/${code}`).set('Authorization', hub);
      expect(read.status).toBe(200);
    }
    const action = await request(app)
      .post(`/api/admin/workspaces/operations/market/${fx.marketB.code}/distribution/run`)
      .set('Authorization', hub).send({});
    expect(action.status).not.toBe(403);
    for (const role of ['finance', 'sourcing']) {
      const denied = await request(app)
        .get(`/api/admin/workspaces/operations/market/${fx.marketA.code}`).set('Authorization', await mkUser(role));
      expect(denied.status).toBe(403);
    }
  });

  it('6 — le Hub central ne confère aucun droit au-delà du Hub : suspendu = retour à la preuve de membership ; relais inchangé', async () => {
    await db.query("UPDATE markets SET lifecycle_status='SUSPENDED' WHERE id=$1", [fx.marketB.id]);
    try {
      const hub = await mkUser('agent_hub');
      const res = await request(app).post(`/api/admin/workspaces/operations/market/${fx.marketB.code}/distribution/run`).set('Authorization', hub).send({});
      expect(res.status).toBe(403);
      const relay = await request(app).post(`/api/admin/workspaces/operations/market/${fx.marketA.code}/orders/X/confirm-cash`).set('Authorization', await mkUser('agent_relais')).send({});
      expect(relay.status).toBe(403);
    } finally {
      await db.query("UPDATE markets SET lifecycle_status='ACTIVE' WHERE id=$1", [fx.marketB.id]);
    }
  });
});
