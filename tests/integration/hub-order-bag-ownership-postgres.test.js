'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-order-bag-ownership-postgres.test.js
 * @brief Replacement for retired customer-bag ownership proofs. Existing historical
 * bags remain readable; NO new customer bag/plan or order-bound box may be created.
 * A new direct COMBOX is allowed and never claims a customer/order identity.
 */
const crypto = require('crypto');
const db = require('../../db');
const hubOps = require('../../services/hub-operations');
jest.setTimeout(60000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('Hub — no new customer bags, COMBOX directe (PG réel)', () => {
  const tag = 'NO-BAG-' + crypto.randomUUID().slice(0, 8);
  const actorId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const marketRelayId = crypto.randomUUID();
  const refs = [tag + '-BAG', tag + '-BOX-ORDER', tag + '-BOX'];
  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL).hostname;
    if (!['localhost','127.0.0.1','::1'].includes(host)) throw new Error('NO_BAG_LOCAL_POSTGRES_ONLY');
    const { rows:[market] } = await db.query("SELECT id FROM markets WHERE code='KM'");
    await db.query("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'No Bag CI',$2,$3,'admin')",
      [actorId,tag.toLowerCase()+'@komerce.test','+2693'+String(Date.now()).slice(-7)]);
    await db.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000002','R',$3)",
      [marketRelayId,'R-'+tag,market.id]);
    await db.query("INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur) VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20)",
      [orderId,actorId,marketRelayId,market.id,tag+'-ORDER']);
  });
  afterAll(async()=>{ await db.pool.end().catch(()=>{}); });
  const count = async () => (await db.query(
    'SELECT count(*)::int AS n FROM hub_physical_units WHERE reference = ANY($1::text[])', [refs])).rows[0].n;

  test('ancien sac client avec plan retourne 410, aucun objet inséré', async () => {
    expect(await count()).toBe(0);
    const result = await hubOps.createOperatorUnitCommand({
      unit_type:'HANDLING_UNIT',order_id:orderId,reference:refs[0],
      bag_plan:[{order_item_id:crypto.randomUUID(),quantity:1}],
    },actorId);
    expect(result).toMatchObject({status:410,body:{code:'HUB_CUSTOMER_BAG_RETIRED'}});
    expect(await count()).toBe(0);
  });

  test('une KOM-BOX ne peut pas porter order_id ou bag_plan', async () => {
    const result = await hubOps.createOperatorUnitCommand({
      unit_type:'MARKET_PARCEL',order_id:orderId,reference:refs[1],
    },actorId);
    expect(result).toMatchObject({status:410,body:{code:'HUB_CUSTOMER_BAG_RETIRED'}});
    expect(await count()).toBe(0);
  });

  test('création légitime de COMBOX directe et identité commerciale non confondue', async () => {
    const result = await hubOps.createOperatorUnitCommand({
      unit_type:'MARKET_PARCEL',reference:refs[2],
    },actorId);
    expect(result.status).toBe(201);
    const { rows:[unit] } = await db.query(
      'SELECT unit_type,order_id,bag_plan,reference FROM hub_physical_units WHERE id=$1',
      [result.body.physical_unit.id]);
    expect(unit.reference).toBe(refs[2]);
    expect(unit.order_id).toBeNull();
    expect(unit.bag_plan).toBeNull();
    expect(await count()).toBe(1);
  });
});
