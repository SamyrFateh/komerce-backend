'use strict';
/**
 * P6 -> P1. Read-only economic signal -> human market-price decision.
 * Margin is an ORDER-level P6 outcome, not a permission to mutate a
 * market-PRODUCT price. Commercial owner: product_market_price_drafts and
 * product_market_price_draft_events written by market-autonomy services.
 * No automatic recommendation formula; no activation or writes.
 */
const {record}=require('./p1-p7-canonical-collector');
function assessP6P1({item,market,shadow=null,draft=null,events=[]}={}){
 if(!item?.product_id||!market?.id||!market?.code)throw Error('Exact market and product required');
 const gaps=new Set(),faults=new Set();
 const economic=shadow?.margin||null;
 const pct=economic?.shadow_pct;
 if(!economic||pct==null)gaps.add('REAL_MARGIN_NOT_ESTABLISHED');
 // An order-level real margin is one input to a human MARKET decision,
 // never by itself approval for a product price across all orders.
 gaps.add('ORDER_MARGIN_NOT_AUTOMATIC_MARKET_PRODUCT_DECISION');
 if(!draft)gaps.add('NO_HUMAN_MARKET_PRICE_DECISION');
 if(draft&&draft.status==='DRAFT_PENDING_GATE')gaps.add('PRICE_DRAFT_NOT_ECONOMICALLY_AUTHORIZED');
 if(draft&&draft.status==='LOCAL_AUTHORIZED_PENDING_CUTOVER')gaps.add('AUTHORIZED_PRICE_NOT_YET_BUYER_ACTIVE');
 if(draft&&draft.status==='LOCAL_ACTIVE') {
  if(!draft.active_at||!draft.authorized_at||!draft.authorization_snapshot)
   faults.add('LOCAL_ACTIVE_MISSING_ECONOMIC_GATE_SNAPSHOT');
  if(!draft.decided_by)gaps.add('PRICE_DECISION_ACTOR_NOT_ESTABLISHED');
 }
 for(const e of events){
  if(String(e.market_id)!==String(market.id))faults.add('PRICE_EVENT_FOREIGN_MARKET');
  if(String(e.product_id)!==String(item.product_id))faults.add('PRICE_EVENT_FOREIGN_PRODUCT');
  if(e.action==='ACTIVATE'&&!e.actor_id)
   faults.add('UNATTRIBUTED_PRICE_ACTIVATE_EVENT');
  if(e.action==='ACTIVATE'&&e.old_amount!=null&&e.new_amount!=null&&
     Number(e.old_amount)!==Number(e.new_amount))
   faults.add('ACTIVATE_CHANGED_AMOUNT_INSTEAD_OF_PRESERVING_AUTHORIZED_DECISION');
  if(e.action==='ACTIVATE'&&!e.decision_snapshot)
   gaps.add('PRICE_ACTIVATION_ECONOMIC_SNAPSHOT_MISSING');
 }
 const sourceStatus=Number.isFinite(Number(pct))&&pct!=null?'PROVED':'UNKNOWN';
 // Actual P1 decision requires independently attributed market-owner history.
 // The legacy Golden seeds neither; no synthetic activation is inferred.
 const targetStatus=draft?.status==='LOCAL_ACTIVE'&&
    draft.decided_by&&draft.authorization_snapshot&&draft.active_at&&
    events.some(e=>e.action==='ACTIVATE'&&e.actor_id&&e.decision_snapshot)
   ?'PROVED':'UNKNOWN';
 const sourceIds={product_id:item.product_id,market_code:market.code};
 const targetIds={product_id:draft?.product_id||item.product_id,
   market_code:draft?.market_code||market.code};
 const proof=record('P6_P1_PRICE_REVIEW',sourceStatus,targetStatus,sourceIds,targetIds,
  {order_id:item.order_id,real_margin_pct:pct??null,margin_basis:economic?.basis||null,
   market_price_status:draft?.status||'NOT_DECIDED',
   price_event_count:events.length,activation_event_count:events.filter(x=>x.action==='ACTIVATE').length,
   automatically_activated:false});
 proof.crossContradictions=[...faults];
 return {proofs:{P6_P1_PRICE_REVIEW:proof},
  diagnostics:{gaps:[...gaps],contradictions:[...faults],
   evidence_level:'HUMAN_PRICE_DECISION_NOT_INFERRED_FROM_MARGIN'},
  facts:{order_id:item.order_id,product_id:item.product_id,
   market_code:market.code,shadow_margin_pct:pct??null,
   price_status:draft?.status||null,event_count:events.length},
  owner_provenance:{
   economic:'services/cost-allocation/real-margin-shadow.computeOrderRealMarginShadow',
   market_pricing:'services/market-commercial-price-service (read-only draft/events)',
   activation:'services/market-local-price-state-transition.activateMarketPriceDecision (not called)',
   approval_not_inferred_from_margin:true}};
}
async function collectP6P1Canonical(db,{item,market,readers={}}={}){
 if(!db||typeof db.query!=='function'||!item?.order_id||!market?.id)
  throw Error('Exact persisted item and resolved market required');
 const {rows:drafts}=await db.query(
  'SELECT market_id,product_id,amount,currency,status,decided_by,authorized_at,'+
  'authorization_snapshot,active_at FROM product_market_price_drafts '+
  'WHERE market_id=$1 AND product_id=$2',
  [market.id,item.product_id]);
 if(drafts.length>1)throw Error('P6_P1_MULTIPLE_PRICE_DECISIONS');
 const {rows:events}=await db.query(
  'SELECT market_id,product_id,action,old_amount,new_amount,currency,'+
  'old_status,new_status,decision_snapshot,actor_id FROM product_market_price_draft_events '+
  'WHERE market_id=$1 AND product_id=$2 ORDER BY created_at,id LIMIT 101',
  [market.id,item.product_id]);
 const reader=readers.realMargin||
  require('../../services/cost-allocation/real-margin-shadow').computeOrderRealMarginShadow;
 const shadow=await reader(item.order_id,{client:db});
 const assessed=assessP6P1({item,market,shadow,draft:drafts[0]||null,events});
 if(events.length>100)assessed.diagnostics.gaps.push('PRICE_HISTORY_PAGINATION_LIMIT');
 return assessed;
}
module.exports={assessP6P1,collectP6P1Canonical};
