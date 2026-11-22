/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {parseM06ManualPurchaseCapture,captureFromEnv}=require('../../scripts/recette/canonical/m06-manual-purchase-capture');

const valid={purchase_proof_ref:'RECU-001',allocations:[
 {seller_label:'Marchand A',channel:'in_person',quantity:1,amount:8,currency:'EUR',proof_ref:'PHOTO-001'},
 {seller_label:'Marchand B',channel:'whatsapp',quantity:2,amount:16,currency:'EUR',proof_ref:'RECU-002'}
]};

describe('G6 M06 operator supplied manual purchase capture',()=>{
 test('has no seller, amount or proof defaults',()=>{
  expect(()=>captureFromEnv({})).toThrow('G6_M06_PURCHASE_CAPTURE_REQUIRED');
 });
 test('derives the confirmed unit cost from the actual allocations',()=>{
  expect(parseM06ManualPurchaseCapture(valid)).toMatchObject({purchase_proof_ref:'RECU-001',
   confirmed_quantity:3,confirmed_unit_price:8,confirmed_currency:'EUR',justified_total:24,
   source:'OPERATOR_SUPPLIED_CAPTURE'});
 });
 test('rejects incomplete quantity, one seller, wrong currency and over commitment',()=>{
  expect(()=>parseM06ManualPurchaseCapture({...valid,allocations:[valid.allocations[0]]}))
   .toThrow('G6_M06_MULTI_SELLER_ALLOCATIONS_REQUIRED');
  expect(()=>parseM06ManualPurchaseCapture({...valid,allocations:valid.allocations.map(x=>({...x,seller_label:'Même vendeur'}))}))
   .toThrow('G6_M06_DISTINCT_SELLERS_REQUIRED');
  expect(()=>parseM06ManualPurchaseCapture({...valid,allocations:valid.allocations.map(x=>({...x,currency:'KMF'}))}))
   .toThrow('G6_M06_PURCHASE_ALLOCATION_INVALID');
  expect(()=>parseM06ManualPurchaseCapture({...valid,allocations:valid.allocations.map(x=>({...x,amount:20}))}))
   .toThrow('G6_M06_PURCHASE_EXCEEDS_COMMITMENT');
 });
 test('requires a reason when four-decimal confirmation rounding changes the actual total',()=>{
  const input={purchase_proof_ref:'RECU-003',allocations:[
   {seller_label:'Marchand A',channel:'in_person',quantity:1,amount:1,currency:'EUR',proof_ref:'PHOTO-003'},
   {seller_label:'Marchand B',channel:'in_person',quantity:2,amount:1,currency:'EUR',proof_ref:'PHOTO-004'}
  ]};
  expect(()=>parseM06ManualPurchaseCapture(input)).toThrow('G6_M06_PURCHASE_VARIANCE_REASON_REQUIRED');
  expect(parseM06ManualPurchaseCapture({...input,variance_reason:'Arrondi du prix pondéré sur le total des reçus.'}))
   .toMatchObject({justified_total:2,variance_reason:'Arrondi du prix pondéré sur le total des reçus.'});
 });
});
