/** @komerce-arch-lite
 * @role g6-hub-recipe-closure
 * @domain orders
 * @layer service
 * @owner backend-core
 * @purpose Admin-only G6-BUYER closure with physical Hub custody preserved and no PSP or supplier contact.
 * @db-read orders, parcels, hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, hub_box_bags, international_shipment_hub_units
 * @db-write none
 * @db-write-via:order-status-machine orders, order_status_history
 * @db-write-via:parcel-operations parcels
 * @db-write-via:hub-physical-identity hub_physical_units, hub_custody_events
 * @db-txn owned
 * @impact-areas orders, hub, logistics, staging-only
 */
'use strict';
const db=require('../db');
const {transitionOrderStatus}=require('./order-status-machine');
const {transitionParcelStatus}=require('./parcel-operations');
const {transitionPhysicalUnit}=require('./hub-physical-identity');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ELIGIBLE=new Set(['ordered','preparation','shipped','in_transit','available']);
const PARCEL_AT_HUB=new Set(['draft','preparation']);
const HUB_STATES=new Set(['RECEIVED','IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED','PACKED']);
function refusal(status,code,message=code){const e=new Error(message);e.status=status;e.code=code;return e;}
function assertScope(order,actor,reason){
  if(!actor||actor.role!=='admin'||!actor.id)throw refusal(403,'G6_HUB_ADMIN_ONLY');
  if(!order||order.simulation_scope!=='G6-BUYER')throw refusal(403,'G6_HUB_NOT_RECIPE','Commande hors G6-BUYER');
  if(order.payment_mode!=='cash_relais'||Number(order.wallet_applied_kmf||0)!==0)
    throw refusal(409,'G6_HUB_MONEY_UNSAFE','Paiement ou wallet incompatible : aucune compensation implicite');
  if(!ELIGIBLE.has(order.status))throw refusal(409,'G6_HUB_ORDER_STATUS','Commande non éligible à la clôture Hub');
  if(String(reason||'').trim().length<8||String(reason).trim().length>500)
    throw refusal(400,'G6_HUB_REASON_REQUIRED');
}
async function closeG6HubOrder(orderId,{actor,reason}={}){
  if(!UUID.test(String(orderId||'')))throw refusal(400,'G6_HUB_INVALID_ID');
  const client=await db.getClient();
  try{
    await client.query('BEGIN');
    // La mutation passe exclusivement par le SSOT Order Status Machine.
    const {rows:[order]}=await client.query(
      'SELECT id,reference,status,simulation_scope,payment_mode,wallet_applied_kmf FROM orders WHERE id=$1 FOR UPDATE',[orderId]);
    if(!order)throw refusal(404,'G6_HUB_ORDER_NOT_FOUND');
    assertScope(order,actor,reason);
    const why=String(reason).trim();
    const {rows:parcels}=await client.query(
      'SELECT id,status FROM parcels WHERE order_id=$1 ORDER BY id FOR UPDATE',[orderId]);
    if(parcels.some(p=>!PARCEL_AT_HUB.has(p.status)))
      throw refusal(409,'G6_HUB_PARCEL_LEFT_HUB','Un colis a quitté le Hub ou est déjà remis');
    const {rows:units}=await client.query(
      `SELECT DISTINCT u.id,u.state,u.outcome_type
         FROM hub_physical_units u
         JOIN hub_physical_unit_placements hp ON hp.physical_unit_id=u.id AND hp.removed_at IS NULL
         JOIN hub_purchase_allocations a ON a.id=hp.allocation_id
        WHERE a.order_id=$1
        UNION SELECT u.id,u.state,u.outcome_type FROM hub_physical_units u WHERE u.order_id=$1
        ORDER BY id`,[orderId]);
    if(!units.length)throw refusal(409,'G6_HUB_PHYSICAL_PROOF_MISSING','Aucune unité physique Hub vérifiable');
    if(units.some(u=>!HUB_STATES.has(u.state)||u.outcome_type))
      throw refusal(409,'G6_HUB_CUSTODY_UNSAFE','Unités sorties du Hub, en incident ou en quarantaine');
    const ids=units.map(u=>u.id);
    const {rows:shared}=await client.query(
      `SELECT 1 FROM hub_physical_unit_placements hp
        JOIN hub_purchase_allocations a ON a.id=hp.allocation_id
        WHERE hp.physical_unit_id=ANY($1::uuid[]) AND hp.removed_at IS NULL
          AND a.order_id<>$2 LIMIT 1`,[ids,orderId]);
    if(shared.length)throw refusal(409,'G6_HUB_UNIT_SHARED','Unité Hub partagée avec une autre commande');
    const {rows:linked}=await client.query(
      `SELECT 1 FROM hub_box_bags WHERE bag_unit_id=ANY($1::uuid[]) OR box_unit_id=ANY($1::uuid[]) LIMIT 1`,[ids]);
    if(linked.length)throw refusal(409,'G6_HUB_BOX_IMMUTABLE','Sac lié à une KOM-BOX : lien physique immuable, clôture refusée');
    const {rows:shipments}=await client.query(
      'SELECT 1 FROM international_shipment_hub_units WHERE physical_unit_id=ANY($1::uuid[]) LIMIT 1',[ids]);
    if(shipments.length)throw refusal(409,'G6_HUB_SHIPMENT_ASSIGNED','Unité liée à une expédition : clôture refusée');
    // Quarantaine = conservation de la marchandise physique, pas de retour fictif
    // dans le stock vendable ; les unités quittent le flux opérationnel normal.
    for(const unit of units){
      await transitionPhysicalUnit(client,{unitId:unit.id,toState:'QUARANTINED',actorId:actor.id,
        details:{g6_cleanup:true,order_id:orderId,reason:why}});
    }
    for(const parcel of parcels){
      const result=await transitionParcelStatus(client,parcel.id,'cancelled',{cancelReason:'G6-CLEANUP HUB · '+why});
      if(!result.ok)throw refusal(409,'G6_HUB_PARCEL_TRANSITION_REFUSED',result.body?.error);
    }
    const transition=await transitionOrderStatus({orderId,newStatus:'cancelled',actor,source:'cancel',
      cancelReason:'G6-CLEANUP HUB · '+why,
      note:'Clôture recette G6 au Hub · '+why,dbClient:client});
    if(!transition.success||transition.noop)throw refusal(409,'G6_HUB_ORDER_TRANSITION_REFUSED',transition.error);
    if(Number(transition.cancelEffects?.walletReversalAmount||0)>0)
      throw refusal(409,'G6_HUB_WALLET_EFFECT_UNEXPECTED');
    await client.query('COMMIT');
    return {id:orderId,reference:order.reference,status:'cancelled',
      parcels_cancelled:parcels.length,units_quarantined:units.length,external_calls:0,psp_refund:false};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
module.exports={assertScope,closeG6HubOrder};
