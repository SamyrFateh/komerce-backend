'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-MA-05 — Pilotage pays : quatre dashboards canoniques
 *
 * Feature propriétaire : market-delegation
 * Feature traversée    : dashboard
 *
 * Prouve sur routes réelles + PostgreSQL réel :
 * - une membership projetée peut ouvrir le contexte dashboard sans users.role;
 * - manager et viewer lisent Pilotage / Commerce / Opérations / Finance de A;
 * - A ne peut jamais lire B ;
 * - market_id navigateur n'est jamais une autorité.
 */

const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const {
  createMarketDelegationFixture,
  makeApp,
} = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(30000);

describeE2E('E2E-MA-05 — market-delegation · dashboards pays', ({ db }) => {
  let fx;
  let app;

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    app = makeApp([
      { mount: '/api/admin/dashboard', modulePath: '../../routes/admin-dashboard-market' },
    ]);
  });

  afterAll(async () => {
    if (fx) await fx.cleanup.run();
  });

  it('1 — la délégation projetée ouvre le contexte dashboard sans rôle global market_operator', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard/context')
      .set('Authorization', fx.managerA.token);

    expect(res.status).toBe(200);
    expect(fx.managerA.role).toBe('client');
  });

  it('2 — manager et viewer lisent les quatre vues canoniques de leur marché', async () => {
    const routes = [
      'unified',
      'commerce',
      'operations',
      'finance',
    ];

    for (const actor of [fx.managerA, fx.viewerA]) {
      for (const surface of routes) {
        const res = await request(app)
          .get(`/api/admin/dashboard/${surface}/market/${fx.marketA.code}`)
          .set('Authorization', actor.token);
        expect(res.status).toBe(200);
      }
    }
  });

  it('3 — le manager A obtient 403 sur le Market ID B', async () => {
    for (const surface of ['unified', 'commerce', 'operations', 'finance']) {
      const res = await request(app)
        .get(`/api/admin/dashboard/${surface}/market/${fx.marketB.code}`)
        .set('Authorization', fx.managerA.token);
      expect(res.status).toBe(403);
    }
  });

  it('4 — market_id en query est rejeté avant lecture métier', async () => {
    const res = await request(app)
      .get(`/api/admin/dashboard/unified/market/${fx.marketA.code}?market_id=${fx.marketB.id}`)
      .set('Authorization', fx.managerA.token);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('client_market_id_forbidden');
  });
});