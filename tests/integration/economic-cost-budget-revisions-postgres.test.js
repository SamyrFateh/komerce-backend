'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration economic-cost-budget-revisions-postgres.test.js
 * @brief ECO-1b: budget revisions on isolated PostgreSQL, rollback-only fixtures.
 */
const crypto = require('crypto');
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(30000);
describeDb('ECO-1b budget revision integrity (REAL_DB)', () => {
  const db = require('../../db');
  let client, actor, post, otherPost, charge;
  const tag = 'ECOB' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const period = '2026-01-01';
  const q = (sql, params) => client.query(sql, params);
  async function reject(sql, params, code) {
    await q('SAVEPOINT bad_budget');
    try { await expect(q(sql, params)).rejects.toMatchObject({ code }); }
    finally { await q('ROLLBACK TO SAVEPOINT bad_budget'); await q('RELEASE SAVEPOINT bad_budget'); }
  }
  const insert = 'INSERT INTO economic_cost_budget_revisions(post_id,period_start,revision,previous_revision,currency,amount_native,amount_eur,fx_legs,fx_as_of,reason,idempotency_key,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now(),$9,$10,$11) RETURNING id';
  function args(p, rev, prev, amount, key, opts = {}) {
    return [p, opts.period || period, rev, prev, opts.currency || 'EUR', amount, opts.eur ?? amount, JSON.stringify(opts.legs || []), opts.reason ?? 'Budget de recette', key, actor];
  }
  beforeAll(async () => {
    client = await db.getClient();
    await q('BEGIN');
    actor = (await q('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0]?.id;
    if (!actor) throw new Error('CI bootstrap did not provide an actor');
    const center = (await q('INSERT INTO economic_cost_centers(code,label) VALUES ($1,$1) RETURNING id',[tag])).rows[0].id;
    const family = (await q("INSERT INTO economic_cost_families(center_id,code,label) VALUES ($1,'FAMILY','Famille') RETURNING id",[center])).rows[0].id;
    charge = (await q("INSERT INTO charges(family,name,amount_kmf,is_recurring,recurrence_period) VALUES ('operationnelle',$1,0,true,'monthly') RETURNING id",[tag])).rows[0].id;
    const postSql = "INSERT INTO economic_cost_posts(center_id,family_id,code,label,economic_nature,allocation_perimeter,allocation_basis,structure_charge_id) VALUES ($1,$2,$3,$3,'FIXED','MUTUALIZED','PERIOD',$4) RETURNING id";
    post = (await q(postSql,[center,family,'POST_A',charge])).rows[0].id;
    otherPost = (await q(postSql,[center,family,'POST_B',null])).rows[0].id;
  });
  afterAll(async () => { if (client) { try { await q('ROLLBACK'); } finally { client.release(); } } });
  test('revisions form a contiguous chain; latest replaces planning value, not a sum', async () => {
    await reject(insert,args(post,2,1,'100.00','missing-prev'),'23503');
    await q(insert,args(post,1,null,'100.00','budget-first'));
    await q(insert,args(post,2,1,'120.00','budget-revise'));
    await reject(insert,args(post,2,1,'130.00','budget-branch'),'23505');
    const latest = (await q('SELECT amount_eur::text AS amount FROM economic_cost_budget_revisions WHERE post_id=$1 AND period_start=$2 ORDER BY revision DESC LIMIT 1',[post,period])).rows[0];
    expect(latest.amount).toBe('120.00');
  });
  test('a predecessor is required in the same post and month, not another scope', async () => {
    await reject(insert,args(otherPost,2,1,'50.00','cross-post'),'23503');
    await reject(insert,args(post,2,1,'50.00','cross-period',{period:'2026-02-01'}),'23503');
    await reject(insert,args(post,3,null,'50.00','null-prev'),'23514');
    await reject(insert,args(post,3,1,'50.00','skip-prev'),'23514');
  });
  test('rejects missing source evidence, invalid dates and invented EUR identity', async () => {
    await reject(insert,args(otherPost,1,null,'10.00','bad-date',{period:'2026-01-02'}),'23514');
    await reject(insert,args(otherPost,1,null,'10.00','bad-reason',{reason:' '}),'23514');
    await reject(insert,args(otherPost,1,null,'-1.00','bad-negative'),'23514');
    await reject(insert,args(otherPost,1,null,'NaN','bad-nan'),'23514');
    await reject(insert,args(otherPost,1,null,'1000','missing-fx',{currency:'KMF',eur:'2.03'}),'23514');
    await reject(insert,args(otherPost,1,null,'10.00','bad-eur',{eur:'11.00'}),'23514');
  });
  test('zero budget is explicit, request key cannot be reused, no real charge created', async () => {
    const before = (await q('SELECT count(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1',[charge])).rows[0].n;
    await q(insert,args(post,3,2,'0.00','budget-zero'));
    await reject(insert,args(post,4,3,'10.00','budget-zero'),'23505');
    const after = (await q('SELECT count(*)::int AS n FROM economic_structure_cost_events WHERE charge_id=$1',[charge])).rows[0].n;
    expect(after).toBe(before);
  });
  test('budget revisions cannot be rewritten or deleted', async () => {
    await reject('UPDATE economic_cost_budget_revisions SET amount_eur=7 WHERE post_id=$1 AND revision=1',[post],'23514');
    await reject('DELETE FROM economic_cost_budget_revisions WHERE post_id=$1 AND revision=1',[post],'23514');
  });
});
