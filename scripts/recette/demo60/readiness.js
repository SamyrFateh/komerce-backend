'use strict';
/**
 * @komerce-arch-lite
 * @role          demo60-readiness
 * @domain        catalog
 * @layer         script
 * @owner         backend-core
 * @purpose       Audit read-only of durable staging demo products and their publishability.
 * @impact-areas  staging-only, catalog, recette
 */
const manifest = require('./manifest');
const { confirmTarget } = require('../target-guard');
const { inTx } = require('../rct1/engine');

function classify(product, exposures) {
  if (!product) return { status:'MISSING', blockers:['PRODUCT_MISSING'] };
  const blockers=[];
  if (!product.image_url) blockers.push('IMAGE_MISSING');
  if (!product.is_active || !product.is_available) blockers.push('PRODUCT_INACTIVE');
  if (!product.boutique_category_key || !product.boutique_subcategory_key) blockers.push('TAXONOMY_MISSING');
  if (Number(product.stock)<=0) blockers.push('STOCK_UNAVAILABLE');
  if (!exposures.some(x=>x.commercial_exposure==='ENABLED' && x.status==='LOCAL_ACTIVE' && Number(x.amount)>0 && x.is_active)) blockers.push('NO_ACTIVE_MARKET_PRICE_AND_EXPOSURE');
  return { status: blockers.length?'NOT_READY':'CATALOG_READY_FOR_CHECKOUT_PROBE', blockers };
}
async function audit({db,env=process.env,confirm=confirmTarget}={}) {
  if(String(env.KOMERCE_ENV).toLowerCase()!=='staging'||env.NODE_ENV==='production') throw Error('DEMO60_STAGING_ONLY');
  const verified=await confirm({db,env});
  if(!verified?.confirmed) throw Error('DEMO60_TARGET_NOT_CONFIRMED');
  return inTx(db,true,async c=>{
    const refs=manifest.map(p=>p.product_ref);
    const {rows:products}=await c.query(`SELECT id,product_ref,name,is_active,is_available,stock,image_url,boutique_category_key,boutique_subcategory_key
      FROM products WHERE product_ref=ANY($1::text[])`,[refs]);
    const {rows:markets}=await c.query(`SELECT p.product_ref,m.code,m.is_active,d.status,d.amount,e.commercial_exposure
      FROM products p JOIN markets m ON TRUE
      LEFT JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id
      LEFT JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id
      WHERE p.product_ref=ANY($1::text[])`,[refs]);
    const byRef=new Map(products.map(p=>[p.product_ref,p]));
    const perRef=new Map();for(const m of markets){if(!perRef.has(m.product_ref))perRef.set(m.product_ref,[]);perRef.get(m.product_ref).push(m)}
    const rows=manifest.map(p=>({product_ref:p.product_ref,name:p.name,family:p.family_proposed,...classify(byRef.get(p.product_ref),perRef.get(p.product_ref)||[])}));
    const statuses=rows.reduce((acc,r)=>(acc[r.status]=(acc[r.status]||0)+1,acc),{});
    return {phase:'demo60-readiness',scope:'staging',mode:'READ_ONLY',writes:0,target_confirmed:true,total:rows.length,statuses,rows};
  });
}
async function main(){const db=require('../../../db');try{console.log(JSON.stringify(await audit({db}),null,2));}finally{await db.pool.end()}}
if(require.main===module) main().catch(e=>{console.error('DEMO60 REFUS: '+e.message);process.exitCode=1});
module.exports={classify,audit};
