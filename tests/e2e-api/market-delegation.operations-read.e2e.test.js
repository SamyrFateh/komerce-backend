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
} = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(30000);

describeE2E('E2E-MA-07 — market-delegation · opérations lecture', ({ db }) => {
  let fx;
  let app;

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
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
});