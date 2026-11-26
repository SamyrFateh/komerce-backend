/**
 * @komerce-arch
 * @role          economic-cost-center-read-model
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, explicit_market_scope, calendar_month
 * @outputs       scoped_centers_families_resources_posts, latest_budget_revisions, outstanding_commitments, explicit_actual_coverage_status
 * @depends       db, middleware/require-pricing-global-authority.js, services/market-delegation-service.js, services/fx-authority.js, services/cost-allocation/real-margin-shadow.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       markets, economic_cost_centers, economic_cost_families, economic_cost_resources, economic_cost_posts, economic_cost_budget_revisions, economic_cost_commitments, economic_cost_commitment_movements, economic_structure_cost_events, international_shipments, international_shipment_events, international_shipment_relay_receipts, international_shipment_hub_units, international_n1_reconciliations, hub_physical_units, hub_box_effective_placements, hub_purchase_allocations, order_items, orders, purchase_lines, supplier_execution_payments, supplier_payment_settlements
 * @db-write      none
 * @db-txn        service_owned_read_only_repeatable_read
 * @doctrine      exact_market_scope, budget_is_not_realized_cost, no_fake_zero, group_raw_not_delegated
 * @impact-areas  economic-engine, finance, market-authorization
 * @version       2026-11
 */
'use strict';
const db = require('../db');
const {parseDecimal,roundHalfEven,convert,FxError}=require('./fx-authority');
const {computePurchaseReal}=require('./cost-allocation/real-margin-shadow');
const {hasPricingGlobalAuthority} = require('../middleware/require-pricing-global-authority');
const {resolveAuthorization} = require('./market-delegation-service');
function error(code,status,message){return Object.assign(new Error(message),{code,status});}
function validate(raw){
  if(!raw || !Object.prototype.hasOwnProperty.call(raw,'marketCode') ||
      (raw.marketCode!==null && !/^[A-Z]{2}$/.test(String(raw.marketCode))))
    throw error('economic_reference_scope_invalid',400,'Périmètre explicite requis');
  if(typeof raw.periodStart!=='string'||!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])-01$/.test(raw.periodStart))
    throw error('economic_reference_period_invalid',400,'Mois invalide');
  return {marketCode:raw.marketCode,periodStart:raw.periodStart};
}
async function resolveScope(client,actor,marketCode,central){
  if(central){
    if(marketCode===null)return null;
    const {rows}=await client.query('SELECT id FROM markets WHERE code=$1',[marketCode]);
    if(!rows.length)throw error('market_not_found',404,'Marché introuvable');
    return rows[0].id;
  }
  if(marketCode===null)throw error('economic_reference_group_forbidden',403,'Périmètre groupe interdit');
  const authz=await resolveAuthorization(client,{userId:actor.id,marketCode,requiredCapability:'pricing.read'});
  if(!authz.market_id)throw error('economic_reference_scope_missing',403,'Périmètre non résolu');
  return authz.market_id;
}
// Server-side aggregation of frozen EUR budget snapshots, never realized cost.
// An incomplete set exposes its coverage and a subtotal, not a complete budget.
function budgetSummary(posts){
  let eur=0n,covered=0;
  for(const p of posts){
    const amount=p.budget?.eur;
    if(typeof amount!=='string'||!/^\d+\.\d{2}$/.test(amount))continue;
    eur+=BigInt(amount.replace('.',''));covered++;
  }
  const digits=eur.toString().padStart(3,'0');
  const recordedEur=covered?digits.slice(0,-2)+'.'+digits.slice(-2):null;
  return {recordedEur,totalEur:posts.length>0&&covered===posts.length?recordedEur:null,coveredPosts:covered,totalPosts:posts.length};
}
// Value the remaining administrative commitment at its frozen opening EUR
// snapshot. This is neither an actual expense nor a fresh FX conversion.
// Corrections of linked facts make the balance non-decisional until reconciled.
function commitmentRemainingEur(k){
  if(k.requires_reconciliation)return null;
  const valid=(v)=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v);
  if(![k.initial_native,k.initial_eur,k.remaining_native].every(valid))return null;
  const a=parseDecimal(k.initial_eur), n=parseDecimal(k.remaining_native), d=parseDecimal(k.initial_native);
  if(d.n<=0n||n.n*d.d>d.n*n.d)return null;
  const cents=roundHalfEven(a.n*n.n*d.d,a.d*n.d*d.n,2);
  const s=cents.toString().padStart(3,'0');
  return s.slice(0,-2)+'.'+s.slice(-2);
}
function commitmentSummary(posts){
  const items=posts.flatMap(p=>p.commitments||[]);
  let cents=0n,covered=0;
  for(const k of items){
    if(k.remaining_eur===null||typeof k.remaining_eur!=='string'||!/^\d+\.\d{2}$/.test(k.remaining_eur))continue;
    cents+=BigInt(k.remaining_eur.replace('.',''));covered++;
  }
  const s=cents.toString().padStart(3,'0');
  const recordedEur=posts.length&&(covered||!items.length)?s.slice(0,-2)+'.'+s.slice(-2):null;
  return {recordedEur,totalEur:covered===items.length?recordedEur:null,coveredCommitments:covered,totalCommitments:items.length,valuation:'FROZEN_OPENING_EUR'};
}
// Evidence subtotal only. Do not project cross-period events using an
// independent allocation rule; the period truth service owns proration.
// Unmapped events remain visible as missing coverage, never a silent zero.
function structureEvidenceSummary(events){
  let cents=0n,included=0,unmapped=0,crossPeriod=0,invalid=0;
  for(const e of events){
    if(!e.post_id){unmapped++;continue;}
    if(e.whole_period!==true){crossPeriod++;continue;}
    if(typeof e.amount_kmf!=='string'||!(/^-?\d+\.\d{2}$/).test(e.amount_kmf)){invalid++;continue;}
    cents+=BigInt(e.amount_kmf.replace('.',''));included++;
  }
  const abs=(cents<0n?-cents:cents).toString().padStart(3,'0');
  const amountKmf=included?(cents<0n?'-':'')+abs.slice(0,-2)+'.'+abs.slice(-2):null;
  return {amountKmf,included,unmapped,crossPeriod,invalid,coverage:'STRUCTURE_EVIDENCE_ONLY'};
}
// Projection of the immutable KMF journal subtotal, not a second expense.
 // The governed fixed parity is read within the same database snapshot.
 // Explicitly identify the projection; never reinterpret original FX evidence.
function structureEurProjector(client){
  const cache=new Map();
  return async function project(events){
    const summary=structureEvidenceSummary(events);
    const empty={...summary,amountEur:null,fxLegs:[],fxStatus:'NO_EVIDENCE'};
    if(summary.amountKmf===null)return empty;
    const amount=summary.amountKmf;
    if(!cache.has(amount)){
      cache.set(amount,(async()=>{
        try{
          const x=await convert({amount,from:'KMF',to:'EUR',client});
          return {amountEur:x.amount_text,fxLegs:x.legs,fxStatus:'GOVERNED_FIXED_PARITY_PROJECTION'};
        }catch(e){
          if(e instanceof FxError&&e.code==='fx_rate_unavailable')
            return {amountEur:null,fxLegs:[],fxStatus:'FX_UNAVAILABLE'};
          throw e;
        }
      })());
    }
    return {...summary,...await cache.get(amount)};
  };
}
// Canonical shipment observation: physical relay receipt, not the date a
// supplier invoice was recorded. Read the per-shipment reconciled snapshot;
// never add historical per-order transport allocations to these amounts.
// Purchase truth belongs to the existing settlement calculator. The flag
// in_order means selected complete purchase lines here, not a second valuation.
// Partial lines, cancelled lines and mixed simulation PO are intentionally
// not valued until a conserved line-to-shipment split is specified.
function shipmentPurchase({lines,payments,settlements}){
  const own=lines.filter(l=>l.in_order);
  if(!own.length||own.some(l=>l.full_line!==true)||lines.some(l=>l.real_order!==true))
    return {amount:null,status:'PURCHASE_SCOPE_INCOMPLETE'};
  const result=computePurchaseReal({lines,payments,settlements});
  if(!result.complete||!Number.isFinite(result.real_kmf)||result.real_kmf<=0||
     !Number.isSafeInteger(Math.round(result.real_kmf*100)))
    return {amount:null,status:'PURCHASE_SETTLEMENT_INCOMPLETE'};
  return {amount:result.real_kmf.toFixed(2),status:'SETTLEMENT_RECONCILED'};
}
async function loadShipmentPurchase(client,shipmentId,marketId){
  const {rows:selection}=await client.query(
    `SELECT a.purchase_line_id AS id,SUM(p.quantity)::int AS shipped,
      BOOL_AND(l.id IS NOT NULL AND l.cancelled_at IS NULL
        AND l.purchase_order_id=a.purchase_order_id AND l.order_item_id=a.order_item_id
        AND o.market_id=$2 AND o.simulation_scope IS NULL) AS valid
      FROM international_shipment_hub_units h
      JOIN hub_box_effective_placements p ON p.box_unit_id=h.physical_unit_id
      JOIN hub_purchase_allocations a ON a.id=p.allocation_id
      LEFT JOIN purchase_lines l ON l.id=a.purchase_line_id
      LEFT JOIN orders o ON o.id=a.order_id
      WHERE h.shipment_id=$1 GROUP BY a.purchase_line_id`,[shipmentId,marketId]);
  if(!selection.length||selection.some(l=>!l.id||l.valid!==true))
    return {amount:null,status:'PURCHASE_SCOPE_INCOMPLETE'};
  const selected=new Map(selection.map(l=>[l.id,l.shipped]));
  const {rows:lines}=await client.query(
    `SELECT l.id,l.purchase_order_id,l.confirmed_at,l.confirmed_quantity,
      l.confirmed_unit_price::text AS confirmed_unit_price,
      COALESCE(l.confirmed_currency,l.supplier_currency) AS supplier_currency,
      l.id=ANY($1::uuid[]) AS in_order,
      (o.id IS NOT NULL AND o.simulation_scope IS NULL) AS real_order,
      NOT EXISTS(SELECT 1 FROM international_shipment_hub_units h
        JOIN hub_box_effective_placements p ON p.box_unit_id=h.physical_unit_id
        JOIN hub_purchase_allocations a ON a.id=p.allocation_id
        WHERE a.purchase_line_id=l.id AND h.shipment_id<>$2) AS exclusive_shipment
      FROM purchase_lines l
      JOIN order_items oi ON oi.id=l.order_item_id JOIN orders o ON o.id=oi.order_id
      WHERE l.cancelled_at IS NULL AND (l.id=ANY($1::uuid[]) OR l.purchase_order_id IN
        (SELECT purchase_order_id FROM purchase_lines WHERE id=ANY($1::uuid[])))
      ORDER BY l.id`,[[...selected.keys()],shipmentId]);
  if(lines.filter(l=>l.in_order).length!==selected.size)
    return {amount:null,status:'PURCHASE_SCOPE_INCOMPLETE'};
  for(const l of lines)if(l.in_order)l.full_line=l.exclusive_shipment===true&&l.confirmed_quantity===selected.get(l.id);
  if(lines.some(l=>l.in_order&&!l.full_line)||lines.some(l=>!l.real_order))
    return {amount:null,status:'PURCHASE_SCOPE_INCOMPLETE'};
  const poIds=[...new Set(lines.map(l=>l.purchase_order_id).filter(Boolean))];
  const {rows:payments}=await client.query(
    'SELECT id,purchase_order_id,status,real_debit_verified,reconciliation_status,currency FROM supplier_execution_payments WHERE purchase_order_id=ANY($1::uuid[])',[poIds]);
  const {rows:settlements}=await client.query(
    `SELECT supplier_execution_payment_id,kind,amount_currency::text AS amount_currency,currency,
      amount_kmf::text AS amount_kmf,fees_kmf::text AS fees_kmf
      FROM supplier_payment_settlements WHERE supplier_execution_payment_id=ANY($1::uuid[])`,[payments.map(p=>p.id)]);
  return shipmentPurchase({lines,payments,settlements});
}
function shipmentActivity(rows){
  const money=v=>typeof v==='string'&&/^\d+\.\d{2}$/.test(v)?BigInt(v.replace('.','')):null;
  const display=v=>{const s=v.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
  const grams=v=>{if(typeof v!=='string'||!/^\d{1,9}(?:\.\d{1,3})?$/.test(v))return null;const [a,b='']=v.split('.');const n=BigInt(a+b.padEnd(3,'0'));return n>0n?n:null;};
  const kg=v=>{const s=v.toString().padStart(4,'0');return s.slice(0,-3)+'.'+s.slice(-3);};
  const costPerKg=(cents,g)=>display(roundHalfEven(cents*10n,g,2));
  const volumeUnits=v=>{if(typeof v!=='string'||!/^\d{1,12}(?:\.\d{1,5})?$/.test(v))return null;const [a,b='']=v.split('.');const n=BigInt(a+b.padEnd(5,'0'));return n>0n?n:null;};
  const volumeText=v=>{const s=v.toString().padStart(6,'0');return s.slice(0,-5)+'.'+s.slice(-5);};
  const sumCount=field=>rows.length&&rows.every(r=>Number.isSafeInteger(r[field])&&r[field]>=0)?rows.reduce((n,r)=>n+BigInt(r[field]),0n).toString():null;
  let documented=0n,freightCustoms=0n,closed=0,allWeight=0n,weightedWeight=0n,weightedCost=0n,weightCount=0,weightedCount=0,purchases=0n,purchaseCount=0,pairedPurchase=0n,pairedTransport=0n,pairedCount=0,pairedFreightCustoms=0n,volume=0n,volumeCount=0,minKg=null,maxKg=null;
  const shipments=rows.map(s=>{
    const amounts=[s.freight_kmf,s.customs_kmf,s.arrival_kmf,s.local_kmf,s.customs_fees_kmf,s.documented_kmf].map(money);
    const complete=Boolean(s.financial_closed_at&&s.financial_close_proof_ref&&s.snapshot_hash&&s.freight_known===true&&
      s.allocation_rows===0&&new Date(s.financial_closed_at)>=new Date(s.physical_closed_at)&&amounts.every(v=>v!==null)&&
      amounts.slice(0,5).reduce((sum,v)=>sum+v,0n)===amounts[5]);
    const transport=complete?amounts[0]+amounts[1]:null;
    if(complete){closed++;documented+=amounts[5];freightCustoms+=transport;}
    const g=s.weight_basis==='MEASURED_GROSS_KG'&&s.weight_proof_ref?grams(s.actual_weight_kg):null;
    if(g!==null){weightCount++;allWeight+=g;if(complete){weightedCount++;weightedWeight+=g;weightedCost+=amounts[5];
      const ratio=roundHalfEven(amounts[5]*10n,g,2);if(minKg===null||ratio<minKg)minKg=ratio;if(maxKg===null||ratio>maxKg)maxKg=ratio;}}
    const v=volumeUnits(s.volume_m3);if(v!==null){volumeCount++;volume+=v;}
    const purchase=money(s.purchase?.amount);
    if(purchase!==null){purchaseCount++;purchases+=purchase;if(complete&&purchase>0n){pairedCount++;pairedPurchase+=purchase;pairedTransport+=amounts[5];pairedFreightCustoms+=transport;}}
    return {reference:s.reference,rail:s.rail,physicalClosedAt:s.physical_closed_at,
      financialClosedAt:s.financial_closed_at||null,financialStatus:complete?'DOCUMENTED_CLOSED':'NOT_RECONCILED',
      volumeM3:s.volume_m3,boxCount:s.box_count,expectedArticles:s.expected_articles,receivedArticles:s.received_articles,
      freightCustomsKmf:complete?display(transport):null,documentedTransportKmf:complete?display(amounts[5]):null,
      freightKmf:complete?s.freight_kmf:null,customsKmf:complete?s.customs_kmf:null,
      arrivalFeesKmf:complete?display(amounts[2]+amounts[4]):null,localTransportKmf:complete?s.local_kmf:null,
      weightKg:g===null?null:kg(g),weightProofRef:g===null?null:s.weight_proof_ref,weightBasis:g===null?null:'MEASURED_GROSS_KG',purchaseKmf:purchase===null?null:display(purchase),purchaseStatus:s.purchase?.status||'PURCHASE_SCOPE_INCOMPLETE',costPerKgKmf:complete&&g!==null?costPerKg(amounts[5],g):null};
  });
  return {cohort:'RELAY_RECEIPT_MONTH_UTC',scopeCoverage:'EXACT_MARKET_NON_SIMULATED',
    physicalClosedCount:shipments.length,financialClosedCount:closed,
    boxCount:sumCount('box_count'),expectedArticles:sumCount('expected_articles'),receivedArticles:sumCount('received_articles'),
    volumeM3:shipments.length&&volumeCount===shipments.length?volumeText(volume):null,volumeSubtotalM3:volumeCount?volumeText(volume):null,volumeCoveredCount:volumeCount,
    documentedTransportSubtotalKmf:closed?display(documented):null,
    freightCustomsSubtotalKmf:closed?display(freightCustoms):null,
    documentedTransportTotalKmf:shipments.length&&closed===shipments.length?display(documented):null,
    coverage:!shipments.length?'NO_OBSERVATIONS':closed===shipments.length?'TRANSPORT_DOCUMENTED':'PARTIAL',
    weightKg:shipments.length&&weightCount===shipments.length?kg(allWeight):null,measuredWeightSubtotalKg:weightCount?kg(allWeight):null,measuredWeightCount:weightCount,
    weightedTransportKmf:weightedCount?display(weightedCost):null,weightedWeightKg:weightedCount?kg(weightedWeight):null,
    weightedShipmentCount:weightedCount,costPerKgKmf:weightedCount?costPerKg(weightedCost,weightedWeight):null,
    minCostPerKgKmf:minKg===null?null:display(minKg),maxCostPerKgKmf:maxKg===null?null:display(maxKg),
    costPerKgCoverage:!weightedCount?'NO_WEIGHTED_OBSERVATIONS':weightedCount===shipments.length?'COMPLETE':'PARTIAL',purchaseKmf:shipments.length&&purchaseCount===shipments.length?display(purchases):null,
    purchaseSubtotalKmf:purchaseCount?display(purchases):null,purchaseCoveredCount:purchaseCount,
    purchaseTransportObservation:{purchaseKmf:pairedCount?display(pairedPurchase):null,transportKmf:pairedCount?display(pairedTransport):null,
      freightCustomsKmf:pairedCount?display(pairedFreightCustoms):null,otherTransportKmf:pairedCount?display(pairedTransport-pairedFreightCustoms):null,
      documentedSubtotalKmf:pairedCount?display(pairedPurchase+pairedTransport):null,fullEconomicCostKmf:null,
      observations:pairedCount,coefficient:pairedCount?(()=>{const n=roundHalfEven(pairedPurchase+pairedTransport,pairedPurchase,4).toString().padStart(5,'0');return n.slice(0,-4)+'.'+n.slice(-4);})():null,
      coverage:!pairedCount?'NO_OBSERVATIONS':pairedCount===shipments.length?'COMPLETE_FOR_PURCHASE_TRANSPORT_ONLY':'PARTIAL',scope:'PURCHASE_PLUS_DOCUMENTED_TRANSPORT_ONLY',decisional:false},shipments};
}
// All series use the same receipt cohort and the same read snapshot.
function monthShift(month,offset){
  const d=new Date(month+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,10);
}
function observedProfitability(rows,periodStart){
  const year=periodStart.slice(0,4)+'-01-01';
  const months=Number(periodStart.slice(5,7));
  const select=(from,to)=>rows.filter(r=>{const t=new Date(r.physical_closed_at).toISOString().slice(0,10);return t>=from&&t<to;});
  function observation(from,to){
    const a=shipmentActivity(select(from,to)),o=a.purchaseTransportObservation;
    return {...o,physicalClosedCount:a.physicalClosedCount,financialClosedCount:a.financialClosedCount,
      measuredWeightKg:a.measuredWeightSubtotalKg,measuredWeightCount:a.measuredWeightCount,periodStart:from,periodEndExclusive:to};
  }
  const points=Array.from({length:months},(_,i)=>{
    const start=monthShift(year,i),end=monthShift(start,1);
    return {periodStart:start,monthly:observation(start,end),cumulative:observation(year,end),rolling3:observation(monthShift(start,-2),end)};
  });
  const end=monthShift(periodStart,1),quarter=monthShift(year,Math.floor((months-1)/3)*3);
  return {basis:'PURCHASE_PLUS_DOCUMENTED_TRANSPORT_ONLY',decisional:false,periodStart,points,
    ranges:{month:observation(periodStart,end),quarter:observation(quarter,end),ytd:observation(year,end)},
    netSalesKmf:null,variableContributionKmf:null,economicResultKmf:null,fullCoefficient:null,structureCoverage:null};
}
async function loadShipmentActivity(client,marketId,periodStart,{includeHistory=false}={}){
  if(marketId===null)return null; // GROUP-only centers are not all markets.
  const from=includeHistory?monthShift(periodStart.slice(0,4)+'-01-01',-2):periodStart;
  const until=monthShift(periodStart,1);
  const {rows}=await client.query(
    `SELECT s.id AS shipment_id,s.reference,s.transport_mode AS rail,s.volume_m3::text AS volume_m3,
      physical.closed_at AS physical_closed_at,receipt.expected_articles,receipt.received_articles,
      weight.actual_weight_kg,weight.weight_basis,weight.weight_proof_ref,
      (SELECT COUNT(*)::int FROM international_shipment_hub_units h WHERE h.shipment_id=s.id) AS box_count,
      n.financial_closed_at,n.financial_close_proof_ref,n.snapshot_hash,n.freight_known,n.allocation_rows,
      n.total_freight_kmf::text AS freight_kmf,n.total_customs_kmf::text AS customs_kmf,
      n.total_arrival_kmf::text AS arrival_kmf,n.total_local_kmf::text AS local_kmf,
      n.total_customs_fees_kmf::text AS customs_fees_kmf,n.documented_total_kmf::text AS documented_kmf
     FROM international_shipments s
     JOIN LATERAL (
       SELECT MIN(e.occurred_at) AS closed_at FROM international_shipment_events e
       WHERE e.shipment_id=s.id AND e.event_type='stage_changed' AND e.to_stage='relay_received'
         AND e.payload->>'attested_by'='relay' AND length(btrim(e.proof_ref))>0
     ) physical ON physical.closed_at IS NOT NULL
     JOIN LATERAL (
       WITH expected AS (
         SELECT a.order_item_id,SUM(pl.quantity)::int AS expected_qty,
           BOOL_AND(o.id IS NOT NULL AND o.market_id IS NOT DISTINCT FROM s.market_id
             AND o.simulation_scope IS NULL AND u.market_id IS NOT DISTINCT FROM s.market_id
             AND u.outcome_type IS NULL AND o.relais_id IS NOT NULL
             AND a.order_id IS NOT DISTINCT FROM oi.order_id) AS market_ok
         FROM international_shipment_hub_units h
         JOIN hub_physical_units u ON u.id=h.physical_unit_id AND u.unit_type='MARKET_PARCEL'
         JOIN hub_box_effective_placements pl ON pl.box_unit_id=u.id
         JOIN hub_purchase_allocations a ON a.id=pl.allocation_id
         LEFT JOIN order_items oi ON oi.id=a.order_item_id
         LEFT JOIN orders o ON o.id=oi.order_id
         WHERE h.shipment_id=s.id GROUP BY a.order_item_id
       ), attested AS (
         SELECT rr.order_item_id,rr.expected_qty,rr.received_qty,rr.received_at,
           rr.relais_id IS NOT DISTINCT FROM o.relais_id AS relay_ok
         FROM international_shipment_relay_receipts rr
         LEFT JOIN order_items oi ON oi.id=rr.order_item_id
         LEFT JOIN orders o ON o.id=oi.order_id WHERE rr.shipment_id=s.id
       )
       SELECT COUNT(*)::int AS n,SUM(x.expected_qty)::int AS expected_articles,
         SUM(rr.received_qty)::int AS received_articles,MAX(rr.received_at) AS last_received,
         BOOL_AND(x.order_item_id IS NOT NULL AND rr.order_item_id IS NOT NULL
           AND x.market_ok IS TRUE AND rr.relay_ok IS TRUE AND rr.expected_qty=x.expected_qty) AS real_market
       FROM expected x FULL JOIN attested rr USING (order_item_id)
     ) receipt ON receipt.n>0 AND receipt.real_market IS TRUE AND receipt.last_received<=physical.closed_at
     LEFT JOIN international_n1_reconciliations n ON n.shipment_id=s.id
     LEFT JOIN LATERAL (
       SELECT MIN(e.payload->>'actual_weight_kg') AS actual_weight_kg,MIN(e.payload->>'weight_basis') AS weight_basis,
         MIN(e.payload->>'weight_proof_ref') AS weight_proof_ref
       FROM international_shipment_events e
       WHERE e.shipment_id=s.id AND e.event_type='freight_recorded' AND e.proof_ref=s.freight_invoice_ref
         AND e.payload->>'weight_basis'='MEASURED_GROSS_KG'
         AND length(btrim(e.payload->>'weight_proof_ref')) BETWEEN 1 AND 240
         AND (n.financial_closed_at IS NULL OR e.occurred_at<=n.financial_closed_at)
       HAVING COUNT(*)=1
     ) weight ON true
     WHERE s.market_id=$1 AND s.stage='relay_received'
       AND physical.closed_at>=($2::date::timestamp AT TIME ZONE 'UTC')
       AND physical.closed_at<($3::date::timestamp AT TIME ZONE 'UTC')
     ORDER BY physical.closed_at,s.reference`,[marketId,from,until]);
  for(const row of rows)row.purchase=await loadShipmentPurchase(client,row.shipment_id,marketId);
  if(!includeHistory)return shipmentActivity(rows);
  return {activity:shipmentActivity(rows.filter(r=>new Date(r.physical_closed_at).toISOString().slice(0,10)>=periodStart)),profitability:observedProfitability(rows,periodStart)};
}
async function readCostCenters(actor,raw){
  if(!actor?.id)throw error('AUTH_REQUIRED',401,'Authentification requise');
  const input=validate(raw);
  const central=actor.role==='admin' && await hasPricingGlobalAuthority(actor.id);
  const client=await db.getClient();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const marketId=await resolveScope(client,actor,input.marketCode,central);
    const {rows:centers}=await client.query(
      'SELECT id,code,label,responsible_user_id,is_active FROM economic_cost_centers WHERE market_id IS NOT DISTINCT FROM $1::uuid ORDER BY code,id',[marketId]);
    const {rows:families}=await client.query(
      'SELECT f.id,f.center_id,f.code,f.label FROM economic_cost_families f JOIN economic_cost_centers c ON c.id=f.center_id WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY f.code,f.id',[marketId]);
    const {rows:resources}=await client.query(
      'SELECT r.id,r.center_id,r.code,r.label,r.resource_kind FROM economic_cost_resources r JOIN economic_cost_centers c ON c.id=r.center_id WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY r.code,r.id',[marketId]);
    const {rows:posts}=await client.query(
      `SELECT p.id,p.center_id,p.family_id,p.resource_id,p.code,p.label,p.economic_nature,p.allocation_perimeter,p.allocation_basis,
        b.revision AS budget_revision,b.currency AS budget_currency,b.amount_native::text AS budget_native,b.amount_eur::text AS budget_eur
       FROM economic_cost_posts p JOIN economic_cost_centers c ON c.id=p.center_id
       LEFT JOIN LATERAL (
          SELECT revision,currency,amount_native,amount_eur FROM economic_cost_budget_revisions
          WHERE post_id=p.id AND period_start=$2::date ORDER BY revision DESC LIMIT 1
       ) b ON true
       WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY p.code,p.id`,[marketId,input.periodStart]);
    const {rows:commitments}=await client.query(
      `SELECT k.id,k.post_id,k.currency,k.amount_native::text AS initial_native,k.amount_eur::text AS initial_eur,
         (k.amount_native-COALESCE(m.used,0))::text AS remaining_native,
         COALESCE(m.has_correction,false) AS requires_reconciliation
       FROM economic_cost_commitments k
       JOIN economic_cost_posts p ON p.id=k.post_id
       JOIN economic_cost_centers c ON c.id=p.center_id
       LEFT JOIN LATERAL (
         SELECT SUM(x.amount_native) AS used,BOOL_OR(EXISTS (
           SELECT 1 FROM economic_structure_cost_events e WHERE e.adjusts_event_id=x.structure_event_id
         )) AS has_correction FROM economic_cost_commitment_movements x WHERE x.commitment_id=k.id
       ) m ON true
       WHERE c.market_id IS NOT DISTINCT FROM $1::uuid AND k.period_start=$2::date ORDER BY k.id`,[marketId,input.periodStart]);
    const {rows:structureEvents}=await client.query(
      `SELECT e.id,p.id AS post_id,p.center_id,e.amount_kmf::text AS amount_kmf,
        (e.economic_from>=($2::date::timestamp AT TIME ZONE 'UTC')
          AND e.economic_to<=(($2::date+interval '1 month') AT TIME ZONE 'UTC')) AS whole_period
       FROM economic_structure_cost_events e
       LEFT JOIN economic_cost_posts p ON p.structure_charge_id=e.charge_id
         AND EXISTS (SELECT 1 FROM economic_cost_centers c WHERE c.id=p.center_id AND c.market_id IS NOT DISTINCT FROM $1::uuid)
       WHERE e.market_id IS NOT DISTINCT FROM $1::uuid
         AND e.economic_from < (($2::date+interval '1 month') AT TIME ZONE 'UTC')
         AND e.economic_to > ($2::date::timestamp AT TIME ZONE 'UTC')
       ORDER BY e.id`,[marketId,input.periodStart]);
    const byPost=new Map();
    for(const k of commitments){if(!byPost.has(k.post_id))byPost.set(k.post_id,[]);byPost.get(k.post_id).push({...k,remaining_eur:commitmentRemainingEur(k)});}
    const projectStructure=structureEurProjector(client);
    const model=await Promise.all(posts.map(async p=>({...p,budget:p.budget_revision===null?null:{revision:p.budget_revision,currency:p.budget_currency,native:p.budget_native,eur:p.budget_eur},
      commitments:byPost.get(p.id)||[],structureEvidence:await projectStructure(structureEvents.filter(e=>e.post_id===p.id)),actual:null,available:null,coverage:'NOT_RECONCILED'})));
    const centerModels=await Promise.all(centers.map(async c=>({...c,budgetSummary:budgetSummary(model.filter(p=>p.center_id===c.id)),commitmentSummary:commitmentSummary(model.filter(p=>p.center_id===c.id)),structureEvidence:await projectStructure(structureEvents.filter(e=>e.center_id===c.id))})));
    const structureEvidence=await projectStructure(structureEvents);
    const history=await loadShipmentActivity(client,marketId,input.periodStart,{includeHistory:true});
    const activity=history?.activity??null,profitability=history?.profitability??null;
    await client.query('COMMIT');
    return {scope:input.marketCode===null?'GROUP':'MARKET',marketCode:input.marketCode,periodStart:input.periodStart,central,readOnly:true,
      centers:centerModels,families,resources,posts:model,budgetSummary:budgetSummary(model),commitmentSummary:commitmentSummary(model),structureEvidence,activity,profitability,actualCoverage:'NOT_RECONCILED',available:null};
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}
}
module.exports={readCostCenters,budgetSummary,commitmentRemainingEur,commitmentSummary,structureEvidenceSummary,structureEurProjector,shipmentActivity,loadShipmentActivity,shipmentPurchase,observedProfitability};
