'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration economic-cost-center-reference-postgres.test.js
 * @brief ECO-1a: real PostgreSQL scope and reference integrity, rollback-only fixtures.
 */
const crypto = require('crypto');
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(30000);
describeDb('ECO-1a cost center reference (REAL_DB)', () => {
  const db = require('../../db');
  let client, km, cm, a, b, familyA, familyB, resourceA, resourceB, chargeA;
  const tag = 'ECO' + crypto.randomBytes(6).toString('hex').toUpperCase();
  async function query(sql, args) { return client.query(sql, args); }
  async function reject(sql, args, code) {
    await query('SAVEPOINT rejected_reference');
    try { await expect(query(sql, args)).rejects.toMatchObject({ code }); }
    finally { await query('ROLLBACK TO SAVEPOINT rejected_reference'); await query('RELEASE SAVEPOINT rejected_reference'); }
  }
  async function center(market, code) {
    return (await query('INSERT INTO economic_cost_centers(market_id,code,label) VALUES ($1,$2,$2) RETURNING id', [market,code])).rows[0].id;
  }
  async function family(centerId) {
    return (await query("INSERT INTO economic_cost_families(center_id,code,label) VALUES ($1,'PERSONNEL','Personnel') RETURNING id", [centerId])).rows[0].id;
  }
  async function resource(centerId) {
    return (await query("INSERT INTO economic_cost_resources(center_id,code,label,resource_kind) VALUES ($1,'EQUIPE','Equipe','PERSONNEL') RETURNING id", [centerId])).rows[0].id;
  }
  const postSql = "INSERT INTO economic_cost_posts(center_id,family_id,resource_id,code,label,economic_nature,allocation_perimeter,allocation_basis,structure_charge_id) VALUES ($1,$2,$3,$4,'Poste',$5,'DIRECT','PERIOD',$6) RETURNING id";
  beforeAll(async () => {
    client = await db.getClient();
    await query('BEGIN');
    const markets = (await query("SELECT id, code FROM markets WHERE code IN ('KM','CM')")).rows;
    km = markets.find(m => m.code === 'KM').id; cm = markets.find(m => m.code === 'CM').id;
    a = await center(km,tag); b = await center(cm,tag);
    familyA = await family(a); familyB = await family(b);
    resourceA = await resource(a); resourceB = await resource(b);
    chargeA = (await query("INSERT INTO charges(family,name,amount_kmf,is_recurring,recurrence_period,market_owner_id) VALUES ('operationnelle',$1,0,true,'monthly',$2) RETURNING id", [tag,km])).rows[0].id;
  });
  afterAll(async () => { if (client) { try { await query('ROLLBACK'); } finally { client.release(); } } });
  test('same code may be scoped by market, not duplicated in one market or group', async () => {
    await reject('INSERT INTO economic_cost_centers(market_id,code,label) VALUES ($1,$2,$2)', [km,tag], '23505');
    await center(null,tag);
    await reject('INSERT INTO economic_cost_centers(market_id,code,label) VALUES (NULL,$1,$1)', [tag], '23505');
  });
  test('activation requires explicit owner; scope cannot move', async () => {
    await reject('UPDATE economic_cost_centers SET is_active=true WHERE id=$1',[a],'23514');
    await reject('UPDATE economic_cost_centers SET market_id=$1 WHERE id=$2',[cm,a],'23514');
  });
  test('family and optional resource cannot cross centers', async () => {
    await reject(postSql,[a,familyB,resourceA,'BAD_FAMILY','FIXED',null],'23503');
    await reject(postSql,[a,familyA,resourceB,'BAD_RESOURCE','FIXED',null],'23503');
  });
  test('structure reference is scope-bound, unique and fixed; no new actual fact', async () => {
    const before = (await query('SELECT count(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1',[chargeA])).rows[0].n;
    await reject(postSql,[b,familyB,resourceB,'BAD_SCOPE','FIXED',chargeA],'23514');
    await reject(postSql,[a,familyA,resourceA,'BAD_NATURE','VARIABLE',chargeA],'23514');
    expect((await query(postSql,[a,familyA,resourceA,'FIXED_POST','FIXED',chargeA])).rows[0].id).toBeTruthy();
    await reject(postSql,[a,familyA,resourceA,'DUPLICATE','FIXED',chargeA],'23505');
    await reject('UPDATE charges SET market_owner_id=$1 WHERE id=$2',[cm,chargeA],'23514');
    const after = (await query('SELECT count(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1',[chargeA])).rows[0].n;
    expect(after).toBe(before);
  });
  test('mixed and variable administrative posts do not require a structure fact', async () => {
    expect((await query(postSql,[b,familyB,null,'MIXED_POST','MIXED',null])).rows[0].id).toBeTruthy();
    expect((await query(postSql,[b,familyB,null,'VARIABLE_POST','VARIABLE',null])).rows[0].id).toBeTruthy();
  });
});
