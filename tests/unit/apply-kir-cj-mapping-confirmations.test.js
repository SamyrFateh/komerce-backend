'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({pool:{connect:jest.fn(),end:jest.fn()}}));
const {apply,validate}=require('../../scripts/apply-kir-cj-mapping-confirmations');
function plan(){
 const eligible=Array.from({length:12},(_,i)=>({
  source_path:'Group '+i,normalized_path:'group '+i,category:'Mode & Beauté',subcategory:'Homme',
  reason:'SOURCE_PATH_PHRASE',decision:'AWAITING_OPERATOR_CONFIRMATION'}));
 return {provider:'CJdropshipping',run_ref:'KIR-000008',fingerprint:'a'.repeat(64),inspected:20,
 eligible_groups:12,eligible_products:19,manual_groups:1,manual_products:1,eligible,
 manual_review:[{product_refs:['KSC-000143'],source_path:'Sports > Accessories'}]};
}
test('fails closed on drift in fingerprint or review cohort',()=>{
 expect(()=>validate(plan(),'b'.repeat(64))).toThrow('STALE_PLAN_FINGERPRINT');
 const p=plan();p.eligible_products=20;
 expect(()=>validate(p,p.fingerprint)).toThrow('KIR_CJ_COHORT_CHANGED');
});
test('confirms all 12 mappings in one transaction with explicit reviewed fingerprint',async()=>{
 const calls=[],client={query:jest.fn(async(sql)=>{calls.push(sql);return {rows:[]};}),release:jest.fn()};
 const confirmMapping=jest.fn(async()=>({status:'CONFIRMED'}));
 const result=await apply({runRef:'KIR-000008',fingerprint:'a'.repeat(64),actor:'operator-test'},{
  pool:{connect:async()=>client},preview:async()=>plan(),confirmMapping});
 expect(result.confirmed_groups).toBe(12);
 expect(confirmMapping).toHaveBeenCalledTimes(12);
 expect(calls[0]).toMatch(/^BEGIN/);
 expect(calls[calls.length-1]).toBe('COMMIT');
 expect(client.release).toHaveBeenCalledTimes(1);
});
test('rolls back on existing contradictory confirmed mappings',async()=>{
 const client={query:jest.fn(async sql=>sql.includes('SELECT source_category_path')
  ? {rows:[{source_category_path:'group 0',status:'CONFIRMED',
    boutique_category_key:'Maison',boutique_subcategory_key:'Cuisine'}]}:{rows:[]}),
  release:jest.fn()};
 const confirmMapping=jest.fn();
 await expect(apply({runRef:'KIR-000008',fingerprint:'a'.repeat(64),actor:'operator-test'},{
  pool:{connect:async()=>client},preview:async()=>plan(),confirmMapping}))
  .rejects.toThrow('EXISTING_CONFIRMED_MAPPING_CONFLICT');
 expect(confirmMapping).not.toHaveBeenCalled();
 expect(client.query).toHaveBeenCalledWith('ROLLBACK');
});
test('refuses absent explicit approval parameters before database connection',async()=>{
 const pool={connect:jest.fn()};
 await expect(apply({runRef:'KIR-000008',fingerprint:'a'.repeat(64),actor:''},{pool}))
  .rejects.toThrow('EXPLICIT_CONFIRMATION_REQUIRED');
 expect(pool.connect).not.toHaveBeenCalled();
});
