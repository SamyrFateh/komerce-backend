'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * L2 : la recette (orders.simulation_scope) est isolée des vues réelles Clients / Client 360 / signaux colis,
 * par provenance de commande ; la vue recette est l'inverse. PostgreSQL réel.
 */
const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('L2 — isolation de la recette par provenance', ({ db }) => {
  const clientIndex = require('../../services/client-index');
  const client360 = require('../../services/client-360');
  const { EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL } = require('../../services/signal-simulation-scope');
  const marketId = uuid(); const relaisId = uuid();
  const simUser = uuid(); const mixUser = uuid(); const realUser = uuid();
  const phones = {};
  const simParcel = uuid(); const realParcel = uuid(); const orphanParcel = uuid();
  let cleanup;
  const rnd = () => `Q${Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')}`;
  const phone = () => `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`;

  async function order(userId, total, scope = null) {
    const id = uuid();
    await db.query(
      `INSERT INTO orders (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,simulation_scope,created_at)
       VALUES ($1,$2,$3,$4,$5,'in_transit','paid','cash_relais',$6,2,$7,NOW())`,
      [id, userId, relaisId, marketId, `L2-${id.slice(0, 8)}`.toUpperCase(), total, scope]);
    return id;
  }
  async function parcel(id, orderId) {
    await db.query(`INSERT INTO parcels (id, reference, order_id, status) VALUES ($1,$2,$3,'draft')`, [id, `PCL-${id.slice(0, 8)}`, orderId]);
  }
  const list = (opts = {}) => clientIndex.listClients({ page_size: 50 }, { marketIds: [marketId], ...opts });
  const byPhone = (r, p) => r.clients.find(c => c.phone === p.replace(/[^0-9+]/g, ''));

  beforeAll(async () => {
    cleanup = createCleanup(db);
    cleanup.trackSql(`SET session_replication_role = replica;
      DELETE FROM parcels WHERE id IN ('${simParcel}','${realParcel}','${orphanParcel}');
      DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE market_id='${marketId}');
      DELETE FROM orders WHERE market_id='${marketId}';
      DELETE FROM relais WHERE id='${relaisId}';
      DELETE FROM markets WHERE id='${marketId}';
      DELETE FROM users WHERE id IN ('${simUser}','${mixUser}','${realUser}');
      SET session_replication_role = origin;`);
    await db.query(`INSERT INTO markets (id,code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,'E2E L2','KMF',0,true,'ACTIVE')`, [marketId, rnd()]);
    await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,island,market_id) VALUES ($1,$2,'E2E','+269000558','E2E','Ngazidja',$3)`, [relaisId, `E2E Relais ${tag('r')}`, marketId]);
    for (const [id, key] of [[simUser, 'sim'], [mixUser, 'mix'], [realUser, 'real']]) {
      phones[key] = phone();
      await db.query(`INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,$2,$3,$4,'client')`, [id, `E2E ${key}`, `${tag(key)}@komerce.test`, phones[key]]);
    }
    await order(simUser, 5000, 'RCT1');                 // client 100 % simulé
    const mixSim = await order(mixUser, 9000, 'RCT1');  // client mixte : 1 simulée + 1 réelle
    await order(mixUser, 1000);
    await order(realUser, 2000);
    await parcel(simParcel, mixSim);
    const realOrder = await order(realUser, 100);
    await parcel(realParcel, realOrder);
  });
  afterAll(async () => { if (cleanup) await cleanup.run(); });

  it('vue réelle : client 100 % simulé absent ; client mixte = agrégats de ses seules commandes réelles', async () => {
    const r = await list();
    expect(byPhone(r, phones.sim)).toBeUndefined();
    expect(byPhone(r, phones.mix)).toMatchObject({ orders_total: 1, orders_valid: 1, ltv_kmf: 1000, average_basket_kmf: 1000 });
    expect(byPhone(r, phones.real)).toMatchObject({ orders_total: 2, ltv_kmf: 2100 });
    expect(r.simulation).toBeNull();
  });

  it('vue recette RCT1 : inversement, étiquetée', async () => {
    const r = await list({ simulationScope: 'RCT1' });
    expect(byPhone(r, phones.sim)).toMatchObject({ orders_total: 1, ltv_kmf: 5000 });
    expect(byPhone(r, phones.mix)).toMatchObject({ orders_total: 1, ltv_kmf: 9000 });
    expect(byPhone(r, phones.real)).toBeUndefined();
    expect(r.simulation.scope).toBe('RCT1');
    expect(r.simulation.label).toMatch(/recette RCT1/);
  });

  it('Client 360 : réel = commandes réelles seulement ; client simulé introuvable en réel, trouvé en recette', async () => {
    const normalize = p => client360.normalizePhone(p);
    const real = await client360.resolveClient(normalize(phones.mix), { marketIds: [marketId] });
    const payload = await client360.loadClient360(real.client, { marketIds: [marketId] });
    expect(payload.summary.orders_total).toBe(1);
    expect(payload.simulation).toBeNull();
    expect((await client360.resolveClient(normalize(phones.sim), { marketIds: [marketId] })).client).toBeNull();
    const sim = await client360.resolveClient(normalize(phones.sim), { marketIds: [marketId], simulationScope: 'RCT1' });
    expect(sim.client).not.toBeNull();
    const simPayload = await client360.loadClient360(sim.client, { marketIds: [marketId], simulationScope: 'RCT1' });
    expect(simPayload.summary.orders_total).toBe(1);
    expect(simPayload.simulation.scope).toBe('RCT1');
  });

  it('signaux colis : colis d’une commande simulée exclu ; colis réel, colis inconnu et signal sans entité conservés', async () => {
    const { rows } = await db.query(
      `SELECT s.entity_id FROM (VALUES ('parcel', $1::text), ('parcel', $2::text), ('parcel', $3::text), ('system', 'x')) AS s(entity_type, entity_id)
       WHERE ${EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL}`, [simParcel, realParcel, orphanParcel]);
    const kept = rows.map(r => r.entity_id);
    expect(kept).not.toContain(simParcel);
    expect(kept).toEqual(expect.arrayContaining([realParcel, orphanParcel, 'x']));
  });
});
