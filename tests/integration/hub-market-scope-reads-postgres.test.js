'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-market-scope-reads-postgres.test.js
 * @brief Lectures Hub scopées par marché (stats/week, pending) pour un profil délégué (responsable pays, finance) : jamais de 500 SQL ; sans délégation, 403 propre.
 */

jest.setTimeout(60000);

if (!process.env.DATABASE_URL) {
  describe.skip('hub-market-scope-reads (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const request = require('supertest');
  const db = require('../../db');
  const kit = require('../helpers/marketDelegationE2EKit');
  const { invalidateUserCache } = require('../../middleware/auth');

  let fx; let app;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';
    fx = await kit.createMarketDelegationFixture(db);
    app = kit.makeApp([{ mount: '/api/hub', modulePath: '../../routes/hub' }]);
  });
  afterAll(async () => { if (fx) await fx.cleanup.run(); });

  for (const role of ['client', 'finance']) {
    for (const path of ['/api/hub/stats/week', '/api/hub/pending']) {
      test(`${path} : profil délégué (users.role=${role}) lit son marché sans 500`, async () => {
        await db.query('UPDATE users SET role = $2::user_role WHERE id = $1', [fx.managerA.id, role]);
        invalidateUserCache(fx.managerA.id);
        const res = await request(app).get(path).set('Authorization', kit.bearer(fx.managerA.id, role));
        expect(res.status).toBe(200);
      });
    }
  }

  test('finance sans délégation : 403 propre', async () => {
    await db.query('UPDATE users SET role = $2::user_role WHERE id = $1', [fx.outsider.id, 'finance']);
    invalidateUserCache(fx.outsider.id);
    const res = await request(app).get('/api/hub/stats/week').set('Authorization', kit.bearer(fx.outsider.id, 'finance'));
    expect(res.status).toBe(403);
  });
}
