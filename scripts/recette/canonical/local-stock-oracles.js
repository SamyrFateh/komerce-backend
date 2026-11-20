/** @komerce-arch-lite
 * @role g6-m02-local-stock-oracles
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Read-only M02 PostgreSQL oracles: zero Hub/PO/transport, O-FIN (G6_FINANCE_SQL_ORACLES.sql), O-DOC, O-NOTIF.
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {snapshot}=require('../staging-local-stock-real-relay-cert');
const FIN_SQL=path.resolve(__dirname,'../../../docs/recette/G6_FINANCE_SQL_ORACLES.sql');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Assertions négatives : une commande LOCAL_STOCK ne touche ni PO, ni Hub, ni transport import.
async function assertNoHubOrTransport(db,orderId,phase){
 const s=await snapshot(db,orderId),c=s.counts,bad=[];
 for(const k of ['purchase_lines','purchase_orders','hub_allocations','hub_units','shipment_receipts',
  'shipped_scans','shipped_scan_events','shipping_history'])if(Number(c[k])!==0)bad.push(k);
 const lines=s.lines;
 if(!lines.length||lines.some(l=>l.fulfillment_source!=='LOCAL_STOCK'))bad.push('fulfillment_not_local');
 if(s.parcels.some(p=>p.shipment_id!=null||p.shipped_at!=null||p.in_transit_at!=null))bad.push('parcel_in_transport');
 const {rows:[x]}=await db.query(
  `SELECT (SELECT count(*)::int FROM international_shipments sh JOIN parcels p ON p.shipment_id=sh.id WHERE p.order_id=$1) AS shipments,
          (SELECT count(*)::int FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1) AS po_lines`,[orderId]);
 if(x.shipments!==0||x.po_lines!==0)bad.push('shipment_or_po_line');
 const parcels=s.parcels.length,expect={any:null,cash:0,available:1,collected:1}[phase];
 if(expect===undefined)throw Error('G6_M02_PHASE_UNKNOWN');
 // 'any' : contrôle de non-régression à tout moment (zéro Hub/PO/transport, provenance locale) ; les autres phases fixent l'état attendu.
 if(expect!==null&&parcels!==expect)bad.push('parcel_count_'+parcels);
 if(phase!=='cash'){
  const want=phase==='collected'?'collected':'available',qty=lines.reduce((n,l)=>n+Number(l.quantity),0);
  if(s.order.status!==want||s.parcels[0].status!==want)bad.push('status_not_'+want);
  if(lines.some(l=>Number(l.qty_received)!==Number(l.quantity)||
   Number(l.qty_collected)!==(phase==='collected'?Number(l.quantity):0)))bad.push('physical_lines_not_'+want);
  if(Number(c.relay_receipts)!==1||Number(c.available_history)!==1)bad.push('receipt_or_history_count');
  if(phase==='collected'&&Number(c.collected_history)!==1)bad.push('collected_history_count');
  if(Number(c.consumed_allocations)!==qty)bad.push('allocations_not_consumed');
 }
 if(phase!=='any'&&Number(c.cash_collections)!==1)bad.push('cash_collections_not_1');
 if(bad.length)throw Error('G6_M02_PG_NEGATIVE_ASSERTION_FAILED_'+phase+':'+bad.join(','));
 return {phase,hub_objects:0,purchase_orders:0,transport:0,parcels,order_status:s.order.status};
}
function finStatements(text=fs.readFileSync(FIN_SQL,'utf8')){
 const out=[];let label='',buf=[];
 for(const line of text.split('\n')){
  const m=/^-- (I\d+)\b/.exec(line);
  if(m){label=m[1];continue}
  if(/^\s*--/.test(line)||!line.trim())continue;
  buf.push(line);
  if(/;\s*$/.test(line)){out.push({label,sql:buf.join('\n').replace(/;\s*$/,'')});buf=[]}
 }
 return out;
}
// O-FIN : les requêtes I1..I15 sont rejouées telles quelles ; une ligne qui nomme la commande est une anomalie,
// les lignes hors cohorte (stock préexistant) sont comptées sans être qualifiées.
async function financeOracle(db,{orderId,reference,statements=finStatements()}){
 const violations=[];let outside=0;
 for(const st of statements){
  const {rows}=await db.query(st.sql);
  for(const row of rows){
   const j=JSON.stringify(row);
   if(j.includes(orderId)||j.includes(reference))violations.push(st.label);else outside++;
  }
 }
 if(violations.length)throw Error('G6_M02_O_FIN_VIOLATION_'+[...new Set(violations)].join(','));
 return {statements:statements.length,cohort_violations:0,outside_cohort_rows:outside};
}
async function documentOracle(db,{orderId,scanId=null,attempts=6}){
 let last;
 for(let i=0;i<attempts;i++){
  const {rows:[inv]}=await db.query('SELECT count(*)::int n FROM invoices WHERE order_id=$1',[orderId]);
  const {rows:docs}=await db.query('SELECT document_type,subject_type,subject_id,pdf_sha256 FROM transaction_documents WHERE order_id=$1',[orderId]);
  const proof=docs.filter(d=>d.document_type==='pickup_proof'&&d.subject_type==='pickup_handoff'&&(!scanId||d.subject_id===scanId));
  const bad=docs.filter(d=>/purchase|supplier|customs|refund/i.test(d.document_type));
  last={invoices:inv.n,pickup_proofs:proof.length,forbidden:bad.map(d=>d.document_type)};
  if(inv.n===1&&(scanId?proof.length===1:true)&&!bad.length&&proof.every(d=>/^[a-f0-9]{64}$/.test(String(d.pdf_sha256||''))))return {...last,pickup_proof_expected:!!scanId};
  await sleep(4000);
 }
 throw Error('G6_M02_O_DOC_INVALID_'+JSON.stringify(last));
}
async function notificationOracle(db,{orderId,reference}){
 const {rows}=await db.query('SELECT event_key,count(*)::int n FROM client_notifications WHERE entity_id=$1 GROUP BY event_key',[orderId]);
 const dup=rows.filter(r=>r.n>1).map(r=>r.event_key),transport=rows.filter(r=>/in_transit|shipped/.test(r.event_key)).map(r=>r.event_key);
 const {rows:logs}=await db.query('SELECT status,count(*)::int n FROM notification_log WHERE order_ref=$1 GROUP BY status',[reference]);
 const sent=logs.filter(r=>r.status==='sent').reduce((n,r)=>n+r.n,0);
 if(dup.length||transport.length||sent)
  throw Error('G6_M02_O_NOTIF_INVALID_dup='+dup+'_transport='+transport+'_sent='+sent);
 return {in_app_events:Object.fromEntries(rows.map(r=>[r.event_key,r.n])),log_statuses:Object.fromEntries(logs.map(r=>[r.status,r.n])),real_sends:0};
}
module.exports={assertNoHubOrTransport,financeOracle,documentOracle,notificationOracle,finStatements};
