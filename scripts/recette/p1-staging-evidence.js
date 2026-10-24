/**
 * @komerce-arch-lite
 * @role staging-p1-actual-lineage-probe
 * @domain catalog
 * @layer script
 * @owner backend-core
 * @purpose Use the existing Golden canonical read-only authority for one supplier->storefront P1 lineage.
 * @db-read products, sourcing_candidates, import_runtime_runs, markets, product_market_exposure, product_market_price_drafts
 * @db-write none
 * @impact-areas sourcing, catalog, market, e2e-certification, staging-only
 */
'use strict';
const fs=require('fs');
const path=require('path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {projectUpstreamEvidence}=require('../../services/golden-upstream-evidence');
const OUT=path.resolve('test-results/staging-p1/lineage.json');
const URL='https://komerce-backend-production.up.railway.app';
const MARKET=String(process.env.P1_MARKET||'KM').trim().toUpperCase();
const PROVIDED=String(process.env.P1_PRODUCT_REF||'').trim();
const MARKETS=['KM','CM','CG','DJ'];
function assertInputs(env=process.env){
  if(env.KOMERCE_ENV!=='staging'||env.NODE_ENV==='production') throw Error('P1_STAGING_ONLY');
  if(env.STAGING_BASE_URL!==URL) throw Error('P1_HOST_NOT_CONFIRMED');
  if(!MARKETS.includes(MARKET))throw Error('P1_UNKNOWN_MARKET');
  if(PROVIDED&&!/^[A-Za-z0-9][A-Za-z0-9._-]{2,90}$/.test(PROVIDED))throw Error('P1_REF_INVALID');
}
async function findProduct(){
  const select='SELECT p.id,p.product_ref,p.name,p.lifecycle_status,p.is_active,'
    +' sc.candidate_ref,sc.supplier_product_id,sc.state AS candidate_state,r.run_ref'
    +' FROM products p JOIN sourcing_candidates sc ON sc.product_id=p.id'
    +' JOIN import_runtime_runs r ON r.import_id=sc.import_id';
  const filter=PROVIDED?' WHERE p.product_ref=$1':' WHERE r.run_ref IS NOT NULL';
  const tail=' ORDER BY sc.updated_at DESC,p.product_ref ASC LIMIT 1';
  const {rows}=await db.query(select+filter+tail,PROVIDED?[PROVIDED]:[]);
  return rows[0]||null;
}
async function readMarketStates(productId){
  const {rows}=await db.query(
    'SELECT m.code,m.currency,m.is_active,m.lifecycle_status,'
    +' COALESCE(pme.commercial_exposure,\'DISABLED\') AS exposure,'
    +' pp.status AS price_status'
    +' FROM markets m'
    +' LEFT JOIN product_market_exposure pme ON pme.market_id=m.id AND pme.product_id=$1'
    +' LEFT JOIN LATERAL (SELECT status FROM product_market_price_drafts'
    +' WHERE market_id=m.id AND product_id=$1 ORDER BY updated_at DESC LIMIT 1) pp ON TRUE'
    +' WHERE m.code=ANY($2::text[]) ORDER BY m.code',[productId,MARKETS]);
  return rows;
}
function verdictOf(gates){
  const required=['SOURCE_PROVED','REFINERY_PROVED','CATALOG_RELEASE_PROVED','STOREFRONT_PROVED'];
  return Array.isArray(gates)&&gates.length===required.length&&
    required.every(key=>gates.some(g=>g.key===key&&g.status==='PROVED'))
    ?'BACKEND_PROVED':'NOT_PROVEN';
}
async function main(){
  const record={schema_version:1,target:URL,market:MARKET,requested_ref:PROVIDED||null,
    generated_at:new Date().toISOString(),git_sha:process.env.GITHUB_SHA||null,
    verdict:'NOT_PROVEN',identity:null,product:null,market_states:[],gates:[],blocker:null};
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  const save=()=>fs.writeFileSync(OUT,JSON.stringify(record,null,2)+'\n');
  try{
    assertInputs();
    const target=await confirmTarget({db});
    if(!target.confirmed)throw Error('P1_STAGING_IDENTITY_MISMATCH');
    record.identity={target_confirmed:true};
    const versionRes=await fetch(URL+'/health/version',{signal:AbortSignal.timeout(10000)});
    if(!versionRes.ok)throw Error('P1_VERSION_HTTP_'+versionRes.status);
    const runtime=await versionRes.json();
    record.git_sha=runtime.commit||runtime.sha||null;
    const expected=process.env.P1_EXPECTED_DEPLOY_SHA;
    if(expected&&(!record.git_sha||record.git_sha!==expected))throw Error('P1_SHA_NOT_DEPLOYED');
    const product=await findProduct();
    if(!product)throw Error('P1_SOURCE_LINKED_PRODUCT_NOT_FOUND');
    record.product=product;
    record.market_states=await readMarketStates(product.id);
    const source=await projectUpstreamEvidence(db,{
      productId:product.id,marketCode:MARKET,storefrontBaseUrl:URL,fetchImpl:fetch
    });
    record.gates=source.gates;
    record.stage=source.stage;
    record.backend_proof_level=source.proof_level;
    record.verdict=verdictOf(source.gates);
    save();
    console.log(JSON.stringify({ref:product.product_ref,market:MARKET,verdict:record.verdict,
      gates:record.gates.map(g=>({key:g.key,status:g.status,finding:g.finding})),
      evidence_file:OUT}));
    if(record.verdict!=='BACKEND_PROVED')process.exitCode=2;
  }catch(e){
    record.blocker=String(e.code||e.message||e).slice(0,180);
    save();
    console.error('P1_BLOCKED: '+record.blocker);
    process.exitCode=2;
  }finally{await db.pool.end();}
}
if(require.main===module)main();
module.exports={assertInputs,verdictOf};
