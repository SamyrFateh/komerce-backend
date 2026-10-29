'use strict';
/**
 * Canonical supplier handoff proof on one SYNTHETIC candidate in isolated
 * certification DB. Preparation of test source payload is fixture setup,
 * never an operator endpoint. Actual product creation is delegated only to
 * sourcing-workspace / catalog-promotion. No market prices or approvals.
 */
const {Client}=require('pg');
const sourcing=require('../../services/sourcing-workspace');
const PID='d675d8bd-7452-42f4-8ba5-cf8480959b96';
const EID='abfa50f5-6a56-4df0-88b2-27f7fc652608';
const SID='5b911a75-cd01-484a-ad58-fbd092183fdf';
function check(cond,code){if(!cond)throw Error('CERT_HANDOFF_'+code);}
async function main(){
 check(process.env.RAILWAY_PROJECT_ID===PID,'PROJECT');
 check(process.env.RAILWAY_ENVIRONMENT_ID===EID,'ENVIRONMENT');
 check(process.env.RAILWAY_SERVICE_ID===SID,'SERVICE');
 check(process.env.KOMERCE_DISABLE_CRONS==='true','CRONS');
 check(process.env.DATABASE_URL&&new URL(process.env.DATABASE_URL).hostname.toLowerCase().endsWith('.railway.internal'),'PRIVATE_DB');
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
 await client.connect();
 try{
  const marker=await client.query('SELECT source_project,source_environment FROM public.cert_fixture_seed_marker LIMIT 1');
  check(marker.rows[0]?.source_project===PID&&marker.rows[0]?.source_environment===EID,'FIXTURE');
  const {rows:[actor]}=await client.query("SELECT id FROM users WHERE email='cert-admin@komerce.invalid' AND role='admin'");
  check(actor?.id,'ADMIN');
  let {rows:[c]}=await client.query(`SELECT id,candidate_ref,product_id,komerce_category,
    commercial_taxonomy_review FROM sourcing_candidates
    WHERE supplier_name='Fournisseur fictif CERT' AND supplier_product_id='CERT-SUP-002'`);
  check(c,'SOURCE_MISSING');
  const proof=async ()=>{
    const p=await client.query(`SELECT p.id,p.product_ref,p.lifecycle_status,p.is_active,p.is_available,
      p.price_kmf, (SELECT COUNT(*)::int FROM catalog_media m WHERE m.product_id=p.id) AS media_count,
      (SELECT COUNT(*)::int FROM product_market_exposure x WHERE x.product_id=p.id) AS market_count,
      (SELECT COUNT(*)::int FROM catalog_publication_decision_audit a WHERE a.product_id=p.id) AS approval_count
      FROM products p WHERE p.id=$1`,[c.product_id]);
    const row=p.rows[0];
    check(row && row.lifecycle_status==='candidate' && row.is_active===false &&
      row.is_available===false && row.price_kmf===null,'NOT_UNPRICED_DRAFT');
    check(row.market_count===0 && row.approval_count===0,'MARKET_OR_APPROVAL_SIDE_EFFECT');
    check(row.media_count>=1,'MEDIA_NOT_CANONICAL');
    return row;
  };
  if(c.product_id){
    const row=await proof();
    console.log('CERT_HANDOFF_ALREADY_VERIFIED '+JSON.stringify({
      productRef:row.product_ref,media:row.media_count,active:false,priceSet:false,marketExposed:false,
    }));
    return;
  }
  if(c.komerce_category!=='electronics'){
    await sourcing.resolveCandidateCategory(c.candidate_ref,'electronics',{id:actor.id});
  }
  // One explicitly declared Boutique subcategory in synthetic taxonomy.
  await client.query(`INSERT INTO boutique_subcategories
    (id,category_key,key,label,is_active,customs_category_key)
    VALUES (91001,'electronics','supports','Supports & fixations',true,'electronics')
    ON CONFLICT DO NOTHING`);
  const contract={
    schema_version:'2',
    supplier_name:'Fournisseur fictif CERT',
    supplier_product_id:'CERT-SUP-002',
    product_name:'Support téléphone métal',
    supplier_category:'Phone Accessories',
    description:'Support téléphone de certification. Produit de test, non commercial.',
    source_locale:'fr',
    purchase_price:1300,
    currency:'KMF',
    weight_kg:0.25,
    media:[{
      supplier_media_id:'CERT-MEDIA-002',
      url:'https://placehold.co/600x600/png?text=KOMERCE+CERT',
      role:'PRODUCT',alt:'Visuel fictif de certification',display_order:0,
    }],
    option_axes:[],
    sellable_units:[{
      supplier_sku:'CERT-SKU-002', option_values:{},
      purchase_price:1300,currency:'KMF',stock_available:4,
      media_refs:['CERT-MEDIA-002'],
    }],
    raw_payload:{synthetic:true,id:'CERT-SUP-002'},
  };
  await client.query(`UPDATE sourcing_candidates SET normalized_source_contract=$1::jsonb,
       description=$2 WHERE id=$3 AND product_id IS NULL`,
       [JSON.stringify(contract),contract.description,c.id]);
  const state=await client.query('SELECT commercial_taxonomy_review,product_id FROM sourcing_candidates WHERE id=$1',[c.id]);
  const mapped=state.rows[0]?.commercial_taxonomy_review;
  let outcome;
  if(mapped?.status==='CONFIRMED'){
    outcome=await sourcing.promoteCandidate(c.candidate_ref,{enrichment_mode:'source_only'},{id:actor.id});
  }else {
    outcome=await sourcing.confirmCandidateBoutiqueCategory(c.candidate_ref,
      {category:'electronics',subcategory:'supports'},{id:actor.id});
    if(!outcome.draft_created){
      console.log('CERT_HANDOFF_GATE '+JSON.stringify({
        confirmed:outcome.confirmed,errorCode:outcome.handoff_error_code,draftCreated:false
      }));
      throw Error('CERT_HANDOFF_BLOCKED_'+String(outcome.handoff_error_code));
    }
  }
  const {rows:[updated]}=await client.query('SELECT product_id FROM sourcing_candidates WHERE id=$1',[c.id]);
  check(updated?.product_id,'NO_PRODUCT_AFTER_CANONICAL_PROMOTION');
  c={...c,product_id:updated.product_id};
  const row=await proof();
  console.log('CERT_HANDOFF_PASS '+JSON.stringify({
    sourceRef:c.candidate_ref,productRef:row.product_ref,canonicalMedia:row.media_count,
    draft:true,active:false,hasSellingPrice:false,marketExposure:0,approved:false,
    via:'sourcing_to_catalog_canonical',fakeSource:true,
  }));
 }finally{await client.end();}
}
main().then(()=>process.exit(0)).catch(error=>{
 console.error('CERT_HANDOFF_FAILED '+String(error?.message||error).slice(0,650));
 process.exit(1);
});
