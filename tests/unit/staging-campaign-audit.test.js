/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
jest.mock('../../scripts/recette/target-guard',()=>({confirmTarget:jest.fn()}));
const { ROOTS,scopedSql,evaluateAudit,inspect }=require('../../scripts/recette/staging-campaign-audit');
function fakeDb(dependencies=[]) {
  const calls=[];
  const client={
    query:jest.fn(async(sql,params)=>{
      calls.push({sql,params});
      if(sql.startsWith('SELECT "id"')) return {rows:[]};
      if(sql.includes('pg_constraint')) return {rows:dependencies};
      return {rows:[]};
    }),
    release:jest.fn(),
  };
  return {db:{pool:{connect:jest.fn().mockResolvedValue(client)}},calls,client};
}
test('only explicit fixture roots are selected; orders require RCT1 scope',()=>{
  expect(ROOTS.map(r=>r.table)).toEqual(['orders','products','users','relais']);
  expect(scopedSql(ROOTS[0]).sql).toMatch(/"simulation_scope" = \$2/);
  expect(scopedSql(ROOTS[0]).params[1]).toBe('RCT1');
  expect(()=>scopedSql({...ROOTS[0],table:'markets'})).toThrow('CAMPAIGN_ROOT_NOT_ALLOWLISTED');
});
test('staging audit rolls back read-only transaction, maps FK and refuses cleanup',async()=>{
  const {db,calls,client}=fakeDb([{parent_table:'orders',child_table:'order_items',constraint_name:'fk_order'}]);
  const result=await inspect({db,env:{KOMERCE_ENV:'staging'},confirm:async()=>({confirmed:true})});
  expect(result.writes).toBe(0);
  expect(result.verdict.cleanup_allowed).toBe(false);
  expect(result.verdict.reasons).toContain('UNREVIEWED_FK:orders->order_items:fk_order');
  expect(calls[0].sql).toBe('BEGIN READ ONLY');
  expect(calls[calls.length-1].sql).toBe('ROLLBACK');
  expect(calls.every(c=>!/^\s*(DELETE|INSERT|UPDATE|TRUNCATE|COMMIT)/i.test(c.sql))).toBe(true);
  expect(client.release).toHaveBeenCalledTimes(1);
});
test('production and unconfirmed database fail closed before any query',async()=>{
  const {db,calls}=fakeDb();
  await expect(inspect({db,env:{KOMERCE_ENV:'production'},confirm:async()=>({confirmed:true})})).rejects.toThrow('CAMPAIGN_STAGING_ONLY');
  await expect(inspect({db,env:{KOMERCE_ENV:'staging'},confirm:async()=>({confirmed:false})})).rejects.toThrow('CAMPAIGN_TARGET_NOT_CONFIRMED');
  expect(calls).toHaveLength(0);
  expect(evaluateAudit([],[]).cleanup_allowed).toBe(false);
});
