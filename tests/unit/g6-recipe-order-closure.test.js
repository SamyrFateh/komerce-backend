/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
jest.mock('../../db',()=>({getClient:jest.fn()}));
jest.mock('../../services/order-status-machine',()=>({transitionOrderStatus:jest.fn()}));
jest.mock('../../services/parcel-operations',()=>({transitionParcelStatus:jest.fn()}));
jest.mock('../../services/hub-physical-identity',()=>({releaseG6RecipeHubPlacements:jest.fn()}));
const {validateScope,closeG6RecipeAtHub}=require('../../services/g6-recipe-order-closure-service');
const oid='00000000-0000-4000-8000-000000000042';
const actor={id:oid,role:'admin'};
const order={id:oid,status:'preparation',simulation_scope:'G6-BUYER',payment_mode:'cash_relais',wallet_applied_kmf:0};
const reason='Clôture de recette après réception au Hub';
test('garde G6 D : uniquement G6, cash, stage tardif, admin et motif',()=>{
 expect(validateScope(order,actor,reason,false)).toBe(true);
 expect(()=>validateScope({...order,simulation_scope:null},actor,reason,false)).toThrow();
 expect(()=>validateScope({...order,payment_mode:'stripe_eur'},actor,reason,false)).toThrow();
 expect(()=>validateScope({...order,status:'collected'},actor,reason,false)).toThrow();
 expect(()=>validateScope({...order,status:'confirmed'},actor,reason,false)).toThrow();
 expect(validateScope({...order,status:'ordered'},actor,reason,true)).toBe(true);
 expect(()=>validateScope(order,{id:oid,role:'agent_hub'},reason,false)).toThrow();
 expect(()=>validateScope(order,actor,'court',false)).toThrow();
 expect(()=>validateScope({...order,wallet_applied_kmf:50},actor,reason,false)).toThrow();
});
test('garde environnement : aucune mutation hors staging',async()=>{
 const previous=process.env.KOMERCE_ENV;
 process.env.KOMERCE_ENV='production';
 try{await expect(closeG6RecipeAtHub(oid,reason,actor)).rejects.toMatchObject({code:'G6_RECIPE_STAGING_ONLY'});}
 finally{if(previous==null)delete process.env.KOMERCE_ENV;else process.env.KOMERCE_ENV=previous;}
});
test('doctrine SSOT : pas de PSP, aucun fournisseur, protections physiques',()=>{
 const fs=require('fs'),path=require('path');
 const src=fs.readFileSync(path.join(__dirname,'../../services/g6-recipe-order-closure-service.js'),'utf8');
 const hub=fs.readFileSync(path.join(__dirname,'../../services/hub-physical-identity.js'),'utf8');
 const sql=fs.readFileSync(path.join(__dirname,'../../migrations/465_g6_recipe_hub_placement_release.sql'),'utf8');
 expect(src).toContain("source:'cancel'");
 expect(src).toContain('transitionParcelStatus');
 expect(src).toContain('releaseG6RecipeHubPlacements');
 expect(src).toContain('G6_RECIPE_RELAY_RECEIPT_REFUSED');
 expect(src).not.toMatch(/processRefund\(|stripe\.refunds|notifySupplier/);
 expect(hub).toContain("reason_code:'G6_RECIPE_UNSOLD_AT_HUB'");
 expect(hub).toContain("eventType:'PLACEMENT_OUT'");
 expect(sql).toContain("current_setting('komerce.g6_recipe_order_id',true)");
 expect(sql).toContain("o.simulation_scope='G6-BUYER'");
 expect(sql).toContain("o.payment_mode='cash_relais'");
 expect(sql).toContain("hub_physical_unit_content_frozen");
});
