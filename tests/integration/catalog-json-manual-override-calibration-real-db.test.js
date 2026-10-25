'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Fourth blind-spot hypothesis from WRITER-NOT-OWNER (Catalog -> Sourcing).
 * Exercise two real services against the same database fixture:
 * catalog-import-json.stageCandidate vs sourcing-candidate-import-service.
 * This is a diagnostic, NOT a correction. DB is always ROLLBACKed.
 */
const ci=process.env.GITHUB_ACTIONS==='true'
 &&process.env.NODE_ENV==='test'
 &&process.env.KOMERCE_DISABLE_CRONS==='true'
 &&process.env.DATABASE_URL==='postgresql://komerce:komerce@localhost:5432/komerce_test';
if(!ci){
 describe.skip('Catalog/Sourcing manual override calibration — disposable CI PostgreSQL only',()=>{
  test('skipped',()=>{});
 });
}else{
 const {randomUUID}=require('node:crypto');
 const {Pool}=require('pg');
 const {stageCandidate}=require('../../services/suppliers/catalog-import-json');
 const {upsertCandidateFromCatalogImport}=require('../../services/sourcing-candidate-import-service');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const makeId=()=>randomUUID();
 const ids={candidate:makeId(),batchA:makeId(),batchB:makeId()};
 const supplier='CI Catalog Sourcing '+ids.candidate.slice(0,10);
 const sourceId='SKU-'+ids.candidate.slice(0,12);
 const profile={
   supplier_name:supplier,profile_id:'ci-profile',profile_version:1,
   profile_hash:'ci-hash',source_sha256:'ci-sha',connector_version:'ci-json'
 };
 const entry={
   supplier_product_id:sourceId,contract:{
    product_name:'Fiche importee',supplier_category:'test',
    purchase_price:120,currency:'AED',stock_available:5,
    description:'Source JSON connector'
   },
   status:'READY_FOR_PROMOTION',diagnostics:{findings:[]},
   raw_payload:{supplier_product_id:sourceId}
 };
 let client;
 beforeAll(async()=>{
  client=await pool.connect();
  await client.query('BEGIN');
  await client.query(
   "INSERT INTO supplier_catalog_imports(id,supplier_name,source_type,status,profile_id,profile_version,profile_hash) VALUES($1,$3,'json','COMPLETED','ci-profile',1,'ci-hash'),($2,$3,'json','COMPLETED','ci-profile',1,'ci-hash')",
   [ids.batchA,ids.batchB,supplier]
  );
  await client.query(
   `INSERT INTO sourcing_candidates
      (id,import_id,supplier_name,supplier_product_id,product_name,
       purchase_price,currency,state,data_sources,normalized_source_contract)
    VALUES($1,$2,$3,$4,'Fiche manuelle',100,'AED','normalized','{"purchase_price":"supplier"}'::jsonb,'{}'::jsonb)`,
   [ids.candidate,ids.batchA,supplier,sourceId]
  );
  await client.query('SAVEPOINT original_candidate');
 });
 afterAll(async()=>{
  if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}
  await pool.end();
 });
 async function getActual(){
  const {rows:[row]}=await client.query(
   'SELECT id,import_id,purchase_price,currency,data_sources,state FROM sourcing_candidates WHERE id=$1',
   [ids.candidate]
  );
  const {rows:[events]}=await client.query(
   "SELECT COUNT(*)::int AS n FROM sourcing_candidate_events WHERE candidate_id=$1 AND event_type='data_correction'",
   [ids.candidate]
  );
  return {row,events:Number(events.n)};
 }
 const ownerInput=()=>({
  importId:ids.batchB,supplierName:supplier,
  product:{supplier_product_id:sourceId,product_name:'Fiche importee',
   purchase_price:120,currency:'AED',stock_available:5},
  normalized:{data_sources:{purchase_price:'supplier'},
   komerce_category:null,estimated_weight_kg:null,estimated_volume_m3:null,
   purchase_price_kmf:null,target_margin_pct:null},
  normalizedSourceContract:{product_name:'Fiche importee'},
  scan:{scan_result:{},sourcing_decision:'KEEP',reason:'ci',
    recommended_action:'review',confidence:'low'},
  verdict:{eligible:true},autoState:'normalized',autoRejectedReason:null,userId:null,
 });
 test('NOMINAL: new supplier price refreshes a non-manual candidate',async()=>{
  await client.query('ROLLBACK TO SAVEPOINT original_candidate');
  await stageCandidate(client,ids.batchB,entry,'normalized',profile);
  const {row,events}=await getActual();
  expect(row.id).toBe(ids.candidate);
  expect(Number(row.purchase_price)).toBe(120);
  expect(row.data_sources.purchase_price).toBe('supplier');
  expect(events).toBe(0);
  console.log('CALIBRATION_EVIDENCE '+JSON.stringify({
   caseId:'CATALOG_REIMPORT_MANUAL_OVERRIDE',mode:'NOMINAL',
   service:'catalog-import-json.stageCandidate',db:'POSTGRES_REAL',
   expected:{updatedSupplierPrice:120,manualLock:false},
   observed:{updatedSupplierPrice:Number(row.purchase_price),manualLock:row.data_sources.purchase_price==='manual'},
   invariantOK:true
  }));
 });
 test('DEVIATION: manually locked price is overwritten by the Catalog writer',async()=>{
  await client.query('ROLLBACK TO SAVEPOINT original_candidate');
  await client.query(
   `UPDATE sourcing_candidates SET purchase_price=100,
     data_sources=jsonb_set(data_sources,'{purchase_price}','"manual"'::jsonb)
    WHERE id=$1`,[ids.candidate]
  );
  await stageCandidate(client,ids.batchB,entry,'normalized',profile);
  const {row,events}=await getActual();
  expect(Number(row.purchase_price)).toBe(120); // existing violation, not desired
  expect(row.data_sources.purchase_price).toBe('manual');
  expect(events).toBe(0);
  console.log('CALIBRATION_EVIDENCE '+JSON.stringify({
   caseId:'CATALOG_REIMPORT_MANUAL_OVERRIDE',mode:'DEVIATION',
   service:'catalog-import-json.stageCandidate',db:'POSTGRES_REAL',
   stimulus:'existing sourcing candidate has purchase_price=100 and data_sources.purchase_price=manual',
   expected:{lockedPrice:100,manualLock:true,correctionEvents:1},
   observed:{lockedPrice:Number(row.purchase_price),
     manualLock:row.data_sources.purchase_price==='manual',correctionEvents:events},
   invariantOK:false
  }));
 });
 test('NEGATIVE CONTROL: actual Sourcing owner writer preserves manual price and audits re-import',async()=>{
  await client.query('ROLLBACK TO SAVEPOINT original_candidate');
  await client.query(
   `UPDATE sourcing_candidates SET purchase_price=100,
     data_sources=jsonb_set(data_sources,'{purchase_price}','"manual"'::jsonb)
    WHERE id=$1`,[ids.candidate]
  );
  const result=await upsertCandidateFromCatalogImport(client,ownerInput());
  expect(result.wasUpdated).toBe(true);
  const {row,events}=await getActual();
  expect(Number(row.purchase_price)).toBe(100);
  expect(row.data_sources.purchase_price).toBe('manual');
  expect(events).toBe(1);
 });
}
