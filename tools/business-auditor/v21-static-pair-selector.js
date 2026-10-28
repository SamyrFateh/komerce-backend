'use strict';
/**
 * Offline source-only pair selection: inventory V0.6 + import hints V0.7.
 * No application modules are loaded, and no database or provider is called.
 * All conclusions are STATIC CANDIDATES, not proven runtime entrypoints.
 */
const crypto=require('node:crypto'),path=require('node:path');
const {importCandidates,resolveRelative}=require('./v07-import-hints');
function normalizeSource(src){
 return String(src).replace(/\/\*[\s\S]*?\*\//g,'')
  .replace(/^\s*\/\/[^\n]*/gm,'');
}
function routesReachable(paths,read){
 const known=new Set(paths),sources=Object.fromEntries(paths.map(p=>[p,read(p)]));
 const next=new Map(paths.map(p=>[p,importCandidates(sources[p])
  .map(spec=>resolveRelative(p,spec,known)).filter(Boolean)]));
 const root=paths.filter(p=>p.startsWith('routes/')&&p.endsWith('.js'));
 const queue=root.map(p=>({file:p,route:p,depth:0})),hits=new Map(),seen=new Set();
 for(let i=0;i<queue.length;i++){
  const x=queue[i],key=x.route+'|'+x.file;
  if(seen.has(key)||x.depth>6)continue;
  seen.add(key);
  if(!hits.has(x.file))hits.set(x.file,new Set());
  hits.get(x.file).add(x.route);
  for(const to of next.get(x.file)||[])
   queue.push({file:to,route:x.route,depth:x.depth+1});
 }
 return {sources,next,routes:root,byFile:hits};
}
function destructuredImports(src,from,target,known){
 const results=[];
 const re=/\b(?:const|let|var)\s*\{([^}]{1,500})\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
 for(const m of String(src).matchAll(re)){
  if(resolveRelative(from,m[2],known)!==target)continue;
  for(const part of m[1].split(',')){
   const name=part.trim().split(/\s*:\s*/)[0];
   if(/^[A-Za-z_$][\w$]*$/.test(name))results.push(name);
  }
 }
 return [...new Set(results)].sort();
}
function functionAt(src,offset){
 const funcs=[...src.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
 let selected=null,following=src.length;
 for(let i=0;i<funcs.length;i++){
  if(funcs[i].index<=offset){
   selected=funcs[i];following=funcs[i+1]?.index??src.length;
  }else break;
 }
 return {name:selected?.[1]||'ANONYMOUS_BOUNDARY',
  body:src.slice(selected?.index??0,following)};
}
function actualCallSites(src,name){
 const cleaned=normalizeSource(src);
 const re=new RegExp('\\b'+name+'\\s*\\(','g');
 const hits=[];
 for(const m of cleaned.matchAll(re)){
  // Ignore function declarations. Only call expressions count.
  const prefix=cleaned.slice(Math.max(0,m.index-30),m.index);
  if(/\bfunction\s+$/.test(prefix))continue;
  hits.push(m.index);
 }
 return hits;
}
function selectPairs({paths,read,writes}){
 const known=new Set(paths),graph=routesReachable(paths,read);
 const groups=new Map();
 for(const w of writes){
  if(!w.physicalTableDeclared||!w.table||!known.has(w.file))continue;
  const key=w.file+'|'+w.table;
  if(!groups.has(key))groups.set(key,{owner:w.file,table:w.table,actions:new Set()});
  groups.get(key).actions.add(w.action);
 }
 const candidates=[],excluded=[];
 for(const group of groups.values()){
  const boundaries=[];
  for(const caller of paths){
   if(caller===group.owner)continue;
   const routePaths=[...(graph.byFile.get(caller)||[])].sort();
   if(!routePaths.length)continue;
   const src=graph.sources[caller];
   const names=destructuredImports(src,caller,group.owner,known);
   for(const symbol of names){
    for(const offset of actualCallSites(src,symbol)){
     const callerFunction=functionAt(normalizeSource(src),offset);
     const ownerSource=graph.sources[group.owner];
     const ownerDeclaration=new RegExp('\\b(?:async\\s+)?function\\s+'+symbol+'\\s*\\(');
     const match=ownerDeclaration.exec(ownerSource);
     if(!match)continue;
     const ownerFunction=functionAt(ownerSource,match.index+match[0].length);
     const readCandidate=/\bSELECT\b[\s\S]{0,400}?\bFROM\s+\w+|\bassert\w*(?:Within|Prior|Balance|Available)\w*\s*\(/i.test(ownerFunction.body);
     const lock=/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b|pg_advisory_(?:xact_)?lock\b/i.test(callerFunction.body);
     boundaries.push({
      source:caller,entry:callerFunction.name,ownerFunction:symbol,
      routePaths,hasOwnerReadPrecheck:readCandidate,hasLocalLock:lock,
      hasBegin:/\bBEGIN\b/.test(callerFunction.body),
      evidence:'LEXICAL_CALL_AND_IMPORT_REACHABILITY_ONLY',
      runtimeReachabilityProven:false
     });
    }
   }
  }
  const dedup=[...new Map(boundaries.map(x=>[
   x.source+'#'+x.entry+'#'+x.ownerFunction,x])).values()]
   .sort((a,b)=>a.source.localeCompare(b.source)||a.ownerFunction.localeCompare(b.ownerFunction));
  if(dedup.length<2){
   excluded.push({owner:group.owner,table:group.table,
    reason:'FEWER_THAN_TWO_REACHABLE_ENTRYPOINT_CANDIDATES'});
   continue;
  }
  for(let i=0;i<dedup.length;i++)for(let j=i+1;j<dedup.length;j++){
   const a=dedup[i],b=dedup[j];
   if(a.source===b.source&&a.entry===b.entry)continue;
   const readFirst=a.hasOwnerReadPrecheck||b.hasOwnerReadPrecheck;
   if(!readFirst)continue;
   const unlocked=Number(!a.hasLocalLock)+Number(!b.hasLocalLock);
   const score=100*Number(readFirst)+20*unlocked+10*Number(a.hasLocalLock!==b.hasLocalLock);
   const entries=[a,b].sort((x,y)=>x.source.localeCompare(y.source)||
    x.ownerFunction.localeCompare(y.ownerFunction));
   const identity=[group.table,...entries.map(x=>x.source+'#'+x.entry+'#'+x.ownerFunction)].join('|');
   candidates.push({id:'KBA-PAIR-'+crypto.createHash('sha256').update(identity).digest('hex').slice(0,12),
    table:group.table,owner:group.owner,actors:entries,score,
    scope:'STATIC_PAIR_CANDIDATE_NOT_RUNTIME_PROOF',
    reason:'Shared physical-table writer with lexical precheck and reachable callers',
    pending:['Validate real transaction boundary','Prove PSP isolated','Provision canonical fixture']});
  }
 }
 candidates.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(candidates)).digest('hex');
 return {contract:'komerce-static-pair-selector/v21',
  selectionLockedBeforeDbExecution:true,selectionHash:fingerprint,
  scannedFiles:paths.length,routeRootFiles:graph.routes.length,
  pairs:candidates,excluded,
  limitations:[
   'Imports are static reachability hints, not a call graph',
   'Function attribution is lexical and can be confused by nested or anonymous callbacks',
   'SELECT detection and BEGIN/lock detection are heuristic and can miss imported locks',
   'No real entrypoint, transaction, PSP or PostgreSQL operation is executed by selection'
  ]};
}
module.exports={routesReachable,destructuredImports,functionAt,actualCallSites,selectPairs};
