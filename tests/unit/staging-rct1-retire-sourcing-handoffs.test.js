'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('node:fs');
const path=require('node:path');
const {
  EXPECTED, HOST, ISSUE, authorize, verifyRows, verifyAfter,
}=require('../../scripts/recette/staging-rct1-retire-sourcing-handoffs');

const records=EXPECTED.map((item,i)=>({
  ...item, id:'00000000-0000-0000-0000-00000000000'+i,
  supplier_name:'RCT1-FICTIF-recette',
  name:item.supplier_product_id+' Sac de test — FICTIF recette',
  is_active:true, is_available:true, preserved_hash:item.product_ref,
}));

test('exact five source-to-catalog identities match the UI fixture set',()=>{
  expect(EXPECTED).toEqual([
    {supplier_product_id:'RCT1-P1',product_ref:'KSC-000180'},
    {supplier_product_id:'RCT1-P2',product_ref:'KSC-000181'},
    {supplier_product_id:'RCT1-P3',product_ref:'KSC-000182'},
    {supplier_product_id:'RCT1-P4',product_ref:'KSC-000183'},
    {supplier_product_id:'RCT1-P5',product_ref:'KSC-000184'},
  ]);
  expect(()=>verifyRows(records)).not.toThrow();
  expect(()=>verifyRows(records.slice(1))).toThrow('RCT1_SOURCING_COUNT_MISMATCH');
  expect(()=>verifyRows([...records,records[0]])).toThrow('RCT1_SOURCING_COUNT_MISMATCH');
});

test('provenance refuses a real supplier, mismatched product or name',()=>{
  for(const changed of [
    {...records[0],supplier_name:'AliExpress'},
    {...records[0],product_ref:'KPR-000093'},
    {...records[0],name:'Vrai article fournisseur'},
  ]) {
    expect(()=>verifyRows([changed,...records.slice(1)])).toThrow('RCT1_SOURCING_PROVENANCE_UNCONFIRMED');
  }
});

test('owner staging write gate, no production or arbitrary issue',()=>{
  const env={ KOMERCE_ENV:'staging',NODE_ENV:'test',STAGING_BASE_URL:HOST,
    GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'SamyrFateh',
    GITHUB_REPOSITORY_OWNER:'SamyrFateh',GITHUB_ISSUE_TITLE:ISSUE,
    RCT1_SOURCING_RETIRE_CONFIRM:'RETIRE_EXACT_RCT1_SOURCING_FIVE' };
  expect(authorize(env,'--dry-run')).toBe(false);
  expect(authorize(env,'--apply')).toBe(true);
  for(const change of [
    {NODE_ENV:'production'}, {KOMERCE_ENV:'production'},
    {GITHUB_ISSUE_TITLE:'[staging-op] audit-rct1-sourcing-handoffs'},
    {GITHUB_ACTOR:'untrusted'}, {STAGING_BASE_URL:'https://other.example'},
  ]) expect(()=>authorize({...env,...change},'--apply')).toThrow();
});

test('all other fields remain identical; apply proves disabled',()=>{
  const after=records.map(r=>({...r,is_active:false,is_available:false}));
  expect(()=>verifyAfter(records,after,true)).not.toThrow();
  expect(()=>verifyAfter(records,records,false)).not.toThrow();
  expect(()=>verifyAfter(records,records,true)).toThrow('RCT1_SOURCING_NOT_DISABLED');
  expect(()=>verifyAfter(records,after,false)).toThrow('RCT1_SOURCING_DRY_RUN_CHANGED');
  const corrupted=[{...after[0],preserved_hash:'other'},...after.slice(1)];
  expect(()=>verifyAfter(records,corrupted,true)).toThrow('RCT1_SOURCING_OTHER_FIELDS_CHANGED');
});

test('SQL audit never mutates candidate lineage and blocks real orders',()=>{
  const script=fs.readFileSync(path.resolve(__dirname,'../../scripts/recette/staging-rct1-retire-sourcing-handoffs.js'),'utf8');
  expect(script).toContain("WHERE p.product_ref=ANY($1::text[])");
  expect(script).toContain("FROM sourcing_candidates WHERE product_id=p.id");
  expect(script).toContain("sc.supplier_product_id");
  expect(script).toContain("sc.supplier_name");
  expect(script).toContain("o.simulation_scope IS DISTINCT FROM 'RCT1'");
  expect(script).toContain("RCT1_SOURCING_REAL_SOURCE_ASSOCIATED");
  expect(script).toContain("RCT1_SOURCING_REAL_ORDERS_ASSOCIATED");
  expect(script).toContain("await client.query(apply?'COMMIT':'ROLLBACK')");
  expect(script).not.toMatch(/DELETE FROM sourcing_candidates|TRUNCATE|CASCADE/i);
});
