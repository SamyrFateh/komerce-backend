'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { upsertCandidateFromCatalogImport }=require('../../services/sourcing-candidate-import-service');
function input(id,name){return{importId:'i',supplierName:'Supplier',product:{supplier_product_id:id,product_name:name,currency:'USD',raw_payload:{id}},normalized:{data_sources:{}},normalizedSourceContract:{schema_version:'2'},scan:{sourcing_decision:'TEST'},verdict:{},autoState:'scanned',autoRejectedReason:null,userId:'u'};}
describe('Gate A final real persistence seams',()=>{
 test('page/order permutation converges on the same supplier identities',async()=>{
  async function play(order){const ids=new Map();let n=0;const q={query:jest.fn(async(sql,params)=>{if(sql.includes('INSERT INTO sourcing_candidates')){const supplierId=params[2];if(!ids.has(supplierId))ids.set(supplierId,'cand-'+(++n));return{rows:[{id:ids.get(supplierId),was_updated:ids.has(supplierId)&&n<order.length,data_sources:{}}]};}return{rows:[]};})};for(const p of order)await upsertCandidateFromCatalogImport(q,input(p,p));return [...ids.keys()].sort();}
  expect(await play(['b','a','c'])).toEqual(await play(['a','b','c']));
 });
});
