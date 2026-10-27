'use strict';
/**
 * Research-only common contradiction evaluator for the OFFICIAL P1..P7
 * process map. Consumes CANONICAL OWNER evidence (never invents it).
 * A missing adapter is NOT_WIRED, never PASS; a conflict is a hypothesis
 * awaiting independent PostgreSQL / HTTP / Chromium reproduction.
 *
 * IMPORTANT: compare identities at the declared grain, not PO header:
 * grouped PO and shared physical parcels may contain multiple markets/orders.
 */
const MAP=Object.freeze([
 {id:'P7_P1_MARKET_PRICING',from:'P7',to:'P1',grain:'market',keys:['market_code'],owner:'market-readiness',consumer:'market-pricing'},
 {id:'P7_P1_MARKET_EXPOSURE',from:'P7',to:'P1',grain:'market',keys:['market_code'],owner:'market-readiness',consumer:'market-exposure'},
 {id:'P7_P2_CHECKOUT',from:'P7',to:'P2',grain:'market',keys:['market_code'],owner:'market-readiness',consumer:'checkout'},
 {id:'P1_P2_SELLABLE_UNIT',from:'P1',to:'P2',grain:'order_item',keys:['product_id','sku_id','market_code'],owner:'catalog-market-exposure',consumer:'checkout'},
 {id:'P2_P3_PURCHASE_REQUIREMENT',from:'P2',to:'P3',grain:'order_item',keys:['order_item_id','sku_id'],owner:'paid-order',consumer:'purchasing'},
 {id:'P3_P4_HUB_RECEIPT',from:'P3',to:'P4',grain:'purchase_line',keys:['purchase_line_id','sku_id'],owner:'purchasing',consumer:'hub-physical-receipt'},
 {id:'P4_P2_RELAY_HANDOFF',from:'P4',to:'P2',grain:'order',keys:['order_id'],owner:'physical-parcel-membership',consumer:'customer-handoff'},
 {id:'P5_P2_PAYMENT_CLOSURE',from:'P5',to:'P2',grain:'order',keys:['order_id'],owner:'payment-reconciliation',consumer:'financial-close'},
 {id:'P3_P6_PURCHASE_COST',from:'P3',to:'P6',grain:'order_item',keys:['order_item_id'],owner:'supplier-payment',consumer:'real-cost-allocation'},
 {id:'P4_P6_LOGISTICS_COST',from:'P4',to:'P6',grain:'order',keys:['order_id'],owner:'freight-customs',consumer:'economic-maturity'},
 {id:'P5_P6_CASH_REALITY',from:'P5',to:'P6',grain:'order',keys:['order_id'],owner:'funds-reconciliation',consumer:'economic-actuals'},
 {id:'P6_P1_PRICE_REVIEW',from:'P6',to:'P1',grain:'market-product',keys:['product_id','market_code'],owner:'human-price-review',consumer:'market-price-write'},
 {id:'P7_P5_COUNTRY_SETTLEMENT',from:'P7',to:'P5',grain:'market',keys:['market_code'],owner:'market-entitlements',consumer:'country-settlement'},
]);
const PROCESS=Object.freeze({
 P1:'Transformation produit',P2:'Commande et remise',P3:'Approvisionnement',
 P4:'Logistique, douane et relais',P5:'Argent',P6:'Coûts et marges',P7:'Marchés',
});
const ALLOWED=new Set(['PROVED','BLOCKED','UNKNOWN','NOT_APPLICABLE']);
const tidy=(key,value)=>value==null||String(value).trim()===''?null:
  key==='market_code'?String(value).trim().toUpperCase():String(value).trim().toLowerCase();

/**
 * proof = {source:{authority,status,ids},target:{authority,status,ids}}
 * Authority evidence must be supplied by adapters invoking EXISTING owner
 * projections/SQL. This pure function cannot certify that provenance.
 */
function evaluateBoundary(boundary,proof) {
 const base={id:boundary.id,from:boundary.from,to:boundary.to,grain:boundary.grain,
   status:'NOT_WIRED',contradictions:[],gaps:[],evidenceLevel:'NOT_VERIFIED'};
 if(!proof) return {...base,gaps:['CANONICAL_OWNER_EVIDENCE_NOT_COLLECTED']};
 const a=proof.source,b=proof.target;
 if(!a||!b||a.authority!==boundary.owner||b.authority!==boundary.consumer ||
    !ALLOWED.has(a.status)||!ALLOWED.has(b.status)) {
  return {...base,status:'INCOMPLETE',gaps:['CANONICAL_OWNER_AUTHORITY_OR_STATUS_MISSING']};
 }
 const contradictions=[],gaps=[];
 // Never call an unsupported/no-data boundary correct or equivalent.
 if(a.status==='BLOCKED'&&b.status==='PROVED')contradictions.push('BLOCKED_OWNER_VS_DOWNSTREAM_PROVED');
 if(a.status==='UNKNOWN'||b.status==='UNKNOWN')gaps.push('UNKNOWN_OWNER_OR_CONSUMER_VERDICT');
 // BLOCKED/BLOCKED is a coherent refusal, not a proved positive process.
 if(a.status==='BLOCKED'||b.status==='BLOCKED')gaps.push('BLOCKED_OWNER_OR_CONSUMER');
 if(a.status==='NOT_APPLICABLE'||b.status==='NOT_APPLICABLE')gaps.push('APPLICABILITY_NOT_INDEPENDENTLY_PROVED');
 const idsA=a.ids||{},idsB=b.ids||{};
 for(const key of boundary.keys){
   const left=tidy(key,idsA[key]),right=tidy(key,idsB[key]);
   if(!left||!right)gaps.push('IDENTITY_NOT_LINKED:'+key);
   else if(left!==right)contradictions.push('IDENTITY_CONTRADICTION:'+key);
 }
 // Cross-authority facts validated by the adapter (e.g. PO ownership or usable
 // physical quantity) remain HYPOTHESES until independently reproduced.
 if(Array.isArray(proof.crossContradictions)){
   for(const code of proof.crossContradictions)if(typeof code==='string'&&code)
     contradictions.push('OWNER_FACT:'+code);
 }
 const status=contradictions.length?'CONTRADICTION_HYPOTHESIS':
   gaps.length?'EVIDENCE_GAP':'NO_CONTRADICTION_OBSERVED';
 return {...base,status,contradictions,gaps,evidenceLevel:'OWNER_OUTPUTS_NOT_INDEPENDENTLY_CERTIFIED'};
}
function evaluateP1P7(proofs={}) {
 if(!proofs||typeof proofs!=='object'||Array.isArray(proofs))throw Error('Evidence map required');
 const boundaries=MAP.map(b=>evaluateBoundary(b,proofs[b.id]));
 const coverage=Object.fromEntries(Object.keys(PROCESS).map(p=>{
   const related=boundaries.filter(b=>b.from===p||b.to===p);
   return [p,{name:PROCESS[p],seams:related.length,
     observed:related.filter(b=>!['NOT_WIRED','INCOMPLETE'].includes(b.status)).length,
     hypotheses:related.filter(b=>b.status==='CONTRADICTION_HYPOTHESIS').length,
     missing:related.filter(b=>b.status==='NOT_WIRED').length}];
 }));
 return {schema:'komerce-p1-p7-cross-boundary-research/v1',mode:'RESEARCH_ONLY',
   verdict:'NOT_CERTIFICATION',boundaries,coverage,
   totals:{seams:MAP.length,observed:boundaries.filter(b=>!['NOT_WIRED','INCOMPLETE'].includes(b.status)).length,
     contradictions:boundaries.filter(b=>b.status==='CONTRADICTION_HYPOTHESIS').length,
     notWired:boundaries.filter(b=>b.status==='NOT_WIRED').length},
   limitations:['No PostgreSQL, owner adapter, checkout, PSP or browser is run by this pure oracle.',
     'Only explicit same-grain identity comparisons; quantity, monetary, eligibility and timing semantics belong to owner services.',
     'Absence of contradiction does not prove the owner outputs are correct.']};
}
module.exports={MAP,PROCESS,evaluateBoundary,evaluateP1P7};
