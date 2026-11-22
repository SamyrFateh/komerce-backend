/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const {centralHubIdentity,explicitSupplierProvenance}=require('../../scripts/recette/canonical/n34-source-oracles');
const HUB='11111111-1111-4111-8111-111111111111';
const REAL='22222222-2222-4222-8222-222222222222';
const PRODUCT='33333333-3333-4333-8333-333333333333';
const CANDIDATE='44444444-4444-4444-8444-444444444444';
const hub={id:HUB,name:'Fournisseur central Hub',platform:'local',
 owner_scope:'hub',auto_order:false,is_active:true,deleted_at:null};
const record={product_id:PRODUCT,procurement_supplier_id:REAL,
 system_key:null,is_active:true,deleted_at:null,candidate_id:CANDIDATE,
 candidate_supplier_id:REAL};
const db=rows=>({query:jest.fn().mockResolvedValue({rows})});

describe('G6 N34 independent PG readback — not a Chromium scenario pass',()=>{
 test('N34a: canonical central Hub is unique, protected-shaped and remains read-only',async()=>{
  const q=db([hub]);
  await expect(centralHubIdentity(q)).resolves.toEqual({
   central_hub_id:HUB,identity_unchanged:true,rows:1,db_write:false
  });
  expect(q.query).toHaveBeenCalledTimes(1);
  expect(q.query.mock.calls[0][0]).toContain("WHERE system_key='central_hub'");
  expect(q.query.mock.calls[0][0].trim().startsWith('SELECT')).toBe(true);
  for(const bad of [[],[hub,hub],[{...hub,is_active:false}],[{...hub,deleted_at:'now'}],
   [{...hub,auto_order:true}],[{...hub,owner_scope:'market'}]]){
   await expect(centralHubIdentity(db(bad))).rejects.toThrow(/G6_N34_CENTRAL_HUB_/);
  }
 });
 test('N34b: explicit real supplier stays on candidate and published product',async()=>{
  const q=db([record]);
  await expect(explicitSupplierProvenance(q,{
   productId:PRODUCT,candidateId:CANDIDATE,expectedSupplierId:REAL
  })).resolves.toMatchObject({selected_supplier_id:REAL,preserved:true,db_write:false});
  expect(q.query.mock.calls[0][1]).toEqual([PRODUCT,CANDIDATE]);
  for(const bad of [[{...record,procurement_supplier_id:HUB}],
   [{...record,candidate_supplier_id:HUB}],[{...record,system_key:'central_hub'}],
   [{...record,is_active:false}],[]]){
    await expect(explicitSupplierProvenance(db(bad),{
     productId:PRODUCT,candidateId:CANDIDATE,expectedSupplierId:REAL
    })).rejects.toThrow(/G6_N34_EXPLICIT_SOURCE_/);
  }
 });
 test('N34b never resolves missing or invalid provenance by falling back to Hub',async()=>{
  const q=db([record]);
  await expect(explicitSupplierProvenance(q,{
   productId:PRODUCT,candidateId:'',expectedSupplierId:REAL
  })).rejects.toThrow('G6_N34_EXPLICIT_SOURCE_IDS_REQUIRED');
  expect(q.query).not.toHaveBeenCalled();
 });
});
