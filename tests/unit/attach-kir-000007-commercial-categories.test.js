'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()},getClient:jest.fn()}));
const {run}=require('../../scripts/attach-kir-000007-commercial-categories');
const source=async()=>({provider:'AliExpress',inspected:20,items:Array.from({length:20},(_,i)=>({
 candidate_ref:'KSC-'+String(120+i).padStart(6,'0'),supplier_category:'Auto > Interior',
 category_path:['Auto','Interior']}))});
const find=async()=>({category:'Auto',subcategory:'Accessoires'});
test('preview reads twenty candidates without writes',async()=>{
 const query={query:jest.fn().mockImplementation(async sql=>({rows:[{id:'one',candidate_ref:'KSC-000120',
   state:'watchlist',product_id:null,commercial_taxonomy_review:null}]}))};
 const result=await run({source,find,query});
 expect(result).toMatchObject({mode:'PREVIEW',total:20,changed:0});
 expect(query.query.mock.calls.every(([sql])=>sql.trim().startsWith('SELECT'))).toBe(true);
});
test('apply is atomic and never modifies customs or KIR',async()=>{
 const client={query:jest.fn(async sql=>{
  if(sql.startsWith('SELECT'))return {rows:[{id:'one',state:'watchlist',product_id:null}]};
  return {rowCount:1};
 }),release:jest.fn()};
 const result=await run({apply:true,actor:'operator',source,find,query:{getClient:async()=>client}});
 expect(result.changed).toBe(20);
 expect(client.query.mock.calls[0][0]).toBe('BEGIN');
 expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
 expect(client.query.mock.calls.filter(([sql])=>sql.startsWith('UPDATE'))).toHaveLength(20);
 expect(client.query.mock.calls.map(([sql])=>sql).join(' ')).not.toContain('komerce_category=');
 expect(client.release).toHaveBeenCalled();
});
test('changed KIR evidence stops without writing',async()=>{
 await expect(run({source:async()=>({...await source(),inspected:19}),find,query:{query:jest.fn()}}))
   .rejects.toThrow('KIR_SOURCE_EVIDENCE_CHANGED');
});
