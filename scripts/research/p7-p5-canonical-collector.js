'use strict';
/**
 * P7 -> P5. Market control plane versus the central-attestation settlement
 * state. There is no commission formula and no inferred country payout.
 * Active Market Operating Assignment is necessary for NEW settlements, but
 * historical settlements against ENDED assignments remain valid records.
 * Never call owner writers; read only on same PG snapshot.
 */
const {record}=require('./p1-p7-canonical-collector');
function assessP7P5({plane,settlements=[]}={}){
 const market=plane?.market||null,assignment=plane?.assignment||null;
 if(!market?.id||!market?.code)throw Error('Resolved P7 market required');
 const faults=new Set(),gaps=new Set();
 const active=Boolean(market.is_active&&market.lifecycle_status==='ACTIVE'&&
  assignment?.status==='ACTIVE');
 if(!active)gaps.add('MARKET_OR_OPERATING_ASSIGNMENT_NOT_ACTIVE');
 if(!settlements.length)gaps.add('NO_COUNTRY_SETTLEMENT_ATTESTATION');
 for(const s of settlements){
  if(String(s.market_id)!==String(market.id))faults.add('SETTLEMENT_FOREIGN_MARKET');
  if(s.assignment_market_id&&String(s.assignment_market_id)!==String(market.id))
   faults.add('SETTLEMENT_ASSIGNMENT_FOREIGN_MARKET');
  if(!s.assignment_market_id)gaps.add('SETTLEMENT_ASSIGNMENT_NOT_RESOLVED');
  if(s.currency!==market.currency)faults.add('SETTLEMENT_CURRENCY_NOT_MARKET_CURRENCY');
  if(s.source!=='CENTRAL_ATTESTATION')faults.add('SETTLEMENT_NOT_CENTRAL_ATTESTATION');
  if(s.status==='READY'&&s.assignment_status!=='ACTIVE')
   faults.add('NEW_READY_SETTLEMENT_ON_INACTIVE_ASSIGNMENT');
  // PAID and RECEIVED are attested lifecycle stages, not proof of bank
  // settlement beyond the stored payment reference / human receipt.
  if(['PAID','RECEIVED'].includes(s.status)&&!s.payment_reference)
   faults.add('PAID_SETTLEMENT_WITHOUT_PAYMENT_REFERENCE');
  if(s.status==='RECEIVED'&&!s.received_at)
   faults.add('RECEIVED_SETTLEMENT_WITHOUT_RECEIPT_TIMESTAMP');
  if(s.status==='READY')gaps.add('READY_ATTESTATION_NOT_COUNTRY_PAYMENT');
  if(s.status==='REQUESTED')gaps.add('REQUESTED_NOT_PAID');
  if(s.status==='PAID')gaps.add('PAID_NOT_COUNTRY_RECEIVED');
  if(s.status==='RECEIVED')gaps.add('COUNTRY_RECEIPT_NOT_EXTERNAL_BANK_PROOF');
 }
 const sourceStatus=active?'PROVED':'UNKNOWN';
 const targetStatus=settlements.length&&
   settlements.every(x=>x.status==='RECEIVED'&&x.received_at&&x.payment_reference)
   ?'PROVED':'UNKNOWN';
 const proof=record('P7_P5_COUNTRY_SETTLEMENT',sourceStatus,targetStatus,
  {market_code:market.code},{market_code:market.code},
  {market_id:market.id,assignment_id:assignment?.id||null,
   assignment_status:assignment?.status||null,
   settlement_count:settlements.length,
   statuses:[...new Set(settlements.map(s=>s.status))],
   external_bank_statement_verified:false});
 proof.crossContradictions=[...faults];
 // Never promote an old completed settlement to current ACTIVE operator
 // authorization; the status of the assignment has temporal semantics.
 if(gaps.size&&proof.target.status==='PROVED')proof.target.status='UNKNOWN';
 return {proofs:{P7_P5_COUNTRY_SETTLEMENT:proof},
  diagnostics:{gaps:[...gaps],contradictions:[...faults],
   evidence_level:'MARKET_ATTESTATION_IS_NOT_EXTERNAL_BANK_TRANSFER'},
  facts:{market_code:market.code,market_id:market.id,
   current_assignment:assignment?.id||null,
   current_assignment_status:assignment?.status||null,
   settlement_count:settlements.length,statuses:[...new Set(settlements.map(s=>s.status))]},
  owner_provenance:{
   market:'services/market-control-plane.getControlPlane',
   settlements:'services/market-settlement-service (read-only state)',
   lifecycle:'migrations/208_market_settlement_foundation.sql',
   external_bank_proof:false}};
}
async function collectP7P5Canonical(db,{plane,readers={}}={}){
 if(!db||typeof db.query!=='function'||!plane?.market?.id)
  throw Error('Market control plane and executor required');
 // Read all historical settlements for this MARKET, not only the current
 // assignment; a previous assignment is valid settlement history.
 const {rows:settlements}=await db.query(
  'SELECT s.market_id,s.assignment_id,s.amount,s.currency,s.source,s.status,'+
  's.payment_reference,s.paid_at,s.received_at,a.market_id AS assignment_market_id,'+
  'a.status AS assignment_status FROM market_settlements s '+
  'LEFT JOIN market_operating_assignments a ON a.id=s.assignment_id '+
  'WHERE s.market_id=$1 ORDER BY s.created_at,s.id LIMIT 101',
  [plane.market.id]);
 const assessed=assessP7P5({plane,settlements});
 if(settlements.length>100)assessed.diagnostics.gaps.push('SETTLEMENT_PAGINATION_LIMIT');
 return assessed;
}
module.exports={assessP7P5,collectP7P5Canonical};
