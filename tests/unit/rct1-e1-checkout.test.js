'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../services/order-checkout-service',()=>({runOrderCheckout:jest.fn()}));
const {run}=require('../../scripts/recette/rct1-e1-checkout');
function fixture(existing=[]){
 const queries=[];
 const client={query:jest.fn(async(sql)=>{
  queries.push(sql);
  if(sql.includes('FROM orders'))return {rows:existing};
  if(sql.includes('FROM products'))return {rows:[{id:'product-1',product_ref:'RCT1-P1',is_active:true,is_available:true,price_kmf:15000}]};
  if(sql.includes('FROM relais'))return {rows:[{id:'relay-1'}]};
  if(sql.includes('FROM users'))return {rows:[{id:'user-1',full_name:'Recette',phone:'000'}]};
  return {rows:[]};
 }),release:jest.fn()};
 return {db:{pool:{connect:async()=>client}},queries};
}
const env={KOMERCE_ENV:'staging',NODE_ENV:'test',RCT1_E1_USER_ID:'user-1',RCT1_E1_RELAY_ID:'relay-1',RCT1_E1_ADMIN_ID:'admin-1'};
const confirm=async()=>({confirmed:true});
test('E1 dry-run does not invoke checkout or commit',async()=>{
 const {db,queries}=fixture();
 const checkout=jest.fn();
 await expect(run({db,env,confirm,checkout})).resolves.toMatchObject({mode:'DRY_RUN',writes:0});
 expect(checkout).not.toHaveBeenCalled();
 expect(queries[0]).toBe('BEGIN READ ONLY');
 expect(queries.at(-1)).toBe('ROLLBACK');
});
test('E1 apply delegates to canonical checkout with internal scope',async()=>{
 const {db}=fixture();
 const checkout=jest.fn().mockResolvedValue({ok:true,order:{id:'o1',reference:'RCT1-E1',simulation_scope:'RCT1',total_kmf:15000}});
 await expect(run({db,env,confirm,checkout,apply:true})).resolves.toMatchObject({mode:'APPLY',order_id:'o1'});
 expect(checkout.mock.calls[0][0].internalSimulation).toMatchObject({scope:'RCT1',reference:'RCT1-E1',actorId:'admin-1'});
});
test('E1 repeat invocation avoids checkout',async()=>{
 const {db}=fixture([{id:'o1',reference:'RCT1-E1',simulation_scope:'RCT1'}]);
 const checkout=jest.fn();
 await expect(run({db,env,confirm,checkout,apply:true})).resolves.toMatchObject({mode:'REPLAY',writes:0});
 expect(checkout).not.toHaveBeenCalled();
});
test('E1 no staging context means fail closed',async()=>{
 const {db}=fixture();
 await expect(run({db,env:{...env,KOMERCE_ENV:'production'},confirm})).rejects.toThrow('RCT1_STAGING_ONLY');
});
