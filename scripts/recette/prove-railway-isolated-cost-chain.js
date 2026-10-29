'use strict';
/**
 * LIVE service-level economic E2E on fake CERT candidate ONLY.
 * Performs the same canonical Sourcing category correction & rescan the
 * Catalogue panel triggers. It must fail rather than invent a price.
 * Never reaches real users, supplier APIs, orders, payments or markets.
 */
const {Client}=require('pg');
const sourcing=require('../../services/sourcing-workspace');
const PID='d675d8bd-7452-42f4-8ba5-cf8480959b96';
const EID='abfa50f5-6a56-4df0-88b2-27f7fc652608';
const SID='5b911a75-cd01-484a-ad58-fbd092183fdf';
const reject=(b,code)=>{if(!b)throw Error('CERT_CHAIN_'+code);};
async function main(){
 reject(process.env.RAILWAY_PROJECT_ID===PID,'WRONG_PROJECT');
 reject(process.env.RAILWAY_ENVIRONMENT_ID===EID,'WRONG_ENV');
 reject(process.env.RAILWAY_SERVICE_ID===SID,'WRONG_SERVICE');
 reject(process.env.KOMERCE_DISABLE_CRONS==='true','CRONS_ACTIVE');
 const uri=process.env.DATABASE_URL;
 reject(uri && new URL(uri).hostname.toLowerCase().endsWith('.railway.internal'),'NONPRIVATE_DB');
 const client=new Client({connectionString:uri,connectionTimeoutMillis:12000});
 await client.connect();
 try{
   const marker=await client.query('SELECT source_project,source_environment FROM public.cert_fixture_seed_marker LIMIT 1');
   reject(marker.rows[0]?.source_project===PID&&marker.rows[0]?.source_environment===EID,'FIXTURE_PROOF');
   const {rows:found}=await client.query(`SELECT candidate_ref,state,scan_result,komerce_category
      FROM sourcing_candidates WHERE supplier_name='Fournisseur fictif CERT'
       AND supplier_product_id='CERT-SUP-001' LIMIT 1`);
   reject(found.length===1,'FIXTURE_NOT_FOUND');
   const candidate=found[0];
   if(candidate.komerce_category==='maison'){
     const p=await client.query(`SELECT
       (SELECT COUNT(*)::int FROM sourcing_candidate_events e JOIN sourcing_candidates c ON c.id=e.candidate_id
         WHERE c.candidate_ref=$1 AND e.event_type='scan') AS scans,
       (SELECT COUNT(*)::int FROM products) AS products,
       (SELECT COUNT(*)::int FROM product_market_exposure) AS exposure`,[candidate.candidate_ref]);
     reject(p.rows[0].scans>=1&&p.rows[0].products===0&&p.rows[0].exposure===0,'REPLAY_PROOF_MISSING');
     console.log('CERT_COST_CHAIN_ALREADY_VERIFIED '+JSON.stringify({category:'maison',noPublication:true}));
     return;
   }
   reject(candidate.komerce_category===null && candidate.state==='scanned','NOT_INITIAL_WATCH');
   reject(candidate.scan_result?.commercial_review?.status==='PENDING_CLASSIFICATION','MISSING_CATEGORY_GATE');
   const actor=await client.query("SELECT id FROM users WHERE email='cert-admin@komerce.invalid' AND role='admin'");
   reject(actor.rows.length===1,'ACTOR');
   // Simulated human confirms a valid category from the real active category
   // authority. Actual business service locks, audits and re-scans candidate.
   const result=await sourcing.resolveCandidateCategory(candidate.candidate_ref,'maison',{id:actor.rows[0].id});
   reject(result.category?.key==='maison','CATEGORY_NOT_ACCEPTED');
   reject(result.state==='scanned','NOT_RESCANNED');
   reject(result.scan?.economics?.market_price_decided===false,'MARKET_PRICE_DECIDED');
   const out=await client.query(`SELECT c.komerce_category,c.scan_result,c.product_id,
     (SELECT COUNT(*)::int FROM sourcing_candidate_events e WHERE e.candidate_id=c.id
       AND e.event_type IN ('data_correction','scan')) AS audit_count,
     (SELECT COUNT(*)::int FROM products) AS products,
     (SELECT COUNT(*)::int FROM product_market_exposure) AS exposure
     FROM sourcing_candidates c WHERE c.candidate_ref=$1`,[candidate.candidate_ref]);
   const saved=out.rows[0];
   reject(saved.komerce_category==='maison'&&saved.audit_count>=2,'AUDIT_OR_CATEGORY_MISSING');
   reject(saved.product_id===null&&saved.products===0&&saved.exposure===0,'UNEXPECTED_PUBLICATION');
   reject(saved.scan_result?.sourcing_decision===result.scan?.decision,'MISMATCH_RESCAN');
   const costs=result.scan?.economics||{};
   const complete=['variable_cost_complete_kmf','minimum_safe_price_kmf','test_price_kmf']
     .every(x=>Number(costs[x])>0&&Number.isFinite(Number(costs[x])));
   console.log('CERT_COST_CHAIN_RESULT '+JSON.stringify({
     from:'WATCH_missing_category',to:result.scan?.decision,
     category:'maison',health:costs.health_status,
     costEvidenceComplete:complete,variable_cost_kmf:costs.variable_cost_complete_kmf,
     minimum_safe_price_kmf:costs.minimum_safe_price_kmf,
     test_price_kmf:costs.test_price_kmf,
     eventCount:saved.audit_count,products:saved.products,marketExposure:saved.exposure,
     marketPriceDecided:false,source:'real_canonical_service_on_fake_data'
   }));
   reject(complete,'COST_EVIDENCE_INCOMPLETE');
 }finally{await client.end();}
}
main().then(()=>process.exit(0)).catch(err=>{console.error('CERT_COST_CHAIN_FAILED '+String(err.message||err).slice(0,600));process.exitCode=1;});
