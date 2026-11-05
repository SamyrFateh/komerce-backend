'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { assess, databaseGates, sourceGates, SCOPE } = require('../../scripts/recette/hub-v1-staging-transactional-preflight');

test('checkout atomique actif, mais les trois garde-fous restants bloquent les écritures staging', () => {
  const gates=sourceGates();
  expect(SCOPE).toBe('E2E-HUB-V1');
  expect(gates.find(c=>c.id==='DEDICATED_ATOMIC_CHECKOUT_SCOPE').pass).toBe(true);
  expect(gates.filter(c=>!c.pass).map(c=>c.id)).toEqual(expect.arrayContaining([
    'SIMULATED_CUSTOMER_PAYMENT_PROVIDER_BYPASS_VERIFIED',
    'STAGING_FIXTURE_OWNERSHIP_AND_CLEANUP_CERTIFIED',
    'STAGING_E2E_CROSS_SERVICE_RUNNER_REVIEWED',
  ]));
});

test('la vérification SQL reste dans une transaction READ ONLY avec ROLLBACK', async () => {
  const statements=[];
  const client={
    query:jest.fn(async(sql)=>{
      statements.push(sql);
      if(sql.includes('FROM public.schema_migrations'))return {rows:[
        {filename:'391_hub_sku_physical_codes.sql'},
        {filename:'392_hub_order_bag_ownership.sql'},
        {filename:'393_hub_order_bag_scan_evidence.sql'},
        {filename:'394_hub_packed_bag_box_link.sql'},
        {filename:'395_product_suppliers_unique_active_priority.sql'},
      ]};
      if(sql.includes('FROM public.orders'))return{rows:[{n:0}]};
      if(sql.includes('FROM (SELECT product_id'))return{rows:[{n:0}]};
      if(sql.includes('FROM public.users'))return{rows:[{role:'agent_hub',n:1},{role:'agent_relais',n:1}]};
      return {rows:[]};
    }),
  };
  const out=await databaseGates(client);
  expect(out.every(c=>c.pass)).toBe(true);
  expect(statements[0]).toBe('BEGIN READ ONLY');
  expect(statements.at(-1)).toBe('ROLLBACK');
  expect(statements.slice(1,-1).every(s=>/^\s*SELECT\b/.test(s))).toBe(true);
});

test('le garde refuse tout autre environnement et une version non épinglée avant de toucher à la base', async () => {
  const db={getClient:jest.fn(),query:jest.fn()};
  await expect(assess({db,env:{KOMERCE_ENV:'production',KOMERCE_TARGET_ENV:'production'}})).rejects.toThrow('STAGING_ONLY');
  await expect(assess({db,env:{KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging'}})).rejects.toThrow('PINNED_SHA_REQUIRED');
  expect(db.getClient).not.toHaveBeenCalled();
  expect(db.query).not.toHaveBeenCalled();
});
