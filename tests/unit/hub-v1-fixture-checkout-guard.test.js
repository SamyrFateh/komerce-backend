'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {
  isAllowedHubFixtureReference,extractRun,reserveHubFixtureReference,assertHubFixtureOwnership,
}=require('../../services/hub-v1-fixture-checkout-guard');
const run='ABC12345', ref='E2E-HUB-V1-'+run+'-KOM-101';
const id=(n)=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const fixture={
  reference:ref,
  actorId:id(9),
  user:{id:id(1)},
  body:{relais_id:id(2),payment_mode:'cash_relais',use_wallet:false,
    items:[{product_id:id(3),quantity:2},{product_id:id(4),quantity:1}]},
};
function client(overrides={}){
  const q=jest.fn(async sql=>{
    if(sql.includes('FROM users WHERE id=$1')&&sql.includes('email'))return{rows:[{email:'e2e-hub-v1-abc12345@komerce.test'}]};
    if(sql.includes('FROM users WHERE id=$1')&&sql.includes('role'))return{rows:[{role:'admin'}]};
    if(sql.includes('FROM relais WHERE id='))return{rows:[{name:'E2E-HUB-V1-ABC12345-RELAIS'}]};
    if(sql.includes('FROM products WHERE'))return{rows:[
      {id:id(3),product_ref:'E2E-HUB-V1-ABC12345-A'},
      {id:id(4),product_ref:'E2E-HUB-V1-ABC12345-B'},
    ]};
    if(sql.includes('FROM orders WHERE'))return{rows:[]};
    return{rows:[]};
  });
  return {query:overrides.query||q};
}
test('référence très stricte, pas d activité réelle, ni de scope arbitraire',()=>{
  expect(isAllowedHubFixtureReference(ref)).toBe(true);
  expect(extractRun(ref)).toBe(run);
  for(const bad of [
    'RCT1-C','E2E-HUB-V1-ABC12345-KOM-999','E2E-HUB-V1-ABC12345-KOM-101;DROP',
    'E2E-HUB-V1-AA-KOM-101','E2E-HUB-V1-ABC12345-REAL',
  ])expect(isAllowedHubFixtureReference(bad)).toBe(false);
});
test('réservation atomique et refus du vol de référence réelle',async()=>{
  const c=client();
  expect(await reserveHubFixtureReference(c,ref)).toMatchObject({already:false});
  expect(c.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  expect(c.query.mock.calls[1][0]).toContain('WHERE reference=$1');
  const collision=client({query:jest.fn(async sql=>
    sql.includes('FROM orders WHERE')?{rows:[{simulation_scope:null}]}:{rows:[]})});
  await expect(reserveHubFixtureReference(collision,ref)).rejects.toMatchObject({
    code:'HUB_V1_REFERENCE_COLLIDES_WITH_REAL_ORDER'});
});
test('buyer, admin, relay, products fictifs et cash sans rail externe',async()=>{
  await expect(assertHubFixtureOwnership(client(),fixture)).resolves.toMatchObject({run,product_count:2});
  await expect(assertHubFixtureOwnership(client(),{
    ...fixture,body:{...fixture.body,share_token:'real',tracking_phone:'+2690000'},
  })).rejects.toMatchObject({code:'HUB_V1_FIXTURE_ONLY_NO_PAYMENT_OR_SHARED_CART'});
  await expect(assertHubFixtureOwnership(client(),{
    ...fixture,user:{id:'not-uuid'},
  })).rejects.toMatchObject({code:'HUB_V1_FIXTURE_ONLY_NO_PAYMENT_OR_SHARED_CART'});
  const wrongBuyer=client({query:jest.fn(async sql=>
    sql.includes('SELECT email FROM users')?{rows:[{email:'someone@real.com'}]}:{rows:[]})});
  await expect(assertHubFixtureOwnership(wrongBuyer,fixture)).rejects.toMatchObject({code:'HUB_V1_FIXTURE_BUYER_REQUIRED'});
});
test('checkout ne reçoit jamais simulation_scope par son HTTP public',()=>{
  const fs=require('fs');const path=require('path');
  const checkout=fs.readFileSync(path.join(__dirname,'../../services/order-checkout-service.js'),'utf8');
  const route=fs.readFileSync(path.join(__dirname,'../../routes/orders/create.js'),'utf8');
  expect(checkout).toContain("internalSimulation.scope === 'E2E-HUB-V1'");
  expect(checkout).toContain('assertHubFixtureOwnership(client');
  expect(checkout).toContain('scope: internalSimulation.scope');
  expect(checkout.indexOf('assignOrderSimulationScope(client')).toBeLessThan(checkout.indexOf("await client.query('COMMIT')"));
  expect(route).not.toContain('internalSimulation:');
});
