#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-final-sql-oracle
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Independent final PostgreSQL READ ONLY readback after 11 real Chromium Hub V1 tests.
 * @db-read orders, parcels, parcel_items, international_shipments, international_shipment_events, international_shipment_hub_units, hub_physical_units, hub_physical_unit_placements, hub_custody_events
 * @db-write none
 * @impact-areas staging-only, hub, relay, shipping-customs, dashboard
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const BASE='https://komerce-backend-production.up.railway.app';
const SOURCE=path.resolve('test-results/hub-v1-clicks/evidence.json');
const OUT=path.resolve('test-results/hub-v1-clicks/final-sql-oracle.json');
const RUN=/^[A-F0-9]{8}$/;

function evaluateEvidence(evidence,run8){
 const reasons=[];
 if(!evidence||evidence.run8!==run8)reasons.push('EVIDENCE_RUN8_MISMATCH');
 if(evidence?.verdict!=='CHROMIUM_CLICKS_RECORDED_SQL_READBACK_PENDING')reasons.push('CHROMIUM_GATE_NOT_COMPLETE');
 if(evidence?.tests?.length!==11||evidence.tests.some(x=>x.status!=='passed'))reasons.push('CHROMIUM_NOT_11_OF_11');
 if(!Array.isArray(evidence?.gestures)||evidence.gestures.length<36||
    evidence.gestures.some(x=>x.verdict!=='CLICK_PASS'||x.http<200||x.http>=300))
   reasons.push('CHROMIUM_GESTURE_NOT_PROVEN');
 for(const key of ['journey:handed_over','journey:forwarder_received','journey:in_transit',
   'journey:arrived','journey:customs_released','journey:local_delivery','relay:attest',
   'relay:collect','local:direct-receipt','local:collect']){
   if(!evidence?.gestures?.some(x=>x.key===key&&x.verdict==='CLICK_PASS'))
     reasons.push('MISSING_CHROMIUM_GESTURE_'+key);
 }
 if(evidence?.transverse_t8?.verdict!=='PASS_REAL_HUB_ARRIVAL_TWO_DIRECTOR_BROWSERS')
   reasons.push('T8_TWO_SESSION_PROOF_MISSING');
 if(!Array.isArray(evidence?.pickup_checks)||evidence.pickup_checks.length!==2||
    evidence.pickup_checks.some(x=>x.verdict!=='PASS'))reasons.push('PICKUP_NEGATIVE_GUARDS_NOT_PROVEN');
 if(evidence?.t_cases?.filter(x=>x.id==='T2'&&x.verdict==='CHROMIUM_UI_GUARD_API_PG_PASS_NO_SECOND_POST').length!==2)
   reasons.push('RECEIVE_IDEMPOTENCY_NOT_PROVEN');
 return reasons;
}
async function oracle({client,run8,evidence}){
 const checks=[];
 const check=(key,pass,detail={})=>checks.push({key,pass:Boolean(pass),...detail});
 const q=async(sql,params=[])=>(await client.query(sql,params)).rows;
 const prefix='E2E-HUB-V1-'+run8+'-';
 const references=['KOM-101','KOM-102','KOM-103','LOCAL'].map(s=>prefix+s);
 const orders=await q(
   'SELECT reference,simulation_scope,payment_status::text AS payment_status FROM orders WHERE reference=ANY($1::text[])',
   [references]);
 check('FOUR_OWNED_SIMULATED_ORDERS',orders.length===4&&orders.every(x=>x.simulation_scope==='E2E-HUB-V1'&&x.payment_status==='paid'),
  {count:orders.length});
 const unmanifested=prefix+'UNMANIFESTED';
 const units=await q(
   "SELECT u.id,u.state::text AS state, COUNT(DISTINCT p.id)::int AS allocations, COUNT(DISTINCT e.id)::int AS custody "+
   "FROM hub_physical_units u LEFT JOIN hub_physical_unit_placements p ON p.physical_unit_id=u.id "+
   "LEFT JOIN hub_custody_events e ON e.physical_unit_id=u.id "+
   "WHERE u.reference=$1 GROUP BY u.id,u.state",[unmanifested]);
 check('UNMANIFESTED_RECEIVED_NO_FAKE_PO',units.length===1&&units[0].state==='RECEIVED'&&
   units[0].allocations===0&&units[0].custody>=1,
   {units:units.length,allocations:units[0]?.allocations??null,custody:units[0]?.custody??null});
 const shipmentRef='HTTP-EXP-'+run8;
 const shipments=await q(
   'SELECT id,reference,stage::text AS stage,hub_draft,forwarder_name,transport_mode,customs_shipment_id '+
   'FROM international_shipments WHERE reference=$1',[shipmentRef]);
 const s=shipments[0];
 check('CANONICAL_SHIPMENT_RELAY_RECEIVED',shipments.length===1&&s.hub_draft===true&&
   s.stage==='relay_received'&&Boolean(s.forwarder_name)&&s.transport_mode==='sea'&&
   Boolean(s.customs_shipment_id),
  {shipments:shipments.length,stage:s?.stage||null,hub_draft:s?.hub_draft??null});
 if(s){
  const events=await q(
   'SELECT to_stage::text AS to_stage,proof_ref FROM international_shipment_events WHERE shipment_id=$1',
   [s.id]);
  const expected=['handed_over','forwarder_received','in_transit','arrived','customs_released','local_delivery'];
  check('SIX_DURABLE_SHIPPING_TRANSITIONS',expected.every(stage=>
    events.some(e=>e.to_stage===stage&&Boolean(e.proof_ref))),
   {durable_stages:expected.filter(stage=>events.some(e=>e.to_stage===stage&&Boolean(e.proof_ref)))});
  const links=await q('SELECT u.reference,u.state::text AS state,u.unit_type::text AS type '+
   'FROM international_shipment_hub_units h JOIN hub_physical_units u ON u.id=h.physical_unit_id '+
   'WHERE h.shipment_id=$1',[s.id]);
  const boxRef=evidence?.t_cases?.find(t=>t.id==='T7')?.box_reference;
  check('PHYSICAL_BOX_LINKED_AND_DISPATCHED',links.length===1&&
   links[0].reference===boxRef&&links[0].state==='DISPATCHED',
   {box_links:links.length,box_dispatched:links[0]?.state==='DISPATCHED'});
 }
 // Independently reread the same imported/local parcels whose customer pickups were
 // clicked in Chromium, including the physical counts and absence of a fake local shipment.
 const parcels=await q(
   "SELECT o.reference AS order_reference,p.reference,p.status::text AS status,p.shipment_id,"+
   "p.shipped_at,p.in_transit_at,COUNT(pi.id)::int AS lines,"+
   "COALESCE(SUM(pi.quantity),0)::int AS quantity,"+
   "COALESCE(SUM(pi.qty_shipped),0)::int AS shipped,"+
   "COALESCE(SUM(pi.qty_received),0)::int AS received,"+
   "COALESCE(SUM(pi.qty_collected),0)::int AS collected "+
   "FROM parcels p JOIN orders o ON o.id=p.order_id LEFT JOIN parcel_items pi ON pi.parcel_id=p.id "+
   "WHERE o.reference=ANY($1::text[]) AND p.cancelled_at IS NULL "+
   "GROUP BY o.reference,p.id,p.reference,p.status,p.shipment_id,p.shipped_at,p.in_transit_at",
   [[prefix+'KOM-101',prefix+'LOCAL']]);
 const imported=parcels.filter(x=>x.order_reference===prefix+'KOM-101');
 const local=parcels.filter(x=>x.order_reference===prefix+'LOCAL');
 check('IMPORT_PICKUP_COLLECTED_PHYSICALLY',imported.length>=1&&
   imported.every(x=>x.status==='collected'&&x.lines>0&&x.quantity>0&&
     x.shipped===x.quantity&&x.received===x.quantity&&x.collected===x.quantity),
   {parcels:imported.length,physical_consistent:imported.every(x=>x.quantity>0&&x.collected===x.quantity)});
 check('LOCAL_PICKUP_NO_FAKE_IMPORT_ROUTE',local.length===1&&
   local[0].status==='collected'&&local[0].quantity>0&&local[0].lines>0&&
   local[0].shipped===0&&local[0].received===local[0].quantity&&
   local[0].collected===local[0].quantity&&
   local[0].shipment_id==null&&local[0].shipped_at==null&&local[0].in_transit_at==null,
   {parcels:local.length,local_collected:local[0]?.status==='collected'});
 return checks;
}
async function main(){
 const env=process.env,run8=String(env.E2E_PROOF_RUN8||'');
 const report={schema:'hub-v1-final-sql-oracle/1',scope:'RAILWAY_STAGING_ONLY',run8,
  verdict:'NOT_PROVEN',pg_read_only:true,checks:[],reason:null};
 let client,open=false;
 try{
  if(!RUN.test(run8)||run8!==env.HUB_V1_CERTIFICATION_RUN||
    env.GITHUB_EVENT_NAME!=='issues'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
    env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||env.KOMERCE_ENV!=='staging'||
    env.KOMERCE_TARGET_ENV!=='staging'||env.NODE_ENV!=='test'||
    env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||
    env.STAGING_BASE_URL!==BASE||
    !/^[a-f0-9]{40}$/i.test(String(env.E2E_EXPECTED_DEPLOY_SHA||'')))
   throw Error('FINAL_ORACLE_OWNER_STAGING_GUARD');
  if(!fs.existsSync(SOURCE))throw Error('CHROMIUM_EVIDENCE_MISSING');
  const evidence=JSON.parse(fs.readFileSync(SOURCE,'utf8'));
  for(const reason of evaluateEvidence(evidence,run8))report.checks.push({key:reason,pass:false});
  if(report.checks.length)throw Error('CHROMIUM_PROOF_INCOMPLETE');
  const target=await confirmTarget({db,env});
  if(!target.confirmed)throw Error('STAGING_DB_IDENTITY_MISMATCH');
  const version=await fetch(BASE+'/health/version');
  if(!version.ok||(await version.json()).commit!==env.E2E_EXPECTED_DEPLOY_SHA)
   throw Error('STAGING_DEPLOY_SHA_DRIFT');
  report.sha=env.E2E_EXPECTED_DEPLOY_SHA;
  client=await db.getClient();
  await client.query('BEGIN READ ONLY');open=true;
  await client.query('SET LOCAL statement_timeout = 15000');
  report.checks.push(...await oracle({client,run8,evidence}));
  await client.query('ROLLBACK');open=false;
  if(report.checks.some(c=>!c.pass))throw Error('INDEPENDENT_PG_ORACLE_MISMATCH');
  report.verdict='PASS_CHROMIUM_AND_INDEPENDENT_PG_FINAL';
 }catch(error){report.reason=String(error.message||error).slice(0,200);process.exitCode=2;}
 finally{
  if(open)await client.query('ROLLBACK').catch(()=>{});
  client?.release?.();
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
  console.log('[hub-v1-final-sql] '+JSON.stringify({verdict:report.verdict,
   checks:report.checks.length,failed:report.checks.filter(x=>!x.pass).map(x=>x.key),
   reason:report.reason,sha:report.sha||null}));
  await db.pool?.end?.();
 }
}
if(require.main===module)main().catch(e=>{console.error('FINAL_ORACLE_FATAL:'+String(e.message).slice(0,200));process.exitCode=2;});
module.exports={evaluateEvidence,oracle};
