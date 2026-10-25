'use strict';
/** @test-kind unit @test-runner node @test-requires none */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {getProtectedManualFields,scanUnprotectedManualUpserts,scanManualProvenanceErasingMerges}=require('../../scripts/audits/lib/manual-provenance-detectors');
const read=file=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
const table='sourcing_candidates';
const ownerSource=read('services/sourcing-candidate-import-service.js');
const foreignSource=read('services/suppliers/catalog-import-json.js');
test('manual field authorities derive from real Sourcing owner SQL',()=>{
 const protectedFields=getProtectedManualFields(ownerSource,table);
 assert.ok(protectedFields.includes('purchase_price'));
 assert.ok(!protectedFields.includes('supplier_product_id'));
});
test('foreign Catalog source UPSERT ignores the owner-declared manual price authority',()=>{
 const fields=getProtectedManualFields(ownerSource,table);
 const findings=scanUnprotectedManualUpserts(foreignSource,'services/suppliers/catalog-import-json.js',table,fields);
 assert.ok(findings.some(x=>x.field==='purchase_price' && x.kind==='MANUAL_FIELD_PROVENANCE_IGNORED_BY_UPSERT'));
});
test('actual owner protects manual purchase price — no false positive',()=>{
 const fields=getProtectedManualFields(ownerSource,table);
 const findings=scanUnprotectedManualUpserts(ownerSource,'services/sourcing-candidate-import-service.js',table,fields);
 assert.ok(!findings.some(x=>x.field==='purchase_price'));
});
test('different synthetic table with corresponding manual guard is handled without naming Sourcing',()=>{
 const owned="INSERT INTO offers(name,price) VALUES($1,$2) ON CONFLICT (name) DO UPDATE SET price = CASE WHEN (offers.data_sources->>'price') = 'manual' THEN offers.price ELSE EXCLUDED.price END";
 const unguarded="INSERT INTO offers(name,price) VALUES($1,$2) ON CONFLICT (name) DO UPDATE SET price = EXCLUDED.price WHERE offers.status <> 'locked'";
 assert.deepEqual(getProtectedManualFields(owned,'offers'),['price']);
 assert.equal(scanUnprotectedManualUpserts(unguarded,'catalog/offer.js','offers',['price']).length,1);
 assert.equal(scanUnprotectedManualUpserts(owned,'owner/offer.js','offers',['price']).length,0);
});
test('nonconflict INSERT and unrelated update must not trigger',()=>{
 assert.deepEqual(scanUnprotectedManualUpserts('INSERT INTO sourcing_candidates(purchase_price) VALUES($1)','no-conflict.js',table,['purchase_price']),[]);
});

test('detect a real owner UPSERT erasing its own manual source authority via JSONB merge',()=>{
 const fields=getProtectedManualFields(ownerSource,table);
 const found=scanManualProvenanceErasingMerges(ownerSource,'services/sourcing-candidate-import-service.js',table,fields);
 assert.ok(found.some(x=>x.protectedFields.includes('purchase_price') && x.kind==='MANUAL_PROVENANCE_ERASED_BY_JSONB_MERGE'));
 assert.equal(found.length,1); // one SQL merge site, not one issue per protected field
 const foreign=scanManualProvenanceErasingMerges(foreignSource,'services/suppliers/catalog-import-json.js',table,fields);
 assert.equal(foreign.length,0);
});
test('non-provenance JSONB merge and safe left-side incoming precedence are ignored',()=>{
 const src='INSERT INTO offers(id) VALUES($1) ON CONFLICT (id) DO UPDATE SET data_sources=EXCLUDED.data_sources || offers.data_sources';
 assert.deepEqual(scanManualProvenanceErasingMerges(src,'offers-owner.js','offers',['price']),[]);
});
