'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * G4: deux comptes E2E independants, deux relais du meme marche et des objets
 * distincts. Preuve des projections de service sur PG16 jetable uniquement.
 * Aucun Chromium et aucune ecriture staging: ce test N'EST PAS un GO G4.
 */
const DISPOSABLE_DATABASE = 'postgresql://komerce:komerce@localhost:5432/komerce_test';
const isolated = process.env.GITHUB_ACTIONS === 'true'
  && process.env.NODE_ENV === 'test'
  && process.env.KOMERCE_DISABLE_CRONS === 'true'
  && process.env.DATABASE_URL === DISPOSABLE_DATABASE
  && process.env.KOMERCE_ENV !== 'staging'
  && process.env.KOMERCE_TARGET_ENV !== 'staging';

if (!isolated) {
  describe.skip('G4 isolation A/B — PostgreSQL 16 jetable obligatoire, staging interdit', () => {
    test('aucune fixture en dehors du CI isole', () => {});
  });
} else {
  const crypto = require('node:crypto');
  const db = require('../../db');
  const operations = require('../../services/operations-workspace');
  const { isE2eTestAccount } = require('../../services/simulation-visibility');
  jest.setTimeout(60000);

  const run8 = crypto.randomBytes(4).toString('hex').toUpperCase();
  const PREFIX = 'G4AB-' + run8;
  const ids = { users: [], relais: [], products: [], orders: [], parcels: [] };
  const actors = {};
  const cases = {};
  let market;

  async function makeRelay(label) {
    const id = crypto.randomUUID();
    ids.relais.push(id);
    await db.query(
      'INSERT INTO relais (id, name, agent_name, phone, address, island, market_id) ' +
      "VALUES ($1,$2,'G4 E2E','+269000000','Recette isolee','Ngazidja',$3)",
      [id, PREFIX + '-Relais-' + label, market.id]
    );
    return id;
  }

  async function makeActor(label, relaisId, e2e) {
    const id = crypto.randomUUID();
    ids.users.push(id);
    await db.query(
      'INSERT INTO users (id, full_name, email, password_hash, role, relais_id) ' +
      "VALUES ($1,$2,$3,'x','agent_relais',$4)",
      [id, PREFIX + '-Agent-' + label, 'g4ab-' + run8.toLowerCase() + '-' + label.toLowerCase() + '@komerce.test', relaisId]
    );
    if (e2e) await db.query('INSERT INTO e2e_test_accounts (user_id) VALUES ($1)', [id]);
    return { id, role: 'agent_relais', relais_id: relaisId };
  }

  async function makeParcel(label, relaisId, status) {
    const productId = crypto.randomUUID(); ids.products.push(productId);
    await db.query('INSERT INTO products (id, name, price_kmf, stock) VALUES ($1,$2,1000,10)',
      [productId, PREFIX + '-Product-' + label]);
    const orderId = crypto.randomUUID(); ids.orders.push(orderId);
    await db.query(
      'INSERT INTO orders (id, reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status, simulation_scope) ' +
      "VALUES ($1,$2,$3,$4,1000,'cash_relais','paid','confirmed','E2E-TEST')",
      [orderId, PREFIX + '-Order-' + label, relaisId, market.id]
    );
    const itemId = crypto.randomUUID();
    await db.query(
      'INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, fulfillment_source) ' +
      "VALUES ($1,$2,$3,1,1000,'LOCAL_STOCK')", [itemId,orderId,productId]
    );
    const parcelId = crypto.randomUUID(); ids.parcels.push(parcelId);
    const reference = PREFIX + '-Parcel-' + label;
    await db.query('INSERT INTO parcels (id, order_id, reference, status, relais_id) VALUES ($1,$2,$3,$4,$5)',
      [parcelId,orderId,reference,status,relaisId]);
    await db.query('INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity) VALUES ($1,$2,$3,1)',
      [parcelId,itemId,productId]);
    return { reference, orderId, parcelId };
  }

  async function readRows() {
    const { rows } = await db.query(
      'SELECT o.id, o.relais_id AS order_relais_id, o.simulation_scope, ' +
      'p.id AS parcel_id, p.relais_id AS parcel_relais_id, p.reference ' +
      'FROM orders o JOIN parcels p ON p.order_id=o.id ' +
      'WHERE o.id = ANY($1::uuid[]) ORDER BY p.reference', [ids.orders]
    );
    return rows;
  }

  const allRefs = (view) => [
    ...view.queues.relay.to_receive.map(x => x.reference),
    ...view.queues.relay.to_collect.map(x => x.reference),
  ];

  beforeAll(async () => {
    const { rows: [m] } = await db.query(
      "SELECT id, code, name, currency, lifecycle_status FROM markets WHERE code='KM'"
    );
    if (!m) throw new Error('KM_MARKET_REQUIRED_ON_DISPOSABLE_PG');
    market = m;
    const aId = await makeRelay('A');
    const bId = await makeRelay('B');
    if (aId === bId) throw new Error('RELAY_IDENTITY_COLLISION');
    actors.A = await makeActor('A', aId, true);
    actors.B = await makeActor('B', bId, true);
    actors.unmarked = await makeActor('unmarked', aId, false);
    cases.A = {
      receive: await makeParcel('A-receive', aId, 'shipped'),
      collect: await makeParcel('A-collect', aId, 'available'),
    };
    cases.B = {
      receive: await makeParcel('B-receive', bId, 'shipped'),
      collect: await makeParcel('B-collect', bId, 'available'),
    };
  });

  afterAll(async () => {
    try {
      await db.query('DELETE FROM e2e_test_accounts WHERE user_id = ANY($1::uuid[])', [ids.users]).catch(() => {});
      for (const id of ids.parcels) {
        await db.query('DELETE FROM parcel_items WHERE parcel_id=$1', [id]).catch(() => {});
        await db.query('DELETE FROM parcels WHERE id=$1', [id]).catch(() => {});
      }
      for (const id of ids.orders) {
        await db.query('DELETE FROM order_items WHERE order_id=$1', [id]).catch(() => {});
        await db.query('DELETE FROM orders WHERE id=$1', [id]).catch(() => {});
      }
      for (const id of ids.products) await db.query('DELETE FROM products WHERE id=$1', [id]).catch(() => {});
      for (const id of ids.users) await db.query('DELETE FROM users WHERE id=$1', [id]).catch(() => {});
      for (const id of ids.relais) await db.query('DELETE FROM relais WHERE id=$1', [id]).catch(() => {});
    } finally {
      if (db.pool && db.pool.end) await db.pool.end();
    }
  });

  test('A et B sont deux acteurs E2E marques, sur deux relais distincts du meme marche', async () => {
    expect(actors.A.id).not.toBe(actors.B.id);
    expect(actors.A.relais_id).not.toBe(actors.B.relais_id);
    expect(await isE2eTestAccount(actors.A.id)).toBe(true);
    expect(await isE2eTestAccount(actors.B.id)).toBe(true);
    expect(await isE2eTestAccount(actors.unmarked.id)).toBe(false);
    const {rows} = await db.query(
      'SELECT COUNT(DISTINCT market_id)::int AS markets FROM relais WHERE id=ANY($1::uuid[])',
      [[actors.A.relais_id,actors.B.relais_id]]
    );
    expect(rows[0].markets).toBe(1);
  });

  test('quatre sens A vers A/B et B vers A/B : files de reception et retrait sans fuite', async () => {
    for (const owner of ['A','B']) {
      const outsider = owner === 'A' ? 'B' : 'A';
      const view = await operations.buildWorkspace({market,viewer:actors[owner]});
      const own = cases[owner], other = cases[outsider];
      expect(view.queues.relay.to_receive.map(x => x.reference)).toContain(own.receive.reference);
      expect(view.queues.relay.to_collect.map(x => x.reference)).toContain(own.collect.reference);
      expect(allRefs(view)).not.toContain(other.receive.reference);
      expect(allRefs(view)).not.toContain(other.collect.reference);
      expect(view.queues.hub.to_ship).toEqual([]);
      expect(view.distribution).toEqual({ parcels: [], unassigned: [] });
      expect(view.inventory).toEqual({ items: [], open_parcels: [] });
      expect(view.data_quality.scope_mode).toBe('relay');
    }
  });

  test('signaux et indicateurs restent strictement lies au relais serveur', async () => {
    for (const owner of ['A','B']) {
      const other = owner === 'A' ? 'B' : 'A';
      const view = await operations.buildWorkspace({market,viewer:actors[owner]});
      expect(view.signals.par_relais.every(x => String(x.id) === actors[owner].relais_id)).toBe(true);
      expect(JSON.stringify(view.signals.par_relais)).not.toContain(actors[other].relais_id);
      // Le compteur physique LIVE ne compte volontairement pas les commandes simulees.
      expect(view.summary.relay_to_collect).toBe(0);
    }
  });

  test('un agent non marque E2E ne voit aucune commande de simulation de son propre relais', async () => {
    const view = await operations.buildWorkspace({market,viewer:actors.unmarked});
    for (const ref of Object.values(cases.A).map(x => x.reference)) {
      expect(allRefs(view)).not.toContain(ref);
    }
  });

  test('aucun relais rattache ou relais invalide : refus avant lecture', async () => {
    for (const relaisId of [null, 'not-a-uuid']) {
      await expect(operations.buildWorkspace({market,viewer:{role:'agent_relais',relais_id:relaisId}}))
        .rejects.toMatchObject({code:'relay_scope_required',status:403});
    }
  });

  test('readback SQL independant : quatre colis restent exactement sur leurs deux relais, aucun write du lecteur', async () => {
    const before = await readRows();
    expect(before).toHaveLength(4);
    for (const owner of ['A','B']) {
      for (const c of Object.values(cases[owner])) {
        expect(before).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id:c.orderId,order_relais_id:actors[owner].relais_id,
            parcel_id:c.parcelId,parcel_relais_id:actors[owner].relais_id,
            simulation_scope:'E2E-TEST',
          }),
        ]));
      }
    }
    await operations.buildWorkspace({market,viewer:actors.A});
    await operations.buildWorkspace({market,viewer:actors.B});
    expect(await readRows()).toEqual(before);
  });
}
