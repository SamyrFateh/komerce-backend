'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * Relais Live : le KPI « en transit / disponibles » ne compte que les colis de commandes réelles et vivantes
 * (jamais simulation/recette ni commande clôturée), sur PostgreSQL réel.
 */
const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('Relais Live — vérité du KPI colis', ({ db }) => {
  const { countRelayParcels } = require('../../services/operations-relay-projection');
  const userId = uuid(); const relaisId = uuid(); const marketId = uuid();
  let cleanup;

  async function order(status, simulation) {
    const id = uuid();
    await db.query(
      `INSERT INTO orders (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,simulation_scope)
       VALUES ($1,$2,$3,$4,$5,$6,'paid','cash_relais',1000,2,$7)`,
      [id, userId, relaisId, marketId, `PK-${id.slice(0, 8)}`.toUpperCase(), status, simulation ? 'RCT1' : null]);
    return id;
  }
  async function parcel(orderId, status) {
    await db.query(`INSERT INTO parcels (order_id,reference,status,relais_id) VALUES ($1,$2,$3,$4)`, [orderId, `PK-${uuid().slice(0, 8)}`, status, relaisId]);
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);
    cleanup.trackSql(`SET session_replication_role = replica;
      DELETE FROM parcels WHERE relais_id='${relaisId}';
      DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE market_id='${marketId}');
      DELETE FROM orders WHERE market_id='${marketId}';
      DELETE FROM relais WHERE id='${relaisId}';
      DELETE FROM markets WHERE id='${marketId}';
      DELETE FROM users WHERE id='${userId}';
      SET session_replication_role = origin;`);
    const { rows: [m] } = await db.query(`SELECT 1 FROM markets WHERE code='ZK'`);
    await db.query(`INSERT INTO markets (id,code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,'E2E parcel kpi','KMF',0,true,'ACTIVE')`,
      [marketId, m ? tag('k').slice(0, 6).toUpperCase() : 'ZK']);
    await db.query(`INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,'E2E',$2,$3,'client')`,
      [userId, `${tag('pk')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,island,market_id) VALUES ($1,$2,'E2E','+269000557','E2E','Ngazidja',$3)`,
      [relaisId, `E2E Relais ${tag('r')}`, marketId]);
  });
  afterAll(async () => { if (cleanup) await cleanup.run(); });

  it('ne compte que les colis des commandes réelles et vivantes', async () => {
    await parcel(await order('in_transit', false), 'in_transit');   // réel : compte
    await parcel(await order('in_transit', true), 'in_transit');    // simulation/recette : exclu
    await parcel(await order('collected', false), 'in_transit');    // commande clôturée : exclu
    await parcel(await order('cancelled', false), 'in_transit');    // commande annulée : exclu
    await parcel(await order('available', false), 'available');     // réel : compte
    await parcel(await order('available', true), 'available');      // simulation : exclu
    const k = await countRelayParcels({ marketIds: [marketId] });
    expect(k).toEqual({ in_transit: 1, available: 1 });
  });
});
