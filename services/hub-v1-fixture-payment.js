/**
 * @komerce-arch-lite
 * @role hub-v1-fixture-payment
 * @domain orders
 * @layer service
 * @owner backend-core
 * @purpose Paiement fictif d'une commande E2E-HUB-V1 : aucune entrée caisse, PSP ou notification.
 * @db-read orders, users
 * @db-write orders, order_status_history (via capacités canoniques)
 * @db-txn same_transaction
 */
'use strict';

const db=require('../db');
const { markPaid }=require('./payment-service');
const { transitionOrderStatus }=require('./order-status-machine');
const { extractRun }=require('./hub-v1-fixture-checkout-guard');

function reject(code){return Object.assign(new Error(code),{code,status:409});}
async function confirmFixturePayment({
  reference,actorId, env=process.env,
  database=db,payment=markPaid,transition=transitionOrderStatus,
}={}){
  if(env.KOMERCE_ENV!=='staging' || env.NODE_ENV!=='test' ||
     env.HUB_V1_E2E_APPLY_MODE!=='approved'){
    throw reject('HUB_V1_FIXTURE_PAYMENT_ENV_FORBIDDEN');
  }
  const run=extractRun(reference);
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(actorId||''))){
    throw reject('HUB_V1_FIXTURE_PAYMENT_ADMIN_REQUIRED');
  }
  const client=await database.getClient();
  let open=false;
  try{
    await client.query('BEGIN');open=true;
    const {rows:[order]}=await client.query(
      'SELECT o.id,o.reference,o.simulation_scope,o.payment_mode,' +
      ' o.payment_status::text AS payment_status,o.status::text AS status,' +
      ' u.email AS buyer_email FROM orders o JOIN users u ON u.id=o.user_id' +
      ' WHERE o.reference=$1 FOR UPDATE OF o',[reference]
    );
    if(!order ||
       order.simulation_scope!=='E2E-HUB-V1' ||
       order.buyer_email?.toLowerCase()!==('e2e-hub-v1-'+run+'@komerce.test').toLowerCase() ||
       order.payment_mode!=='cash_relais'){
      throw reject('HUB_V1_FIXTURE_PAYMENT_OWNERSHIP_MISMATCH');
    }
    const {rows:[actor]}=await client.query('SELECT role::text AS role FROM users WHERE id=$1',[actorId]);
    if(actor?.role!=='admin')throw reject('HUB_V1_FIXTURE_PAYMENT_ADMIN_REQUIRED');

    if(order.payment_status==='paid'&&order.status==='ordered'){
      await client.query('ROLLBACK');open=false;
      return {ok:true,idempotent_replay:true,order_ref:reference,proof:'SIMULATION_ONLY_NO_DEBIT'};
    }
    if(order.payment_status!=='pending'||order.status!=='pending'){
      throw reject('HUB_V1_FIXTURE_PAYMENT_STATE_INVALID');
    }

    // Canonical payment writer; do NOT set cash_paid_at and do NOT write
    // cash_collections / PSP provider references / customer notifications.
    const paid=await payment(order.id,{client,cashPaidAt:false});
    if(!paid?.changed)throw reject('HUB_V1_FIXTURE_PAYMENT_NOT_APPLIED');
    for(const step of ['confirmed','ordered']){
      const result=await transition({
        orderId:order.id,newStatus:step,
        actor:{id:actorId,role:'admin'},
        source:'hub_v1_fixture',dbClient:client,
      });
      if(!result?.success || result.noop || result.newStatus!==step){
        throw reject('HUB_V1_FIXTURE_STATUS_TRANSITION_REFUSED');
      }
    }
    await client.query('COMMIT');open=false;
    return {ok:true,idempotent_replay:false,order_ref:reference,proof:'SIMULATION_ONLY_NO_DEBIT'};
  }catch(error){
    if(open)await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
module.exports={confirmFixturePayment};
