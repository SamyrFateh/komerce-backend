'use strict';
/**
 * Read-only economic quotation for one unpublished canonical Catalogue draft.
 * The authoritative Pricing Engine calculates costs; test confirms no sale
 * price, local activation or product writes were produced. All target IDs
 * restricted to the fake-data certification Railway project.
 */
const {Client}=require('pg');
const pricing=require('../../services/pricing-engine');
const PID='d675d8bd-7452-42f4-8ba5-cf8480959b96';
const EID='abfa50f5-6a56-4df0-88b2-27f7fc652608';
const SID='5b911a75-cd01-484a-ad58-fbd092183fdf';
function check(x,msg){if(!x)throw Error('CERT_PRICING_'+msg);}
async function main(){
 check(process.env.RAILWAY_PROJECT_ID===PID,'PROJECT');
 check(process.env.RAILWAY_ENVIRONMENT_ID===EID,'ENV');
 check(process.env.RAILWAY_SERVICE_ID===SID,'SERVICE');
 check(process.env.KOMERCE_DISABLE_CRONS==='true','CRONS');
 const url=process.env.DATABASE_URL;
 check(url&&new URL(url).hostname.toLowerCase().endsWith('.railway.internal'),'PRIVATE_DB');
 const db=new Client({connectionString:url,connectionTimeoutMillis:12000});
 await db.connect();
 try {
  const marker=await db.query('SELECT source_project,source_environment FROM cert_fixture_seed_marker LIMIT 1');
  check(marker.rows[0]?.source_project===PID&&marker.rows[0]?.source_environment===EID,'MARKER');
  const {rows:[p]}=await db.query(`SELECT p.id,p.product_ref,p.name,p.category,p.cost_kmf,
    p.weight_kg,p.price_kmf,p.is_active,p.lifecycle_status FROM products p
    JOIN sourcing_candidates c ON c.product_id=p.id
    WHERE c.supplier_product_id='CERT-SUP-002' AND c.supplier_name='Fournisseur fictif CERT'`);
  check(p?.id&&p.is_active===false&&p.lifecycle_status==='candidate'&&p.price_kmf===null,'NOT_DRAFT');
  const result=await pricing.recommend({
    product_id:p.id, category:p.category,
    cost_kmf:p.cost_kmf, weight_kg:p.weight_kg, current_price_kmf:0,
    channel:'cash_relais',
  });
  const variable=Number(result.variable_cost_complete_kmf);
  const floor=Number(result.minimum_safe_price_kmf);
  check(variable>0&&Number.isFinite(variable),'NO_VARIABLE_COST');
  check(floor>0&&Number.isFinite(floor),'NO_MINIMUM_SAFE');
  check(result.final_price_kmf==null,'PRICE_WAS_DECIDED');
  const after=await db.query(`SELECT p.is_active,p.price_kmf,p.lifecycle_status,
    (SELECT COUNT(*)::int FROM product_market_exposure x WHERE x.product_id=p.id) AS markets
    FROM products p WHERE id=$1`,[p.id]);
  const state=after.rows[0];
  check(state.is_active===false&&state.price_kmf===null&&state.markets===0,'SIDE_EFFECT');
  console.log('CERT_PRICING_READONLY_PASS '+JSON.stringify({
    productRef:p.product_ref,category:p.category,purchaseCostKmf:Number(p.cost_kmf),
    variableCostKmf:variable,minimumSafePriceKmf:floor,
    testPriceKmf:result.test_price_kmf==null?null:Number(result.test_price_kmf),
    recommendedReferenceKmf:result.recommended_price_kmf==null?null:Number(result.recommended_price_kmf),
    finalPriceDecided:false,marketActivated:false,
    marketExposureCount:state.markets,mode:'authoritative_engine_readonly'
  }));
 }finally{await db.end();}
}
main().then(()=>process.exit(0)).catch(e=>{
 console.error('CERT_PRICING_READONLY_FAILED '+String(e.message||e).slice(0,600));
 process.exit(1);
});
