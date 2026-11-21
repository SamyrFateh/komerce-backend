/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {classify,selectMixedBasket,SELLABLE_SQL}=require('../../scripts/recette/canonical/m03-prereq');
const {guard}=require('../../scripts/recette/g6-prereq-probe');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const P=(ref,source,local=0)=>({id:ref,product_ref:ref,price:1000,source_key:source,local_available:local});
const READY=[P('KPR-000100','supplier:a',2),P('KPR-000200','supplier:a'),P('KPR-000201','supplier:b'),P('KPR-000202','supplier:c'),P('KPR-000203','central_hub')];
describe('G6 prereq probe',()=>{
 test('READY when local + >=3 import sources + central hub',()=>{
  const r=classify(READY);
  expect(r.verdict).toBe('M03_READY');
  expect(r.import_sources).toEqual(['central_hub','supplier:a','supplier:b','supplier:c']);
 });
 test('KPR-000165 never counts as local stock (#4757)',()=>{
  const r=classify([P('KPR-000165','supplier:a',3),...READY.slice(1)]);
  expect(r.verdict).toContain('LOCAL_STOCK');
 });
 test('missing parts are named',()=>{
  expect(classify(READY.filter(p=>p.source_key!=='central_hub')).verdict).toBe('M03_MISSING:CENTRAL_HUB_PRODUCT');
  expect(classify([P('KPR-000100','supplier:a',1),P('KPR-000200','supplier:b')]).verdict)
   .toBe('M03_MISSING:IMPORT_SOURCES_1_OF_3+CENTRAL_HUB_PRODUCT+SELLABLE_PRODUCTS_2_OF_4');
 });
 test('SQL is read only and applies the sellable rule',()=>{
  expect(SELLABLE_SQL).toMatch(/LOCAL_ACTIVE/);expect(SELLABLE_SQL).toMatch(/ENABLED/);
  expect(SELLABLE_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
 });
 test('central Hub manual catalogue identity matches runtime supplier fallback, with no invented vendor SKU or stock',()=>{
  // Migration 403: products.procurement_supplier_id is the durable Hub owner;
  // this internal assignment does NOT require a product_suppliers vendor mapping.
  expect(SELLABLE_SQL).toContain('p.procurement_supplier_id');
  expect(SELLABLE_SQL).toContain("s.system_key='central_hub'");
  expect(SELLABLE_SQL).toContain("k.source='MANUAL'");
  expect(SELLABLE_SQL).toContain('k.supplier_order_identity IS NULL');
  expect(SELLABLE_SQL).toContain('k.stock>0');
  expect(SELLABLE_SQL).toContain('h.is_active=TRUE AND h.deleted_at IS NULL');
  // The READ ONLY probe may say PREREQ_READY but only real buyer Chromium proves checkout.
  const manual=P('KPR-000255','central_hub');
  manual.import_ready=true;
  const mix=selectMixedBasket([P('KPR-000241','supplier:a',1),P('KPR-000165','supplier:a'),
    P('KPR-000195','supplier:b'),manual]);
  expect(mix.imports.map(p=>p.source_key)).toEqual(['central_hub','supplier:a','supplier:b']);
  expect(classify([P('KPR-000241','supplier:a',1),P('KPR-000165','supplier:a'),
    P('KPR-000195','supplier:b'),manual]).verdict).toBe('M03_READY');
 });
 test('central Hub catalogue ownership without an active internal manual SKU remains NOT import-ready',()=>{
  const unsold=P('KPR-000255','central_hub');
  unsold.import_ready=false;
  const items=[P('KPR-000241','supplier:a',1),P('KPR-000165','supplier:a'),
    P('KPR-000195','supplier:b'),unsold];
  expect(classify(items).verdict).toContain('IMPORT_SOURCES_2_OF_3');
  expect(()=>selectMixedBasket(items)).toThrow('G6_M03_IMPORT_SOURCES_BELOW_3_GOT_2');
 });
 test('basket selection: 1 local + 3 distinct sources, central hub first',()=>{
  const b=selectMixedBasket(READY);
  expect(b.local.product_ref).toBe('KPR-000100');
  expect(b.imports).toHaveLength(3);
  expect(new Set(b.imports.map(p=>p.source_key)).size).toBe(3);
  expect(b.imports[0].source_key).toBe('central_hub');
 });
 test('basket with fewer than 3 sources is refused',()=>{
  expect(()=>selectMixedBasket(READY.slice(0,3))).toThrow('G6_M03_IMPORT_SOURCES_BELOW_3_GOT_2');
  expect(()=>selectMixedBasket(READY.slice(1))).toThrow('G6_M03_LOCAL_STOCK_PRODUCT_MISSING');
 });
 test('probe guard requires owner, staging and PG read only; workflow has no Chromium nor write',()=>{
  const ok={GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'o',GITHUB_REPOSITORY_OWNER:'o',GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',KOMERCE_ENV:'staging',PGOPTIONS:'-c default_transaction_read_only=on'};
  expect(()=>guard(ok)).not.toThrow();
  expect(()=>guard({...ok,PGOPTIONS:''})).toThrow('G6_PREREQ_PROBE');
  expect(()=>guard({...ok,GITHUB_ACTOR:'x'})).toThrow('G6_PREREQ_PROBE');
  const y=read('.github/workflows/staging-g6-prereq-probe.yml');
  for(const m of ['KM','CM','CG'])expect(y).toContain("'[staging-op] g6-prereq-probe-"+m+"'");
  expect(y).toContain('default_transaction_read_only=on');expect(y).toContain('github.actor == github.repository_owner');
  expect(y).toContain('Undeployed-only drift');expect(y).not.toMatch(/playwright|chromium install/i);
  expect(read('scripts/recette/g6-prereq-probe.js')).toContain('BEGIN READ ONLY');
 });
});
