'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),getClient:jest.fn(),pool:{end:jest.fn()}}));
const {run}=require('../../scripts/apply-kir-000007-commercial-mappings');
const APPROVED=require('../../scripts/apply-kir-000007-commercial-mappings').APPROVED;
const coverage=async()=>({provider:'AliExpress',inspected:20,source_category_groups:8,ungrouped_products:0,
 categories:APPROVED.map(([source_path],index)=>({source_path,count:index===1?6:index===2?5:index===3||index===4||index===7?2:1}))});
function mockQuery(existing=false){
 return {query:jest.fn(async(sql)=> {
   if(sql.includes('SELECT bc.key AS category'))return {rows:[{category:'Auto',subcategory:'Accessoires'},{category:'Tech',subcategory:'Phones'}]};
   if(sql.includes('SELECT status,boutique_category_key'))return {rows:existing?[{status:'CONFIRMED',boutique_category_key:'Auto',boutique_subcategory_key:'Accessoires',proposed_label_fr:'Accessoires extérieurs'}]:[]};
   return {rowCount:1,rows:[]};
 })};
}
test('preview has no write statements',async()=>{
 const query=mockQuery();const result=await run({coverage,query});
 expect(result.mode).toBe('PREVIEW');expect(result.groups).toBe(8);
 expect(result.receipts.every(r=>r.action==='WOULD_CONFIRM')).toBe(true);
 expect(query.query.mock.calls.every(([sql])=>sql.trim().startsWith('SELECT'))).toBe(true);
});
test('application commits eight mappings as one transaction',async()=>{
 const client={...mockQuery(),release:jest.fn()};const query={getClient:jest.fn().mockResolvedValue(client)};
 const result=await run({apply:true,actor:'admin-test',coverage,query});
 expect(result.changed).toBe(8);
 expect(client.query.mock.calls[0][0]).toBe('BEGIN');
 expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
 expect(client.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO supplier_commercial_category_mappings'))).toHaveLength(8);
 expect(client.query.mock.calls.map(([sql])=>sql).join(' ')).not.toContain('UPDATE sourcing_candidates');
 expect(client.release).toHaveBeenCalled();
});
test('fails closed if KIR family evidence changes',async()=>{
 const query=mockQuery();
 await expect(run({coverage:async()=>({...await coverage(),inspected:19}),query})).rejects.toThrow('KIR_SOURCE_EVIDENCE_CHANGED');
 expect(query.query).not.toHaveBeenCalled();
});
