'use strict';
/**
 * Independent economic invariants, evaluated for EVERY schedule (AB, BA, PAR)
 * even when the schedule is serializable. No PSP API and no DB writes.
 * Values normalized into EUR cents using the ORIGINAL order capture snapshot.
 */
function cents(eur){
 const n=Number(eur);
 if(!Number.isFinite(n)||n<0)throw Error('TOOL_ERROR: nonnumeric monetary amount');
 return Math.round(n*100);
}
function checkFinancialSchedule(record){
 if(!record||!record.state||!record.capture||
    !Array.isArray(record.state.refunds)||
    !['AB','AB_REPEAT','BA','PAR'].includes(record.mode))
  throw Error('TOOL_ERROR: incomplete financial observation');
 const capturedEurCents=cents(record.capture.eur),
  capturedKmf=Number(record.capture.kmf),walletKmf=Number(record.state.walletCreditKmf);
 if(!Number.isFinite(capturedKmf)||capturedKmf<=0||
  !Number.isFinite(walletKmf)||walletKmf<0||capturedEurCents<=0)
  throw Error('TOOL_ERROR: missing capture FX snapshot or wallet amount');
 const pspEvents=record.state.pspEvents;
 if(!Array.isArray(pspEvents)||pspEvents.some(e=>!e.id||
  !Number.isFinite(Number(e.amountEur))||Number(e.amountEur)<0))
  throw Error('TOOL_ERROR: PSP log must include each independent refund');
 const pspCents=pspEvents.reduce((s,e)=>s+cents(e.amountEur),0);
 const walletEqCents=Math.round(walletKmf*capturedEurCents/capturedKmf);
 const outflow=pspCents+walletEqCents;
 const ledger=record.state.refunds;
 const paypalEntries=ledger.filter(x=>x.refund_method==='paypal'&&
  x.status==='completed');
 const refundMatches=pspEvents.map(e=>({
  eventId:e.id,
  registered:paypalEntries.some(r=>
   r.stripe_refund_id===e.id&&cents(r.amount_eur)===cents(e.amountEur)),
 }));
 const signals=[];
 if(outflow>capturedEurCents+1)signals.push('I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE');
 if(refundMatches.some(m=>!m.registered))signals.push('I2_PSP_REFUND_MISSING_FROM_LEDGER');
 if(record.outcomes?.paypal?.http===200&&pspEvents.length&&
   refundMatches.some(m=>!m.registered))
  signals.push('I3_OWNER_SUCCESS_WITH_UNRECORDED_PSP_REFUND');
 return {contract:'komerce-independent-financial-invariants/v22',
  mode:record.mode,capturedCents:capturedEurCents,
  pspRefundedCents:pspCents,walletEquivalentCents:walletEqCents,
  totalRefundValueCents:outflow,
  originalSnapshot:{capturedKmf,capturedEurCents},
  pspReconciliation:refundMatches,
  signals,
  violation:signals.length>0,
  economicInterpretation:'SNAPSHOT_ORIGINAL_KMF_PER_EUR',
  noProductionIncidentClaim:true};
}
function evaluateSchedules(records){
 if(!Array.isArray(records)||records.length!==4||
   records.map(x=>x.mode).join('|')!=='AB|AB_REPEAT|BA|PAR')
  throw Error('TOOL_ERROR: missing AB, replay, BA or PAR');
 const details=records.map(checkFinancialSchedule);
 return {contract:'komerce-financial-route-probe-verdict/v22',
  schedules:details,deterministic:
   details[0].capturedCents===details[1].capturedCents&&
   details[0].pspRefundedCents===details[1].pspRefundedCents&&
   details[0].walletEquivalentCents===details[1].walletEquivalentCents&&
   details[0].signals.join('|')===details[1].signals.join('|'),
  violatedSchedules:details.filter(x=>x.violation).map(x=>x.mode),
  serializabilitySuffices:false,
  note:'Every sequential schedule has its own business-invariant verdict; serializability alone never means financial correctness'};
}
module.exports={checkFinancialSchedule,evaluateSchedules};
