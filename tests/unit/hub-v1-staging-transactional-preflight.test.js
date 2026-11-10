'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { assess, databaseGates, sourceGates, SCOPE } = require('../../scripts/recette/hub-v1-staging-transactional-preflight');

test('sans activation propriétaire, le staging n autorise pas les écritures de recette', () => {
  const gates=sourceGates();
  expect(SCOPE).toBe('E2E-HUB-V1');
  expect(gates.find(c=>c.id==='DEDICATED_ATOMIC_CHECKOUT_SCOPE').pass).toBe(true);
  expect(gates.find(c=>c.id==='SIMULATED_CUSTOMER_PAYMENT_PROVIDER_BYPASS_VERIFIED').pass).toBe(true);
  expect(gates.filter(c=>!c.pass).map(c=>c.id)).toEqual([
    'STAGING_DISPOSABLE_DATA_MODE_CONFIRMED',
    'STAGING_EXISTING_RUNNER_OWNER_AUTHORIZED',
  ]);
});

test('mode jetable owner-only autorise les workflows existants tout en préservant les 4 gardes paiements', () => {
  const owner={
    HUB_V1_STAGING_DISPOSABLE_MODE:'1',
    KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',NODE_ENV:'test',
    EXPECTED_RAILWAY_ENVIRONMENT:'staging',KOMERCE_DISABLE_CRONS:'true',
    HUB_V1_E2E_APPLY_MODE:'approved',
    STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
    GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',
    GITHUB_REPOSITORY_OWNER:'SamyrFateh',GITHUB_ACTOR:'SamyrFateh',GITHUB_EVENT_NAME:'issues',
  };
  const allowed=sourceGates(process.cwd(),owner);
  expect(allowed.every(g=>g.pass)).toBe(true);
  for(const changed of [
    {GITHUB_ACTOR:'other'},{GITHUB_REPOSITORY:'unknown/repo'},
    {KOMERCE_ENV:'production'},{NODE_ENV:'production'},
    {HUB_V1_STAGING_DISPOSABLE_MODE:'0'},{KOMERCE_DISABLE_CRONS:'false'},
    {STAGING_BASE_URL:'https://example.com'},
  ]){
    const g=sourceGates(process.cwd(),{...owner,...changed});
    expect(g.find(x=>x.id==='STAGING_DISPOSABLE_DATA_MODE_CONFIRMED').pass).toBe(false);
  }
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
        {filename:'396_parcel_ref_seq_realign.sql'},
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

test('le préflight staging utilise le SHA applicatif prouvé et non HEAD arbitraire', () => {
  const fs = require('fs');
  const path = require('path');
  const yaml = fs.readFileSync(path.join(__dirname, '../../.github/workflows/hub-v1-staging-transactional-preflight.yml'), 'utf8');
  expect(yaml).toContain('fetch-depth: 0');
  expect(yaml).toContain('node scripts/recette/resolve-staging-deploy-pin.js');
  expect(yaml).toContain('node scripts/recette/hub-v1-staging-transactional-preflight.js');
  expect(yaml).not.toContain('E2E_EXPECTED_DEPLOY_SHA=$(git rev-parse HEAD)');
  expect(yaml).toContain('No-write staging fixture preflight');
});
