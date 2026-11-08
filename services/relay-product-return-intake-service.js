/**
 * @komerce-arch
 * @role          relay-product-return-intake-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        assigned_relay_agent, existing_dispute_id, observation, condition, optional_zone
 * @outputs       one_immutable_physical_receipt_per_return_request
 * @depends       db.js, disputes, orders, order_items, relay_product_return_receipts
 * @used-by       routes/relay-dashboard.js
 * @db-read       disputes, orders, order_items, products, relay_product_return_receipts
 * @db-write      relay_product_return_receipts
 * @db-txn        owns_transaction_with_dispute_row_lock
 * @doctrine      no_implicit_refund_no_sellable_stock, physical_custody_is_explicit, relay_scope_from_session
 * @impact-areas  orders, logistics, dashboard, refunds
 * @version       2026-11
 */
'use strict';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONDITIONS=Object.freeze(['sealed','opened','damaged','unknown']);
class ReturnIntakeError extends Error{
  constructor(code,message,status=400){super(message);this.code=code;this.status=status;}
}
const reject=(code,message,status)=>{throw new ReturnIntakeError(code,message,status);};

function requireRelayAgent(actor){
  if(!actor || actor.role!=='agent_relais' || !UUID.test(String(actor.id||'')) ||
     !UUID.test(String(actor.relais_id||'')))
    reject('RETURN_INTAKE_ROLE_FORBIDDEN','Agent affecté à un relais requis.',403);
  return actor.relais_id;
}
function normalizeInput(requestId,condition,zone,observation){
  if(!UUID.test(String(requestId||'')))reject('RETURN_INTAKE_ID_INVALID','Dossier SAV invalide.');
  const conditionCode=String(condition||'unknown').trim();
  if(!CONDITIONS.includes(conditionCode))reject('RETURN_INTAKE_CONDITION_INVALID','État constaté invalide.');
  const storageZone=String(zone||'').trim().toUpperCase()||null;
  if(storageZone && !/^[A-Z]$/.test(storageZone))
    reject('RETURN_INTAKE_ZONE_INVALID','Utiliser une lettre A à Z ou laisser vide.');
  const note=String(observation||'').trim();
  if(note.length<10||note.length>1000)
    reject('RETURN_INTAKE_OBSERVATION_REQUIRED','Constat de 10 à 1000 caractères obligatoire.');
  return {requestId,conditionCode,storageZone,note};
}
/** Physical custody; no mutation of the dispute, order, inventory or wallet. */
async function recordIntake({actor,requestId,condition,zone,observation,db}){
  const relayId=requireRelayAgent(actor);
  const fields=normalizeInput(requestId,condition,zone,observation);
  const client=await db.getClient();
  try{
    await client.query('BEGIN');
    const {rows:[row]}=await client.query(
      `SELECT d.id,d.status,d.type,d.return_quantity,oi.qty_collected,
              o.relais_id,o.simulation_scope,o.reference,p.name AS product_name
         FROM disputes d
         JOIN orders o ON o.id=d.order_id
         JOIN order_items oi ON oi.id=d.return_order_item_id AND oi.order_id=o.id
         JOIN products p ON p.id=oi.product_id
        WHERE d.id=$1 AND o.relais_id=$2 AND o.simulation_scope IS NULL
        FOR UPDATE OF d`,
      [fields.requestId,relayId]
    );
    if(!row || row.type!=='product_return')
      reject('RETURN_INTAKE_NOT_FOUND','Dossier introuvable dans ce relais.',404);
    const {rows:[existing]}=await client.query(
      'SELECT * FROM relay_product_return_receipts WHERE request_id=$1',
      [fields.requestId]
    );
    if(existing){
      if(existing.received_by===actor.id &&
         existing.condition_code===fields.conditionCode &&
         existing.storage_zone===fields.storageZone &&
         existing.observation===fields.note){
        await client.query('COMMIT');
        return {receipt:existing,replayed:true};
      }
      reject('RETURN_INTAKE_ALREADY_RECORDED','Reprise déjà attestée ; la preuve ne peut pas être modifiée.',409);
    }
    if(!['open','processing'].includes(row.status) ||
       Number(row.return_quantity)<1 ||
       Number(row.qty_collected)<Number(row.return_quantity))
      reject('RETURN_INTAKE_NOT_ELIGIBLE','Dossier clos ou quantité non remise au client.',409);

    const {rows:[receipt]}=await client.query(
      `INSERT INTO relay_product_return_receipts
       (request_id,relay_id,quantity,condition_code,storage_zone,observation,received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,request_id,relay_id,quantity,condition_code,storage_zone,
                 observation,received_by,received_at`,
      [fields.requestId,relayId,row.return_quantity,fields.conditionCode,
       fields.storageZone,fields.note,actor.id]
    );
    await client.query('COMMIT');
    return {receipt:{...receipt,order_reference:row.reference,product_name:row.product_name},replayed:false};
  }catch(error){
    await client.query('ROLLBACK');
    if(error.code==='23505')
      reject('RETURN_INTAKE_ALREADY_RECORDED','Reprise déjà attestée.',409);
    if(error.code==='23514' && /RELAY_RETURN_RECEIPT_NOT_ELIGIBLE/.test(String(error.message)))
      reject('RETURN_INTAKE_NOT_ELIGIBLE','La reprise ne correspond pas au dossier et au relais.',409);
    throw error;
  }finally{
    client.release();
  }
}

module.exports={ReturnIntakeError,CONDITIONS,requireRelayAgent,normalizeInput,recordIntake};
