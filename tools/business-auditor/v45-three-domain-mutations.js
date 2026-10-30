'use strict';
/**
 * Inspectable held-out adversarial mutations for three EXISTING physical owners.
 * They are source changes on disposable PG only, NOT an unknown-bug generator,
 * and NOT a sealed independent blind benchmark.
 */
const CASES=Object.freeze([
 {id:'FX_INCORRECT_PIVOT',domain:'fx',mode:'FX',truth:'FAULT',
  source:'services/fx-authority.js',from:"pivot: 'EUR',",to:"pivot: 'USD',"},
 {id:'FX_ROUNDING_OFFSET',domain:'fx',mode:'FX',truth:'FAULT',
  source:'services/fx-authority.js',
  from:'const q = roundHalfEven(num, den, minor);',
  to:'const q = roundHalfEven(num + den, den, minor);'},
 {id:'FX_EQUIV_RATIONAL_SCALE',domain:'fx',mode:'FX',truth:'EQUIVALENT_ON_FIXTURE',
  source:'services/fx-authority.js',
  from:'const q = roundHalfEven(num, den, minor);',
  to:'const q = roundHalfEven(num * 2n, den * 2n, minor);'},
 {id:'MARKET_ALLOW_SUSPENDED_PRICE',domain:'market',mode:'MARKET',truth:'FAULT',
  source:'services/market-operation-guard.js',
  from:'local_price_activate: Object.freeze([ACTIVE]),',
  to:'local_price_activate: Object.freeze([ACTIVE, SUSPENDED]),'},
 {id:'MARKET_DENY_PROVISIONING_DRAFT',domain:'market',mode:'MARKET',truth:'FAULT',
  source:'services/market-operation-guard.js',
  from:'local_price_draft: Object.freeze([ACTIVE, PROVISIONING]),',
  to:'local_price_draft: Object.freeze([ACTIVE]),'},
 {id:'MARKET_EQUIV_ARRAY_COPY',domain:'market',mode:'MARKET',truth:'EQUIVALENT_ON_FIXTURE',
  source:'services/market-operation-guard.js',
  from:'local_price_activate: Object.freeze([ACTIVE]),',
  to:'local_price_activate: Object.freeze([... [ACTIVE]]),'},
 {id:'ORDERS_UNAUTHORIZED_RELAIS',domain:'orders',mode:'ORDER',truth:'FAULT',
  source:'services/order-status-machine.js',
  from:"ordered:     ['admin', 'agent_hub'],",
  to:"ordered:     ['admin', 'agent_hub', 'agent_relais'],"},
 {id:'ORDERS_DUPLICATE_REPLAY',domain:'orders',mode:'ORDER',truth:'FAULT',
  source:'services/order-status-machine.js',
  from:'if (previousStatus === newStatus) {',
  to:'if (false && previousStatus === newStatus) {'},
 {id:'ORDERS_EQUIV_ROLE_ORDER',domain:'orders',mode:'ORDER',truth:'EQUIVALENT_ON_FIXTURE',
  source:'services/order-status-machine.js',
  from:"ordered:     ['admin', 'agent_hub'],",
  to:"ordered:     ['agent_hub', 'admin'],"}
]);
const OWNERS=Object.freeze({
 FX:'services/fx-authority.js',MARKET:'services/market-operation-guard.js',
 ORDER:'services/order-status-machine.js'
});
function mutate(source,id,file){
 const spec=CASES.find(c=>c.id===id);
 if(!spec||spec.source!==file)throw Error('V45_UNSUPPORTED_MUTATION_OR_OWNER');
 if(typeof source!=='string'||source.split(spec.from).length!==2)
  throw Error('V45_NON_UNIQUE_SOURCE_ANCHOR '+id);
 return source.replace(spec.from,spec.to);
}
function select(files){
 if(!Array.isArray(files)||!files.length||files.some(f=>typeof f!=='string'||
   f.includes('..')||f.startsWith('/')))
  throw Error('V45_FILES_NOT_ALLOWED');
 const modes=Object.entries(OWNERS).filter(([,file])=>files.includes(file))
  .map(([mode])=>mode);
 if(modes.length===0)throw Error('V45_NO_REVIEWED_OWNER_SELECTED');
 if(files.some(f=>!Object.values(OWNERS).includes(f)))
  throw Error('V45_UNREVIEWED_OWNER_NOT_EXECUTABLE');
 return modes;
}
function judge(records,modes){
 if(!Array.isArray(records)||!Array.isArray(modes)||!modes.length)
  throw Error('V45_INVALID_EVIDENCE');
 const expected=CASES.filter(c=>modes.includes(c.mode));
 if(records.length!==expected.length||new Set(records.map(r=>r.id)).size!==expected.length)
  throw Error('V45_INCOMPLETE_OR_DUPLICATE_EXPERIMENT');
 const seen=new Set(),facts=[];
 for(const r of records){
  const c=expected.find(x=>x.id===r.id);
  if(!c||seen.has(r.id)||r.mode!==c.mode||r.domain!==c.domain||
     r.truth!==c.truth||r.realOwnerExecuted!==true||
     r.canonicalPg!==true||r.cloneDropped!==true||
     r.mutationApplied!==true||!Array.isArray(r.signals))
   throw Error('V45_MISSING_PROVENANCE '+r.id);
  seen.add(r.id);
  facts.push({...r,correct:c.truth==='FAULT'?r.signals.length>0:r.signals.length===0});
 }
 const positives=facts.filter(x=>x.truth==='FAULT'),negatives=facts.filter(x=>x.truth==='EQUIVALENT_ON_FIXTURE');
 return {records:facts,summary:{
  ownerFamilies:modes.length,mutants:facts.length,faults:positives.length,
  equivalentControls:negatives.length,
  detected:positives.filter(x=>x.correct).length,
  missed:positives.filter(x=>!x.correct).length,
  falsePositives:negatives.filter(x=>!x.correct).length,
  status:facts.every(x=>x.correct)?'PASS_REVIEWED_THREE_DOMAIN_ADVERSARIAL':
   'FAIL_ADVERSARIAL_REGRESSION'}};
}
module.exports={CASES,OWNERS,mutate,select,judge};
