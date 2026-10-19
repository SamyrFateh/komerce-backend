/**
 * @komerce-arch-lite
 * @role          rct1-e1-checkout-runner
 * @domain        orders
 * @layer         script
 * @owner         backend-core
 * @purpose       Executer E1 via checkout canonique uniquement sur staging avec prerequis explicites.
 * @impact-areas  staging-only, orders, recette
 */
'use strict';
const { confirmTarget } = require('./target-guard');
const { runOrderCheckout } = require('../../services/order-checkout-service');
const EXPECTED_REF = 'RCT1-E1';
async function run({ db, env = process.env, checkout = runOrderCheckout, confirm = confirmTarget, apply = false }) {
 if(env.KOMERCE_ENV !== 'staging' || env.NODE_ENV === 'production') throw Error('RCT1_STAGING_ONLY');
 if(!env.RCT1_E1_USER_ID || !env.RCT1_E1_RELAY_ID || !env.RCT1_E1_ADMIN_ID) throw Error('RCT1_E1_IDENTITIES_REQUIRED');
 const confirmation = await confirm({ db, env });
 if(!confirmation?.confirmed) throw Error('RCT1_TARGET_NOT_CONFIRMED');
 const client=await db.pool.connect();
 let pre;
 try{
  await client.query('BEGIN READ ONLY');
  const existing=await client.query('SELECT id, reference, simulation_scope FROM orders WHERE reference=$1',[EXPECTED_REF]);
  const products=await client.query('SELECT id, product_ref, is_active, is_available, price_kmf FROM products WHERE product_ref=$1',['RCT1-P1']);
  const relay=await client.query('SELECT id FROM relais WHERE id=$1 AND is_active=TRUE',[env.RCT1_E1_RELAY_ID]);
  const user=await client.query('SELECT id, full_name, phone FROM users WHERE id=$1',[env.RCT1_E1_USER_ID]);
  pre={existing:existing.rows,product:products.rows[0],relay:relay.rows[0],user:user.rows[0]};
  await client.query('ROLLBACK');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
 if(pre.existing.length){
  if(pre.existing.length!==1||pre.existing[0].simulation_scope!=='RCT1')throw Error('RCT1_E1_REFERENCE_COLLISION');
  return {mode:apply?'REPLAY':'DRY_RUN',reference:EXPECTED_REF,already:true,writes:0};
 }
 if(!pre.product||!pre.product.is_active||!pre.product.is_available||Number(pre.product.price_kmf)!==15000||!pre.relay||!pre.user)
  throw Error('RCT1_E1_CANONICAL_PREREQUISITES_MISSING_OR_PRICE_MISMATCH');
 if(!apply)return {mode:'DRY_RUN',reference:EXPECTED_REF,writes:0,ready_for_checkout:true};
 // The service owns the transaction and marks simulation_scope before COMMIT.
 const result=await checkout({
  user:pre.user,
  body:{items:[{product_id:pre.product.id,quantity:1}],relais_id:pre.relay.id,payment_mode:'cash_relais',use_wallet:false},
  internalSimulation:{scope:'RCT1',reference:EXPECTED_REF,actorId:env.RCT1_E1_ADMIN_ID,reason:'RCT1 E1 staging controlled test'}
 });
 if(!result.ok) {
  if(result.body?.code==='RCT1_ORDER_ALREADY_EXISTS')return {mode:'REPLAY',reference:EXPECTED_REF,already:true,writes:0};
  throw Error('RCT1_E1_CHECKOUT_REFUSED: '+JSON.stringify(result.body));
 }
 if(result.order.reference!==EXPECTED_REF || result.order.simulation_scope!=='RCT1')
  throw Error('RCT1_E1_POSTCHECK_SCOPE_VIOLATION');
 return {mode:'APPLY',reference:EXPECTED_REF,order_id:result.order.id,total_kmf:result.order.total_kmf};
}
async function main(){
 const apply=process.argv.includes('--apply');
 const db=require('../../db');
 try{process.stdout.write(JSON.stringify(await run({db,apply}),null,2)+'\n')}
 finally{await db.pool.end()}
}
if(require.main===module)main().catch(e=>{process.stderr.write('RCT1 E1 REFUS: '+e.message+'\n');process.exitCode=1});
module.exports={run};
