'use strict';
/** V0.7 is a static declaration audit. No writer, SQL or provider is executed. */
const REVIEW=new Set(['CROSS_DOMAIN_UNDECLARED','OWNER_MISSING','OWNER_CONFLICT','FEATURE_CARD_MISSING','DOMAIN_MISSING','TARGET_UNPROVEN']);
const LEVEL={HIGH:0,MEDIUM:1,LOW:2,INFO:3};
function aliases(cards){
 const map=new Map();
 for(const {id,domain} of cards||[]){
  if(!id||!domain)continue;
  const k=String(domain).toLowerCase();
  if(!map.has(k))map.set(k,new Set());
  map.get(k).add(id);
 }
 return map;
}
function matches(domain,ids,byDomain){
 const d=String(domain||'').trim().toLowerCase();
 if(!d)return false;
 if(ids.includes(d))return true;
 const a=byDomain.get(d);
 return Boolean(a&&a.size===1&&ids.includes([...a][0]));
}
function classify(w,byDomain){
 const owners=w.explicitOwners||[],tech=w.declaredTechnicalWriters||[],
  writers=w.declaredFeatureWriters||[],domain=w.declaredDomain||null;
 let status='OWNER_DECLARED',priority='INFO';
 if(!w.physicalTableDeclared){status='TARGET_UNPROVEN';priority='MEDIUM'}
 else if(!owners.length){status=w.ownerResolution==='NOT_IN_FEATURE_CARDS'?'FEATURE_CARD_MISSING':'OWNER_MISSING';priority='MEDIUM'}
 else if(owners.length>1){status='OWNER_CONFLICT';priority='HIGH'}
 else if(!domain){status='DOMAIN_MISSING';priority='MEDIUM'}
 else if(matches(domain,owners,byDomain)){status=owners.includes(domain)?'OWNER_DECLARED':'OWNER_DOMAIN_ALIAS_DECLARED'}
 else if(matches(domain,tech,byDomain)){status='TECHNICAL_WRITER_DECLARED';priority='LOW'}
 else if(matches(domain,writers,byDomain)){status='FEATURE_WRITER_DECLARED';priority='LOW'}
 else{status='CROSS_DOMAIN_UNDECLARED';priority=w.binding==='DIRECT_QUERY_ARGUMENT'?'HIGH':'MEDIUM'}
 const flags=[];
 if(w.headerStatus==='MISSING_HEADER')flags.push('HEADER_MISSING');
 if(w.headerStatus==='TABLE_NOT_DECLARED_IN_HEADER')flags.push('HEADER_WRITE_NOT_DECLARED');
 if(w.binding!=='DIRECT_QUERY_ARGUMENT')flags.push('QUERY_CALL_NOT_PROVEN');
 if(w.dynamic)flags.push('DYNAMIC_SQL');
 const needsReview=REVIEW.has(status)||flags.includes('HEADER_MISSING')||flags.includes('HEADER_WRITE_NOT_DECLARED');
 return {id:w.id||null,file:w.file,line:w.line,table:w.table||null,rawTarget:w.rawTarget||null,
  action:w.action||null,domain,owners,tech,writers,status,priority,flags,needsReview,
  schemaEvidence:w.schemaEvidence,binding:w.binding||'NOT_PROVEN',ruleIds:w.primaryGrainRules||[],
  evidence:'LEXICAL_DECLARATION_ONLY',verifiedCallPath:false,authorized:false,
  runtimeWriteProven:false,confirmedBusinessBug:false};
}
function buildQualification(inventory){
 if(inventory?.contract!=='komerce-business-writer-inventory/v1'||!Array.isArray(inventory.writes))
  throw Error('V0.7 needs a complete writer-inventory/v1');
 const byDomain=aliases(inventory.featureCards);
 const findings=inventory.writes.map(w=>classify(w,byDomain));
 const byStatus={},groups=new Map();
 for(const w of findings){
  byStatus[w.status]=(byStatus[w.status]||0)+1;
  const key=[w.file,w.table||w.rawTarget||'<dynamic>',w.status].join('|');
  if(!groups.has(key))groups.set(key,{file:w.file,table:w.table,rawTarget:w.rawTarget,
   status:w.status,priority:w.priority,owners:w.owners,domain:w.domain,
   occurrences:0,lines:[],directQueryCandidates:0,needsReview:false,rules:new Set()});
  const g=groups.get(key);g.occurrences++;g.lines.push(w.line);g.needsReview ||= w.needsReview;
  if(w.binding==='DIRECT_QUERY_ARGUMENT')g.directQueryCandidates++;
  for(const id of w.ruleIds)g.rules.add(id);
 }
 const cases=[...groups.values()].map(g=>({...g,rules:[...g.rules].sort(),lines:g.lines.sort((a,b)=>a-b)}))
  .sort((a,b)=>LEVEL[a.priority]-LEVEL[b.priority]||b.directQueryCandidates-a.directQueryCandidates||
   b.occurrences-a.occurrences||a.file.localeCompare(b.file));
 const total=findings.length,physical=inventory.writes.filter(w=>w.physicalTableDeclared).length;
 if(total!==inventory.summary.candidateWrites||physical!==inventory.summary.physicalTableCandidates||
  total-physical!==inventory.summary.notProvenTableCandidates||
  cases.reduce((sum,c)=>sum+c.occurrences,0)!==total)throw Error('V0.7 lost source occurrences');
 return {contract:'komerce-business-writer-qualification/v1',findings,cases,
  summary:{occurrences:total,physical,unresolved:total-physical,cases:cases.length,
   reviewOccurrences:findings.filter(w=>w.needsReview).length,reviewCases:cases.filter(c=>c.needsReview).length,
   byStatus,verifiedCallPaths:0,authorizedWrites:0,confirmedBugs:0},
  limitations:['Source and Feature Card declarations are not authorization',
   'Direct query argument is syntax, not proven runtime reachability',
   'Declared owner match cannot prove business invariant correctness',
   'Unproven target candidates stay visible without invented table name']};
}
module.exports={buildQualification,classify,aliases,matches};
