'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-MA-01 — Autorité Market ID, équipe et réseau local
 *
 * Feature propriétaire : market-delegation
 * Features traversées  : auth-identity, market, logistics
 *
 * Prouve sur routes réelles + PostgreSQL réel :
 * - manager A : lecture équipe + mutations réseau autorisées ;
 * - viewer A : lectures autorisées, mutations refusées ;
 * - absence de membership sur B : refus avant toute fuite de ressource ;
 * - une ressource appartenant à B reste 404 quand elle est ciblée via A ;
 * - market_id envoyé par le navigateur n'est jamais une autorité ;
 * - suspension/réactivation préserve la ligne relais et laisse une trace audit.
 */

const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const {
  createMarketDelegationFixture,
  makeApp,
} = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(30000);

describeE2E('E2E-MA-01 — market-delegation · autorité, équipe, réseau', ({ db }) => {
  let fx;
  let app;
  const createdRelais = [];

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    app = makeApp([
      { modulePath: '../../routes/market-delegation-team' },
      { modulePath: '../../routes/market-delegation-network' },
    ]);
  });

  afterAll(async () => {
    for (const id of createdRelais) fx.cleanup.track('relais', 'id', id);
    if (fx) await fx.cleanup.run();
  });

  it('1 — manager et viewer voient uniquement leur équipe A', async () => {
    const manager = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketA.code}/team`)
      .set('Authorization', fx.managerA.token);
    expect(manager.status).toBe(200);
    expect(manager.body.market.code).toBe(fx.marketA.code);
    expect(manager.body.assignment_id).toBe(fx.assignmentA.id);
    expect(manager.body.actor_capabilities).toContain('team.read');

    const viewer = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketA.code}/team`)
      .set('Authorization', fx.viewerA.token);
    expect(viewer.status).toBe(200);
    expect(viewer.body.actor_capabilities).toContain('team.read');
    expect(viewer.body.actor_capabilities).not.toContain('team.invite');
  });

  it('2 — un viewer ne peut pas transformer sa lecture en mutation', async () => {
    const res = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/team/invitations`)
      .set('Authorization', fx.viewerA.token)
      .send({ email: fx.outsider.email, capabilities: ['network.read'] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  });

  it('3 — le manager peut intégrer un utilisateur existant avec une autorité bornée', async () => {
    const res = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/team/invitations`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-01-team')
      .send({ email: fx.outsider.email, capabilities: ['network.read'] });

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('membership');
    expect(res.body.capabilities).toEqual(['network.read']);

    const readable = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketA.code}/network/relais`)
      .set('Authorization', fx.outsider.token);
    expect(readable.status).toBe(200);

    const mutation = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/network/relais`)
      .set('Authorization', fx.outsider.token)
      .send({ name: 'Relais interdit', agent_name: 'Viewer', phone: '+269000001', address: 'Test' });
    expect(mutation.status).toBe(403);
    expect(mutation.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  });

  it('4 — market_id client est rejeté et aucune ligne n’est écrite', async () => {
    const before = await db.query('SELECT COUNT(*)::int AS n FROM relais WHERE market_id = $1', [fx.marketA.id]);

    const res = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/network/relais`)
      .set('Authorization', fx.managerA.token)
      .send({
        market_id: fx.marketB.id,
        name: 'Tentative cross-market',
        agent_name: 'E2E',
        phone: '+269000002',
        address: 'Test',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MARKET_ID_FORBIDDEN');
    const after = await db.query('SELECT COUNT(*)::int AS n FROM relais WHERE market_id = $1', [fx.marketA.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('5 — chaque manager crée dans son marché et A ne peut cibler la ressource de B', async () => {
    const createA = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/network/relais`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-01-relais-a')
      .send({ name: 'Relais A', agent_name: 'Agent A', phone: '+269000003', address: 'Zone A' });
    expect(createA.status).toBe(201);
    createdRelais.push(createA.body.relais.id);

    const createB = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketB.code}/network/relais`)
      .set('Authorization', fx.managerB.token)
      .send({ name: 'Relais B', agent_name: 'Agent B', phone: '+269000004', address: 'Zone B' });
    expect(createB.status).toBe(201);
    createdRelais.push(createB.body.relais.id);

    const stored = await db.query('SELECT id, market_id FROM relais WHERE id = ANY($1::uuid[]) ORDER BY id', [createdRelais]);
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.find((row) => row.id === createA.body.relais.id).market_id).toBe(fx.marketA.id);
    expect(stored.rows.find((row) => row.id === createB.body.relais.id).market_id).toBe(fx.marketB.id);

    const hidden = await request(app)
      .put(`/api/market-delegation/markets/${fx.marketA.code}/network/relais/${createB.body.relais.id}`)
      .set('Authorization', fx.managerA.token)
      .send({ name: 'Je ne dois jamais voir B' });
    expect(hidden.status).toBe(404);

    const noMembership = await request(app)
      .get(`/api/market-delegation/markets/${fx.marketB.code}/network/relais`)
      .set('Authorization', fx.managerA.token);
    expect(noMembership.status).toBe(403);
    expect(noMembership.body.code).toBe('MARKET_MEMBERSHIP_REQUIRED');
  });

  it('6 — suspendre/réactiver ne supprime jamais le relais et l’action est auditée', async () => {
    const relayId = createdRelais[0];

    const suspended = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/network/relais/${relayId}/suspend`)
      .set('Authorization', fx.managerA.token)
      .set('x-correlation-id', 'e2e-ma-01-suspend')
      .send({});
    expect(suspended.status).toBe(200);

    const rowAfterSuspend = await db.query('SELECT id, is_active FROM relais WHERE id=$1', [relayId]);
    expect(rowAfterSuspend.rows).toHaveLength(1);
    expect(rowAfterSuspend.rows[0].is_active).toBe(false);

    const activated = await request(app)
      .post(`/api/market-delegation/markets/${fx.marketA.code}/network/relais/${relayId}/activate`)
      .set('Authorization', fx.managerA.token)
      .send({});
    expect(activated.status).toBe(200);

    const rowAfterActivate = await db.query('SELECT id, is_active FROM relais WHERE id=$1', [relayId]);
    expect(rowAfterActivate.rows).toHaveLength(1);
    expect(rowAfterActivate.rows[0].is_active).toBe(true);

    const audit = await db.query(
      `SELECT action, capability, correlation_id
         FROM market_delegation_audit
        WHERE assignment_id=$1 AND actor_user_id=$2
        ORDER BY occurred_at`,
      [fx.assignmentA.id, fx.managerA.id]
    );
    expect(audit.rows.some((row) => row.capability === 'network.suspend')).toBe(true);
    expect(audit.rows.some((row) => row.correlation_id === 'e2e-ma-01-suspend')).toBe(true);
  });
});
