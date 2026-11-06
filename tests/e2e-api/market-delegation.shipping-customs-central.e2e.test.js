'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * Hub central, workspace Expeditions & Douane : agent_hub et agent_transitaire executent le transit sur tout marche ACTIF
 * sans membership ; aucun droit douane/couts ; marche non ACTIF, market_operator et agent_relais inchanges.
 */

const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const { createMarketDelegationFixture, makeApp, bearer, uuid } = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(30000);

describeE2E('E2E — shipping-customs · Hub central', ({ db }) => {
  let fx; let app;
  const P = '/api/admin/workspaces/shipping-customs/market';

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    fx.cleanup.trackSql('DELETE FROM market_delegation_audit WHERE market_id IN ($1,$2)', [fx.marketA.id, fx.marketB.id]);
    app = makeApp([{ mount: '/api/admin/workspaces/shipping-customs', modulePath: '../../routes/admin-shipping-customs-workspace' }]);
  });
  afterAll(async () => { if (fx) await fx.cleanup.run(); });

  async function mkUser(role) {
    const id = uuid();
    await db.query('INSERT INTO users (id, full_name, email, phone, role) VALUES ($1,$2,$3,$4,$5)',
      [id, `E2E ${role}`, `e2e-${role}-${id.slice(0, 8)}@komerce.test`, `+2693${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, role]);
    fx.cleanup.track('users', 'id', id);
    fx.cleanup.trackSql('DELETE FROM market_delegation_audit WHERE actor_user_id = $1', [id]);
    return bearer(id, role);
  }
  const transition = (code, token, to) => request(app).post(`${P}/${code}/international/INT-NOPE/transition`).set('Authorization', token).send({ to_stage: to, proof_ref: 'P' });

  it('agent_hub et agent_transitaire sans membership : lecture OK et gestes de transit non refuses (expedition inconnue = 404/409, jamais 403)', async () => {
    for (const role of ['agent_hub', 'agent_transitaire']) {
      const tok = await mkUser(role);
      for (const code of [fx.marketA.code, fx.marketB.code]) {
        expect((await request(app).get(`${P}/${code}`).set('Authorization', tok)).status).toBe(200);
      }
    }
    const hub = await mkUser('agent_hub');
    const trans = await mkUser('agent_transitaire');
    expect((await transition(fx.marketA.code, hub, 'handed_over')).status).not.toBe(403);
    expect((await transition(fx.marketA.code, trans, 'forwarder_received')).status).not.toBe(403);
    // un acteur n'execute que les etapes de son role (machine a etats)
    expect((await transition(fx.marketA.code, hub, 'in_transit')).status).toBe(403);
  });

  it('aucun droit douane/couts ajoute ; market_operator et agent_relais refuses', async () => {
    for (const role of ['agent_hub', 'agent_transitaire']) {
      const tok = await mkUser(role);
      for (const tail of ['/international/INT-NOPE/costs', '/international/INT-NOPE/freight', '/customs/shipments']) {
        expect((await request(app).post(`${P}/${fx.marketA.code}${tail}`).set('Authorization', tok).send({})).status).toBe(403);
      }
    }
    for (const role of ['market_operator', 'agent_relais']) {
      expect((await request(app).get(`${P}/${fx.marketA.code}`).set('Authorization', await mkUser(role))).status).toBe(403);
    }
  });

  it('marche suspendu : retour a la preuve de membership', async () => {
    await db.query("UPDATE markets SET lifecycle_status='SUSPENDED' WHERE id=$1", [fx.marketB.id]);
    try {
      for (const role of ['agent_hub', 'agent_transitaire']) {
        expect((await request(app).get(`${P}/${fx.marketB.code}`).set('Authorization', await mkUser(role))).status).toBe(403);
      }
    } finally { await db.query("UPDATE markets SET lifecycle_status='ACTIVE' WHERE id=$1", [fx.marketB.id]); }
  });
});
