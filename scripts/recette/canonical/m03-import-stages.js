/** @komerce-arch-lite
 * @role g6-m03-import-stages
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Orchestrator loop of the M03 import branch (HUB_PO..CLIENT_PICKUP): one gesture sequence per PO from a read-only PG inventory, one consolidated bag, no bypass.
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const mp=require('./multi-po');
const {UUID}=mp;
const PREDECESSOR=Object.freeze({
 HUB_COMMITMENT:'HUB_PO',HUB_VENDOR_READINESS:'HUB_COMMITMENT',HUB_VENDOR_SIMULATION:'HUB_VENDOR_READINESS',
 HUB_RECEIVING:'HUB_VENDOR_SIMULATION',HUB_RECEIVING_READBACK:'HUB_RECEIVING',HUB_CUSTOMER_BAG:'HUB_RECEIVING_READBACK',
 HUB_KOM_BOX:'HUB_CUSTOMER_BAG',HUB_SHIPMENT:'HUB_KOM_BOX',FORWARDER:'HUB_SHIPMENT',CUSTOMS:'FORWARDER',
 RELAY_RECEIPT:'CUSTOMS',CLIENT_PICKUP:'RELAY_RECEIPT'});
const SUPPLIER_PACKAGE=/^SUPPLIER_PACKAGE-[A-Z0-9-]{8,}$/i;
// Pur : un échec enfant qui prouve un manque d'écran ou de produit devient un verdict explicite (jamais un contournement).
function classifyGap(stageId,message){
 const m=String(message||'');
 if(/PRODUCT_GAP/.test(m))return 'PRODUCT_GAP';
 const screen={HUB_CUSTOMER_BAG:/G6_BAG_EXACT_(ORDER|SOURCE)_NOT_AVAILABLE/,RELAY_RECEIPT:/G6_RELAY_UI_ITEM_NOT_UNIQUE/,
  HUB_KOM_BOX:/G6_BOX_UNEXPECTED_PARCEL_AMBIGUITY/}[stageId];
 if(screen&&screen.test(m))return 'SCREEN_MISSING';
 if(/G6_BOX_CLIENT_PARCEL_NOT_UNIQUE|G6_BOX_LINK_OR_SINGLE_PLACEMENT_INVALID|G6_BAG_CREATE_PG_INVALID/.test(m))return 'PRODUCT_GAP';
 return null;
}
function createM03ImportStages({db,env,ROOT,REPORT_PATH,SCRIPTS,execute,report,stageProofs,verifyStage,orderPg,poState,marketProfile}){
 const out=rel=>path.join(ROOT,rel);
 const write=(rel,obj)=>{fs.mkdirSync(path.dirname(out(rel)),{recursive:true});fs.writeFileSync(out(rel),JSON.stringify(obj,null,2)+'\n')};
 async function requirePredecessor(stageId,context){
  const pred=PREDECESSOR[stageId];
  if(!stageProofs.has(pred))throw Error('G6_DYNAMIC_HUB_PREDECESSOR_MISSING_'+pred);
  await verifyStage(pred,context);
 }
 async function inventory(context,opts){
  const inv=await mp.readImportInventory(db,context.order_id,opts);
  // Limite déclarée : les scripts de gestes supposent 1 unité par ligne IMPORT.
  if(inv.units!==inv.item_count)throw Error('G6_M03_PRODUCT_GAP_IMPORT_ITEM_QUANTITY_NOT_ONE');
  return inv;
 }
 async function allocationsFor(inv,orderId){
  const {rows}=await db.query('SELECT id,purchase_order_id FROM hub_purchase_allocations WHERE order_id=$1 AND purchase_order_id=ANY($2::uuid[])',[orderId,inv.pos.map(p=>p.po_id)]);
  const byPo=new Map(rows.map(r=>[r.purchase_order_id,r.id]));
  if(rows.length!==inv.pos.length||byPo.size!==inv.pos.length||inv.pos.some(p=>!UUID.test(String(byPo.get(p.po_id)||''))))
   throw Error('G6_M03_PRODUCT_GAP_ALLOCATION_NOT_ONE_PER_PO');
  return inv.pos.map(p=>byPo.get(p.po_id));
 }
 const receiptsOf=inv=>{
  const agg=report('HUB_RECEIVING').data;
  if(agg.multi_po!==true||!Array.isArray(agg.per_po))throw Error('G6_M03_RECEIPT_AGGREGATE_INVALID');
  return inv.pos.map(p=>{
   const e=agg.per_po.find(x=>x.po_id===p.po_id);
   const ref=e?.report?.receipt?.reference;
   if(!SUPPLIER_PACKAGE.test(String(ref||'')))throw Error('G6_DYNAMIC_PHYSICAL_RECEIPT_REFERENCE_MISSING');
   return ref;
  });
 };
 const baseStageEnv=(stageId,context)=>({...env,G6_DYNAMIC_FRESH_ORDER:'1',G6_CANONICAL_PHASE:stageId,
  G6_CANONICAL_ORDER_ID:context.order_id,G6_CANONICAL_ORDER_REFERENCE:context.order_reference,
  G6_CANONICAL_DB_FINGERPRINT:context.db_fingerprint});
 async function runHubPo(context){
  if(!stageProofs.has('RELAY_CASH'))throw Error('G6_DYNAMIC_CASH_CHECKPOINT_MISSING');
  await verifyStage('RELAY_CASH',context);
  const buyer=report('BUYER').data;
  if(!UUID.test(String(buyer.buyer_id||''))||buyer.order?.id!==context.order_id||
     !env.E2E_AGENT_HUB_EMAIL||!env.E2E_AGENT_HUB_PASSWORD||!env.E2E_AGENT_RELAIS_EMAIL||!env.E2E_AGENT_RELAIS_PASSWORD)
   throw Error('G6_DYNAMIC_HUB_IDENTITY_NOT_BOUND');
  const first=await inventory(context,{requirePo:false});
  if(first.item_count<mp.MIN_IMPORT_POS)throw Error('G6_M03_PRODUCT_GAP_IMPORT_ITEMS_BELOW_'+mp.MIN_IMPORT_POS);
  if(first.pos.length!==0)throw Error('G6_M03_HUB_PO_ALREADY_STARTED_NO_REPLAY');
  fs.rmSync(out(REPORT_PATH.HUB_PO),{force:true});
  const perPo=[];
  for(let k=0;k<first.item_count;k++){
   const runner=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['playwright','test','--config=playwright.hub-v1-clicks.config.js',SCRIPTS.HUB_PO],
    {cwd:ROOT,env:{...env,PGOPTIONS:'-c default_transaction_read_only=on',E2E_CLICKS_BASE_URL:'https://komerce-backend-production.up.railway.app',
     G6_CANONICAL_HUB_STAGE:'1',G6_CANONICAL_ORDER_REFERENCE:context.order_reference,G6_CANONICAL_ORDER_ID:context.order_id,
     G6_CANONICAL_BUYER_ID:buyer.buyer_id,G6_CANONICAL_PO_ITERATION:String(k),G6_CANONICAL_IMPORT_ITEMS:String(first.item_count)},
     stdio:'inherit',timeout:16*60*1000});
   let data=null;try{data=report('HUB_PO').data}catch(_){}
   if(runner.error||runner.status!==0)
    throw Error((classifyGap('HUB_PO',data?.error)?'G6_M03_'+classifyGap('HUB_PO',data.error)+'_HUB_PO_':'G6_DYNAMIC_HUB_CHROMIUM_FAILED_')+'PO_'+(k+1)+
     (data?.error?' | child_error='+String(data.error).slice(0,300):''));
   const draft=(data.gestures||[]).filter(x=>x.key==='prepare-draft-po'&&x.verdict==='PASS');
   const now=await inventory(context,{requirePo:false});
   if(now.pos.length!==k+1||!draft.length||!now.pos.some(p=>p.po_id===draft.at(-1).purchase_order_id))
    throw Error('G6_DYNAMIC_HUB_PO_IDENTITY_DRIFT');
   const keep='test-results/g6-p3-kuyiyuk/evidence.po-'+(k+1)+'.json';
   write(keep,data);perPo.push({iteration:k,po_id:draft.at(-1).purchase_order_id,report:data});
  }
  const final=await inventory(context,{requirePo:true});
  if(final.pos.length!==first.item_count)throw Error('G6_M03_PRODUCT_GAP_POS_NOT_ONE_PER_IMPORT_ITEM');
  write(REPORT_PATH.HUB_PO,{schema:'komerce-g6-p3-multi-po/1',multi_po:true,stage_id:'HUB_PO',reference:context.order_reference,
   order_id:context.order_id,db_fingerprint:context.db_fingerprint,sha:context.staging_sha,verdict:'G6_P3_MULTI_PO_DRAFT_POS_CHROMIUM_PASS',
   external_supplier_calls:0,external_payment_executed:false,staging_cash_confirmation_recorded:false,
   po_ids:final.pos.map(p=>p.po_id),import_items:final.item_count,per_po:perPo});
  return report('HUB_PO').data;
 }
 async function runPerPo(stageId,context){
  await requirePredecessor(stageId,context);
  const inv=await inventory(context,{requirePo:true});
  const receipts=stageId==='HUB_RECEIVING_READBACK'?receiptsOf(inv):[];
  const perPo=[];
  fs.rmSync(out(REPORT_PATH[stageId]),{force:true});
  for(const [i,it] of mp.planStage(stageId,inv).entries()){
   fs.rmSync(out(REPORT_PATH[stageId]),{force:true});
   execute(SCRIPTS[stageId],{...baseStageEnv(stageId,context),...it.env,G6_CANONICAL_RECEIPT_REFERENCE:receipts[i]||''});
   const data=report(stageId).data;
   write(REPORT_PATH[stageId].replace(/report\.json$/,'report.po-'+(i+1)+'.json'),data);
   perPo.push({po_id:it.po_id,report:data});
  }
  write(REPORT_PATH[stageId],{schema:'komerce-g6-m03-per-po/1',multi_po:true,stage_id:stageId,reference:context.order_reference,
   order_id:context.order_id,db_fingerprint:context.db_fingerprint,sha:context.staging_sha,
   external_supplier_calls:0,external_payment_executed:false,po_ids:inv.pos.map(p=>p.po_id),per_po:perPo});
  return report(stageId).data;
 }
 async function runOrderStage(stageId,context,finalMileIdentity){
  await requirePredecessor(stageId,context);
  const inv=await inventory(context,{requirePo:true});
  const receipts=receiptsOf(inv),allocations=await allocationsFor(inv,context.order_id);
  const bag=stageId==='HUB_KOM_BOX'?report('HUB_CUSTOMER_BAG').data:null;
  const [it]=mp.planStage(stageId,inv,{receipts,allocations});
  let parcel=null;
  if(stageId==='HUB_KOM_BOX'){
   if(!UUID.test(String(bag?.bag_id||''))||bag?.after?.parcels?.length!==0)
    throw Error('G6_M03_KOM_BOX_BAG_OR_PARCEL_PRESTATE_INVALID');
   // The sealed physical bag is NOT a client parcel. This stage must first play
   // the authorized per-order "Répartir" UI gesture, after all IMPORT receipts,
   // to create the one canonical IMPORT parcel/parcel_items membership.
   // Never invent a parcel ID or run a global market-wide distribution.
   const rel='test-results/g6-m03-parcel-distribution/report.json';
   fs.rmSync(out(rel),{force:true});
   execute('scripts/recette/g6-m03-import-distribute-chromium.js',{
    ...baseStageEnv(stageId,context),...it.env,
    G6_CANONICAL_BAG_ID:bag.bag_id,G6_M03_IMPORT_ITEMS:String(inv.item_count)
   });
   const proof=JSON.parse(fs.readFileSync(out(rel),'utf8'));
   if(proof.verdict!=='G6_M03_IMPORT_PARCEL_DISTRIBUTION_CHROMIUM_PG_PASS'||
      proof.order_id!==context.order_id||proof.reference!==context.order_reference||
      proof.sha!==context.staging_sha||proof.db_fingerprint!==context.db_fingerprint||
      proof.external_supplier_calls!==0||proof.external_payment_executed!==false||
      !UUID.test(String(proof.parcel_id||''))||
      !Array.isArray(proof.import_order_item_ids)||proof.import_order_item_ids.length!==inv.item_count)
    throw Error('G6_M03_KOM_BOX_DISTRIBUTION_UI_PROOF_INVALID');
   const {rows:members}=await db.query(
    "SELECT p.id AS parcel_id,p.order_id AS parcel_order_id,pi.order_item_id,pi.quantity::int AS quantity "
    +"FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id "
    +"JOIN order_items oi ON oi.id=pi.order_item_id "
    +"WHERE oi.order_id=$1 AND oi.fulfillment_source='IMPORT' AND p.status<>'cancelled' AND p.cancelled_at IS NULL "
    +"ORDER BY pi.order_item_id",[context.order_id]);
   if(members.length!==inv.item_count||
      members.some(m=>m.parcel_id!==proof.parcel_id||m.parcel_order_id!==context.order_id||m.quantity!==1)||
      JSON.stringify(members.map(m=>m.order_item_id).sort())!==
       JSON.stringify([...proof.import_order_item_ids].sort()))
    throw Error('G6_M03_KOM_BOX_DISTRIBUTION_INDEPENDENT_PG_INVALID');
   parcel=proof.parcel_id;
  }
  const finals=['HUB_SHIPMENT','FORWARDER','CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP'];
  const ids=finals.includes(stageId)?await finalMileIdentity(db,context,{beforeShipment:stageId==='HUB_SHIPMENT',m03:true}):null;
  fs.rmSync(out(REPORT_PATH[stageId]),{force:true});
  execute(SCRIPTS[stageId],{...baseStageEnv(stageId,context),...it.env,
   G6_CANONICAL_RECEIPT_REFERENCE:receipts[0],G6_CANONICAL_ALLOCATION_ID:allocations[0],
   ...(stageId==='HUB_KOM_BOX'?{G6_CANONICAL_BAG_ID:bag.bag_id,G6_CANONICAL_BAG_REF:bag.bag_ref,G6_CANONICAL_PARCEL_ID:parcel}:{}),
   ...(ids?Object.fromEntries(Object.entries(ids).map(([k,v])=>['G6_CANONICAL_'+k.toUpperCase(),v])):{})});
  return report(stageId).data;
 }
 async function executeImport(stageId,context,finalMileIdentity){
  try{
   if(stageId==='HUB_PO')return await runHubPo(context);
   if(mp.PER_PO_STAGES.includes(stageId))return await runPerPo(stageId,context);
   if(mp.ORDER_STAGES.includes(stageId))return await runOrderStage(stageId,context,finalMileIdentity);
  }catch(e){
   const kind=classifyGap(stageId,e.message);
   if(kind&&!/G6_M03_(PRODUCT_GAP|SCREEN_MISSING)/.test(e.message))throw Error('G6_M03_'+kind+'_'+stageId+': '+e.message);
   throw e;
  }
  throw Error('G6_DYNAMIC_DOWNSTREAM_STAGE_NOT_MIGRATED_'+stageId);
 }
 // Vérification indépendante (PG lecture seule) d'une étape import M03 : mêmes exigences que M01, par PO / par sac consolidé.
 async function verifyImport(stageId,context,data,digest){
  const provenance=data.reference===context.order_reference&&data.db_fingerprint===context.db_fingerprint&&
   data.external_supplier_calls===0&&data.external_payment_executed===false;
  if(stageId==='HUB_PO'){
   const cash=stageProofs.get('RELAY_CASH');
   if(!cash||cash.order_id!==context.order_id||cash.order_reference!==context.order_reference)
    throw Error('G6_DYNAMIC_HUB_CASH_CHECKPOINT_INVALID');
   const inv=await inventory(context,{requirePo:true});
   if(data.multi_po!==true||!provenance||data.order_id!==context.order_id||data.verdict!=='G6_P3_MULTI_PO_DRAFT_POS_CHROMIUM_PASS'||
      !Array.isArray(data.per_po)||data.per_po.length!==inv.item_count||inv.pos.length!==inv.item_count||
      JSON.stringify([...data.po_ids].sort())!==JSON.stringify(inv.pos.map(p=>p.po_id).sort())||
      inv.pos.some(p=>p.po_status!=='draft'&&!stageProofs.has('HUB_COMMITMENT')))
    throw Error('G6_DYNAMIC_HUB_UI_PROOF_INVALID');
   for(const [k,e] of data.per_po.entries()){
    const r=e.report;
    if(r.verdict!=='G6_P3_MANUAL_LINE_AND_DRAFT_PO_CHROMIUM_PASS'||r.reference!==context.order_reference||
       r.db_fingerprint!==context.db_fingerprint||r.external_supplier_calls!==0||r.external_payment_executed!==false||
       Number(r.final?.po_count)!==k+1||Number(r.final?.line_count)!==inv.item_count||
       r.hub_po_oracle?.po_status!=='draft'||r.hub_po_oracle?.supplier_consistent!==true||!UUID.test(String(e.po_id||'')))
     throw Error('G6_DYNAMIC_HUB_PO_NOT_UNIQUE');
   }
   const pg=await orderPg(db,context);
   if(pg.payment_status!=='paid'||pg.cash_count!==1||pg.control_count!==1)throw Error('G6_DYNAMIC_HUB_PG_CASH_INVALID');
  }else if(mp.PER_PO_STAGES.includes(stageId)){
   const inv=await inventory(context,{requirePo:true});
   if(data.multi_po!==true||!provenance||data.sha!==context.staging_sha||data.per_po?.length!==inv.pos.length||
      JSON.stringify([...data.po_ids].sort())!==JSON.stringify(inv.pos.map(p=>p.po_id).sort()))
    throw Error('G6_DYNAMIC_HUB_STAGE_PROVENANCE_INVALID_'+stageId);
   const received=stageId==='HUB_RECEIVING_READBACK'?new Map(report('HUB_RECEIVING').data.per_po.map(x=>[x.po_id,x.report.receipt?.reference])):null;
   for(const e of data.per_po){
    const r=e.report,po=await poState(db,context,e.po_id);
    if(r.reference!==context.order_reference||r.po_id!==po.id||r.db_fingerprint!==context.db_fingerprint||
       r.external_supplier_calls!==0||r.external_payment_executed!==false||(r.sha&&r.sha!==context.staging_sha)||
       (['HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION'].includes(stageId)&&r.sha!==context.staging_sha))
     throw Error('G6_DYNAMIC_HUB_STAGE_PROVENANCE_INVALID_'+stageId);
    if(stageId==='HUB_COMMITMENT'){
     if(r.verdict!=='G6_HUB_COMMITMENT_AND_INTERNAL_SUBMIT_CHROMIUM_PASS_NOT_VENDOR_OR_RECEIPT_GO'||r.commitment?.http!==201||
        r.commitment?.pdf_generated!==true||r.after?.po_status!=='notified'||r.after?.commitment_count!==1||
        r.after?.payment_authorization_count!==0||po.status!=='notified'||po.commitments!==1||po.payments!==0||po.executions!==0)
      throw Error('G6_DYNAMIC_HUB_COMMITMENT_PG_INVALID');
    }else if(stageId==='HUB_VENDOR_READINESS'){
     if(r.verdict!=='G6_VENDOR_SEND_UI_READY_BUT_EXTERNAL_EVENT_NOT_PROVEN'||r.supplier_send_certified!==false||
        r.supplier_confirmation_certified!==false||r.physical_receipt_certified!==false||
        r.screen?.external_send_form_not_submitted!==true||po.status!=='notified'||po.commitments!==1||po.payments!==0||po.executions!==0)
      throw Error('G6_DYNAMIC_HUB_VENDOR_READINESS_INVALID');
    }else if(stageId==='HUB_VENDOR_SIMULATION'){
     if(r.verdict!=='G6_VENDOR_SIMULATED_SEND_AND_CONFIRM_CHROMIUM_PASS_NOT_RECEIPT_GO'||r.provenance!=='SIMULATED / STAGING ONLY'||
        r.after?.po_status!=='confirmed'||r.after?.simulation_marker!==true||r.after?.manual_executions!==1||
        r.after?.payment_authorizations!==0||po.status!=='confirmed'||po.commitments!==1||po.payments!==0||po.executions!==1)
      throw Error('G6_DYNAMIC_HUB_VENDOR_SIMULATION_INVALID');
    }else{
     const source=stageId==='HUB_RECEIVING'?r.receipt?.reference:r.physical_ref;
     if(!SUPPLIER_PACKAGE.test(String(source||''))||(received&&received.get(e.po_id)!==source)||po.payments!==0||po.executions!==1)
      throw Error('G6_DYNAMIC_PHYSICAL_PROVENANCE_INVALID_'+stageId);
     const n=await db.query('SELECT COUNT(*)::int AS n FROM hub_physical_units WHERE reference=$1 AND unit_type=$2',[source,'SUPPLIER_PACKAGE']);
     if(n.rows[0]?.n!==1||po.status!=='hub_received')throw Error('G6_DYNAMIC_PHYSICAL_RECEIPT_PG_INVALID');
     if(stageId==='HUB_RECEIVING'){
      if(r.verdict!=='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_PASS_NOT_KOM_BOX_GO'||r.physical_receipt_certified!==true||
         r.receipt?.gesture!=='Chromium button click'||r.after?.remaining!==0||r.after?.physical_units!==1||
         r.after?.external_payment_authorizations!==0)
       throw Error('G6_DYNAMIC_RECEIVING_UI_PG_INVALID');
     }else if(r.verdict!=='G6_HUB_RECEIPT_SIMULATED_CHROMIUM_HISTORICAL_UI_PG_READBACK_PASS'||r.read_only!==true||
        r.readback?.remaining!==0||r.readback?.placements?.length!==1||r.readback.placements[0].reference!==source||
        r.readback.placements[0].evidence_method!=='MANUAL')
      throw Error('G6_DYNAMIC_RECEIVING_READBACK_INVALID');
    }
   }
  }else if(stageId==='HUB_CUSTOMER_BAG'){
   const inv=await inventory(context,{requirePo:true}),receipts=receiptsOf(inv);
   const act=(data.after?.units||[]).filter(u=>u.active);
   if(!provenance||data.sha!==context.staging_sha||data.verdict!=='G6_CUSTOMER_BAG_SIMULATED_CHROMIUM_PG_PASS'||
      !UUID.test(String(data.bag_id||''))||JSON.stringify([...(data.source_refs||[])].sort())!==JSON.stringify([...receipts].sort())||
      data.after?.bags?.length!==1||data.after.bags[0].id!==data.bag_id||data.after.bags[0].state!=='PACKED'||
      act.length!==inv.item_count||act.some(u=>u.id!==data.bag_id))
    throw Error('G6_DYNAMIC_CUSTOMER_BAG_INVALID');
  }else if(stageId==='HUB_KOM_BOX'){
   const inv=await inventory(context,{requirePo:true}),bag=report('HUB_CUSTOMER_BAG').data;
   if(!provenance||data.bag_id!==bag.bag_id||data.bag_ref!==bag.bag_ref||!UUID.test(String(data.box_id||''))||
      data.after?.box?.length!==1||data.after.box[0].id!==data.box_id||data.after.box[0].state!=='PACKED'||
      data.after?.links?.length!==1||data.after.links[0].bag_unit_id!==bag.bag_id||data.after.links[0].box_unit_id!==data.box_id||
      data.after?.effective?.length!==inv.item_count)
    throw Error('G6_DYNAMIC_KOM_BOX_INVALID');
  }else throw Error('G6_REAL_BUYER_CASH_STAGE_NOT_IMPLEMENTED_'+stageId);
  void digest;
  return true;
 }
 return Object.freeze({execute:executeImport,verify:verifyImport,classifyGap});
}
module.exports={createM03ImportStages,classifyGap,PREDECESSOR};
