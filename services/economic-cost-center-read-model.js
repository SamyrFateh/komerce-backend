/**
 * @komerce-arch
 * @role          economic-cost-center-read-model
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, explicit_market_scope, calendar_month
 * @outputs       scoped_centers_families_resources_posts, latest_budget_revisions, outstanding_commitments, explicit_actual_coverage_status
 * @depends       db, middleware/require-pricing-global-authority.js, services/market-delegation-service.js, services/fx-authority.js, services/cost-allocation/real-margin-shadow.js, services/economic-cost-write-authority.js, services/economic-cost-reference-service.js, services/pricing-period-structure.js, services/customer-handoff-reconciliation.js, services/cost-allocation/cost-types.js, services/cost-allocation/cost-expectation.js, services/pricing-risk-period.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       markets, users, economic_cost_centers, economic_cost_families, economic_cost_resources, economic_cost_posts, economic_cost_budget_revisions, economic_cost_commitments, economic_cost_commitment_movements, economic_structure_cost_events, international_shipments, international_shipment_events, international_shipment_relay_receipts, international_shipment_hub_units, international_n1_reconciliations, hub_physical_units, hub_box_effective_placements, hub_purchase_allocations, order_items, orders, purchase_lines, supplier_execution_payments, supplier_payment_settlements, refunds, international_shipment_charges, customs_shipments, customs_shipment_parcels, parcels, parcel_items, scans, order_item_real_cost_allocations, economic_group_period_closures, economic_risk_cost_events, economic_risk_watermark_events
 * @db-write      economic_group_period_closures
 * @db-txn        service_owned_read_only_repeatable_read_and_serializable_close
 * @doctrine      exact_market_scope, budget_is_not_realized_cost, no_fake_zero, group_raw_not_delegated
 * @impact-areas  economic-engine, finance, market-authorization
 * @version       2026-11
 */
'use strict';
const db = require('../db');
const {createHash}=require('node:crypto');
const {parseDecimal,roundHalfEven,convert,FxError}=require('./fx-authority');
const {computePurchaseReal}=require('./cost-allocation/real-margin-shadow');
const {computePeriodStructureTruth}=require('./pricing-period-structure');
const {computePeriodRiskTruth}=require('./pricing-risk-period');
const {classifyProof}=require('./customer-handoff-reconciliation');
const {RECONCILIABLE_VARIABLE_COST_TYPES}=require('./cost-allocation/cost-types');
const {LEGACY_UNJUSTIFIED_SOURCE,expectedTypes}=require('./cost-allocation/cost-expectation');
const {hasPricingGlobalAuthority} = require('../middleware/require-pricing-global-authority');
const {resolveAuthorization} = require('./market-delegation-service');
const costAuthority=require('./economic-cost-write-authority');
const {listResponsibleCandidates}=require('./economic-cost-reference-service');
function error(code,status,message){return Object.assign(new Error(message),{code,status});}
function validate(raw){
  if(!raw || !Object.prototype.hasOwnProperty.call(raw,'marketCode') ||
      (raw.marketCode!==null && !/^[A-Z]{2}$/.test(String(raw.marketCode))))
    throw error('economic_reference_scope_invalid',400,'Périmètre explicite requis');
  if(typeof raw.periodStart!=='string'||!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])-01$/.test(raw.periodStart))
    throw error('economic_reference_period_invalid',400,'Mois invalide');
  return {marketCode:raw.marketCode,periodStart:raw.periodStart};
}
async function resolveScope(client,actor,marketCode,globalRead){
  if(globalRead){
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
function cents(value){return typeof value==='string'&&/^-?\d+\.\d{2}$/.test(value)?BigInt(value.replace('.','')):null;}
function eurString(value){const abs=(value<0n?-value:value).toString().padStart(3,'0');return (value<0n?'-':'')+abs.slice(0,-2)+'.'+abs.slice(-2);}
// Recorded-only balance is explicitly not the full economic availability:
// no inference that a missing invoice is a zero charge. Unmapped/cross-period
// facts and corrected commitments prevent a misleading balance.
function recordedPostBalance(post){
  const budget=cents(post.budget?.eur),committed=cents(commitmentSummary([post]).totalEur),actual=cents(post.structureEvidence?.amountEur);
  const e=post.structureEvidence;
  if(!post.acceptsStructureActual||budget===null||committed===null||actual===null||!e||e.unmapped||e.crossPeriod||e.invalid)
    return {recordedActualEur:actual===null?null:eurString(actual),recordedAvailableEur:null,status:'NOT_RECONCILED',decisional:false};
  const available=budget-committed-actual;
  return {recordedActualEur:eurString(actual),recordedAvailableEur:eurString(available),status:available<0n?'RECORDED_OVER_BUDGET':'RECORDED_BALANCE',decisional:false};
}
function recordedBalanceSummary(posts){
  let sum=0n,actual=0n,covered=0,actualCovered=0;
  for(const p of posts){
    const balance=p.recordedBalance||recordedPostBalance(p),a=cents(balance.recordedActualEur),b=cents(balance.recordedAvailableEur);
    if(a!==null){actual+=a;actualCovered++;}
    if(b!==null){sum+=b;covered++;}
  }
  return {recordedActualEur:actualCovered?eurString(actual):null,recordedAvailableEur:covered===posts.length&&covered>0?eurString(sum):null,partialAvailableEur:covered?eurString(sum):null,coveredPosts:covered,totalPosts:posts.length,status:covered===posts.length&&covered>0?(sum<0n?'RECORDED_OVER_BUDGET':'RECORDED_BALANCE'):'NOT_RECONCILED',decisional:false};
}
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
function shipmentActivity(rows,scopeCoverage='EXACT_MARKET_NON_SIMULATED'){
  const money=v=>typeof v==='string'&&/^\d+\.\d{2}$/.test(v)?BigInt(v.replace('.','')):null;
  const display=v=>{const s=v.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
  const grams=v=>{if(typeof v!=='string'||!/^\d{1,9}(?:\.\d{1,3})?$/.test(v))return null;const [a,b='']=v.split('.');const n=BigInt(a+b.padEnd(3,'0'));return n>0n?n:null;};
  const kg=v=>{const s=v.toString().padStart(4,'0');return s.slice(0,-3)+'.'+s.slice(-3);};
  const costPerKg=(cents,g)=>display(roundHalfEven(cents*10n,g,2));
  const volumeUnits=v=>{if(typeof v!=='string'||!/^\d{1,12}(?:\.\d{1,5})?$/.test(v))return null;const [a,b='']=v.split('.');const n=BigInt(a+b.padEnd(5,'0'));return n>0n?n:null;};
  const volumeText=v=>{const s=v.toString().padStart(6,'0');return s.slice(0,-5)+'.'+s.slice(-5);};
  const sumCount=field=>rows.length&&rows.every(r=>Number.isSafeInteger(r[field])&&r[field]>=0)?rows.reduce((n,r)=>n+BigInt(r[field]),0n).toString():null;
  let documented=0n,freightCustoms=0n,closed=0,allWeight=0n,weightedWeight=0n,weightedCost=0n,weightCount=0,weightedCount=0,purchases=0n,purchaseCount=0,pairedPurchase=0n,pairedTransport=0n,pairedCount=0,pairedFreightCustoms=0n,volume=0n,volumeCount=0,minKg=null,maxKg=null;
  let minCoefficient=null,maxCoefficient=null,pairedWeight=0n,pairedWeightCount=0;
  const formatCoefficient=value=>{
    if(value===null)return null;
    const digits=value.toString().padStart(5,'0');
    return digits.slice(0,-4)+'.'+digits.slice(-4);
  };
  const shipments=rows.map(s=>{
    const amounts=[s.freight_kmf,s.customs_kmf,s.arrival_kmf,s.local_kmf,s.customs_fees_kmf,s.documented_kmf].map(money);
    const stale=s.reconciliation_stale===true;
    const complete=Boolean(!stale&&s.financial_closed_at&&s.financial_close_proof_ref&&s.snapshot_hash&&s.freight_known===true&&
      s.allocation_rows===0&&new Date(s.financial_closed_at)>=new Date(s.physical_closed_at)&&amounts.every(v=>v!==null)&&
      amounts.slice(0,5).reduce((sum,v)=>sum+v,0n)===amounts[5]);
    const transport=complete?amounts[0]+amounts[1]:null;
    if(complete){closed++;documented+=amounts[5];freightCustoms+=transport;}
    const g=s.weight_basis==='MEASURED_GROSS_KG'&&s.weight_proof_ref?grams(s.actual_weight_kg):null;
    if(g!==null){weightCount++;allWeight+=g;if(complete){weightedCount++;weightedWeight+=g;weightedCost+=amounts[5];
      const ratio=roundHalfEven(amounts[5]*10n,g,2);if(minKg===null||ratio<minKg)minKg=ratio;if(maxKg===null||ratio>maxKg)maxKg=ratio;}}
    const v=volumeUnits(s.volume_m3);if(v!==null){volumeCount++;volume+=v;}
    const purchase=money(s.purchase?.amount);
    if(purchase!==null){purchaseCount++;purchases+=purchase;}
    if(complete&&purchase!==null&&purchase>0n){
      pairedCount++;pairedPurchase+=purchase;pairedTransport+=amounts[5];pairedFreightCustoms+=transport;
      if(g!==null){pairedWeight+=g;pairedWeightCount++;}
      const coefficient=roundHalfEven(purchase+amounts[5],purchase,4);
      if(minCoefficient===null||coefficient<minCoefficient)minCoefficient=coefficient;
      if(maxCoefficient===null||coefficient>maxCoefficient)maxCoefficient=coefficient;
    }
    return {reference:s.reference,rail:s.rail,physicalClosedAt:s.physical_closed_at,
      financialClosedAt:s.financial_closed_at||null,financialStatus:complete?'DOCUMENTED_CLOSED':stale?'PENDING_RECONCILIATION':'NOT_RECONCILED',
      volumeM3:s.volume_m3,boxCount:s.box_count,expectedArticles:s.expected_articles,receivedArticles:s.received_articles,
      freightCustomsKmf:complete?display(transport):null,documentedTransportKmf:complete?display(amounts[5]):null,
      freightKmf:complete?s.freight_kmf:null,customsKmf:complete?s.customs_kmf:null,
      arrivalFeesKmf:complete?display(amounts[2]+amounts[4]):null,localTransportKmf:complete?s.local_kmf:null,
      weightKg:g===null?null:kg(g),weightProofRef:g===null?null:s.weight_proof_ref,weightBasis:g===null?null:'MEASURED_GROSS_KG',purchaseKmf:purchase===null?null:display(purchase),purchaseStatus:s.purchase?.status||'PURCHASE_SCOPE_INCOMPLETE',costPerKgKmf:complete&&g!==null?costPerKg(amounts[5],g):null};
  });
  return {cohort:'RELAY_RECEIPT_MONTH_UTC',scopeCoverage,
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
      observations:pairedCount,coefficient:formatCoefficient(pairedCount?roundHalfEven(pairedPurchase+pairedTransport,pairedPurchase,4):null),
      minCoefficient:formatCoefficient(minCoefficient),maxCoefficient:formatCoefficient(maxCoefficient),
      coefficientWeightKg:pairedWeightCount?kg(pairedWeight):null,coefficientWeightCount:pairedWeightCount,
      coverage:!pairedCount?'NO_OBSERVATIONS':pairedCount===shipments.length?'COMPLETE_FOR_PURCHASE_TRANSPORT_ONLY':'PARTIAL',scope:'PURCHASE_PLUS_DOCUMENTED_TRANSPORT_ONLY',decisional:false},shipments};
}
// All series use the same receipt cohort and the same read snapshot.
function monthShift(month,offset){
  const d=new Date(month+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,10);
}
function observedProfitability(rows,periodStart,scopeCoverage){
  const year=periodStart.slice(0,4)+'-01-01';
  const months=Number(periodStart.slice(5,7));
  const select=(from,to)=>rows.filter(r=>{const t=new Date(r.physical_closed_at).toISOString().slice(0,10);return t>=from&&t<to;});
  function observation(from,to){
    const a=shipmentActivity(select(from,to),scopeCoverage),o=a.purchaseTransportObservation;
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
  const scope=marketId===null?'ALL_MARKETS_NON_SIMULATED':'EXACT_MARKET_NON_SIMULATED';
  const from=includeHistory?monthShift(periodStart.slice(0,4)+'-01-01',-2):periodStart;
  const until=monthShift(periodStart,1);
  const {rows}=await client.query(
    `SELECT s.id AS shipment_id,s.market_id,s.reference,s.transport_mode AS rail,s.volume_m3::text AS volume_m3,
      physical.closed_at AS physical_closed_at,receipt.expected_articles,receipt.received_articles,
      weight.actual_weight_kg,weight.weight_basis,weight.weight_proof_ref,
      (SELECT COUNT(*)::int FROM international_shipment_hub_units h WHERE h.shipment_id=s.id) AS box_count,
      (n.shipment_id IS NOT NULL AND n.reconciled_at < GREATEST(s.updated_at, cs.declared_at, late_cost.last_at)) AS reconciliation_stale,
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
     LEFT JOIN customs_shipments cs ON cs.id=s.customs_shipment_id AND cs.market_id=s.market_id
     LEFT JOIN LATERAL (
       SELECT MAX(c.recorded_at) AS last_at FROM international_shipment_charges c WHERE c.shipment_id=s.id
     ) late_cost ON true
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
     WHERE s.market_id IS NOT NULL AND ($1::uuid IS NULL OR s.market_id=$1) AND s.stage='relay_received'
       AND physical.closed_at>=($2::date::timestamp AT TIME ZONE 'UTC')
       AND physical.closed_at<($3::date::timestamp AT TIME ZONE 'UTC')
     ORDER BY physical.closed_at,s.reference`,[marketId,from,until]);
  for(const row of rows)row.purchase=await loadShipmentPurchase(client,row.shipment_id,row.market_id ?? marketId);
  if(!includeHistory)return shipmentActivity(rows,scope);
  return {activity:shipmentActivity(rows.filter(r=>new Date(r.physical_closed_at).toISOString().slice(0,10)>=periodStart),scope),profitability:observedProfitability(rows,periodStart,scope)};
}
// Commercial order cohort, not the cash journal nor the shipment cohort.
// Same net-sale identity as real-margin-shadow: checkout total is already
// net of discounts and wallet; wallet is a payment instrument. Completed
// refunds restate the originating cohort, pending refunds do not.
function periodSalesEvidence(rows,scope='EXACT_MARKET_NON_SIMULATED'){
  const money=v=>{if(typeof v!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(v))return null;const [a,b='']=v.split('.');return BigInt(a+b.padEnd(2,'0'));};
  const text=n=>{const s=(n<0n?-n:n).toString().padStart(3,'0');return (n<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
  let paid=0,covered=0,invalid=0,pendingRefundOrders=0,terminalExceptions=0,unpaid=0,gross=0n,wallet=0n,refunds=0n;
  for(const row of rows){
    if(!['paid','refunded'].includes(row.payment_status)){unpaid++;continue;}
    paid++;
    if(row.pending_refunds>0)pendingRefundOrders++;
    const amounts=[row.total_kmf,row.wallet_kmf,row.refunds_kmf].map(money);
    if(amounts.some(x=>x===null)){invalid++;continue;}
    const [total,w,refund]=amounts;
    if(refund>total+w){invalid++;continue;}
    if((row.status==='cancelled'||row.status==='refunded'||row.payment_status==='refunded')&&refund===0n){terminalExceptions++;continue;}
    covered++;gross+=total;wallet+=w;refunds+=refund;
  }
  return {basis:'ORDER_CREATED_MONTH_UTC_CURRENT_STATE',scope,
    paidOrderCount:paid,coveredOrderCount:covered,unpaidOrderCount:unpaid,pendingRefundOrders,terminalExceptions,invalidOrderCount:invalid,
    checkoutSubtotalKmf:covered?text(gross):null,walletSubtotalKmf:covered?text(wallet):null,completedRefundSubtotalKmf:covered?text(refunds):null,
    observedNetSalesKmf:covered?text(gross+wallet-refunds):null,
    coverage:!paid?'NO_PAID_ORDERS':covered===paid&&!pendingRefundOrders?'PAID_COHORT_RESTATED':'PARTIAL',
    decisional:false,recognition:'COMMERCIAL_OBSERVATION_NOT_ACCOUNTING_PERIOD'};
}
async function loadPeriodSalesEvidence(client,marketId,periodStart){
  const {rows}=await client.query(
    `SELECT o.status::text AS status,o.payment_status::text AS payment_status,
      o.total_kmf::text AS total_kmf,COALESCE(o.wallet_applied_kmf,0)::text AS wallet_kmf,
      COALESCE(r.completed,0)::text AS refunds_kmf,COALESCE(r.pending,0)::int AS pending_refunds
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT SUM(x.amount_kmf) FILTER (WHERE x.status='completed') AS completed,
          COUNT(*) FILTER (WHERE x.status='pending') AS pending
        FROM refunds x WHERE x.order_id=o.id
      ) r ON true
      WHERE o.market_id IS NOT NULL AND ($1::uuid IS NULL OR o.market_id=$1) AND o.simulation_scope IS NULL
        AND o.created_at>=($2::date::timestamp AT TIME ZONE 'UTC')
        AND o.created_at<(($2::date+interval '1 month') AT TIME ZONE 'UTC')
      ORDER BY o.id`,[marketId,periodStart]);
  return periodSalesEvidence(rows,marketId===null?'ALL_MARKETS_NON_SIMULATED':'EXACT_MARKET_NON_SIMULATED');
}
async function loadPeriodRecognitionEvidence(client, marketId, periodStart) {
  const bounds = [marketId, periodStart, monthShift(periodStart, 1)];
  const {rows: scans} = await client.query(
    `SELECT p.id AS parcel_id,p.status::text AS parcel_status,s.pickup_method,s.authorization_version,s.document_checked,s.scan_code,s.notes,
        items.units
       FROM parcels p
       JOIN orders o ON o.id=p.order_id
       LEFT JOIN scans s ON s.parcel_id=p.id AND s.order_id=o.id
         AND s.step='collected' AND NOT s.is_anomaly
         AND s.created_at>=($2::date::timestamp AT TIME ZONE 'UTC')
         AND s.created_at<($3::date::timestamp AT TIME ZONE 'UTC')
       LEFT JOIN LATERAL (
         SELECT SUM(pi.qty_collected)::int AS units
         FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id
         WHERE pi.parcel_id=p.id
         HAVING BOOL_AND(oi.order_id=o.id AND pi.qty_collected BETWEEN 0 AND pi.quantity)
       ) items ON true
       WHERE o.market_id IS NOT NULL AND ($1::uuid IS NULL OR o.market_id=$1) AND o.simulation_scope IS NULL
         AND p.collected_at>=($2::date::timestamp AT TIME ZONE 'UTC')
         AND p.collected_at<($3::date::timestamp AT TIME ZONE 'UTC')`, bounds);
  const candidates = new Set(scans.map(scan=>scan.parcel_id));
  const handoffs = new Map();
  for (const scan of scans) {
    if (scan.parcel_status==='collected' && scan.units>0 && classifyProof(scan).valid) handoffs.set(scan.parcel_id, scan.units);
  }
  const {rows: [refunds]} = await client.query(
    `SELECT COUNT(*)::int AS count,SUM(r.amount_kmf)::text AS amount_kmf
       FROM refunds r JOIN orders o ON o.id=r.order_id
       WHERE r.status='completed'
         AND o.market_id IS NOT NULL AND ($1::uuid IS NULL OR o.market_id=$1) AND o.simulation_scope IS NULL
         AND r.completed_at>=($2::date::timestamp AT TIME ZONE 'UTC')
         AND r.completed_at<($3::date::timestamp AT TIME ZONE 'UTC')`, bounds);
  const {rows: [sales]} = await client.query(
    `WITH target_lines AS (
         SELECT DISTINCT order_item_id FROM parcel_items WHERE parcel_id=ANY($1::uuid[])
       ), delivered AS (
         SELECT oi.id AS item_id,p.id AS parcel_id,p.collected_at,oi.price_kmf,
                basket.gross,basket.before_line,o.total_kmf+COALESCE(o.wallet_applied_kmf,0) AS net,
                SUM(pi.qty_collected)::int AS units
         FROM target_lines t
         JOIN order_items oi ON oi.id=t.order_item_id
         JOIN orders o ON o.id=oi.order_id
         JOIN parcel_items pi ON pi.order_item_id=oi.id
         JOIN parcels p ON p.id=pi.parcel_id AND p.order_id=o.id
         CROSS JOIN LATERAL (
           SELECT SUM(item.price_kmf*item.quantity) AS gross,
                  COALESCE(SUM(item.price_kmf*item.quantity) FILTER (WHERE item.id<oi.id),0) AS before_line
           FROM order_items item WHERE item.order_id=o.id
         ) basket
         WHERE pi.qty_collected>0 AND p.status='collected' AND p.collected_at IS NOT NULL
           AND o.payment_status IN ('paid','refunded')
           AND o.discount_kmf>=0 AND o.total_kmf+COALESCE(o.wallet_applied_kmf,0)>=0
           AND o.total_kmf+COALESCE(o.wallet_applied_kmf,0)+o.discount_kmf=basket.gross
           AND (SELECT SUM(other.quantity) FROM parcel_items other
                JOIN parcels package ON package.id=other.parcel_id
                WHERE other.order_item_id=oi.id AND package.order_id=o.id
                  AND package.status<>'cancelled')<=oi.quantity
         GROUP BY oi.id,p.id,o.id,basket.gross,basket.before_line
       ), cumulative AS (
         SELECT *,SUM(units) OVER (PARTITION BY item_id ORDER BY collected_at,parcel_id) AS cumulative_units
         FROM delivered
       )
       SELECT COALESCE(SUM(units),0)::int AS covered_units,
              SUM(CASE WHEN gross=0 THEN 0 ELSE
                ROUND(net*(before_line+price_kmf*cumulative_units)/gross,2)
                - ROUND(net*(before_line+price_kmf*(cumulative_units-units))/gross,2)
              END)::numeric(20,2)::text AS amount_kmf
       FROM cumulative WHERE parcel_id=ANY($1::uuid[])`, [[...handoffs.keys()]]);
  const {rows: [costs]} = await client.query(
    `WITH handed_off_lines AS (
         SELECT pi.parcel_id,oi.id AS order_item_id,oi.order_id,
                oi.fulfillment_source,o.payment_mode::text AS payment_mode,
                o.relais_id IS NOT NULL AS relay_beneficiary,
                o.hub_preparation_at IS NOT NULL AS hub_operation,
                EXISTS (SELECT 1 FROM customs_shipment_parcels csp
                  JOIN customs_shipments cs ON cs.id=csp.shipment_id
                  WHERE csp.parcel_id=pi.parcel_id AND cs.is_active
                    AND cs.status<>'pending' AND cs.customs_paid_kmf IS NOT NULL) AS customs_known,
                BOOL_AND(pi.qty_collected=pi.quantity) AS full_parcel_line,
                SUM(pi.quantity)=oi.quantity AND NOT EXISTS (
                  SELECT 1 FROM parcel_items other
                  WHERE other.order_item_id=oi.id AND other.parcel_id<>pi.parcel_id
                ) AS whole_order_line
         FROM parcel_items pi
         JOIN order_items oi ON oi.id=pi.order_item_id
         JOIN parcels p ON p.id=pi.parcel_id AND p.order_id=oi.order_id
         JOIN orders o ON o.id=oi.order_id
         WHERE pi.parcel_id=ANY($1::uuid[])
         GROUP BY pi.parcel_id,oi.id,o.id
       ), eligible AS (
         SELECT line.parcel_id,line.order_item_id,a.cost_type,a.amount_kmf
         FROM handed_off_lines line
         JOIN order_item_real_cost_allocations a
           ON a.order_item_id=line.order_item_id AND a.order_id=line.order_id
         WHERE line.full_parcel_line AND a.cost_type=ANY($2::text[])
           AND a.is_actual AND a.allocation_method<>'estimated_fallback'
           AND NULLIF(BTRIM(a.source),'') IS NOT NULL
           AND a.source NOT IN ($3,'products.cost_kmf')
           AND COALESCE(a.provenance,'') NOT ILIKE '%FICTIF%'
           AND (
             a.parcel_id=line.parcel_id
             OR (a.parcel_id IS NULL AND a.shipment_id IS NULL AND line.whole_order_line
               AND NOT EXISTS (
                 SELECT 1 FROM order_item_real_cost_allocations scoped
                 WHERE scoped.order_item_id=a.order_item_id AND scoped.order_id=a.order_id
                   AND scoped.cost_type=a.cost_type
                   AND (scoped.parcel_id IS NOT NULL OR scoped.shipment_id IS NOT NULL)
               ))
           )
       ), coverage AS (
         SELECT line.*,ARRAY(SELECT DISTINCT e.cost_type::text FROM eligible e
           WHERE e.parcel_id=line.parcel_id AND e.order_item_id=line.order_item_id ORDER BY e.cost_type::text) AS types
         FROM handed_off_lines line
       )
       SELECT COUNT(DISTINCT parcel_id)::int AS parcel_count,SUM(amount_kmf)::text AS amount_kmf,
              (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.parcel_id,c.order_item_id),'[]'::jsonb) FROM coverage c) AS line_evidence
       FROM eligible`, [[...handoffs.keys()], RECONCILIABLE_VARIABLE_COST_TYPES, LEGACY_UNJUSTIFIED_SOURCE]);
  const completeParcels=completeCostParcelCount(costs.line_evidence);
  return {
    candidateHandoffParcelCount: candidates.size,
    handoffParcelCount: handoffs.size,
    attestedUnits: [...handoffs.values()].reduce((total, units) => total + units, 0),
    confirmedRefundCount: refunds.count,
    confirmedRefundKmf: refunds.amount_kmf,
    pricedHandoffUnits: sales.covered_units,
    documentedHandoffSalesKmf: sales.amount_kmf,
    parcelCostEvidenceCount: costs.parcel_count,
    fullyCoveredParcelCount: completeParcels,
    documentedParcelVariableCostKmf: costs.amount_kmf,
    coverage: 'DOCUMENTED_EVENTS_ONLY',
  };
}
// The existing canonical applicability rules are applied per handed-off line.
// At final handoff an import needs customs evidence, even if its event is missing.
function completeCostParcelCount(lines) {
  if(!Array.isArray(lines))return null;
  const parcels=new Map();
  for(const line of lines){
    const imported=line.fulfillment_source!=='LOCAL_STOCK';
    const expected=expectedTypes({status:'collected',payment_mode:line.payment_mode,
      imported,customs_event:imported,hub_route:imported||line.hub_operation,relay_beneficiary:line.relay_beneficiary});
    const present=new Set(line.types||[]);
    const complete=line.full_parcel_line===true && !!line.payment_mode
      && ['IMPORT','LOCAL_STOCK'].includes(line.fulfillment_source)
      && (!imported||line.customs_known===true) && expected.every(type=>present.has(type));
    parcels.set(line.parcel_id,(parcels.get(line.parcel_id)??true)&&complete);
  }
  return [...parcels.values()].filter(Boolean).length;
}
function projectGroupPeriodResult(recognition, structure, reviewedRisk) {
  // A known empty handoff cohort is zero; an absent/incomplete denominator is not.
  const noHandoffs=recognition.candidateHandoffParcelCount===0&&recognition.handoffParcelCount===0;
  const sales = noHandoffs ? 0n : cents(recognition.documentedHandoffSalesKmf);
  const transactionCosts = noHandoffs ? 0n : cents(recognition.documentedParcelVariableCostKmf);
  const refunds = recognition.confirmedRefundCount === 0 ? 0n : cents(recognition.confirmedRefundKmf);
  const fixed = Number.isFinite(structure.recognizedKmf) ? cents(structure.recognizedKmf.toFixed(2)) : null;
  const risk = reviewedRisk.amountKmf == null ? null : cents(reviewedRisk.amountKmf);
  const reasons = [];
  if (recognition.candidateHandoffParcelCount !== recognition.handoffParcelCount || sales === null || recognition.pricedHandoffUnits !== recognition.attestedUnits) reasons.push('SALES_INCOMPLETE');
  if (transactionCosts === null || recognition.fullyCoveredParcelCount !== recognition.handoffParcelCount) reasons.push('VARIABLE_COSTS_INCOMPLETE');
  if (refunds === null) reasons.push('REFUNDS_INCOMPLETE');
  if (fixed === null) reasons.push('STRUCTURE_INCOMPLETE');
  if (risk === null) reasons.push('RISK_REVIEW_INCOMPLETE');
  if (reasons.length) return {status:'NOT_RECONCILED',reasons,resultKmf:null};

  const netSales = sales - refunds;
  const variableCosts = transactionCosts + risk;
  const contribution = netSales - variableCosts;
  return {
    status:'PROVISIONAL',reasons:[],
    netSalesKmf:eurString(netSales),
    variableCostKmf:eurString(variableCosts),
    actualRiskKmf:eurString(risk),
    contributionKmf:eurString(contribution),
    structureKmf:eurString(fixed),
    resultKmf:eurString(contribution-fixed),
  };
}
async function loadGroupPeriodRisk(client, periodStart) {
  const {rows: markets} = await client.query('SELECT id FROM markets ORDER BY id');
  if (!markets.length) return {amountKmf:null};
  let total = 0n;
  for (const {id} of markets) {
    const truth = await computePeriodRiskTruth({
      marketId:id,from:periodStart,to:monthShift(periodStart,1),executor:client,
    });
    const amount = truth.actual_risk_cost_kmf;
    if (truth.status!=='RISK_PERIOD_TRUTH_AVAILABLE' || !Number.isFinite(amount)) return {amountKmf:null};
    total += cents(amount.toFixed(2));
  }
  return {amountKmf:eurString(total)};
}
async function loadGroupPeriodApproval(client, periodStart, result) {
  const {rows:[snapshot]} = await client.query(
    `WITH bounds AS (
         SELECT $1::date::timestamp AT TIME ZONE 'UTC' AS lo,
                ($1::date+interval '1 month') AT TIME ZONE 'UTC' AS hi
       ), handed_off AS (
         SELECT p.id,p.order_id,p.collected_at,p.status FROM parcels p JOIN orders o ON o.id=p.order_id CROSS JOIN bounds
         WHERE p.collected_at>=lo AND p.collected_at<hi AND o.market_id IS NOT NULL
           AND o.simulation_scope IS NULL
       ), sold_items AS (
         SELECT DISTINCT pi.order_item_id FROM parcel_items pi JOIN handed_off p ON p.id=pi.parcel_id
       ), affected_economic_shipments AS (
         SELECT DISTINCT h.shipment_id
         FROM sold_items i
         JOIN hub_purchase_allocations a ON a.order_item_id=i.order_item_id
         JOIN hub_box_effective_placements pl ON pl.allocation_id=a.id
         JOIN international_shipment_hub_units h ON h.physical_unit_id=pl.box_unit_id
       ), facts AS (
         SELECT 'handoff' AS kind,to_jsonb(s) AS fact FROM scans s JOIN handed_off p ON p.id=s.parcel_id WHERE s.step='collected'
         UNION ALL SELECT 'parcel-handoff',to_jsonb(p) FROM handed_off p
         UNION ALL SELECT 'order-price',jsonb_build_array(o.id,o.total_kmf,o.discount_kmf,o.wallet_applied_kmf,o.payment_status,o.market_id)
           FROM orders o WHERE EXISTS (SELECT 1 FROM handed_off p WHERE p.order_id=o.id)
         UNION ALL SELECT 'item-price',jsonb_build_array(i.id,i.order_id,i.price_kmf,i.quantity)
           FROM order_items i WHERE EXISTS (SELECT 1 FROM handed_off p WHERE p.order_id=i.order_id)
         UNION ALL SELECT 'line',to_jsonb(pi) FROM parcel_items pi JOIN handed_off p ON p.id=pi.parcel_id
         UNION ALL SELECT 'allocation',to_jsonb(a) FROM order_item_real_cost_allocations a JOIN sold_items i ON i.order_item_id=a.order_item_id
         UNION ALL SELECT 'refund',to_jsonb(r) FROM refunds r JOIN orders o ON o.id=r.order_id CROSS JOIN bounds
           WHERE r.status='completed' AND r.completed_at>=lo AND r.completed_at<hi AND o.market_id IS NOT NULL AND o.simulation_scope IS NULL
         UNION ALL SELECT 'risk',to_jsonb(r) FROM economic_risk_cost_events r CROSS JOIN bounds WHERE r.economic_at>=lo AND r.economic_at<hi
         UNION ALL SELECT 'risk-review',to_jsonb(w) FROM economic_risk_watermark_events w CROSS JOIN bounds
           WHERE w.closed_through>=hi
         UNION ALL SELECT 'structure',to_jsonb(e) FROM economic_structure_cost_events e CROSS JOIN bounds WHERE e.economic_from<hi AND e.economic_to>lo
         UNION ALL SELECT 'shipment-charge',to_jsonb(c) FROM international_shipment_charges c JOIN affected_economic_shipments h ON h.shipment_id=c.shipment_id
         UNION ALL SELECT 'shipment-reconciliation',to_jsonb(n) FROM international_n1_reconciliations n JOIN affected_economic_shipments h ON h.shipment_id=n.shipment_id
         UNION ALL SELECT 'shipment-customs',jsonb_build_array(c.id,c.declared_at)
           FROM affected_economic_shipments h JOIN international_shipments s ON s.id=h.shipment_id
           JOIN customs_shipments c ON c.id=s.customs_shipment_id AND c.market_id=s.market_id
       )
       SELECT COALESCE((SELECT jsonb_agg(fact ORDER BY kind,fact) FROM facts),'[]'::jsonb)::text AS facts,
              (SELECT evidence_hash FROM economic_group_period_closures
                WHERE period_start=$1::date ORDER BY id DESC LIMIT 1) AS closed_hash,
              EXISTS (SELECT 1 FROM affected_economic_shipments h
                JOIN international_shipments s ON s.id=h.shipment_id
                LEFT JOIN customs_shipments c ON c.id=s.customs_shipment_id AND c.market_id=s.market_id
                LEFT JOIN international_n1_reconciliations n ON n.shipment_id=h.shipment_id
                LEFT JOIN LATERAL (
                  SELECT MAX(charge.recorded_at) AS last_at
                  FROM international_shipment_charges charge WHERE charge.shipment_id=h.shipment_id
                ) charges ON true
                WHERE n.reconciled_at IS NULL OR
                  n.reconciled_at<GREATEST(s.updated_at,c.declared_at,charges.last_at)) AS late_charge`, [periodStart]);
  const evidenceHash = createHash('sha256').update(JSON.stringify([periodStart,result,snapshot.facts])).digest('hex');
  if (snapshot.late_charge) {
    return {status:'NOT_RECONCILED',reasons:['SHIPMENT_CHARGES_PENDING_RECONCILIATION'],resultKmf:null};
  }
  return {...result,evidenceHash,status:snapshot.closed_hash===evidenceHash?'CLOSED':snapshot.closed_hash?'REOPENED':'PROVISIONAL'};
}
async function closeGroupPeriod(actor, {periodStart,evidenceHash,evidenceRef,attested}={}) {
  if (actor?.role!=='admin'||!await hasPricingGlobalAuthority(actor.id)) {
    throw error('economic_close_forbidden',403,'Autorité économique groupe requise');
  }
  if (attested!==true || !/^[a-f0-9]{64}$/.test(String(evidenceHash)) ||
      typeof evidenceRef!=='string'||evidenceRef.trim().length<3||evidenceRef.trim().length>1000) {
    throw error('economic_close_evidence_invalid',400,'Attestation et justificatif de clôture requis');
  }
  const input=validate({marketCode:null,periodStart});
  if (monthShift(input.periodStart,1)>new Date().toISOString().slice(0,10)) {
    throw error('economic_close_month_open',409,'Le mois est toujours en cours');
  }
  const client=await db.getClient();
  try {
    // The reviewed snapshot and the append-only attestation share one transaction.
    // A fact committed later remains a new fact and reopens the period.
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const model=await readCostCentersSnapshot(actor,input,client,true,true);
    const result=model.profitability?.groupPeriodResult;
    if (result?.evidenceHash!==evidenceHash) {
      throw error('economic_close_evidence_changed',409,'Les preuves ont changé. Rechargez la période.');
    }
    const {rows}=await client.query(
      `INSERT INTO economic_group_period_closures(period_start,evidence_hash,evidence_ref,actor_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (period_start,evidence_hash) DO NOTHING RETURNING id`,
      [input.periodStart,evidenceHash,evidenceRef.trim(),actor.id]);
    await client.query('COMMIT');
    return {outcome:rows.length?'closed':'replayed',periodStart:input.periodStart};
  } catch(e) {
    try{await client.query('ROLLBACK');}catch(_){}
    if(e.code==='40001'||e.code==='40P01')throw error('economic_close_concurrent_change',409,'Les preuves ont changé ou une autre clôture est en cours. Rechargez la période.');
    throw e;
  } finally {client.release();}
}
// Single result authority: the cockpit, the Direction read and period closure
// use the identical recognition, fixed cost, reviewed risk and evidence hash.
async function groupPeriodDecision(client,periodStart,recognition){
  const truth=await computePeriodStructureTruth({from:periodStart,to:monthShift(periodStart,1),executor:client});
  const structureCoverage={
    status:truth.status,evidenceCount:truth.evidence_event_count,
    groupSharedKmf:truth.evidence_event_count?truth.group_pool_kmf:null,
    marketDirectKmf:truth.evidence_event_count?truth.other_market_direct_kmf:null,
    recognizedKmf:truth.evidence_event_count?truth.recognized_total_kmf:null,
  };
  const provisional=projectGroupPeriodResult(recognition,structureCoverage,{amountKmf:null});
  let result=provisional.reasons.length===1&&provisional.reasons[0]==='RISK_REVIEW_INCOMPLETE'
    ?projectGroupPeriodResult(recognition,structureCoverage,await loadGroupPeriodRisk(client,periodStart)):provisional;
  if(result.status==='PROVISIONAL')result=await loadGroupPeriodApproval(client,periodStart,result);
  return {structureCoverage,result};
}
// No pricing ACT grant required to read. No full model (or closure hash)
// escapes to the dashboard. EUR is a fixed-parity projection of the KMF
// result, NOT a reconstruction of each historical native source valuation.
async function readGroupPeriodDecision(actor,periodStart){
  if(!actor?.id||actor.role!=='admin')throw error('economic_reference_group_forbidden',403,'Périmètre groupe interdit');
  const input=validate({marketCode:null,periodStart});
  const client=await db.getClient();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const recognition=await loadPeriodRecognitionEvidence(client,null,input.periodStart);
    const {result}=await groupPeriodDecision(client,input.periodStart,recognition);
    let amountEur=null,fxStatus='NO_RESULT',fxLegs=[];
    if(result.resultKmf!=null){
      try{
        const fx=await convert({amount:result.resultKmf,from:'KMF',to:'EUR',client});
        amountEur=fx.amount_text;fxLegs=fx.legs;fxStatus='GOVERNED_FIXED_PARITY_PROJECTION';
      }catch(e){if(e instanceof FxError&&e.code==='fx_rate_unavailable')fxStatus='FX_UNAVAILABLE';else throw e;}
    }
    await client.query('COMMIT');
    return {periodStart:input.periodStart,status:result.status,reasons:result.reasons,
      resultKmf:result.resultKmf,resultEur:amountEur,fxStatus,fxLegs};
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}
}

// Market economics use exactly the same recognition and arithmetic as the
// group. Internal attributions are read once; invoices are never an extra cost.
async function marketPeriodDecision(client,marketId,periodStart,recognition){
  const truth=await computePeriodStructureTruth({marketId,from:periodStart,to:monthShift(periodStart,1),executor:client,strictPersistedAttributions:true});
  const structureCoverage={status:truth.status,recognizedKmf:truth.market_n3_decisional?truth.market_n3_total_kmf:null};
  let result=projectGroupPeriodResult(recognition,structureCoverage,{amountKmf:null});
  if(result.reasons.length===1&&result.reasons[0]==='RISK_REVIEW_INCOMPLETE'){
    const risk=await computePeriodRiskTruth({marketId,from:periodStart,to:monthShift(periodStart,1),executor:client});
    if(risk.status==='RISK_PERIOD_TRUTH_AVAILABLE'&&Number.isFinite(risk.actual_risk_cost_kmf))
      result=projectGroupPeriodResult(recognition,structureCoverage,{amountKmf:risk.actual_risk_cost_kmf.toFixed(2)});
  }
  if(result.status==='PROVISIONAL'){
    const {rows:[late]}=await client.query(
      `WITH affected AS (
         SELECT DISTINCT h.shipment_id
         FROM parcels p JOIN orders o ON o.id=p.order_id
         JOIN parcel_items pi ON pi.parcel_id=p.id
         JOIN hub_purchase_allocations a ON a.order_item_id=pi.order_item_id
         JOIN hub_box_effective_placements pl ON pl.allocation_id=a.id
         JOIN international_shipment_hub_units h ON h.physical_unit_id=pl.box_unit_id
         WHERE o.market_id=$1 AND o.simulation_scope IS NULL
           AND p.collected_at>=($2::date::timestamp AT TIME ZONE 'UTC')
           AND p.collected_at<($3::date::timestamp AT TIME ZONE 'UTC')
       )
       SELECT EXISTS(SELECT 1 FROM affected h
         JOIN international_shipments s ON s.id=h.shipment_id
         LEFT JOIN customs_shipments c ON c.id=s.customs_shipment_id AND c.market_id=s.market_id
         LEFT JOIN international_n1_reconciliations n ON n.shipment_id=h.shipment_id
         LEFT JOIN LATERAL (SELECT MAX(recorded_at) AS last_at FROM international_shipment_charges WHERE shipment_id=h.shipment_id) charges ON true
         WHERE s.market_id IS DISTINCT FROM $1::uuid OR n.reconciled_at IS NULL
           OR n.reconciled_at<GREATEST(s.updated_at,c.declared_at,charges.last_at)) AS late_charge`,[marketId,periodStart,monthShift(periodStart,1)]);
    if(late?.late_charge!==false)result={status:'NOT_RECONCILED',reasons:['SHIPMENT_CHARGES_PENDING_RECONCILIATION'],resultKmf:null};
  }
  return {structureCoverage,result};
}
async function periodResultDisplay(client,result,currency){
  const display={currency,fxStatus:'NO_RESULT',result:null,contribution:null,netSales:null,variableCost:null,actualRisk:null,structure:null};
  if(result.resultKmf==null)return display;
  try{
    for(const key of ['result','contribution','netSales','variableCost','actualRisk','structure']){
      const x=await convert({amount:result[key+'Kmf'],from:'KMF',to:currency,client});
      display[key]=x.amount_text;
    }
    display.fxStatus=currency==='KMF'?'KMF_BASE_PROJECTION':'GOVERNED_KMF_PROJECTION';
    return display;
  }catch(e){
    if(e instanceof FxError&&e.code==='fx_rate_unavailable')
      return {currency,fxStatus:'FX_UNAVAILABLE',result:null,contribution:null,netSales:null,variableCost:null,actualRisk:null,structure:null};
    throw e;
  }
}
async function readMarketPeriodDecision(actor,marketCode,periodStart){
  if(!actor?.id||marketCode==null)throw error('economic_reference_scope_invalid',403,'Périmètre marché requis');
  const input=validate({marketCode,periodStart});
  const client=await db.getClient();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const marketId=await resolveScope(client,actor,input.marketCode,actor.role==='admin');
    const {rows:[market]}=await client.query('SELECT currency FROM markets WHERE id=$1 AND code=$2',[marketId,input.marketCode]);
    if(!market?.currency)throw error('market_not_found',404,'Marché introuvable');
    const recognition=await loadPeriodRecognitionEvidence(client,marketId,input.periodStart);
    const {result}=await marketPeriodDecision(client,marketId,input.periodStart,recognition);
    const display=await periodResultDisplay(client,result,market.currency);
    await client.query('COMMIT');
    return {periodStart:input.periodStart,status:result.status,reasons:result.reasons,resultKmf:result.resultKmf,display};
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}
}

async function readCostCenters(actor,raw){
  if(!actor?.id)throw error('AUTH_REQUIRED',401,'Authentification requise');
  const input=validate(raw);
  const globalRead=actor.role==='admin';
  const central=globalRead && await hasPricingGlobalAuthority(actor.id);
  const client=await db.getClient();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const model=await readCostCentersSnapshot(actor,input,client,central,globalRead);
    await client.query('COMMIT');
    return model;
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}
}
async function readCostCentersSnapshot(actor,input,client,central,globalRead){
    const marketId=await resolveScope(client,actor,input.marketCode,globalRead);
    const costCapabilities=await costAuthority.project(client,actor,input.marketCode,marketId,central);
    const {rows:centers}=await client.query(
      'SELECT c.id,c.code,c.label,c.responsible_user_id,c.is_active,u.full_name AS responsible_label FROM economic_cost_centers c LEFT JOIN users u ON u.id=c.responsible_user_id WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY c.code,c.id',[marketId]);
    const {rows:families}=await client.query(
      'SELECT f.id,f.center_id,f.code,f.label FROM economic_cost_families f JOIN economic_cost_centers c ON c.id=f.center_id WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY f.code,f.id',[marketId]);
    const {rows:resources}=await client.query(
      'SELECT r.id,r.center_id,r.code,r.label,r.resource_kind FROM economic_cost_resources r JOIN economic_cost_centers c ON c.id=r.center_id WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY r.code,r.id',[marketId]);
    const {rows:posts}=await client.query(
      `SELECT p.id,p.center_id,p.family_id,p.resource_id,p.code,p.label,p.economic_nature,p.allocation_perimeter,p.allocation_basis,(p.structure_charge_id IS NOT NULL) AS "acceptsStructureActual",
        b.revision AS budget_revision,b.currency AS budget_currency,b.amount_native::text AS budget_native,b.amount_eur::text AS budget_eur
       FROM economic_cost_posts p JOIN economic_cost_centers c ON c.id=p.center_id
       LEFT JOIN LATERAL (
          SELECT revision,currency,amount_native,amount_eur FROM economic_cost_budget_revisions
          WHERE post_id=p.id AND period_start=$2::date ORDER BY revision DESC LIMIT 1
       ) b ON true
       WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY p.code,p.id`,[marketId,input.periodStart]);
    const {rows:commitments}=await client.query(
      `SELECT k.id,k.post_id,k.currency,k.evidence_ref,k.amount_native::text AS initial_native,k.amount_eur::text AS initial_eur,
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
        e.currency,e.evidence_ref,e.event_kind,
        CASE WHEN e.event_kind='ACCRUAL' AND e.amount_original>0
          AND NOT EXISTS (SELECT 1 FROM economic_structure_cost_events corr WHERE corr.adjusts_event_id=e.id)
          THEN (e.amount_original-COALESCE((SELECT SUM(m.amount_native) FROM economic_cost_commitment_movements m WHERE m.structure_event_id=e.id),0))::text END AS consumable_native,
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
      commitments:byPost.get(p.id)||[],eligibleStructureFacts:structureEvents.filter(e=>e.post_id===p.id&&e.whole_period&&e.consumable_native!=null&&/^[0-9]+(?:\.[0-9]+)?$/.test(e.consumable_native)&&/[1-9]/.test(e.consumable_native)).map(e=>({id:e.id,currency:e.currency,evidenceRef:e.evidence_ref,remainingNative:e.consumable_native})),structureEvidence:await projectStructure(structureEvents.filter(e=>e.post_id===p.id)),actual:null,available:null,coverage:'NOT_RECONCILED'})));
    for(const p of model)p.recordedBalance=recordedPostBalance(p);
    const centerModels=await Promise.all(centers.map(async c=>({...c,budgetSummary:budgetSummary(model.filter(p=>p.center_id===c.id)),commitmentSummary:commitmentSummary(model.filter(p=>p.center_id===c.id)),structureEvidence:await projectStructure(structureEvents.filter(e=>e.center_id===c.id)),recordedBalance:recordedBalanceSummary(model.filter(p=>p.center_id===c.id))})));
    const structureEvidence=await projectStructure(structureEvents);
    const history=await loadShipmentActivity(client,marketId,input.periodStart,{includeHistory:true});
    const activity=history?.activity??null,profitability=history?.profitability??null;
    const salesEvidence=await loadPeriodSalesEvidence(client,marketId,input.periodStart);
    if (profitability) {
      profitability.salesEvidence = salesEvidence;
      profitability.recognitionEvidence = await loadPeriodRecognitionEvidence(client, marketId, input.periodStart);
    }
    if(marketId===null&&profitability){
      const decision=await groupPeriodDecision(client,input.periodStart,profitability.recognitionEvidence);
      profitability.structureCoverage=decision.structureCoverage;
      profitability.groupPeriodResult=decision.result;
    }else if(marketId!==null&&profitability){
      const decision=await marketPeriodDecision(client,marketId,input.periodStart,profitability.recognitionEvidence);
      profitability.structureCoverage=decision.structureCoverage;
      const {rows:[market]}=await client.query('SELECT currency FROM markets WHERE id=$1 AND code=$2',[marketId,input.marketCode]);
      profitability.marketPeriodResult={...decision.result,display:await periodResultDisplay(client,decision.result,market?.currency||null)};
    }
    const responsibleCandidates=costCapabilities.reference?await listResponsibleCandidates(client,marketId):[];
    return {scope:input.marketCode===null?'GROUP':'MARKET',marketCode:input.marketCode,periodStart:input.periodStart,globalRead,central,costCapabilities,readOnly:!Object.values(costCapabilities).some(Boolean),
      centers:centerModels,families,resources,responsibleCandidates,posts:model,recordedBalance:recordedBalanceSummary(model),budgetSummary:budgetSummary(model),commitmentSummary:commitmentSummary(model),structureEvidence,activity,profitability,actualCoverage:'NOT_RECONCILED',available:null};
}
module.exports={readMarketPeriodDecision,readGroupPeriodDecision,readCostCenters,closeGroupPeriod,budgetSummary,recordedPostBalance,recordedBalanceSummary,commitmentRemainingEur,commitmentSummary,structureEvidenceSummary,structureEurProjector,shipmentActivity,loadShipmentActivity,shipmentPurchase,observedProfitability,periodSalesEvidence,projectGroupPeriodResult,completeCostParcelCount};
