'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn()}));
jest.mock('../../services/suppliers/connectors/cj-connector',()=>({fetchProducts:jest.fn()}));
jest.mock('../../services/suppliers/cj-catalog-index',()=>({fetchCategories:jest.fn()}));
jest.mock('../../services/suppliers/catalog-import-orchestrator',()=>({importCatalog:jest.fn()}));
jest.mock('../../services/suppliers/catalog-sync-checkpoint',()=>({getCheckpoint:jest.fn(),ensureCheckpoint:jest.fn(),markComplete:jest.fn(),recordPageSuccess:jest.fn(),recordError:jest.fn(),summarize:jest.fn()}));
const {syncCategory}=require('../../scripts/cj-full-catalog-sync');
const product=id=>({supplier_product_id:id,product_name:id,image_url:'https://fixture/p.jpg',purchase_price:1});
function rig(pages,{checkpoint=null}={}){
 let count=0;const imported=[];const cp={getCheckpoint:jest.fn().mockResolvedValue(checkpoint),ensureCheckpoint:jest.fn().mockResolvedValue({}),markComplete:jest.fn(),recordPageSuccess:jest.fn(),recordError:jest.fn()};
 return {deps:{fetchProducts:jest.fn(async({page})=>pages[page]||{products:[],total_records:Object.keys(pages).length}),countCleanCandidates:jest.fn(async()=>count),importFetchedSubset:jest.fn(async({subset})=>{imported.push(...subset.map(x=>x.supplier_product_id));count+=subset.length;return{accepted:subset.length,rejected:0};}),checkpoints:cp},cp,imported};
}
const cfg={syncKey:'gate-a',pageSize:2,maxApiCalls:20,maxCleanProducts:100};
const cat={category_id:'cat',path:'Fixture'};
describe('Gate A pagination on real CJ syncCategory seam',()=>{
 test('duplicate across pages and empty intermediate page produce exact unique accounting',async()=>{const r=rig({1:{products:[product('a'),product('b')],total_records:6},2:{products:[],total_records:6},3:{products:[product('b'),product('c')],total_records:6}});const seen=new Set();const out=await syncCategory(cat,cfg,{used:0},seen,r.deps);expect(out.status).toBe('complete');expect([...seen].sort()).toEqual(['a','b','c']);expect(r.imported.sort()).toEqual(['a','b','c']);expect(r.cp.recordPageSuccess).toHaveBeenCalledTimes(3);});
 test('checkpoint resume starts exactly at persisted next_page',async()=>{const r=rig({2:{products:[product('b')],total_records:4}}, {checkpoint:{next_page:2,total_pages:2,total_records:4,completed:false,capped_by_supplier:false}});await syncCategory(cat,cfg,{used:0},new Set(['a']),r.deps);expect(r.deps.fetchProducts).toHaveBeenCalledTimes(1);expect(r.deps.fetchProducts.mock.calls[0][0].page).toBe(2);});
 test('replayed supplier identity is not imported twice',async()=>{const r=rig({1:{products:[product('a'),product('a')],total_records:2}});const seen=new Set();await syncCategory(cat,cfg,{used:0},seen,r.deps);expect(r.imported).toEqual(['a']);});
 test('quota failure records error and does not advance page',async()=>{const r=rig({}, {checkpoint:{next_page:2,total_pages:3,total_records:6,completed:false}});r.deps.fetchProducts.mockRejectedValueOnce(new Error('429 Too Many Requests'));const out=await syncCategory(cat,cfg,{used:0},new Set(),r.deps);expect(out.status).toBe('quota-paused');expect(r.cp.recordError).toHaveBeenCalledTimes(1);expect(r.cp.recordPageSuccess).not.toHaveBeenCalled();});
});
