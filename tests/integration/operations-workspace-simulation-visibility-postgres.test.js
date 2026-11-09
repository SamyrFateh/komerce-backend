'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Feature proprietaire : logistics (Workspace Operations, visibilite des commandes de simulation).
 * Regle : orders.simulation_scope n'est visible dans les files du workspace que pour un compte present dans
 * e2e_test_accounts (marqueur pose par staging-e2e-provision). Table vide = personne ; admin sans marqueur non.
 */
const hasEnv = Boolean(process.env.DATABASE_URL);
if (!hasEnv) {
  describe.skip('Workspace simulation — SKIPPED: no DATABASE_URL', () => { it('requires DATABASE_URL', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const workspace = require('../../services/operations-workspace');
  const { isE2eTestAccount } = require('../../services/simulation-visibility');
  jest.setTimeout(30000);
  const TAG = `wssim${Date.now().toString(36)}`;
  const ids = { users: [], orders: [], parcels: [], products: [], relais: [] };
  let market; let relaisId; let sim; let real;
  const u = { e2eRelay: null, realRelay: null, realAdmin: null };

  async function mkUser(label, role) {
    const id = crypto.randomUUID();
    ids.users.push(id);
    await db.query(`INSERT INTO users (id, full_name, email, password_hash, role, relais_id) VALUES ($1,$2,$3,'x',$4,$5)`, [id, `${TAG}-${label}`, `${TAG}-${label}@komerce.test`, role, role === 'agent_relais' ? relaisId : null]);
    return { id, role, relais_id: role === 'agent_relais' ? relaisId : null };
  }
  async function seed(label, scope, status) {
    const productId = crypto.randomUUID(); ids.products.push(productId);
    await db.query('INSERT INTO products (id, name, price_kmf, stock) VALUES ($1,$2,1000,10)', [productId, `${TAG}-${label}`]);
    const orderId = crypto.randomUUID(); ids.orders.push(orderId);
    await db.query(`INSERT INTO orders (id, reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status, simulation_scope)
                    VALUES ($1,$2,$3,$4,1000,'cash_relais','paid','confirmed',$5)`, [orderId, `${TAG}-${label}`, relaisId, market.id, scope]);
    const itemId = crypto.randomUUID();
    await db.query(`INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1,$2,$3,1,1000,'LOCAL_STOCK')`, [itemId, orderId, productId]);
    const parcelId = crypto.randomUUID(); ids.parcels.push(parcelId);
    await db.query(`INSERT INTO parcels (id, order_id, reference, status, relais_id) VALUES ($1,$2,$3,$4,$5)`, [parcelId, orderId, `${TAG}-P-${label}`, status, relaisId]);
    await db.query('INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity) VALUES ($1,$2,$3,1)', [parcelId, itemId, productId]);
    return `${TAG}-P-${label}`;
  }
  const refs = async (viewer) => {
    const q = (await workspace.buildWorkspace({ market, viewer })).queues;
    return { ship: q.hub.to_ship.map((r) => r.reference), receive: q.relay.to_receive.map((r) => r.reference), collect: q.relay.to_collect.map((r) => r.reference) };
  };

  beforeAll(async () => {
    [market] = (await db.query("SELECT id, code, name, currency, lifecycle_status FROM markets WHERE code='KM'")).rows;
    relaisId = crypto.randomUUID(); ids.relais.push(relaisId);
    await db.query(`INSERT INTO relais (id, name, agent_name, phone, address, island, market_id) VALUES ($1,$2,'E2E','+269000111','Moroni','Ngazidja',$3)`, [relaisId, `${TAG}-relais`, market.id]);
    u.e2eRelay = await mkUser('e2e-relay', 'agent_relais');
    u.realRelay = await mkUser('real-relay', 'agent_relais');
    u.realAdmin = await mkUser('real-admin', 'admin');
    sim = { ship: await seed('SIMSHIP', 'E2E-TEST', 'preparation'), receive: await seed('SIMRECV', 'E2E-TEST', 'shipped'), collect: await seed('SIMCOLL', 'E2E-TEST', 'available') };
    real = await seed('REALSHIP', null, 'preparation');
  });
  afterAll(async () => {
    try {
      await db.query('DELETE FROM e2e_test_accounts WHERE user_id = ANY($1::uuid[])', [ids.users]).catch(() => {});
      for (const id of ids.parcels) { await db.query('DELETE FROM parcel_items WHERE parcel_id=$1', [id]).catch(() => {}); await db.query('DELETE FROM parcels WHERE id=$1', [id]).catch(() => {}); }
      for (const id of ids.orders) { await db.query('DELETE FROM order_items WHERE order_id=$1', [id]).catch(() => {}); await db.query('DELETE FROM orders WHERE id=$1', [id]).catch(() => {}); }
      for (const id of ids.products) await db.query('DELETE FROM products WHERE id=$1', [id]).catch(() => {});
      for (const id of ids.relais) await db.query('DELETE FROM relais WHERE id=$1', [id]).catch(() => {});
      for (const id of ids.users) await db.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
    } finally { if (db.pool && db.pool.end) await db.pool.end(); }
  });

  test('table vide pour ces comptes : personne ne voit la simulation (admin compris)', async () => {
    for (const viewer of [u.e2eRelay, u.realRelay, u.realAdmin, undefined]) {
      const r = await refs(viewer);
      if (viewer?.role === 'agent_relais') expect(r.ship).toEqual([]); // jamais de tâche Hub pour un relais
      else expect(r.ship).toContain(real);
      for (const k of ['ship', 'receive', 'collect']) expect(r[k]).not.toContain(sim[k]);
    }
    expect(await isE2eTestAccount(u.e2eRelay.id)).toBe(false);
  });

  test('compte E2E marque : voit le colis simule dans Expedier, Receptionner et Distribuer', async () => {
    await db.query('INSERT INTO e2e_test_accounts (user_id) VALUES ($1)', [u.e2eRelay.id]);
    const r = await refs(u.e2eRelay);
    expect(r.ship).toEqual([]); // agent relais : l'E2E n'accorde pas un droit Hub
    expect(r.receive).toContain(sim.receive);
    expect(r.collect).toContain(sim.collect);
  });

  test('compte reel du meme role et du meme marche : ne le voit pas', async () => {
    const r = await refs(u.realRelay);
    for (const k of ['ship', 'receive', 'collect']) expect(r[k]).not.toContain(sim[k]);
  });

  test('portée par relais : un second relais du même marché ne voit ni commandes, ni colis, ni compteurs du premier', async () => {
    const otherId = crypto.randomUUID(); ids.relais.push(otherId);
    await db.query(`INSERT INTO relais (id, name, agent_name, phone, address, island, market_id) VALUES ($1,$2,'E2E','+269000112','Moroni','Ngazidja',$3)`, [otherId, `${TAG}-second-relais`, market.id]);
    const outsider = await mkUser('other-relay', 'agent_relais');
    await db.query('UPDATE users SET relais_id=$2 WHERE id=$1', [outsider.id, otherId]);
    outsider.relais_id = otherId;
    const view = await workspace.buildWorkspace({market,viewer:outsider});
    expect(view.queues.relay.to_receive.map(x=>x.reference)).not.toContain(sim.receive);
    expect(view.queues.relay.to_collect.map(x=>x.reference)).not.toContain(sim.collect);
    expect(view.queues.relay.cash_pending).toEqual([]);
    expect(view.signals.par_relais.every(x=>String(x.id)===String(otherId))).toBe(true);
    expect(view.queues.hub.to_ship).toEqual([]);
  });

  test('admin reel sans marqueur ni opt-in : ne le voit pas', async () => {
    const r = await refs(u.realAdmin);
    for (const k of ['ship', 'receive', 'collect']) expect(r[k]).not.toContain(sim[k]);
  });
}
