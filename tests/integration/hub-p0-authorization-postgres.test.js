'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-p0-authorization-postgres.test.js
 * @brief HUB P0 (#3247) — frontière d'autorisation HTTP réelle : agent_hub constitue les PO et lit le dossier ; market_operator sans délégation ne lit pas un marché et n'écrit aucune PO.
 */

process.env.KOMERCE_GROUPED_PURCHASING = '1';

jest.setTimeout(60000);

if (!process.env.DATABASE_URL) {
  describe.skip('hub-p0-authorization (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  let app; let admin; let agentHub; let operator;
  const bearer = (u) => ['Authorization', `Bearer ${u.token}`];
  const nil = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';
    jest.spyOn(require('../../bootstrap/crons'), 'startOperationalCrons').mockImplementation(() => {});
    app = require('../../server');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    admin = await createUser({ role: 'admin' });
    agentHub = await createUser({ role: 'agent_hub' });
    operator = await createUser({ role: 'market_operator' });
  });

  afterAll(async () => { await cleanup(); });

  test('agent_hub lit le dossier du marché KM', async () => {
    const res = await request(app).get('/api/hub/dossier?market=KM').set(...bearer(agentHub));
    expect(res.status).toBe(200);
    expect(res.body.market.code).toBe('KM');
    expect(res.body.kpis).toBeDefined();
  });

  test('marché inconnu ou absent : 404 / 400', async () => {
    expect((await request(app).get('/api/hub/dossier?market=ZZ').set(...bearer(admin))).status).toBe(404);
    expect((await request(app).get('/api/hub/dossier').set(...bearer(admin))).status).toBe(400);
  });

  test('market_operator sans délégation sur KM : 403', async () => {
    const res = await request(app).get('/api/hub/dossier?market=KM').set(...bearer(operator));
    expect(res.status).toBe(403);
  });

  test('trace : clé obligatoire et UUID valide', async () => {
    expect((await request(app).get('/api/hub/trace').set(...bearer(agentHub))).status).toBe(400);
    expect((await request(app).get('/api/hub/trace?po_id=pas-un-uuid').set(...bearer(agentHub))).status).toBe(400);
    const res = await request(app).get(`/api/hub/trace?po_id=${nil}`).set(...bearer(agentHub));
    expect(res.status).toBe(200);
    expect(res.body.chain).toEqual([]);
  });

  test('agent_hub passe la garde de préparation de PO ; market_operator reçoit 403', async () => {
    const ok = await request(app).post('/api/purchasing/po/prepare').set(...bearer(agentHub)).send({});
    expect(ok.status).not.toBe(403);
    expect(ok.status).not.toBe(401);
    const denied = await request(app).post('/api/purchasing/po/prepare').set(...bearer(operator)).send({});
    expect(denied.status).toBe(403);
    const sentDenied = await request(app).post(`/api/purchasing/po/${nil}/sent`).set(...bearer(operator)).send({ channel: 'email' });
    expect(sentDenied.status).toBe(403);
  });

  test('rattachement carton → expédition : réservé aux rôles Hub', async () => {
    const denied = await request(app).post(`/api/hub/box/${nil}/shipment`).set(...bearer(operator)).send({ shipment_reference: 'X' });
    expect(denied.status).toBe(403);
    const res = await request(app).post(`/api/hub/box/${nil}/shipment`).set(...bearer(agentHub)).send({ shipment_reference: 'INEXISTANT' });
    expect(res.status).toBe(404);
  });
}
