'use strict';
/** Independent fixed-currency rational oracle and lifecycle-policy matrix.
 * No Komerce services imported here; expected values are derived from
 * canonical DB snapshot and separately stated business invariants.
 */
const fail=x=>{throw Error('V31_ORACLE_TOOL_ERROR: '+x)};
function rat(value){
 const s=String(value),m=/^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
 if(!m)fail('invalid decimal '+s);
 const dec=m[3]||'';
 return {n:BigInt(m[2]+dec)*(m[1]==='-'?-1n:1n),d:10n**BigInt(dec.length)};
}
function halfEven(a,rateFrom,rateTo){
 const x=rat(a),f=rat(rateFrom),t=rat(rateTo);
 if(f.n<=0n||t.n<=0n)fail('positive FX rates required');
 let n=x.n*t.n*f.d;
 const d=x.d*t.d*f.n;
 const neg=n<0n;
 if(neg)n=-n;
 let q=n/d;
 const twice=(n%d)*2n;
 if(twice>d||(twice===d&&q%2n===1n))q++;
 return (neg?-q:q).toString();
}
function fxOracle(raw){
 if(raw?.mode!=='FX'||!Array.isArray(raw.rates)||raw.rates.length!==2||
  !Array.isArray(raw.outcomes)||raw.outcomes.length!==3)fail('missing canonical FX evidence');
 const rates=Object.fromEntries(raw.rates.map(x=>[x.currency,x.rate]));
 if(!rates.KMF||!rates.XAF)fail('parity provenance missing');
 const signals=[],detail=[];
 for(const {input,result} of raw.outcomes){
  const expected=halfEven(input.amount,input.from==='EUR'?'1':rates[input.from],
    input.to==='EUR'?'1':rates[input.to]);
  const legCount=input.from==='EUR'?1:2;
  if(!result||result.amount_text!==expected||Number(result.amount)!==Number(expected)||
   result.rounding?.mode!=='half_even'||result.rounding?.minor_unit!==0||
   result.pivot!=='EUR'||result.from!==input.from||result.to!==input.to)
   signals.push('FX1_PIVOT_RESULT_OR_ROUNDING_MISMATCH');
  if(!Array.isArray(result?.legs)||result.legs.length!==legCount||
   result.legs.some(l=>l.source!=='currency_parities'||l.kind!=='parity'||
    rates[l.pair?.split('/')[1]]!==l.rate))
   signals.push('FX2_RATE_PROVENANCE_INCORRECT');
  detail.push({from:input.from,to:input.to,amount:input.amount,
   expected,actual:result?.amount_text||null});
 }
 return {contract:'komerce-independent-fixed-parity-oracle/v31',
  signals:[...new Set(signals)],violation:signals.length>0,detail,
  testedCurrencies:['EUR','KMF','XAF'],
  floatingCurrenciesCertified:false};
}
function allowed(status,operation,existingOrders){
 if(status==='ACTIVE')return true;
 if(status==='SUSPENDED')return operation==='customs_shipment_create'&&existingOrders===true;
 if(status==='PROVISIONING')return operation==='local_price_draft';
 return false;
}
function marketOracle(raw){
 if(raw?.mode!=='MARKET'||!Array.isArray(raw.observations)||raw.observations.length!==15||
  !raw.marketId||raw.marketCode!=='KM')fail('incomplete canonical market evidence');
 const signals=[],statuses=['ACTIVE','SUSPENDED','PROVISIONING'];
 for(const status of statuses){
  const rows=raw.observations.filter(x=>x.status===status);
  if(rows.length!==5)fail('market matrix incomplete '+status);
  for(const row of rows){
   const expect=allowed(status,row.operation,row.existingOrders);
   if(row.before?.lifecycle_status!==status||row.after?.lifecycle_status!==status||
    row.before.is_active!==(status!=='PROVISIONING')||
    row.after.is_active!==(status!=='PROVISIONING'))
    signals.push('MK1_LIFECYCLE_DB_STATE_NOT_STABLE');
   if(row.outcome?.allowed!==expect)
    signals.push('MK2_MARKET_OPERATION_POLICY_VIOLATION');
   if(expect&&row.outcome?.returnedMarket!==raw.marketCode)
    signals.push('MK3_ALLOWED_OPERATION_WRONG_MARKET');
   if(!expect&&(row.outcome?.error?.status!==409||
    row.outcome.error.code!==(status==='SUSPENDED'?'MARKET_SUSPENDED':'MARKET_NOT_ACTIVE')))
    signals.push('MK4_FORBIDDEN_OPERATION_NOT_TYPED_409');
  }
 }
 return {contract:'komerce-independent-market-lifecycle-oracle/v31',
  signals:[...new Set(signals)],violation:signals.length>0,
  checks:raw.observations.length,scope:'MARKET_LIFECYCLE_ONLY_NOT_USER_AUTHORIZATION'};
}
function inspect(raw){
 if(raw?.contract!=='komerce-fx-market-owner-physical/v31'||
  !raw.ownerExecuted||!raw.canonicalPg||!raw.noExternalNetwork||
  raw.noProductionAccess!==true||raw.authMiddlewareExecuted!==false)
  fail('source execution and cloned DB provenance absent');
 return raw.mode==='FX'?fxOracle(raw):
  raw.mode==='MARKET'?marketOracle(raw):fail('unknown mode');
}
function negative(raw){
 const forged=structuredClone(raw);
 if(raw.mode==='FX'){
  forged.outcomes[0].result.amount_text=String(Number(forged.outcomes[0].result.amount_text)+1);
  forged.outcomes[0].result.amount=Number(forged.outcomes[0].result.amount_text);
  return {name:'FORGED_PARITY_CONVERSION',signals:inspect(forged).signals};
 }
 if(raw.mode==='MARKET'){
  const row=forged.observations.find(x=>x.status==='SUSPENDED'&&
   x.operation==='local_price_activate');
  if(!row)fail('cannot construct forbidden price activation mutant');
  row.outcome={allowed:true,error:null,returnedMarket:forged.marketCode};
  return {name:'FORGED_SUSPENDED_ACTIVATION',signals:inspect(forged).signals};
 }
 fail('unknown mutant target');
}
module.exports={rat,halfEven,fxOracle,marketOracle,inspect,negative};
