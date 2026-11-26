'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration economic-cost-commitments-postgres.test.js
 * @brief ECO-1c: rollback-only commitment scope and conservation.
 */
const crypto = require('crypto');
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(30000);
describeDb('ECO-1c commitment reference (REAL_DB)', () => {
  const db = require('../../db');
  const structure = require('../../services/pricing-period-structure');
  const tag = 'ECOC' + crypto.randomBytes(6).toString('hex').toUpperCase();
  let client, actor, post, otherPost, charge, c1, c2, c3, fact;
  const q = (sql, args) => client.query(sql,args);
  async function reject(sql,args,code='23514') {
    await q('SAVEPOINT bad_commitment');
    try { await expect(q(sql,args)).rejects.toMatchObject({code}); }
    finally { await q('ROLLBACK TO SAVEPOINT bad_commitment'); await q('RELEASE SAVEPOINT bad_commitment'); }
  }
  const open = "INSERT INTO economic_cost_commitments(post_id,period_start,currency,amount_native,amount_eur,fx_legs,fx_as_of,evidence_ref,request_key,recorded_by) VALUES ($1,'2026-01-01','EUR',$2,$2,'[]',now(),'test-contract',$3,$4) RETURNING id";
  const move = "INSERT INTO economic_cost_commitment_movements(commitment_id,kind,amount_native,structure_event_id,evidence_ref,request_key,recorded_by) VALUES ($1,$2,$3,$4,'test-proof',$5,$6)";
  beforeAll(async () => {
    client = await db.getClient(); await q('BEGIN');
    actor = (await q("INSERT INTO users(email,full_name,phone,role,password_hash) VALUES ($1,'ECO commitment CI',$2,'admin','not-a-login-hash') RETURNING id",[tag.toLowerCase()+'@test.invalid','+269'+(3000000+crypto.randomInt(6000000))])).rows[0].id;
    const center = (await q('INSERT INTO economic_cost_centers(code,label) VALUES ($1,$1) RETURNING id',[tag])).rows[0].id;
    const family = (await q("INSERT INTO economic_cost_families(center_id,code,label) VALUES ($1,'FAMILY','Famille') RETURNING id",[center])).rows[0].id;
    charge = (await q("INSERT INTO charges(family,name,amount_kmf,is_recurring,recurrence_period) VALUES ('operationnelle',$1,0,true,'monthly') RETURNING id",[tag])).rows[0].id;
    const postSql = "INSERT INTO economic_cost_posts(center_id,family_id,code,label,economic_nature,allocation_perimeter,allocation_basis,structure_charge_id) VALUES ($1,$2,$3,$3,'FIXED','MUTUALIZED','PERIOD',$4) RETURNING id";
    post=(await q(postSql,[center,family,'POST_A',charge])).rows[0].id;
    otherPost=(await q(postSql,[center,family,'POST_B',null])).rows[0].id;
    c1=(await q(open,[post,100,'commitment-one',actor])).rows[0].id;
    c2=(await q(open,[post,100,'commitment-two',actor])).rows[0].id;
    c3=(await q(open,[otherPost,100,'commitment-other',actor])).rows[0].id;
    fact=(await structure.recordStructureCostEvent({charge_id:charge,scope_kind:'GROUP',event_kind:'ACCRUAL',economic_from:'2026-01-01T00:00:00Z',economic_to:'2026-02-01T00:00:00Z',currency:'EUR',amount_original:60,fx_rate_to_kmf:491.96,amount_kmf:29517.6,fx_source:'CI fixture',source_kind:'MANUAL',evidence_ref:'CI test only'},actor,{executor:client})).id;
  });
  afterAll(async()=>{if(client){try{await q('ROLLBACK');}finally{client.release();}}});
  test('opening and releasing commitments do not create realized events',async()=>{
    await q(move,[c1,'RELEASE',20,null,'release-first',actor]);
    const n=(await q('SELECT count(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1',[charge])).rows[0].n;
    expect(n).toBe(1);
    await reject(move,[c1,'RELEASE',81,null,'release-too-much',actor]);
  });
  test('partial linked consumption and remaining balance conserve commitment and source',async()=>{
    await q(move,[c1,'CONSUME_STRUCTURE',40,fact,'consume-first',actor]);
    await q(move,[c2,'CONSUME_STRUCTURE',20,fact,'consume-second',actor]);
    await reject(move,[c2,'CONSUME_STRUCTURE',1,fact,'consume-overfact',actor]);
    const row=(await q('SELECT c.amount_native-COALESCE(SUM(m.amount_native),0) AS remaining FROM economic_cost_commitments c LEFT JOIN economic_cost_commitment_movements m ON m.commitment_id=c.id WHERE c.id=$1 GROUP BY c.id',[c1])).rows[0];
    expect(Number(row.remaining)).toBe(40);
    expect((await q('SELECT count(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1',[charge])).rows[0].n).toBe(1);
  });
  test('wrong post and duplicate request are rejected',async()=>{
    await reject(move,[c3,'CONSUME_STRUCTURE',10,fact,'wrong-post',actor]);
    await reject(move,[c1,'RELEASE',1,null,'release-first',actor],'23505');
  });
  test('historical commitments and movements cannot be rewritten',async()=>{
    await reject('UPDATE economic_cost_commitments SET amount_native=1 WHERE id=$1',[c1]);
    await reject('DELETE FROM economic_cost_commitment_movements WHERE commitment_id=$1',[c1]);
  });
});
