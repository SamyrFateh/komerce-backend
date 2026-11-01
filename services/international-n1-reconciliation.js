/**
 * @komerce-arch
 * @role          international-shipment-costs-owner
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, admin_actor, shipment_documented_facts
 * @outputs       reconciled_real_costs_per_shipment, financial_closure_evidence
 * @depends       db, crypto
 * @used-by       routes/admin-shipping-customs-workspace.js
 * @db-read       international_shipments, international_shipment_hub_units, hub_physical_units, international_shipment_charges, international_n1_reconciliations, customs_shipments, customs_shipment_fees
 * @db-write      international_n1_reconciliations
 * @db-txn        withTransaction
 * @doctrine      real_facts_per_shipment, no_article_cost_allocation, no_auto_N1, unknown_is_not_zero, idempotent_snapshot
 * @impact-areas  logistics, customs, economic-engine, dashboards
 */
'use strict';
const crypto=require('crypto');
const db=require('../db');
class ReconciliationError extends Error{
  constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
}
const fail=(code,message,status=409)=>{throw new ReconciliationError(code,message,status);};
const cents=v=>{
  if(v==null||!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(v).trim()))
    fail('SHIPMENT_COST_INVALID','Montant invalide : zéro explicite accepté, inconnu non');
  const n=Math.round(Number(v)*100);
  if(!Number.isSafeInteger(n))fail('SHIPMENT_COST_UNSAFE','Montant hors limite sûre');
  return n;
};
const format=n=>(n/100).toFixed(2);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sum=a=>a.reduce((s,x)=>s+x,0);
function netFees(rows){
  const totals=new Map();
  for(const r of rows){
    const key=String(r.fee_type||'').trim();
    totals.set(key,(totals.get(key)||0)+(r.kind==='credit'?-cents(r.amount_kmf):cents(r.amount_kmf)));
  }
  if([...totals.values()].some(v=>v<0))fail('SHIPMENT_COST_NEGATIVE','Avoir supérieur au coût initial');
  return totals;
}
/**
 * Snapshot of documented costs owned by the international dossier. No item
 * or order allocation is attempted, and no pricing or margin writer is called.
 * The financial close is explicit, after the physical relay receipt.
 */
async function reconcile(market,actor,reference,database=db,options={}){
  if(!market?.id||!market?.code||actor?.role!=='admin'||!actor?.id)
    fail('SHIPMENT_COST_FORBIDDEN','Autorité Admin et marché serveur requis',403);
  if(!database||typeof database.withTransaction!=='function')
    throw Error('SHIPMENT_COST_TRANSACTION_REQUIRED');
  const close=options.close===true;
  const closeProof=close?String(options.proof_ref||'').trim():null;
  if(close&&(!closeProof||closeProof.length>240))
    fail('SHIPMENT_COST_CLOSE_PROOF_REQUIRED','Justificatif de clôture économique requis',400);
  return database.withTransaction(async client=>{
    const {rows:[s]}=await client.query(
      'SELECT s.*, cs.is_active AS customs_active, cs.status AS customs_status, cs.freight_kmf AS customs_freight_kmf, cs.customs_paid_kmf, cs.market_id AS customs_market_id '+
      'FROM international_shipments s LEFT JOIN customs_shipments cs ON cs.id=s.customs_shipment_id '+
      'WHERE s.market_id=$1 AND s.reference=$2 FOR UPDATE OF s',[market.id,reference]);
    if(!s)fail('SHIPMENT_COST_NOT_FOUND','Expédition absente sur ce marché',404);
    const {rows:boxes}=await client.query(
      'SELECT h.physical_unit_id,u.market_id,u.state,u.outcome_type FROM international_shipment_hub_units h '+
      'JOIN hub_physical_units u ON u.id=h.physical_unit_id WHERE h.shipment_id=$1 ORDER BY h.physical_unit_id',[s.id]);
    if(!boxes.length||boxes.some(b=>String(b.market_id)!==String(market.id)||b.outcome_type))
      fail('SHIPMENT_COST_BOX_SCOPE','KOM-BOX absentes, hors marché ou en anomalie');
    if(!s.customs_shipment_id||!s.customs_active||String(s.customs_market_id)!==String(market.id))
      fail('SHIPMENT_COST_CUSTOMS_REQUIRED','Dossier douane actif du même marché requis');
    const {rows:[customs]}=await client.query(
      'SELECT id,is_active,freight_kmf,customs_paid_kmf,status FROM customs_shipments '+
      'WHERE id=$1 AND market_id=$2 FOR UPDATE',[s.customs_shipment_id,market.id]);
    if(!customs?.is_active)fail('SHIPMENT_COST_CUSTOMS_INACTIVE','Dossier douane non actif');
    if(customs.freight_kmf!=null&&cents(customs.freight_kmf)>0&&s.freight_invoice_kmf!=null)
      fail('SHIPMENT_COST_DUPLICATE_FREIGHT','Fret déclaré deux fois (transport et douane)');
    const {rows:charges}=await client.query(
      'SELECT id,fee_type,kind,amount_kmf,proof_ref FROM international_shipment_charges '+
      'WHERE shipment_id=$1 ORDER BY recorded_at,id',[s.id]);
    const {rows:customsFees}=await client.query(
      'SELECT id,fee_type,kind,amount_kmf,proof_ref FROM customs_shipment_fees '+
      'WHERE shipment_id=$1 ORDER BY fee_type,proof_ref,id',[s.customs_shipment_id]);
    const transportKinds=new Set(charges.filter(c=>c.fee_type!=='local_transport').map(c=>c.fee_type));
    if(customsFees.some(f=>transportKinds.has(f.fee_type)))
      fail('SHIPMENT_COST_DUPLICATE_FEE_FAMILY','Même famille de frais douane et transport');
    const proofs=new Set([
      ...(s.freight_invoice_ref?[String(s.freight_invoice_ref).trim().toLowerCase()]:[]),
      ...charges.map(c=>String(c.proof_ref).trim().toLowerCase()),
    ]);
    if(customsFees.some(f=>proofs.has(String(f.proof_ref).trim().toLowerCase())))
      fail('SHIPMENT_COST_DUPLICATE_PROOF','Facture ou justificatif enregistré deux fois');
    const freight=s.freight_invoice_kmf==null?null:cents(s.freight_invoice_kmf);
    const customsAmount=customs.customs_paid_kmf==null?null:cents(customs.customs_paid_kmf);
    const feeNets=netFees(charges), customsFeeNets=netFees(customsFees);
    const arrival=sum([...feeNets].filter(([k])=>k!=='local_transport').map(([,v])=>v));
    const local=feeNets.get('local_transport')??null;
    const customsFee=sum([...customsFeeNets.values()]);
    const hasFacts=freight!==null||customsAmount!==null||charges.length>0||customsFees.length>0;
    if(!hasFacts)fail('SHIPMENT_COST_NO_DOCUMENTS','Aucun montant réel documenté');
    // An interim total includes only KNOWN items. Never infer that an absent
    // freight, customs declaration or local transport invoice means zero.
    const documented=sum([freight??0,customsAmount??0,arrival,local??0,customsFee]);
    const missing=[];
    if(freight===null)missing.push('freight');
    if(customsAmount===null)missing.push('customs_duties');
    if(local===null)missing.push('local_transport');
    if(close){
      if(s.stage!=='relay_received')
        fail('SHIPMENT_COST_RELAY_REQUIRED','Réception relais attestée requise pour clôturer');
      if(missing.length)
        fail('SHIPMENT_COST_INCOMPLETE','Postes non documentés : '+missing.join(', '));
    }
    const snapshot=hash({shipment:s.id,market:market.id,stage:s.stage,
      freight:s.freight_invoice_kmf,freightProof:s.freight_invoice_ref,
      customsId:s.customs_shipment_id,customsStatus:customs.status,
      customsAmount:customs.customs_paid_kmf,customsFreight:customs.freight_kmf,
      charges,customsFees,boxIds:boxes.map(b=>b.physical_unit_id)});
    const {rows:[prior]}=await client.query(
      'SELECT snapshot_hash,financial_closed_at FROM international_n1_reconciliations WHERE shipment_id=$1',
      [s.id]);
    if(prior?.snapshot_hash===snapshot&&!close)
      return {reference:s.reference,idempotent:true,status:prior.financial_closed_at?'closed':'partial',
        documented_total_kmf:format(documented),missing,allocation_rows:0,
        freight_kmf:freight===null?null:format(freight),
        customs_kmf:customsAmount===null?null:format(customsAmount),
        arrival_kmf:format(arrival+customsFee),local_kmf:local===null?null:format(local)};
    if(prior?.financial_closed_at&&prior.snapshot_hash!==snapshot&&!close)
      fail('SHIPMENT_COST_CLOSED_CHANGED','Faits corrigés après clôture : réouverture documentée requise');
    await client.query(
      'INSERT INTO international_n1_reconciliations '+
      '(shipment_id,snapshot_hash,total_freight_kmf,total_arrival_kmf,total_local_kmf,allocation_rows,actor_id,freight_known,'+
      'total_customs_kmf,total_customs_fees_kmf,documented_total_kmf,financial_closed_at,financial_closed_by,financial_close_proof_ref) '+
      'VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,CASE WHEN $11::boolean THEN now() ELSE NULL END,$12,$13) '+
      'ON CONFLICT(shipment_id) DO UPDATE SET snapshot_hash=EXCLUDED.snapshot_hash,'+
      'total_freight_kmf=EXCLUDED.total_freight_kmf,total_arrival_kmf=EXCLUDED.total_arrival_kmf,'+
      'total_local_kmf=EXCLUDED.total_local_kmf,allocation_rows=0,actor_id=EXCLUDED.actor_id,'+
      'freight_known=EXCLUDED.freight_known,total_customs_kmf=EXCLUDED.total_customs_kmf,'+
      'total_customs_fees_kmf=EXCLUDED.total_customs_fees_kmf,documented_total_kmf=EXCLUDED.documented_total_kmf,'+
      'financial_closed_at=COALESCE(EXCLUDED.financial_closed_at,international_n1_reconciliations.financial_closed_at),'+
      'financial_closed_by=COALESCE(EXCLUDED.financial_closed_by,international_n1_reconciliations.financial_closed_by),'+
      'financial_close_proof_ref=COALESCE(EXCLUDED.financial_close_proof_ref,international_n1_reconciliations.financial_close_proof_ref),reconciled_at=now()',
      [s.id,snapshot,format(freight??0),format(arrival),format(local??0),String(actor.id),
        freight!==null,format(customsAmount??0),format(customsFee),format(documented),close,String(actor.id),closeProof]);
    return {reference:s.reference,status:close?'closed':'partial',idempotent:false,
      documented_total_kmf:format(documented),missing,allocation_rows:0,
      freight_kmf:freight===null?null:format(freight),
      customs_kmf:customsAmount===null?null:format(customsAmount),
      arrival_kmf:format(arrival+customsFee),local_kmf:local===null?null:format(local),
      financial_closed:close};
  });
}
module.exports={reconcile,ReconciliationError,_internals:{cents,format,hash,netFees}};
