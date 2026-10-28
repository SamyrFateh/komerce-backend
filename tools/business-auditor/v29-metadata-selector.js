'use strict';
/**
 * V2.9 SOURCE-ONLY discovery and executable-recipe selection.
 * Inputs: genuine tracked runtime sources, owner-aware SQL writer inventory,
 * feature-card authorities, source route-import graph, V2.1 writer pair graph,
 * V2.2 equivalence class ranking and seven independent SQL invariants.
 *
 * The ranking is NOT a runtime bug oracle; only pre-reviewed recipes can run.
 * No DB, PSP, application import or production evidence in this module.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {trackedJs,buildWriterInventory,sourceScope}=require('./writer-inventory');
const {selectPairs}=require('./v21-static-pair-selector');
const {collapseFrozenPairs,tablePriority}=require('./v22-prioritize-pairs');
const {REGISTRY}=require('./v28-proof-adapters');
const {RULES}=require('./rules');
const ROOT=path.resolve(__dirname,'../..');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const stable=o=>JSON.stringify(o);
const error=s=>{throw Error('V29_SELECTION_TOOL_ERROR: '+s)};
function domainForTable(table,category,declared=[]){
 const t=String(table||'');
 if(/product_market|pricing|price_draft|margin|currency|exchange|fx_/.test(t))return 'pricing';
 if(/catalog|exposure|product_variants|product_categories/.test(t))return 'catalogue';
 if(/inventory|purchase|stock|hub/.test(t))return 'inventory';
 if(/parcel|shipment|scans|relais|delivery|customs/.test(t))return 'logistics';
 if(/refund|wallet|payment|cash|settlement|payout|ledger/.test(t))return 'finance';
 if(/auth|member|permission|assignment|role/.test(t))return 'authorization';
 if(/order_items|orders|order_|transition/.test(t))return 'orders';
 if(/sourcing|supplier|discovery|refiner|taxonomy/.test(t))return 'sourcing';
 const x=declared.filter(d=>typeof d==='string');
 const map={logistics:'logistics',payments:'finance',finance:'finance',inventory:'inventory',
  orders:'orders',sourcing:'sourcing',catalog:'catalogue',catalogue:'catalogue',pricing:'pricing',
  authorization:'authorization'};
 const d=x.find(v=>map[v]);
 return d?map[d]:'unclassified';
}
function scenarioEvidence(inv,ranking,{maxCases=4,domains=['finance','logistics']}={}){
 if(!Number.isInteger(maxCases)||maxCases<1||maxCases>4||
  !Array.isArray(domains)||!domains.length||domains.some(x=>!['finance','logistics'].includes(x))||
  new Set(domains).size!==domains.length)error('invalid physical budget/domain filter');
 if(inv?.contract!=='komerce-business-writer-inventory/v1'||
  ranking?.contract!=='komerce-prioritized-pair-selector/v22'||
  !/^[a-f0-9]{64}$/.test(ranking.rankHash||''))error('writer/selector provenance missing');
 const refund=ranking.rank.find(x=>x.table==='refunds'&&
  x.actors.some(a=>a.source==='routes/orders/cancel.js')&&
  x.actors.some(a=>a.source==='services/payment-paypal.js'));
 const parcel=inv.writes.filter(x=>x.table==='parcel_items'&&
  x.file==='services/auto-parcel.js'&&x.physicalTableDeclared===true&&
  x.binding==='DIRECT_QUERY_ARGUMENT');
 const all=[
  {domain:'finance',source:refund,ids:['FIN-REFUND-BA','FIN-REFUND-AB'],
   match:'SAME_TABLE_PAIR_FROM_V22_OWNER_GRAPH',
   evidence:refund?{pairId:refund.id,table:refund.table,
    actorSources:refund.actors.map(a=>a.source),score:refund.score}:null},
  {domain:'logistics',source:parcel.length?parcel:null,
   ids:['LOG-PARCEL-NOMINAL','LOG-PARCEL-CANCELLED'],
   match:'CANONICAL_AUTO_PARCEL_WRITER_IN_V06_INVENTORY',
   evidence:parcel.length?{table:'parcel_items',writer:'services/auto-parcel.js',
    writerLines:parcel.map(x=>x.line).slice(0,5)}:null}
 ];
 // Fail closed when a previously grounded recipe stops matching the actual
 // writer/source, rather than silently trusting old recipe IDs.
 const eligible=all.filter(x=>domains.includes(x.domain));
 if(eligible.some(x=>!x.source))
  error('calibrated owner writer no longer present: '+
   eligible.filter(x=>!x.source).map(x=>x.domain).join(','));
 const recipes=eligible.flatMap(x=>x.ids.map(id=>{
  const c=REGISTRY.find(r=>r.id===id);
  if(!c||c.domain!==x.domain)error('registered independent oracle missing '+id);
  return {id,domain:c.domain,mode:c.mode,fixture:c.fixture,expect:c.expect,
   ownerEvidence:x.evidence,selectionReason:x.match};
 }));
 // Fair, bounded execution: nominal finance then nominal logistics, then
 // adversarial finance then adversarial logistics. Never pick two identical
 // cases, even when one domain is absent.
 const positives=recipes.filter(r=>r.expect==='PASS_WITH_EVIDENCE'),
  negatives=recipes.filter(r=>r.expect==='BUSINESS_VIOLATION');
 const selected=[...positives,...negatives].slice(0,maxCases);
 const seal=sha(stable({sourceRankingHash:ranking.rankHash,
  selected:selected.map(r=>({id:r.id,evidence:r.ownerEvidence,expected:r.expect}))}));
 return {contract:'komerce-owner-grounded-calibrated-recipe-selection/v29',
  mode:'SOURCE_DISCOVERED_OWNER_ANCHORED_RECIPES',
  rankHash:ranking.rankHash,hash:seal,considered:recipes.length,
  budget:maxCases,selected,unselected:recipes.filter(x=>!selected.some(y=>y.id===x.id)),
  limits:'Only exact independently reviewed financial/logistics adapters are executable. No arbitrary writer pair is safe to run without fixture and oracle.'};
}
function prepare({paths,read,inventory,rules=RULES,maxCases=4,
 domains=['finance','logistics'],sha:commit}){
 if(!Array.isArray(paths)||typeof read!=='function'||
  !/^[a-f0-9]{40}$/.test(commit||''))error('incomplete source provenance');
 const inv=inventory||buildWriterInventory(ROOT,{paths});
 const sources=paths.filter(f=>sourceScope(f)==='APPLICATION_CANDIDATE');
 const sourcePairs=selectPairs({paths:sources,read,writes:inv.writes});
 const priority=collapseFrozenPairs(sourcePairs,read);
 const tableLookup=new Map(inv.tableSummary.map(x=>[x.table,x]));
 const tableRules=new Map();
 for(const r of rules){
  const table=String(r.grain||'').split('.')[0];
  if(!tableRules.has(table))tableRules.set(table,[]);
  tableRules.get(table).push({id:r.id,priority:r.priority,boundary:r.boundary,
   owner:r.owner,grain:r.grain});
 }
 const eligiblePairs=priority.rank.map((x,index)=>{
  const summary=tableLookup.get(x.table);
  const signalRules=tableRules.get(x.table)||[];
  const domain=domainForTable(x.table,x.category,summary?.domains);
  const risk=tablePriority(x.table);
  const cross=Number((summary?.crossDomainReview||0)>0);
  const score=x.score+signalRules.length*40+cross*30;
  return {id:x.id,sourceRank:index+1,table:x.table,domain,
   ownerSource:x.owner,actorSources:x.actors.map(a=>a.source),
   ownerFunctions:x.ownerFunctions,groupMembers:x.groupMembers,
   rankScore:score,sourceCategory:risk.category,
   sourcePairId:x.representativeId,matchingIndependentRules:signalRules,
   crossDomainReview:cross===1,
   runtimeReachabilityProven:false,
   physicalStatus:'ADAPTER_NOT_CERTIFIED_FOR_THIS_PAIR',
   hypothesis:'STATIC_PAIR_CANDIDATE_NOT_CONFIRMED_BUG'};
 }).sort((a,b)=>b.rankScore-a.rankScore||a.id.localeCompare(b.id));
 const represented=new Set(eligiblePairs.map(x=>x.table));
 const solo=inv.tableSummary.filter(x=>!represented.has(x.table))
  .map(x=>({table:x.table,domain:domainForTable(x.table,'',x.domains),
   writerCount:x.writers.length,sqlOccurrences:x.occurrences,
   ownerResolutionEvidence:x.explicitOwners,
   matchingIndependentRules:tableRules.get(x.table)||[],
   physicalStatus:'NO_TWO_WRITER_PAIR_OR_CALIBRATED_ADAPTER',
   hypothesis:'SINGLE_TABLE_SOURCE_REVIEW_NOT_CONFIRMED_BUG'}))
  .sort((a,b)=>b.sqlOccurrences-a.sqlOccurrences||a.table.localeCompare(b.table));
 const calibration=scenarioEvidence(inv,priority,{maxCases,domains});
 const qualifiedPhysicalCases=new Set(calibration.selected.map(x=>x.id));
 const evidence={
  contract:'komerce-metadata-driven-selection/v29',sha:commit,
  inventory:{coverage:inv.coverage,summary:inv.summary},
  pairs:{sourcePairCount:sourcePairs.pairs.length,
   v21SelectionHash:sourcePairs.selectionHash,
   equivalenceClasses:priority.rank.length,
   v22RankingHash:priority.rankHash,reviewQueue:eligiblePairs,
   unpairedSchemaTables:solo},
  rules:{count:rules.length,ids:rules.map(x=>x.id)},
  calibration,
  summary:{
   totalWriterPairs:sourcePairs.pairs.length,
   equivalenceClasses:eligiblePairs.length,
   singleWriterOrUnpairedTables:solo.length,
   priorityUnexecutable:eligiblePairs.length,
   physicalCalibrationsRunnable:qualifiedPhysicalCases.size,
   requiresNewAdapterForFullCoverage:true,
   domainsWithoutPhysicalAdapters:[
    'sourcing','pricing','catalogue','orders','inventory','authorization'
   ]
  },
  bounds:'All pair/rule ranking is source-only before DB. Runtime/HTTP ownership unproven.',
 };
 evidence.selectionHash=sha(stable({sha:commit,
  v21:evidence.pairs.v21SelectionHash,v22:evidence.pairs.v22RankingHash,
  calibration:calibration.hash,rules:evidence.rules.ids}));
 return evidence;
}
function fromRepo(options={}){
 const root=options.root||ROOT;
 const paths=trackedJs(root);
 const inv=buildWriterInventory(root,{paths});
 const read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const cp=require('node:child_process');
 const commit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 return prepare({paths,read,inventory:inv,sha:commit,
  maxCases:options.maxCases||4,domains:options.domains||['finance','logistics']});
}
module.exports={domainForTable,scenarioEvidence,prepare,fromRepo};
