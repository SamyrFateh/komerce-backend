/**
 * @komerce-arch-lite
 * @role staging-p1-one-real-source-inactive-draft
 * @domain sourcing
 * @layer script
 * @owner backend-core
 * @purpose Promote exactly one certified real AliExpress supplier candidate to canonical INACTIVE draft, preserving immutable KIR intake.
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, sourcing_candidate_events, products, product_market_exposure
 * @db-write-via:sourcing-candidate-actions sourcing_candidates, sourcing_candidate_events, products, catalog_media, product_skus
 * @impact-areas sourcing, catalog, staging-only
 */
'use strict';
const fs=require('fs'),path=require('path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {verifyRuntimeRevision}=require('./p1-staging-evidence');
const {promoteCandidate}=require('../../services/sourcing-candidate-actions');
const {evaluateSourcingCandidateOutcome}=require('../../services/sourcing-certification');
const {classifyCandidate}=require('../aliexpress-promote-run-staging');
const HOST='https://komerce-backend-production.up.railway.app';
const RUN_REF='KIR-000009';
const CANDIDATE='b3ee3e1b-1489-43d5-85fd-a5b1b18b594f';
const SUPPLIER_ITEM='1005007360384344';
const RECLASSIFIED='5e655aea-6b8d-46a9-8465-f0395d67fb02';
const ISSUE='[staging-op] p1-promote-one-sourced-inactive-draft';
function authorize(env,mode){
 if(!['--preview','--apply'].includes(mode))throw Error('INVALID_MODE');
 if(env.KOMERCE_ENV!=='staging'||env.NODE_ENV==='production'||env.STAGING_BASE_URL!==HOST)
   throw Error('P1_STAGING_REQUIRED');
 if(mode==='--apply'&&(
   env.P1_DRAFT_SINGLE_APPROVAL!=='APPROVE_INACTIVE_ONLY_KIR_000009'||
   env.GITHUB_EVENT_NAME!=='issues'||
   env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
   !env.GITHUB_ACTOR||env.GITHUB_ISSUE_TITLE!==ISSUE))
   throw Error('P1_EXPLICIT_OPERATOR_APPROVAL_REQUIRED');
 return mode==='--apply';
}
function validateEvolution(run,candidates,items,events){
 const ready=new Set(['ready_for_refinery','catalog_imported']);
 if(run.run_ref!==RUN_REF||String(run.provider).toLowerCase()!=='aliexpress'||
   run.source_type!=='api'||run.intake?.pipeline_status!=='CANONICAL_RESOLVED')
   throw Error('P1_SOURCE_RUN_INVALID');
 if(items.length!==candidates.length)throw Error('P1_IMPORT_ITEMS_NOT_ONE_TO_ONE');
 const seen=new Set(items.map(item=>String(item.candidate_id)));
 if(seen.size!==items.length||candidates.some(x=>!seen.has(String(x.id))))
   throw Error('P1_IMPORT_ITEM_IDENTITIES_MISMATCH');
 const original=items.filter(item=>ready.has(item.outcome)).length;
 const declared=Number(run.intake?.ready_for_refinery);
 if(original!==declared||declared!==12)throw Error('P1_IMMUTABLE_SOURCE_INTAKE_MISMATCH');
 const byId=new Map(items.map(item=>[String(item.candidate_id),item]));
 const transitioned=[];
 let computed=0;
 for(const candidate of candidates){
   const state=evaluateSourcingCandidateOutcome(candidate);
   if(state.sourcing_certified)computed++;
   const initial=ready.has(byId.get(String(candidate.id)).outcome);
   if(initial!==state.sourcing_certified)
     transitioned.push({id:String(candidate.id),from:byId.get(String(candidate.id)).outcome,to:state.outcome});
 }
 if(computed!==13||transitioned.length!==1||transitioned[0].id!==RECLASSIFIED||
    transitioned[0].from!=='deferred'||transitioned[0].to!=='ready_for_refinery')
   throw Error('P1_UNEXPLAINED_READY_DELTA');
 const post=events.filter(e=>new Date(e.created_at)>new Date(run.finished_at));
 if(post.length!==2||post.some(e=>String(e.candidate_id)!==RECLASSIFIED)||
   !post.some(e=>e.event_type==='data_correction'&&e.changes?.komerce_category)||
   !post.some(e=>e.event_type==='scan'&&
     (e.result?.sourcing_decision||e.result?.scan_result?.sourcing_decision)==='TEST'))
   throw Error('P1_POST_RUN_RECLASSIFICATION_NOT_PROVED');
 return {original_ready:original,current_ready:computed,delta:computed-original,
   reason:'CATEGORY_CORRECTION_THEN_TEST_AFTER_IMMUTABLE_IMPORT',transitioned};
}
async function inspect(){
 const run=(await db.query(
   'SELECT id,run_ref,provider,source_type,intake,import_id,finished_at FROM import_runtime_runs WHERE run_ref=$1',
   [RUN_REF])).rows[0];
 if(!run||!run.finished_at)throw Error('P1_MISSING_CLOSED_RUN');
 const candidates=(await db.query(
   'SELECT * FROM sourcing_candidates WHERE import_id=$1 ORDER BY id',[run.import_id])).rows;
 const items=(await db.query(
   'SELECT candidate_id,outcome FROM import_runtime_item_events WHERE run_id=$1 ORDER BY seq',[run.id])).rows;
 const events=(await db.query(
   'SELECT candidate_id,event_type,changes,result,created_at FROM sourcing_candidate_events WHERE candidate_id=ANY($1::uuid[]) ORDER BY created_at,id',
   [candidates.map(x=>x.id)])).rows;
 const evidence=validateEvolution(run,candidates,items,events);
 const candidate=candidates.find(x=>String(x.id)===CANDIDATE);
 if(!candidate||candidate.supplier_product_id!==SUPPLIER_ITEM)
   throw Error('P1_SINGLE_SUPPLIER_IDENTITY_NOT_MATCHED');
 const verdict=evaluateSourcingCandidateOutcome(candidate);
 if(!verdict.outcome_valid||!verdict.sourcing_certified)
   throw Error('P1_SELECTED_CANDIDATE_NOT_CERTIFIED');
 const alreadyLinked=candidate.state==='imported_to_catalog'&&candidate.product_id;
 if(!alreadyLinked&&classifyCandidate(candidate).status!=='promotable')
   throw Error('P1_CANDIDATE_NOT_PROMOTABLE');
 const conflict=(await db.query(
   "SELECT count(*)::int AS n FROM sourcing_candidates "+
   "WHERE lower(supplier_name)='aliexpress' AND supplier_product_id=$1 "+
   "AND product_id IS NOT NULL AND id<>$2",[SUPPLIER_ITEM,CANDIDATE])).rows[0].n;
 if(conflict!==0)throw Error('P1_EXISTING_SUPPLIER_PRODUCT_CONFLICT');
 const affectedDemo=(await db.query(
   "SELECT count(*)::int AS n FROM products WHERE product_ref=ANY($1::text[]) AND is_active=TRUE",
   [Array.from({length:8},(_,i)=>'KPR-'+String(i+84).padStart(6,'0'))])).rows[0].n;
 if(affectedDemo!==0)throw Error('P1_DEMO_PRODUCTS_REACTIVATED');
 return {run,candidate,evidence,alreadyLinked:Boolean(alreadyLinked)};
}
async function verifyDraft(productId){
 const p=(await db.query(
   'SELECT id,product_ref,is_active,is_available,lifecycle_status,price_kmf FROM products WHERE id=$1',
   [productId])).rows[0];
 if(!p||p.is_active!==false||p.is_available!==false||p.lifecycle_status!=='candidate'||
    /^KPR-0000(8[4-9]|9[0-1])$/.test(p.product_ref))
   throw Error('P1_NEW_DRAFT_NOT_INACTIVE');
 const ref=(await db.query(
   'SELECT id,state,product_id FROM sourcing_candidates WHERE id=$1',[CANDIDATE])).rows[0];
 if(ref?.state!=='imported_to_catalog'||String(ref.product_id)!==String(productId))
   throw Error('P1_OWNER_SOURCE_LINK_NOT_COMMITTED');
 const exposed=(await db.query(
   'SELECT count(*)::int AS n FROM product_market_exposure WHERE product_id=$1',[productId])).rows[0].n;
 if(exposed!==0)throw Error('P1_UNEXPECTED_MARKET_EXPOSURE');
 return {product_ref:p.product_ref,product_id:p.id,
   is_active:p.is_active,is_available:p.is_available,lifecycle_status:p.lifecycle_status,
   price_kmf:p.price_kmf,exposures:exposed};
}
async function main(){
 const mode=process.argv[2],outDir=path.resolve('test-results/staging-p1');
 const dest=path.join(outDir,mode==='--apply'?'new-draft-apply.json':'new-draft-preview.json');
 const proof={mode,status:'BLOCKED',source_run:RUN_REF,candidate_id:CANDIDATE,
   supplier_product_id:SUPPLIER_ITEM,created_at:new Date().toISOString(),
   economic_price_market_decision:'NONE',publication:'NONE',writes:0};
 fs.mkdirSync(outDir,{recursive:true});
 try{
   const apply=authorize(process.env,mode);
   const target=await confirmTarget({db});
   if(!target?.confirmed)throw Error('P1_STAGING_FINGERPRINT_MISMATCH');
   const res=await fetch(HOST+'/health/version',{signal:AbortSignal.timeout(10000)});
   if(!res.ok)throw Error('P1_STAGING_SHA_NOT_READABLE');
   const deployed=await res.json();
   proof.git=verifyRuntimeRevision(deployed.commit||deployed.sha,process.env.GITHUB_SHA);
   const original=await inspect();
   proof.accounting=original.evidence;
   proof.previously_promoted=original.alreadyLinked;
   if(!apply){
     proof.status=original.alreadyLinked?'ALREADY_PROMOTED_SAFE':'ONE_INACTIVE_DRAFT_READY_TO_CREATE';
     if(original.alreadyLinked)proof.draft=await verifyDraft(original.candidate.product_id);
   }else{
     const result=original.alreadyLinked?
       {product_id:original.candidate.product_id,already_existing:true}:
       await promoteCandidate(CANDIDATE,{enrichment_mode:'source_only'},null);
     proof.draft=await verifyDraft(result.product_id);
     proof.writes=original.alreadyLinked?0:1;
     proof.status=original.alreadyLinked?'ALREADY_PROMOTED_SAFE':'CREATED_ONE_CANONICAL_INACTIVE_DRAFT';
     const intact=(await db.query(
       'SELECT intake FROM import_runtime_runs WHERE run_ref=$1',[RUN_REF])).rows[0];
     if(Number(intact?.intake?.ready_for_refinery)!==12)
       throw Error('P1_IMMUTABLE_RUN_READY_COUNT_CHANGED');
   }
   console.log(JSON.stringify({status:proof.status,run:RUN_REF,source:SUPPLIER_ITEM,
     evolution:proof.accounting,draft:proof.draft||null,writes:proof.writes}));
 }catch(e){
   proof.status='BLOCKED';
   proof.error=String(e.code||e.message||e).slice(0,230);
   console.error('P1_SINGLE_DRAFT_BLOCKED:'+proof.error);
   process.exitCode=2;
 }finally{
   fs.writeFileSync(dest,JSON.stringify(proof,null,2)+'\n');
   await db.pool.end();
 }
}
if(require.main===module)main();
module.exports={authorize,validateEvolution,CANDIDATE,SUPPLIER_ITEM,RUN_REF};
