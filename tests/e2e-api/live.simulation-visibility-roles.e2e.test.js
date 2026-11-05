'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * Hub Live / Relais Live — « Afficher la recette » (include_simulation).
 * Prouve sur vraie base, vraies routes, jetons par rôle : par défaut la recette est absente ;
 * admin + include_simulation=1 la voit (avec simulation_scope) ; agent_hub, agent_relais et
 * market_operator n'obtiennent jamais de recette (paramètre ignoré ou refus) ; les KPI restent réels.
 */
const request = require('supertest');
const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');
const { bearer, makeApp } = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(60000);

describeE2E('Live — visibilité de la recette par rôle', ({ db }) => {
  const marketId = uuid(); const relaisId = uuid();
  const ids = { admin: uuid(), agent_hub: uuid(), agent_relais: uuid(), market_operator: uuid(), client: uuid() };
  const REAL = `LV-REAL-${tag('r')}`.toUpperCase(); const SIM = `LV-SIM-${tag('s')}`.toUpperCase();
  const SCOPE = 'E2E-HUB-V1';
  let cleanup; let app;
  const rnd = () => `Q${Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')}`;
  const auth = (role) => ({ Authorization: bearer(ids[role], role) });
  const refs = (res, key) => (res.body[key] || []).map((o) => o.reference);

  async function kpiCounters() {
    const [hub, relay] = await Promise.all([
      request(app).get('/api/hub-dash/dashboard').set(auth('admin')),
      request(app).get('/api/relay/dashboard').set(auth('admin')),
    ]);
    return { hub: hub.body.orders, relay: relay.body.kpi };
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);
    cleanup.trackSql(`SET session_replication_role = replica;
      DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE market_id='${marketId}');
      DELETE FROM orders WHERE market_id='${marketId}';
      DELETE FROM relais WHERE id='${relaisId}';
      DELETE FROM markets WHERE id='${marketId}';
      DELETE FROM users WHERE id IN (${Object.values(ids).map((i) => `'${i}'`).join(',')});
      SET session_replication_role = origin;`);
    await db.query(`INSERT INTO markets (id,code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,'E2E LV','KMF',0,true,'ACTIVE')`, [marketId, rnd()]);
    await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,island,market_id) VALUES ($1,$2,'E2E','+269000559','E2E','Ngazidja',$3)`, [relaisId, `E2E LV ${tag('r')}`, marketId]);
    for (const role of ['admin', 'agent_hub', 'agent_relais', 'market_operator', 'client']) {
      await db.query(
        `INSERT INTO users (id,full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [ids[role], `E2E ${role}`, `${tag(role)}@komerce.test`.toLowerCase(), `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`, role, role === 'agent_relais' ? relaisId : null]);
    }
    for (const [ref, scope] of [[REAL, null], [SIM, SCOPE]]) {
      await db.query(
        `INSERT INTO orders (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,simulation_scope,created_at,available_at)
         VALUES ($1,$2,$3,$4,$5,'available','paid','cash_relais',1000,2,$6,NOW(),NOW())`,
        [uuid(), ids.client, relaisId, marketId, ref, scope]);
    }
    app = makeApp([
      { mount: '/api/hub-dash', modulePath: '../../routes/hub-dashboard' },
      { mount: '/api/relay', modulePath: '../../routes/relay-dashboard' },
    ]);
  });
  afterAll(async () => { if (cleanup) await cleanup.run(); });

  it('par défaut (admin) : la recette est absente de la liste Relais', async () => {
    const res = await request(app).get('/api/relay/orders?status=available&limit=100').set(auth('admin'));
    expect(res.status).toBe(200);
    expect(refs(res, 'orders')).toContain(REAL);
    expect(refs(res, 'orders')).not.toContain(SIM);
  });

  it('admin + include_simulation=1 : la recette apparaît avec son scope ; les KPI ne bougent pas', async () => {
    const before = await kpiCounters();
    const res = await request(app).get('/api/relay/orders?status=available&limit=100&include_simulation=1').set(auth('admin'));
    expect(res.status).toBe(200);
    expect(refs(res, 'orders')).toEqual(expect.arrayContaining([REAL, SIM]));
    expect(res.body.orders.find((o) => o.reference === SIM).simulation_scope).toBe(SCOPE);
    expect(res.body.orders.find((o) => o.reference === REAL).simulation_scope).toBeNull();
    expect(await kpiCounters()).toEqual(before);
  });

  it('agent_relais : include_simulation est ignoré (jamais de recette)', async () => {
    const res = await request(app).get('/api/relay/orders?status=available&limit=100&include_simulation=1').set(auth('agent_relais'));
    expect(res.status).toBe(200);
    expect(refs(res, 'orders')).toContain(REAL);
    expect(refs(res, 'orders')).not.toContain(SIM);
  });

  it('market_operator (sans délégation) : aucune recette, refus ou liste réelle', async () => {
    const res = await request(app).get('/api/relay/orders?status=available&limit=100&include_simulation=1').set(auth('market_operator'));
    expect([200, 403]).toContain(res.status);
    expect(refs(res, 'orders')).not.toContain(SIM);
  });

  it('Hub : admin voit la recette avec le flag, jamais sans ; agent_hub jamais', async () => {
    await db.query(`UPDATE orders SET status='confirmed' WHERE market_id=$1`, [marketId]);
    const q = (role, flag) => request(app).get(`/api/hub-dash/queue?tab=to_prepare&limit=100${flag ? '&include_simulation=1' : ''}`).set(auth(role));
    const none = await q('admin', false);
    expect(refs({ body: none.body }, 'data')).not.toContain(SIM);
    const before = await kpiCounters();
    const adm = await q('admin', true);
    expect(adm.status).toBe(200);
    expect(refs(adm, 'data')).toEqual(expect.arrayContaining([REAL, SIM]));
    expect(adm.body.data.find((o) => o.reference === SIM).simulation_scope).toBe(SCOPE);
    expect(await kpiCounters()).toEqual(before);
    const agent = await q('agent_hub', true);
    expect(agent.status).toBe(200);
    expect(refs(agent, 'data')).not.toContain(SIM);
    const mo = await q('market_operator', true);
    expect(refs(mo, 'data')).not.toContain(SIM);
  });
});
