'use strict';
/**
 * Rank PRE-FROZEN V2.1 candidates without choosing a known bug at runtime.
 * 1) collapse equivalent owner-function+lock signatures;
 * 2) exclude dead/simulated paths & append-only writers without owner precheck;
 * 3) enforce actual table-read or financial assertion in owner source;
 * 4) rank by money, stock/allocations, parcels, state, others.
 * No DB calls. The original frozen ranking hash stays in the evidence.
 */
const crypto=require('node:crypto');
const {functionAt}=require('./v21-static-pair-selector');
function tablePriority(table){
 const t=String(table).toLowerCase();
 if(/refund|wallet|payment|cash|capture|settlement|financial|ledger|payout/.test(t))
  return {priority:1000,category:'FINANCIAL'};
 if(/stock|inventory|allocation|reservation/.test(t))
  return {priority:850,category:'INVENTORY'};
 if(/parcel|hub|shipment/.test(t))
  return {priority:700,category:'LOGISTICS'};
 if(/status|transition|order_items/.test(t))
  return {priority:500,category:'ORDER_STATE'};
 return {priority:200,category:'GENERAL'};
}
const excludedName=p=>/(^|\/)(?:test|tests|scripts|simulator|seed|fixture|demo)(\/|\.|-)|\bseed[A-Z]|\bsimulat/i.test(p);
function ownerScope(ownerSource,method) {
 const escaped=method.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const re=new RegExp('\\b(?:async\\s+)?function\\s+'+escaped+'\\s*\\(');
 const hit=re.exec(ownerSource);
 if(!hit)return null;
 const body=functionAt(ownerSource,hit.index+hit[0].length).body;
 return body;
}
function readsTableBeforeMutation(src,table) {
 if(typeof src!=='string')return false;
 const cleaned=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 const literal=table.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const from=new RegExp('\\b(?:FROM|JOIN)\\s+(?:"?public"?\\.)?"?'+literal+'"?\\b','i');
 const select=cleaned.search(/\bSELECT\b/i),tableAt=cleaned.search(from);
 const write=cleaned.search(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i);
 return select>=0&&tableAt>=select&&(write<0||tableAt<write);
}
function hasFinancialAssertion(src){
 return /\bassert[A-Za-z]*(?:WithinCaptured|RecordCompatible|Balance|Available|Prior)\s*\(/.test(src);
}
function enrich(p,read) {
 const actors=p.actors.map(x=>{
  const src=ownerScope(read(p.owner),x.ownerFunction);
  return {...x,ownerFunctionReadSameTable:readsTableBeforeMutation(src,p.table),
   ownerFunctionFinancialAssertion:hasFinancialAssertion(src||''),
   ownerFunctionScoped:src!==null};
 });
 return {...p,actors};
}
function collapseFrozenPairs(selection,read,{nightly=10,pr=5}={}) {
 if(selection?.contract!=='komerce-static-pair-selector/v21'||
  selection.selectionLockedBeforeDbExecution!==true||
  !/^[a-f0-9]{64}$/.test(selection.selectionHash||'')||
  !Array.isArray(selection.pairs)||typeof read!=='function')
  throw Error('TOOL_ERROR: V2.1 frozen ranking missing or corrupted');
 const groups=new Map(),dropped={simulated:0,noOwnerEvidence:0,noReadPrecheck:0};
 for(const p of selection.pairs) {
  if(excludedName(p.owner)||p.actors.some(x=>excludedName(x.source)||excludedName(x.entry))){
   dropped.simulated++;continue;
  }
  const q=enrich(p,read);
  if(q.actors.some(x=>!x.ownerFunctionScoped)){dropped.noOwnerEvidence++;continue}
  if(!q.actors.some(x=>x.ownerFunctionReadSameTable||x.ownerFunctionFinancialAssertion)){
   dropped.noReadPrecheck++;continue;
  }
  const ownerLockState=q.actors.map(a=>a.ownerFunction+':'+(a.hasLocalLock?'L':'U')).sort();
  const key=q.table+'|'+ownerLockState.join('|');
  if(!groups.has(key))groups.set(key,{key,table:q.table,owner:q.owner,
    ownerFunctions:ownerLockState,examples:[],members:0});
  const group=groups.get(key);
  group.members++;
  group.examples.push(q);
 }
 const rank=[...groups.values()].map(g=>{
  const policy=tablePriority(g.table);
  g.examples.sort((a,b)=>{
   const routeA=a.actors.filter(x=>x.source.startsWith('routes/')).length,
    routeB=b.actors.filter(x=>x.source.startsWith('routes/')).length;
   return routeB-routeA||
    b.actors.filter(x=>x.ownerFunctionReadSameTable).length-
    a.actors.filter(x=>x.ownerFunctionReadSameTable).length||
    a.id.localeCompare(b.id);
  });
  const chosen=g.examples[0];
  const readCount=chosen.actors.filter(x=>x.ownerFunctionReadSameTable).length;
  const assertCount=chosen.actors.filter(x=>x.ownerFunctionFinancialAssertion).length;
  const unlocked=chosen.actors.filter(x=>!x.hasLocalLock).length;
  const score=policy.priority+readCount*24+assertCount*30+unlocked*7;
  return {id:'KBA22-'+crypto.createHash('sha256').update(g.key).digest('hex').slice(0,12),
   table:g.table,owner:g.owner,ownerFunctions:g.ownerFunctions,score,
   category:policy.category,groupMembers:g.members,
   representativeId:chosen.id,actors:chosen.actors,
   scope:'STATIC_EQUIVALENCE_CLASS_NOT_HTTP_OR_RUNTIME_VERIFIED',
   policyPreapproved:false};
 }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 const hash=crypto.createHash('sha256').update(JSON.stringify(rank)).digest('hex');
 return {contract:'komerce-prioritized-pair-selector/v22',
  parentSelectionHash:selection.selectionHash,rankHash:hash,
  counts:{original:selection.pairs.length,classes:rank.length,dropped},
  limits:{pr,nightly},
  pr:rank.slice(0,pr).map(x=>x.id),
  nightly:rank.slice(0,nightly).map(x=>x.id),
  rank,
  caveat:'Classes use static source and locks; real routes, amounts and authorization unverified. Money weighting is a review heuristic.'};
}
module.exports={tablePriority,ownerScope,readsTableBeforeMutation,hasFinancialAssertion,collapseFrozenPairs};
