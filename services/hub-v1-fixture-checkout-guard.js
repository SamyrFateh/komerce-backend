/**
 * @komerce-arch-lite
 * @role hub-v1-fixture-checkout-guard
 * @domain orders
 * @layer service
 * @owner backend-core
 * @purpose Réserver un checkout simulé Hub V1 (non exposé aux routes clients).
 * @db-read users, relais, products, orders
 * @db-write none
 * @db-txn caller_transaction_preserved
 */
'use strict';

const PATTERN=/^E2E-HUB-V1-([A-Z0-9]{8})-(KOM-101|KOM-102|KOM-103|LOCAL)$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fail=(code)=>Object.assign(new Error(code),{code,status:409});

function isAllowedHubFixtureReference(reference){
  return typeof reference==='string'&&PATTERN.test(reference);
}
function extractRun(reference){
  const m=typeof reference==='string'&&PATTERN.exec(reference);
  if(!m)throw fail('HUB_V1_REFERENCE_NOT_ALLOWED');
  return m[1];
}
async function reserveHubFixtureReference(client,reference){
  extractRun(reference);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[reference]);
  const {rows}=await client.query('SELECT id,reference,simulation_scope FROM orders WHERE reference=$1',[reference]);
  if(rows.length){
    if(rows[0].simulation_scope!=='E2E-HUB-V1')throw fail('HUB_V1_REFERENCE_COLLIDES_WITH_REAL_ORDER');
    return {already:true,order:rows[0]};
  }
  return {already:false};
}
async function assertHubFixtureOwnership(client,{reference,actorId,user,body}={}){
  const run=extractRun(reference);
  const items=body?.items;
  if(!Array.isArray(items)||items.length===0||!UUID.test(user?.id)||!UUID.test(actorId)||
     !UUID.test(body?.relais_id)||body?.payment_mode!=='cash_relais'||
     Boolean(body?.use_wallet)||body?.stripe_payment_intent||body?.share_token||
     body?.tracking_phone){
    throw fail('HUB_V1_FIXTURE_ONLY_NO_PAYMENT_OR_SHARED_CART');
  }
  const ids=[...new Set(items.map(i=>i?.product_id))];
  if(ids.length<1||ids.some(id=>!UUID.test(id)))throw fail('HUB_V1_FIXTURE_PRODUCT_ID_INVALID');
  const {rows:[buyer]}=await client.query('SELECT email FROM users WHERE id=$1',[user.id]);
  if(String(buyer?.email||'').toLowerCase()!==('e2e-hub-v1-'+run+'@komerce.test').toLowerCase()){
    throw fail('HUB_V1_FIXTURE_BUYER_REQUIRED');
  }
  const {rows:[actor]}=await client.query('SELECT role::text AS role FROM users WHERE id=$1',[actorId]);
  if(actor?.role!=='admin')throw fail('HUB_V1_FIXTURE_ADMIN_REQUIRED');
  const {rows:[relay]}=await client.query('SELECT name FROM relais WHERE id=$1',[body.relais_id]);
  if(relay?.name!=='E2E-HUB-V1-'+run+'-RELAIS')throw fail('HUB_V1_FIXTURE_RELAY_REQUIRED');
  const {rows:products}=await client.query(
    'SELECT id,product_ref FROM products WHERE id=ANY($1::uuid[])',[ids]
  );
  if(products.length!==ids.length||
      products.some(p=>!String(p.product_ref||'').startsWith('E2E-HUB-V1-'+run+'-'))){
    throw fail('HUB_V1_FIXTURE_PRODUCTS_REQUIRED');
  }
  return {run,product_count:products.length};
}
module.exports={
  isAllowedHubFixtureReference,extractRun,reserveHubFixtureReference,assertHubFixtureOwnership,
};
