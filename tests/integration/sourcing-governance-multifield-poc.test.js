'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * One generic detector challenged on THREE unrelated fields using real
 * governance owners, real SQL services and CI-only rollback transactions.
 * No publication, provider API, payment or Railway writes.
 */
const isolated=process.env.GITHUB_ACTIONS==='true'
  &&process.env.NODE_ENV==='test'
  &&process.env.KOMERCE_DISABLE_CRONS==='true'
  &&process.env.DATABASE_URL==='postgresql://komerce:komerce@localhost:5432/komerce_test';
if(!isolated){
 describe.skip('GOV source-provenance multi-field — CI disposable Postgres only',()=>{
  test('no non-isolated writes',()=>{});
 });
}else{
 const {randomUUID}=require('node:crypto');
 const db=require('../../db');
 const feature=require('../../features/sourcing.feature');
 const {updateCandidate}=require('../../services/sourcing-candidate-actions');
 const {upsertCandidateFromCatalogImport}=require('../../services/sourcing-candidate-import-service');
 const {evaluateAuthorityTrace}=require('../../scripts/audits/evaluate-provenance-invariant');
 jest.setTimeout(30000);
 // Field contracts come from owner updateCandidate.sourceUpdates and import
 // upsert CASE clauses; detector itself has no awareness of these field names.
 const contracts=[
  {field:'purchase_price',provenance:'purchase_price',first:200,edited:240,second:210,third:220},
  {field:'komerce_category',provenance:'category',first:'maison',edited:'electronique',second:'beaute',third:'jardin'},
  {field:'estimated_weight_kg',provenance:'weight',first:1.25,edited:2.5,second:1.8,third:1.95},
 ];
 function input(supplier,spec,value,round){
  const price=spec.field==='purchase_price'?value:200;
  const category=spec.field==='komerce_category'?value:'maison';
  const weight=spec.field==='estimated_weight_kg'?value:1.25;
  return {
   importId:null,supplierName:supplier,
   product:{
    supplier_product_id:'one-stable-offer',
    product_name:'GOV diagnostic never publish',supplier_category:'Physical product',
    purchase_price:price,currency:'KMF',stock_available:7,min_order_qty:1,
    raw_payload:{round,price,currency:'KMF',category,weight},
   },
   normalized:{
    komerce_category:category,estimated_weight_kg:weight,estimated_volume_m3:0.005,
    purchase_price_kmf:price,target_margin_pct:30,
    data_sources:{purchase_price:'supplier',category:'supplier',weight:'supplier',target_margin:'supplier'},
    confidence:'high',
   },
   normalizedSourceContract:null,
   scan:{
    scan_result:{provider_round:round},sourcing_decision:'WATCH',
    reason:'GOV diagnostic only',recommended_action:'review',confidence:'high',
   },
   verdict:null,autoState:'scanned',autoRejectedReason:null,userId:null,
  };
 }
 async function capture(q,id,spec,action,round){
  const {rows:[r]}=await q.query(
   'SELECT id,supplier_product_id,purchase_price,currency,purchase_price_kmf,komerce_category,estimated_weight_kg,data_sources,raw_payload,state FROM sourcing_candidates WHERE id=$1',
   [id]);
  if(!r)throw Error('Candidate disappeared');
  const rawKey=spec.field==='purchase_price'?'price':spec.field==='komerce_category'?'category':'weight';
  return {
   id:round,action,
   snapshot:{
    value:r[spec.field],provenance:r.data_sources?.[spec.provenance],
    identity:r.supplier_product_id,currency:r.currency,priceKmf:r.purchase_price_kmf,
    sourceRound:r.raw_payload?.round,sourceValue:r.raw_payload?.[rawKey],
   },
  };
 }
 async function scenario(spec,manual){
  const q=await db.getClient();
  let begun=false;
  try{
   await q.query('BEGIN');begun=true;
   const supplier='GOV-POC-MULTI-'+randomUUID();
   const initial=await upsertCandidateFromCatalogImport(q,input(supplier,spec,spec.first,1));
   const id=initial.row.id;
   const sequence=[await capture(q,id,spec,'supplier_reimport','initial')];
   if(manual){
    await updateCandidate(id,{[spec.field]:spec.edited},null,q);
    sequence.push(await capture(q,id,spec,'human_override','human'));
   }
   for(const [round,value] of [[2,spec.second],[3,spec.third]]){
    const next=await upsertCandidateFromCatalogImport(q,input(supplier,spec,value,round));
    expect(next.row.id).toBe(id);
    sequence.push(await capture(q,id,spec,'supplier_reimport',round));
   }
   return {
    sequence,
    evaluation:evaluateAuthorityTrace({
     entity:String(id),field:'value',sourceField:'provenance',
     expectedAuthority:'manual',sequence,
    }),
   };
  }finally{
   if(begun)await q.query('ROLLBACK');
   q.release();
  }
 }
 test('Gouvernance : same owner and DB for human and supplier mutation',()=>{
  expect(feature.name).toBe('sourcing');
  expect(feature.db.tables).toContain('sourcing_candidates: RW!');
  expect(feature.files.services).toEqual(expect.arrayContaining([
   'services/sourcing-candidate-import-service.js',
   'services/sourcing-candidate-actions.js',
  ]));
 });
 for(const spec of contracts){
  test(spec.field+' — human correction lost after two supplier reimports',async()=>{
   const {sequence,evaluation}=await scenario(spec,true);
   const [initial,human,first,second]=sequence.map(x=>x.snapshot);
   expect(initial).toMatchObject({value:spec.first,provenance:'supplier',sourceRound:1});
   expect(human).toMatchObject({value:spec.edited,provenance:'manual'});
   expect(first).toMatchObject({value:spec.edited,provenance:'supplier',sourceRound:2});
   expect(second).toMatchObject({value:spec.third,provenance:'supplier',sourceRound:3});
   expect(first.sourceValue).toEqual(spec.second);
   expect(second.sourceValue).toEqual(spec.third);
   expect(evaluation.verdict).toBe('CONTRADICTION_OBSERVED');
   expect(evaluation.firstViolation).toMatchObject({
    kind:'AUTHORITY_MARKER_OVERWRITTEN',at:2,
   });
   expect(evaluation.violations).toEqual(expect.arrayContaining([
    expect.objectContaining({kind:'MANUAL_VALUE_OVERWRITTEN',at:3}),
   ]));
   if(spec.field==='purchase_price'){
    expect(human.priceKmf).toBe(spec.edited);
    expect(second.priceKmf).toBe(spec.third);
    expect(second.currency).toBe('KMF');
   }
   console.log('GOV_MULTIFIELD_PROOF',JSON.stringify({
    field:spec.field,source:spec.provenance,
    initial:initial.value,manual:human.value,
    first:first.value,firstAuthority:first.provenance,
    second:second.value,secondAuthority:second.provenance,
    firstViolation:evaluation.firstViolation,
    violations:evaluation.violations.map(v=>v.kind),
    rawSourcePreserved:second.sourceValue===spec.third,
    classification:'BUG_REPRODUCED_NOT_FIXED',
   }));
  });
  test(spec.field+' — no manual assertion, supplier refresh is valid',async()=>{
   const {sequence,evaluation}=await scenario(spec,false);
   const [,first,second]=sequence.map(x=>x.snapshot);
   expect(first).toMatchObject({value:spec.second,provenance:'supplier'});
   expect(second).toMatchObject({value:spec.third,provenance:'supplier'});
   expect(evaluation.verdict).toBe('NO_MANUAL_ASSERTION');
   expect(evaluation.violations).toHaveLength(0);
   console.log('GOV_MULTIFIELD_CONTROL',JSON.stringify({
    field:spec.field,finalValue:second.value,verdict:evaluation.verdict,
   }));
  });
 }
 afterAll(async()=>db.pool.end());
}
