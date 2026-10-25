'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Permanent regression: manual overrides survive successive supplier imports
 * over five typed fields, tested with one generic evaluator on real CI-only
 * PostgreSQL transactions with ROLLBACK; no Railway or live provider writes.
 */
const isolated=process.env.GITHUB_ACTIONS==='true'
  &&process.env.NODE_ENV==='test'
  &&process.env.KOMERCE_DISABLE_CRONS==='true'
  &&process.env.DATABASE_URL==='postgresql://komerce:komerce@localhost:5432/komerce_test';
if(!isolated){
 describe.skip('Sourcing manual provenance — disposable CI PostgreSQL only',()=>{
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
  {field:'estimated_volume_m3',provenance:'volume',first:0.005,edited:0.012,second:0.006,third:0.007},
  {field:'target_margin_pct',provenance:'target_margin',first:30,edited:55,second:32,third:33},
 ];
 function input(supplier,spec,value,round){
  const price=spec.field==='purchase_price'?value:200;
  const category=spec.field==='komerce_category'?value:'maison';
  const weight=spec.field==='estimated_weight_kg'?value:1.25;
  const volume=spec.field==='estimated_volume_m3'?value:0.005;
  const margin=spec.field==='target_margin_pct'?value:30;
  return {
   importId:null,supplierName:supplier,
   product:{
    supplier_product_id:'one-stable-offer',
    product_name:'GOV diagnostic never publish',supplier_category:'Physical product',
    purchase_price:price,currency:'KMF',stock_available:7,min_order_qty:1,
    raw_payload:{round,price,currency:'KMF',category,weight,volume,margin},
   },
   normalized:{
    komerce_category:category,estimated_weight_kg:weight,estimated_volume_m3:volume,
    purchase_price_kmf:price,target_margin_pct:margin,
    data_sources:{purchase_price:'supplier',category:'supplier',weight:'supplier',volume:'supplier',target_margin:'supplier'},
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
   'SELECT id,supplier_product_id,purchase_price,currency,purchase_price_kmf,komerce_category,estimated_weight_kg,estimated_volume_m3,target_margin_pct,data_sources,raw_payload,state FROM sourcing_candidates WHERE id=$1',
   [id]);
  if(!r)throw Error('Candidate disappeared');
  const rawKey=({purchase_price:'price',komerce_category:'category',estimated_weight_kg:'weight',estimated_volume_m3:'volume',target_margin_pct:'margin'})[spec.field];
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
  test(spec.field+' — human correction preserved over two supplier reimports',async()=>{
   const {sequence,evaluation}=await scenario(spec,true);
   const [initial,human,first,second]=sequence.map(x=>x.snapshot);
   expect(initial).toMatchObject({value:spec.first,provenance:'supplier',sourceRound:1});
   expect(human).toMatchObject({value:spec.edited,provenance:'manual'});
   expect(first).toMatchObject({value:spec.edited,provenance:'manual',sourceRound:2});
   expect(second).toMatchObject({value:spec.edited,provenance:'manual',sourceRound:3});
   expect(first.sourceValue).toEqual(spec.second);
   expect(second.sourceValue).toEqual(spec.third);
   expect(evaluation.verdict).toBe('INVARIANT_OBSERVED');
   expect(evaluation.firstViolation).toBeNull();
   expect(evaluation.violations).toHaveLength(0);
   if(spec.field==='purchase_price'){
    expect(human.priceKmf).toBe(spec.edited);
    expect(second.priceKmf).toBe(spec.edited);
    expect(second.currency).toBe('KMF');
   }
   console.log('SOURCING_PROVENANCE_PRESERVED',JSON.stringify({
    field:spec.field,source:spec.provenance,
    initial:initial.value,manual:human.value,
    first:first.value,firstAuthority:first.provenance,
    second:second.value,secondAuthority:second.provenance,
    firstViolation:evaluation.firstViolation,
    violations:evaluation.violations.map(v=>v.kind),
    rawSourcePreserved:second.sourceValue===spec.third,
    classification:'INVARIANT_PROVEN',
   }));
  });
  test(spec.field+' — no manual assertion, supplier refresh is valid',async()=>{
   const {sequence,evaluation}=await scenario(spec,false);
   const [,first,second]=sequence.map(x=>x.snapshot);
   expect(first).toMatchObject({value:spec.second,provenance:'supplier'});
   expect(second).toMatchObject({value:spec.third,provenance:'supplier'});
   expect(evaluation.verdict).toBe('NO_MANUAL_ASSERTION');
   expect(evaluation.violations).toHaveLength(0);
   console.log('SOURCING_PROVENANCE_CONTROL',JSON.stringify({
    field:spec.field,finalValue:second.value,verdict:evaluation.verdict,
   }));
  });
 }
 test('second explicit human correction supersedes the first; raw supplier history continues',async()=>{
  const spec=contracts[0],q=await db.getClient();
  try{
   await q.query('BEGIN');
   const supplier='GOV-MULTI-'+randomUUID();
   const initial=await upsertCandidateFromCatalogImport(q,input(supplier,spec,200,1));
   const id=initial.row.id;
   await updateCandidate(id,{purchase_price:240},null,q);
   await upsertCandidateFromCatalogImport(q,input(supplier,spec,210,2));
   await updateCandidate(id,{purchase_price:260},null,q);
   await upsertCandidateFromCatalogImport(q,input(supplier,spec,220,3));
   const row=await capture(q,id,spec,'supplier_reimport',3);
   expect(row.snapshot).toMatchObject({
    value:260,provenance:'manual',sourceRound:3,sourceValue:220,priceKmf:260,
   });
  } finally {await q.query('ROLLBACK');q.release();}
 });
 afterAll(async()=>db.pool.end());
}
