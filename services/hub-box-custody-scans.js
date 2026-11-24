/**
 * @komerce-arch
 * @role          hub-box-custody-scan-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        scoped_market, shipment_reference, QR_scan, authenticated_actor
 * @outputs       immutable_per_box_custody_evidence
 * @depends       db, services/hub-opaque-labels
 * @used-by       routes/admin-shipping-customs-workspace.js, services/international-shipment-journey.js
 * @db-read       international_shipments, international_shipment_hub_units, hub_scan_labels, hub_physical_units
 * @db-write      hub_box_custody_scans
 * @db-txn        caller_owned_or_withTransaction
 * @doctrine      scan_is_not_a_transition, dual_party_handover, manifest_complete_before_departure
 */
'use strict';
const db = require('../db');
const labels = require('./hub-opaque-labels');

const STEPS=Object.freeze({
  HUB_HANDOVER:{role:['admin','agent_hub'],stage:'hub_ready'},
  CARRIER_ACCEPTED:{role:['admin','agent_transitaire'],stage:'handed_over',prior:'HUB_HANDOVER'},
  CARRIER_LOADED:{role:['admin','agent_transitaire'],stage:'forwarder_received',prior:'CARRIER_ACCEPTED'},
});
class CustodyError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const deny=(status,code,message)=>{throw new CustodyError(status,code,message);};
function validateActor(actor,step){
  if(!actor||!actor.id||!STEPS[step]?.role.includes(actor.role))
    deny(403,'CUSTODY_ACTOR_FORBIDDEN','Acteur non habilité pour cette opération');
}
async function requireScanCoverage(q,shipmentId,eventType){
  const {rows:[r]}=await q.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE c.id IS NULL)::int AS missing
       FROM international_shipment_hub_units h
       LEFT JOIN hub_box_custody_scans c
         ON c.shipment_id=h.shipment_id AND c.box_unit_id=h.physical_unit_id AND c.event_type=$2
      WHERE h.shipment_id=$1`,
    [shipmentId,eventType]);
  if(!r||!Number(r.total)||Number(r.missing))
    deny(409,'CUSTODY_MANIFEST_INCOMPLETE',
      'Toutes les COMBOX du manifeste doivent être scannées et confirmées : '+(r?.missing??'inconnu')+' manquante(s)');
  return {total:Number(r.total),missing:0};
}
async function confirmBoxScan(market,actor,reference,input={},database=db){
  if(!market?.id)deny(400,'CUSTODY_MARKET_REQUIRED','Marché serveur requis');
  const step=String(input.event_type||'').trim().toUpperCase();
  validateActor(actor,step);
  const proof=String(input.proof_ref||'').trim();
  if(proof.length<3||proof.length>240)deny(400,'CUSTODY_PROOF_REQUIRED','Preuve de scan requise');
  if(input.confirmed!==true)deny(400,'CUSTODY_CONFIRMATION_REQUIRED','Confirmer explicitement le geste après scan');
  const shipmentRef=String(reference||'').trim();
  if(!/^[a-z0-9_.:-]{3,96}$/i.test(shipmentRef))
    deny(400,'CUSTODY_SHIPMENT_INVALID','Référence expédition invalide');
  return database.withTransaction(async q=>{
    const {rows:[shipment]}=await q.query(
      'SELECT id,stage FROM international_shipments WHERE reference=$1 AND market_id=$2 FOR UPDATE',
      [shipmentRef,market.id]);
    if(!shipment)deny(404,'CUSTODY_SHIPMENT_NOT_FOUND','Expédition introuvable');
    if(shipment.stage!==STEPS[step].stage)
      deny(409,'CUSTODY_SHIPMENT_STAGE','Étape non autorisée dans cet état du transport');
    let label;
    try {
      label=await labels.resolveLabel(q,{code:input.qr_code,marketId:market.id});
    }catch(e){
      if(e instanceof labels.LabelError)
        deny(e.status===400?400:404,'CUSTODY_LABEL_INVALID','QR COMBOX introuvable ou illisible');
      throw e;
    }
    if(label.target_type!=='COMBOX')
      deny(409,'CUSTODY_NOT_A_COMBOX','Scanner une étiquette COMBOX, pas ARTICLE');
    const {rows:[box]}=await q.query(
      `SELECT u.id,u.state,u.outcome_type FROM international_shipment_hub_units h
         JOIN hub_physical_units u ON u.id=h.physical_unit_id
        WHERE h.shipment_id=$1 AND u.id=$2 FOR UPDATE OF u`,
      [shipment.id,label.physical_unit_id]);
    if(!box)deny(409,'CUSTODY_BOX_NOT_IN_MANIFEST','COMBOX absente du manifeste');
    if(box.state!=='DISPATCHED'||box.outcome_type)
      deny(409,'CUSTODY_BOX_NOT_DISPATCHED','COMBOX non expédiée du Hub ou en anomalie');
    if(STEPS[step].prior){
      const {rows:prior}=await q.query(
        'SELECT 1 FROM hub_box_custody_scans WHERE shipment_id=$1 AND box_unit_id=$2 AND event_type=$3',
        [shipment.id,box.id,STEPS[step].prior]);
      if(!prior.length)deny(409,'CUSTODY_PRIOR_SCAN_REQUIRED','Confirmation précédente de la COMBOX manquante');
    }
    const {rows:[saved]}=await q.query(
      `INSERT INTO hub_box_custody_scans
         (shipment_id,box_unit_id,label_id,event_type,actor_id,proof_ref)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (shipment_id,box_unit_id,event_type) DO NOTHING
       RETURNING id,occurred_at`,
      [shipment.id,box.id,label.label_id,step,actor.id,proof]);
    if(!saved)deny(409,'CUSTODY_ALREADY_CONFIRMED','Cette COMBOX a déjà été confirmée à cette étape');
    return {shipment_reference:shipmentRef,box_unit_id:box.id,event_type:step,
      occurred_at:saved.occurred_at,confirmed:true};
  });
}
module.exports={STEPS,CustodyError,confirmBoxScan,requireScanCoverage};
