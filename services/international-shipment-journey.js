/**
 * @komerce-arch
 * @role international-shipment-journey-owner
 * @domain logistics
 * @layer service
 * @criticality high
 * @inputs authenticated_actor, server_resolved_market, physical_evidence, real_invoices
 * @outputs immutable_shipment_facts, read_only_cost_reconciliation
 * @db-read international_shipments, international_shipment_parcels, international_shipment_hub_units, hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, international_shipment_charges, international_shipment_events, parcels, orders, customs_shipments, customs_shipment_parcels, customs_shipment_fees, international_n1_reconciliations
 * @db-write international_shipments, international_shipment_hub_units, international_shipment_events, international_shipment_charges, customs_shipments
 * @db-txn withTransaction
 * @doctrine market_scope_server_owned, fact_not_financial_allocation, no_customs_clearance_inferred
 */
'use strict';
const db = require('../db');
const boxShipment = require('./hub-box-shipment-service');
const STAGES = Object.freeze(['hub_ready','handed_over','forwarder_received','in_transit','arrived',
  'customs_released','local_delivery','relay_received']);
const STAGE_ROLES = Object.freeze({
  handed_over:['admin','agent_hub'],forwarder_received:['admin','agent_transitaire'],
  in_transit:['admin','agent_transitaire'],arrived:['admin','agent_transitaire'],
  customs_released:['admin'],local_delivery:['admin','agent_hub'],relay_received:['admin','agent_hub'],
});
const FEE_TYPES = Object.freeze(['handling','storage','forwarder','local_tax','exceptional','other','local_transport']);
class JourneyError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const fail=(status,code,message)=>{throw new JourneyError(status,code,message);};
function toJourneyError(e){return e instanceof JourneyError||!e||!Number.isInteger(e.status)?e:new JourneyError(e.status,e.code,e.message);}
function str(value,name,max=180,required=true){
  const s=typeof value==='string'?value.trim():'';
  if((required&&!s)||s.length>max)fail(400,'JOURNEY_INVALID_'+name,name+' invalide');
  return s||null;
}
function ref(value,name='reference'){
  const s=str(value,name,96);
  if(!/^[a-z0-9_.:-]{3,96}$/i.test(s))fail(400,'JOURNEY_INVALID_'+name,'Référence simple requise');
  return s;
}
function number(value,name,{positive=false,scale=2}={}){
  if(value===null||value===undefined||value==='')return null;
  const s=String(value).trim();
  const pattern=new RegExp('^\\d{1,12}(?:\\.\\d{1,'+scale+'})?$');
  if(!pattern.test(s)||(positive&&Number(s)<=0))
    fail(400,'JOURNEY_INVALID_'+name,name+' doit être un montant ou volume valide');
  return s;
}
function date(value){
  if(value==null||value==='')return null;
  const v=str(value,'date',10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||
     new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)
    fail(400,'JOURNEY_INVALID_DATE','Date YYYY-MM-DD requise');
  return v;
}
function actorOk(actor,roles){
  if(!actor||!actor.id||!roles.includes(actor.role))fail(403,'JOURNEY_ROLE_FORBIDDEN','Acteur non habilité');
}
function marketOk(market){
  if(!market||!market.id||!market.code)fail(400,'JOURNEY_MARKET_REQUIRED','Marché serveur requis');
}
function transact(database,fn){
  if(!database||typeof database.withTransaction!=='function')throw Error('JOURNEY_TRANSACTION_REQUIRED');
  return database.withTransaction(fn);
}
async function get(client,market,reference,lock=false){
  const q='SELECT * FROM international_shipments WHERE market_id=$1 AND reference=$2'+(lock?' FOR UPDATE':'');
  const {rows:[r]}=await client.query(q,[market.id,ref(reference)]);
  if(!r)fail(404,'JOURNEY_NOT_FOUND','Expédition introuvable sur ce marché');
  return r;
}
async function evidence(client,s,type,actor,proof,from,to,payload={},notes=null){
  await client.query(
    'INSERT INTO international_shipment_events (shipment_id,event_type,from_stage,to_stage,proof_ref,actor_id,payload,notes) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
    [s.id,type,from,to,str(proof,'proof_ref',240),String(actor.id),JSON.stringify(payload),notes?str(notes,'notes',2000):null]
  );
}
// Opening a Hub preparation dossier is not evidence of a physical handover.
async function open(market,actor,input={},database=db){
  marketOk(market);actorOk(actor,['admin','agent_hub']);
  const reference=ref(input.reference);
  const hubUnitIds=Array.isArray(input.hub_unit_ids)?input.hub_unit_ids.map(x=>String(x||'').trim()):[];
  if(hubUnitIds.length>500||new Set(hubUnitIds).size!==hubUnitIds.length)
    fail(400,'JOURNEY_HUB_UNITS_INVALID','Au maximum 500 cartons uniques');
  if(Array.isArray(input.parcel_refs)&&input.parcel_refs.length)
    fail(400,'JOURNEY_HUB_OPEN_PARCELS_FORBIDDEN','Utiliser des KOM-BOX pour ouvrir un dossier Hub');
  return transact(database,async client=>{
    let boxes=[];
    try{boxes=await boxShipment.lockAttachableBoxes(client,{marketId:market.id,unitIds:hubUnitIds});}
    catch(e){throw toJourneyError(e);}
    const {rows:[s]}=await client.query(
      'INSERT INTO international_shipments(market_id,reference,forwarder_name,transport_mode,created_by,hub_draft) VALUES ($1,$2,NULL,NULL,$3,TRUE) RETURNING *',
      [market.id,reference,String(actor.id)]);
    try{await boxShipment.insertBoxLinks(client,{shipmentId:s.id,units:boxes,actor});}
    catch(e){throw toJourneyError(boxShipment.translate(e));}
    await client.query(
      "INSERT INTO international_shipment_events(shipment_id,event_type,from_stage,to_stage,proof_ref,actor_id,payload) VALUES ($1,'opened',NULL,'hub_ready',NULL,$2,$3::jsonb)",
      [s.id,String(actor.id),JSON.stringify({hub_units:boxes.map(b=>({id:b.id,reference:b.reference}))})]);
    return {reference:s.reference,stage:'hub_ready',hub_draft:true,hub_units:boxes.length};
  });
}
async function transition(market,actor,reference,body={},database=db){
  marketOk(market);
  const target=str(body.to_stage,'to_stage',40),roles=STAGE_ROLES[target];
  if(!roles)fail(400,'JOURNEY_STAGE_INVALID','Étape non reconnue');
  actorOk(actor,roles);
  const proof=str(body.proof_ref,'proof_ref',240);
  return transact(database,async client=>{
    const s=await get(client,market,reference,true);
    if(STAGES.indexOf(target)!==STAGES.indexOf(s.stage)+1)
      fail(409,'JOURNEY_STAGE_ORDER','Les étapes doivent être validées dans l’ordre');
    if(target==='in_transit'&&!s.tracking_reference&&!s.bill_of_lading_ref)
      fail(409,'JOURNEY_TRACKING_REQUIRED','Suivi ou connaissement requis avant départ');
    if(target==='customs_released'){
      if(!s.customs_shipment_id)fail(409,'JOURNEY_CUSTOMS_REQUIRED','Dossier douane lié requis');
      const {rows:[c]}=await client.query(
        'SELECT status,customs_paid_kmf FROM customs_shipments WHERE id=$1 AND market_id=$2',
        [s.customs_shipment_id,market.id]);
      if(!c||!['declared','confirmed'].includes(c.status)||c.customs_paid_kmf==null)
        fail(409,'JOURNEY_CUSTOMS_PENDING','Dossier douane ou montant non rapproché');
      // The supplied proof is the actual mainlevee, never inferred from payment.
    }
    let handedUnits=null;
    if(target==='handed_over'){
      // Emballé (PACKED) ≠ expédié du Hub (DISPATCHED) ≠ remis au transitaire (handed_over) : trois faits distincts.
      const {rows:units}=await client.query(
        'SELECT u.id,u.reference,u.state,u.outcome_type FROM international_shipment_hub_units h JOIN hub_physical_units u ON u.id=h.physical_unit_id WHERE h.shipment_id=$1 ORDER BY u.reference FOR UPDATE OF u',
        [s.id]);
      if(s.hub_draft&&!units.length)fail(409,'JOURNEY_HUB_DRAFT_EMPTY','Ajoutez au moins un carton avant la remise');
      const bad=units.filter(u=>u.state!=='DISPATCHED'||u.outcome_type);
      if(bad.length)fail(409,'JOURNEY_HUB_UNITS_NOT_DISPATCHED',
        'Remise refusée : carton(s) non expédié(s) du Hub, en anomalie ou non conforme : '+bad.map(u=>u.reference+' ('+(u.outcome_type||u.state)+')').join(', '));
      handedUnits=units.map(u=>({id:u.id,reference:u.reference}));
    }
    let transferDetails=null;
    if(target==='handed_over'&&s.hub_draft){
      const forwarder=str(body.forwarder_name||s.forwarder_name,'forwarder_name');
      const mode=str(body.transport_mode||s.transport_mode,'transport_mode',10);
      if(forwarder.length<2)fail(400,'JOURNEY_FORWARDER_REQUIRED','Transitaire identifié requis');
      if(!['sea','air'].includes(mode))fail(400,'JOURNEY_MODE_INVALID','Mode de transport requis');
      transferDetails={forwarder_name:forwarder,transport_mode:mode};
      await client.query(
        'UPDATE international_shipments SET stage=$3,forwarder_name=$4,transport_mode=$5,updated_at=now() WHERE id=$1 AND market_id=$2',
        [s.id,market.id,target,forwarder,mode]);
    }else{
      const stamped=target==='in_transit'?',departed_at=COALESCE(departed_at,now())'
        :target==='arrived'?',arrived_at=COALESCE(arrived_at,now())':'';
      await client.query('UPDATE international_shipments SET stage=$3,updated_at=now()'+stamped+
        ' WHERE id=$1 AND market_id=$2',[s.id,market.id,target]);
    }
    await evidence(client,s,'stage_changed',actor,proof,s.stage,target,
      handedUnits?{physical_step:target,hub_units:handedUnits,...transferDetails}:{physical_step:target},body.notes);
    return {reference:s.reference,from_stage:s.stage,stage:target};
  });
}
async function updateTracking(market,actor,reference,body={},database=db){
  marketOk(market);actorOk(actor,['admin','agent_transitaire']);
  const proof=str(body.proof_ref,'proof_ref',240);
  const cols=['tracking_reference','container_reference','bill_of_lading_ref'];
  const values=cols.map(k=>body[k]===undefined?undefined:str(body[k],k,160,false));
  const eta=body.estimated_arrival_date===undefined?undefined:date(body.estimated_arrival_date);
  if(values.every(v=>v===undefined)&&eta===undefined)fail(400,'JOURNEY_TRACKING_EMPTY','Aucune information renseignée');
  return transact(database,async client=>{
    const s=await get(client,market,reference,true);
    const next=values.map((v,i)=>v===undefined?s[cols[i]]:v);
    const nextEta=eta===undefined?s.estimated_arrival_at:eta;
    await client.query('UPDATE international_shipments SET tracking_reference=$3,container_reference=$4,bill_of_lading_ref=$5,estimated_arrival_at=$6,updated_at=now() WHERE id=$1 AND market_id=$2',
      [s.id,market.id,...next,nextEta]);
    await evidence(client,s,'tracking_updated',actor,proof,s.stage,s.stage,
      {tracking_reference:next[0],container_reference:next[1],bill_of_lading_ref:next[2],eta:nextEta});
    return {reference:s.reference,tracking_reference:next[0],estimated_arrival_at:nextEta};
  });
}
async function recordFreight(market,actor,reference,body={},database=db){
  marketOk(market);actorOk(actor,['admin']);
  const amount=number(body.amount_kmf,'amount_kmf');
  if(amount===null)fail(400,'JOURNEY_FREIGHT_REQUIRED','Montant réel du fret requis (0 accepté)');
  const invoice=str(body.invoice_ref,'invoice_ref',240);
  const volume=number(body.volume_m3,'volume_m3',{positive:true,scale:5});
  const rate=number(body.rate_kmf_per_m3,'rate_kmf_per_m3');
  return transact(database,async client=>{
    const s=await get(client,market,reference,true);
    if(STAGES.indexOf(s.stage)<STAGES.indexOf('forwarder_received'))
      fail(409,'JOURNEY_FORWARDER_RECEIPT_REQUIRED','Réception transitaire non prouvée');
    if(s.freight_invoice_kmf!=null)fail(409,'JOURNEY_FREIGHT_ALREADY_RECORDED','Facture déjà enregistrée');
    if(rate!=null&&s.transport_mode!=='sea')fail(400,'JOURNEY_SEA_RATE_ONLY','Tarif m³ incompatible');
    await client.query('UPDATE international_shipments SET freight_invoice_kmf=$3,freight_invoice_ref=$4,volume_m3=COALESCE($5,volume_m3),freight_rate_kmf_per_m3=COALESCE($6,freight_rate_kmf_per_m3),updated_at=now() WHERE id=$1 AND market_id=$2',
      [s.id,market.id,amount,invoice,volume,rate]);
    await evidence(client,s,'freight_recorded',actor,invoice,s.stage,s.stage,{amount_kmf:amount,volume_m3:volume,rate});
    return {reference:s.reference,amount_kmf:amount,invoice_ref:invoice,cost_reconciliation:'not_reconciled'};
  });
}
async function linkCustoms(market,actor,reference,body={},database=db){
  marketOk(market);actorOk(actor,['admin']);
  const customsRef=ref(body.customs_reference,'customs_reference');
  const proof=str(body.proof_ref,'proof_ref',240);
  return transact(database,async client=>{
    const s=await get(client,market,reference,true);
    if(s.customs_shipment_id)fail(409,'JOURNEY_CUSTOMS_ALREADY_LINKED','Dossier douane déjà lié');
    const {rows:[c]}=await client.query(
      'SELECT id FROM customs_shipments WHERE reference=$1 AND market_id=$2 AND is_active=TRUE',
      [customsRef,market.id]);
    if(!c)fail(404,'JOURNEY_CUSTOMS_NOT_FOUND','Dossier douane actif absent sur ce marché');
    if(STAGES.indexOf(s.stage)<STAGES.indexOf('arrived'))
      fail(409,'JOURNEY_CUSTOMS_ARRIVAL_REQUIRED','Liaison douane après arrivée constatée');
    const {rows:[scope]}=await client.query(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE u.market_id IS DISTINCT FROM $2 OR u.outcome_type IS NOT NULL)::int AS bad "+
      "FROM international_shipment_hub_units h JOIN hub_physical_units u ON u.id=h.physical_unit_id WHERE h.shipment_id=$1",
      [s.id,market.id]);
    if(!scope||!Number(scope.total)||Number(scope.bad)>0)
      fail(409,'JOURNEY_CUSTOMS_BOX_SCOPE','Aucun KOM-BOX valide du marché dans le dossier');
    const {rows:[legacy]}=await client.query(
      'SELECT COUNT(*)::int AS n FROM customs_shipment_parcels WHERE shipment_id=$1',[c.id]);
    if(Number(legacy.n)>0)
      fail(409,'JOURNEY_CUSTOMS_LEGACY_MEMBERSHIP','Dossier douane sur anciens colis : utiliser le flux KOM-BOX sans double modèle');
    await client.query('UPDATE international_shipments SET customs_shipment_id=$3,updated_at=now() WHERE id=$1 AND market_id=$2',
      [s.id,market.id,c.id]);
    await evidence(client,s,'customs_linked',actor,proof,s.stage,s.stage,{customs_reference:customsRef});
    return {reference:s.reference,customs_reference:customsRef};
  });
}
// The canonical Hub flow declares the customs amount against its shipment dossier.
// Unlike the legacy parcel-based declaration, it does not write item allocations.
async function declareCustoms(market,actor,reference,body={},database=db){
  marketOk(market);actorOk(actor,['admin']);
  const amount=number(body.amount_kmf,'amount_kmf');
  if(amount===null)fail(400,'JOURNEY_CUSTOMS_AMOUNT_REQUIRED','Droits/taxes connus requis : zéro confirmé accepté');
  const proof=str(body.proof_ref,'proof_ref',240);
  return transact(database,async client=>{
    const s=await get(client,market,reference,true);
    if(STAGES.indexOf(s.stage)<STAGES.indexOf('arrived'))
      fail(409,'JOURNEY_CUSTOMS_ARRIVAL_REQUIRED','Constater arrivée avant déclaration');
    if(!s.customs_shipment_id)fail(409,'JOURNEY_CUSTOMS_LINK_REQUIRED','Dossier douane non lié');
    const {rows:[customs]}=await client.query(
      'SELECT id,status,is_active,customs_paid_kmf FROM customs_shipments WHERE id=$1 AND market_id=$2 FOR UPDATE',
      [s.customs_shipment_id,market.id]);
    if(!customs?.is_active)fail(409,'JOURNEY_CUSTOMS_INACTIVE','Dossier douane inactif');
    if(customs.customs_paid_kmf!=null)
      fail(409,'JOURNEY_CUSTOMS_AMOUNT_IMMUTABLE','Droits déjà déclarés : correction documentée nécessaire');
    const {rows:[legacy]}=await client.query(
      'SELECT COUNT(*)::int AS n FROM customs_shipment_parcels WHERE shipment_id=$1',[customs.id]);
    if(Number(legacy.n)>0)fail(409,'JOURNEY_CUSTOMS_LEGACY_MEMBERSHIP','Dossier douane non canonique');
    await client.query(
      "UPDATE customs_shipments SET customs_paid_kmf=$3,status='declared',declared_at=now(),declared_by=$4 WHERE id=$1 AND market_id=$2",
      [customs.id,market.id,amount,String(actor.id)]);
    await evidence(client,s,'customs_amount_confirmed',actor,proof,s.stage,s.stage,{amount_kmf:amount});
    return {reference:s.reference,amount_kmf:amount,customs_status:'declared'};
  });
}
async function recordCost(market,actor,reference,body={},database=db){
  marketOk(market);actorOk(actor,['admin']);
  const type=str(body.fee_type,'fee_type',40);
  if(!FEE_TYPES.includes(type))fail(400,'JOURNEY_FEE_UNKNOWN','Nature de frais invalide');
  const amount=number(body.amount_kmf,'amount_kmf');
  if(amount===null)fail(400,'JOURNEY_AMOUNT_REQUIRED','Montant requis');
  const proof=str(body.proof_ref,'proof_ref',240),key=str(body.idempotency_key,'idempotency_key',160);
  const kind=body.kind||'charge';
  if(!['charge','credit'].includes(kind)||(kind==='credit'&&Number(amount)===0))
    fail(400,'JOURNEY_KIND_INVALID','Crédit strictement positif requis');
  return transact(database,async client=>{
    const s=await get(client,market,reference,true);
    if(type==='local_transport'&&STAGES.indexOf(s.stage)<STAGES.indexOf('customs_released'))
      fail(409,'JOURNEY_RELEASE_REQUIRED','Transport local seulement après mainlevée');
    if(type!=='local_transport'&&STAGES.indexOf(s.stage)<STAGES.indexOf('arrived'))
      fail(409,'JOURNEY_ARRIVAL_REQUIRED','Frais d’arrivée enregistrés après arrivée');
    const {rows:[existing]}=await client.query(
      'SELECT * FROM international_shipment_charges WHERE shipment_id=$1 AND idempotency_key=$2',
      [s.id,key]);
    if(existing){
      if(existing.fee_type!==type||existing.kind!==kind||
         Number(existing.amount_kmf)!==Number(amount)||existing.proof_ref!==proof)
        fail(409,'JOURNEY_COST_IDEMPOTENCY_CONFLICT','Même clé pour un coût différent');
      return {reference:s.reference,cost_id:existing.id,idempotent:true,cost_reconciliation:'not_reconciled'};
    }
    if(s.customs_shipment_id&&type!=='local_transport'){
      const {rows:[legacy]}=await client.query(
        'SELECT id FROM customs_shipment_fees WHERE shipment_id=$1 AND proof_ref=$2 LIMIT 1',
        [s.customs_shipment_id,proof]);
      if(legacy)fail(409,'JOURNEY_COST_ALREADY_RECORDED','Facture déjà enregistrée au dossier douane');
    }
    if(kind==='credit'){
      const {rows:[balance]}=await client.query(
        "SELECT COALESCE(SUM(CASE WHEN kind='credit' THEN -amount_kmf ELSE amount_kmf END),0) AS net FROM international_shipment_charges WHERE shipment_id=$1 AND fee_type=$2",
        [s.id,type]);
      if(Number(balance.net)<Number(amount))fail(409,'JOURNEY_CREDIT_TOO_HIGH','Crédit supérieur aux frais');
    }
    const {rows:[saved]}=await client.query(
      'INSERT INTO international_shipment_charges (shipment_id,fee_type,kind,amount_kmf,proof_ref,idempotency_key,notes,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [s.id,type,kind,amount,proof,key,body.notes||null,String(actor.id)]);
    return {reference:s.reference,cost_id:saved.id,idempotent:false,cost_reconciliation:'not_reconciled'};
  });
}
async function list(market,database=db){
  marketOk(market);
  const {rows}=await database.query(
    "SELECT s.*, (SELECT COUNT(*)::int FROM international_shipment_hub_units hu WHERE hu.shipment_id=s.id) AS hub_unit_count, "+
    "(SELECT COALESCE(SUM(CASE WHEN c.kind='credit' THEN -c.amount_kmf ELSE c.amount_kmf END),0) FROM international_shipment_charges c WHERE c.shipment_id=s.id) AS supplementary_costs_kmf, "+
    "cs.reference AS customs_reference,cs.customs_paid_kmf,cs.status AS customs_status, "+
    "n1.documented_total_kmf,n1.total_customs_kmf,n1.financial_closed_at, "+
    "CASE WHEN n1.shipment_id IS NULL THEN 'not_reconciled' "+
    "WHEN n1.reconciled_at < GREATEST(s.updated_at,COALESCE(latest_cost.last_at,s.updated_at),COALESCE(cs.declared_at,s.updated_at)) THEN 'pending_reconciliation' "+
    "WHEN n1.financial_closed_at IS NOT NULL THEN 'closed' ELSE 'partial' END AS cost_reconciliation "+
    "FROM international_shipments s LEFT JOIN customs_shipments cs ON cs.id=s.customs_shipment_id AND cs.market_id=s.market_id "+
    "LEFT JOIN international_n1_reconciliations n1 ON n1.shipment_id=s.id "+
    "LEFT JOIN LATERAL (SELECT MAX(c.recorded_at) AS last_at FROM international_shipment_charges c WHERE c.shipment_id=s.id) latest_cost ON TRUE "+
    "WHERE s.market_id=$1 ORDER BY s.created_at DESC LIMIT 100",[market.id]
  );
  return rows.map(r=>({...r,freight_estimated_kmf:
    r.transport_mode==='sea'&&r.volume_m3!=null&&r.freight_rate_kmf_per_m3!=null
      ?(Number(r.volume_m3)*Number(r.freight_rate_kmf_per_m3)).toFixed(2):null}));
}
async function detail(market,reference,database=db){
  marketOk(market);
  const s=await get(database,market,reference);
  const [events,charges,hubRows,snapshot]=await Promise.all([
    database.query('SELECT event_type,from_stage,to_stage,proof_ref,occurred_at,actor_id,notes FROM international_shipment_events WHERE shipment_id=$1 ORDER BY occurred_at,id',[s.id]),
    database.query('SELECT fee_type,kind,amount_kmf,proof_ref,recorded_at,notes FROM international_shipment_charges WHERE shipment_id=$1 ORDER BY recorded_at,id',[s.id]),
    database.query(`SELECT u.id AS unit_id,u.reference,u.state,h.attached_at,a.purchase_order_id,a.purchase_line_id,a.product_sku_id,o.reference AS order_ref,p.quantity
      FROM international_shipment_hub_units h JOIN hub_physical_units u ON u.id=h.physical_unit_id
      LEFT JOIN hub_physical_unit_placements p ON p.physical_unit_id=u.id AND p.removed_at IS NULL
      LEFT JOIN hub_purchase_allocations a ON a.id=p.allocation_id LEFT JOIN orders o ON o.id=a.order_id
      WHERE h.shipment_id=$1 ORDER BY u.reference,o.reference`,[s.id]),
    database.query('SELECT documented_total_kmf,financial_closed_at,reconciled_at,total_freight_kmf,total_customs_kmf,total_arrival_kmf,total_local_kmf FROM international_n1_reconciliations WHERE shipment_id=$1',[s.id]),
  ]);
  const boxes=new Map();
  for(const r of hubRows.rows){
    if(!boxes.has(r.unit_id))boxes.set(r.unit_id,{unit_id:r.unit_id,reference:r.reference,state:r.state,attached_at:r.attached_at,contents:[]});
    if(r.order_ref)boxes.get(r.unit_id).contents.push({order_ref:r.order_ref,purchase_order_id:r.purchase_order_id,purchase_line_id:r.purchase_line_id,product_sku_id:r.product_sku_id,quantity:Number(r.quantity)});
  }
  return {shipment:{...s,...(snapshot.rows[0]||{})},hub_units:[...boxes.values()],events:events.rows,charges:charges.rows};
}
module.exports={STAGES,STAGE_ROLES,FEE_TYPES,JourneyError,open,transition,updateTracking,recordFreight,linkCustoms,declareCustoms,recordCost,list,detail,
  _internals:{ref,date,number,actorOk}};
