/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
jest.mock('../../services/routing',()=>({
 isRelaisRoutable:jest.fn(r=>Boolean(r.zone||r.island_code)),
}));
jest.mock('../../services/catalog-certification',()=>({
 certifyCatalogProduct:jest.fn(),
}));
const {certifyCatalogProduct}=require('../../services/catalog-certification');
const {isRelaisRoutable}=require('../../services/routing');
const {branchFor,readRouteAvailability,assertRouteMissing,assertSupplierPublicationBlocked}=require('../../scripts/recette/canonical/g5a-negative-branches');

describe('G6-G5A — branches métier N03 et N05',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('N03 et N05 refusent les branches inattendues, sans fallback silencieux',()=>{
  expect(branchFor('N03',null)).toBe('SUSPENDED');
  expect(branchFor('N03','ROUTE_MISSING')).toBe('ROUTE_MISSING');
  expect(branchFor('N05','SOI_INCOMPLETE')).toBe('SOI_INCOMPLETE');
  expect(()=>branchFor('N03','SOI_INCOMPLETE')).toThrow('BRANCH_UNSUPPORTED');
  expect(()=>branchFor('N05','ROUTE_MISSING')).toThrow('BRANCH_UNSUPPORTED');
 });
 test('N03 : route disponible seulement si le backend juge au moins un relais routable',async()=>{
  const query=jest.fn()
   .mockResolvedValueOnce({rows:[{id:'m-1',lifecycle_status:'ACTIVE'}]})
   .mockResolvedValueOnce({rows:[
    {id:'r-1',market_code:'CM',zone:null,island_code:null},
    {id:'r-2',market_code:'CM',zone:'',island_code:null},
   ]});
  const value=await readRouteAvailability({query},'CM');
  expect(value).toEqual({
   market_lifecycle:'ACTIVE',active_relays:2,routable_relays:0,route_available:false,
   resolution:'CANONICAL_IS_RELAIS_ROUTABLE',
  });
  expect(assertRouteMissing(value)).toEqual(value);
  expect(isRelaisRoutable).toHaveBeenCalledTimes(2);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][1]).toEqual(['CM']);
  expect(query.mock.calls[1][1]).toEqual(['m-1']);
  expect(()=>assertRouteMissing({...value,routable_relays:1,route_available:true})).toThrow('PREREQ_MISSING_ROUTE_ABSENT');
  expect(()=>assertRouteMissing({...value,market_lifecycle:'SUSPENDED'})).toThrow('PREREQ_MISSING_ROUTE_ABSENT');
 });
 test('N03 : refus de route absente inventée lorsqu’un relais est routable',async()=>{
  const query=jest.fn()
   .mockResolvedValueOnce({rows:[{id:'m-1',lifecycle_status:'ACTIVE'}]})
   .mockResolvedValueOnce({rows:[{id:'r-3',zone:'Brazzaville',market_code:'CG'}]});
  const value=await readRouteAvailability({query},'CG');
  expect(value.route_available).toBe(true);
  expect(()=>assertRouteMissing(value)).toThrow('PREREQ_MISSING_ROUTE_ABSENT');
 });
 const candidate=(qty,complete,reasons)=>({
  row:{lifecycle_status:'candidate',active_supplier_skus:qty,complete_supplier_skus:complete},
  certification:{certified:false,reasons},
 });
 test('N05 sans SKU actif : certificat canonique refuse la publication',async()=>{
  certifyCatalogProduct.mockResolvedValue(candidate(0,0,['active_supplier_sku_missing']));
  await expect(assertSupplierPublicationBlocked({query:jest.fn()},'product-1','NO_ACTIVE_SKU'))
   .resolves.toMatchObject({sku_complete:false,certification_verdict:'BLOCKED',certification_rule:'active_supplier_sku_missing'});
  expect(certifyCatalogProduct).toHaveBeenCalledWith(expect.objectContaining({query:expect.any(Function)}),
   'product-1',{requireSupplierSku:true});
 });
 test('N05 SOI incomplet : SKU actif, identité fournisseur incomplète et refus de certification',async()=>{
  certifyCatalogProduct.mockResolvedValue(candidate(2,1,['supplier_order_identity_incomplete']));
  const p=await assertSupplierPublicationBlocked({query:jest.fn()},'product-1','SOI_INCOMPLETE');
  expect(p).toMatchObject({sku_complete:true,soi_complete:false,active_supplier_skus:2,complete_supplier_skus:1});
  certifyCatalogProduct.mockResolvedValue(candidate(2,2,['supplier_mapping_missing']));
  await expect(assertSupplierPublicationBlocked({query:jest.fn()},'product-1','SOI_INCOMPLETE'))
   .rejects.toThrow('PREREQ_MISSING_SUPPLIER_ORDER_IDENTITY_INCOMPLETE');
  certifyCatalogProduct.mockResolvedValue({row:{lifecycle_status:'active'},certification:{certified:true,reasons:[]}});
  await expect(assertSupplierPublicationBlocked({query:jest.fn()},'product-1','SOI_INCOMPLETE'))
   .rejects.toThrow('PREREQ_MISSING_CANDIDATE_CERTIFICATION');
 });
});
