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

function offsetForLine(src,n){
 if(!Number.isInteger(n)||n<1)return -1;
 let offset=0;
 for(let i=1;i<n;i++){
  const next=src.indexOf('\n',offset);
  if(next<0)return -1;
  offset=next+1;
 }
 return offset;
}
function selectPairs({paths,read,writes}){
 const known=new Set(paths),graph=routesReachable(paths,read),groups=new Map();
 // The inventory says WHICH physical table a file writes. Bind that mutation
 // to its enclosing source function before identifying any caller.
 for(const w of writes){
  if(!w.physicalTableDeclared||!w.table||!known.has(w.file))continue;
  const src=graph.sources[w.file],offset=offsetForLine(src,w.line);
  if(offset<0)continue;
  const method=functionAt(src,offset).name;
  if(method==='ANONYMOUS_BOUNDARY')continue;
  const key=w.file+'|'+w.table;
  if(!groups.has(key))groups.set(key,{owner:w.file,table:w.table,writerFunctions:new Set()});
  groups.get(key).writerFunctions.add(method);
 }
 const candidates=[],excluded=[];
 for(const group of groups.values()){
  const boundaries=[];
  for(const caller of paths){
   if(caller===group.owner)continue;
   const routePaths=[...(graph.byFile.get(caller)||[])].sort();
   if(!routePaths.length)continue;
   const src=graph.sources[caller];
   const names=destructuredImports(src,caller,group.owner,known)
    .filter(n=>group.writerFunctions.has(n));
   for(const symbol of names){
    for(const offset of actualCallSites(src,symbol)){
     const callerFunction=functionAt(normalizeSource(src),offset);
     const ownerSource=graph.sources[group.owner];
     const declaration=new RegExp('\\b(?:async\\s+)?function\\s+'+symbol+'\\s*\\(');
     const match=declaration.exec(ownerSource);
     if(!match)continue;
     const ownerFunction=functionAt(ownerSource,match.index+match[0].length);
     if(ownerFunction.name!==symbol)continue;
     const readCandidate=/\bSELECT\b[\s\S]{0,400}?\bFROM\s+\w+|\bassert\w*(?:Within|Prior|Balance|Available)\w*\s*\(/i.test(ownerFunction.body);
     const lock=/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b|pg_advisory_(?:xact_)?lock\b/i.test(callerFunction.body);
     boundaries.push({
      source:caller,entry:callerFunction.name,ownerFunction:symbol,
      routePaths,hasOwnerReadPrecheck:readCandidate,hasLocalLock:lock,
      hasBegin:/\bBEGIN\b/.test(callerFunction.body),
      evidence:'FUNCTION_SCOPED_SQL_WRITER_AND_LEXICAL_IMPORT_CALL',
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
    reason:'FEWER_THAN_TWO_REACHABLE_FUNCTION_SCOPED_WRITERS'});
   continue;
  }
  for(let i=0;i<dedup.length;i++)for(let j=i+1;j<dedup.length;j++){
   const a=dedup[i],b=dedup[j];
   if(a.source===b.source)continue;
   if(!(a.hasOwnerReadPrecheck||b.hasOwnerReadPrecheck))continue;
   if(a.hasLocalLock&&b.hasLocalLock)continue; // inspect locks first, lower-priority later
   const unlocked=Number(!a.hasLocalLock)+Number(!b.hasLocalLock);
   const score=100+20*unlocked+10*Number(a.hasLocalLock!==b.hasLocalLock);
   const entries=[a,b].sort((x,y)=>x.source.localeCompare(y.source)||
    x.ownerFunction.localeCompare(y.ownerFunction));
   const identity=[group.table,...entries.map(x=>x.source+'#'+x.entry+'#'+x.ownerFunction)].join('|');
   candidates.push({id:'KBA-PAIR-'+crypto.createHash('sha256').update(identity).digest('hex').slice(0,12),
    table:group.table,owner:group.owner,actors:entries,score,
    scope:'STATIC_FUNCTION_SCOPED_CANDIDATE_NOT_RUNTIME_PROOF',
    reason:'Same physical SQL table, proven lexical writer function, caller import and precheck',
    pending:['Verify actual SQL statement before running','Verify transaction and shared lock',
     'Ensure no external provider invoked','Prepare isolated schema-backed fixtures']});
  }
 }
 candidates.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(candidates)).digest('hex');
 return {contract:'komerce-static-pair-selector/v21',
  selectionLockedBeforeDbExecution:true,selectionHash:fingerprint,
  scannedFiles:paths.length,routeRootFiles:graph.routes.length,
  pairs:candidates,excluded,
  limitations:[
   'Writer association uses enclosing named function from SQL literal source location; imported helper writes can be missed',
   'Route reachability is import-based, not control-flow or HTTP reachability proof',
   'SQL preconditions and transaction boundaries are lexical, not an interprocedural AST proof',
   'Locked/locked candidates are deferred, not certified safe',
   'No real payment provider, route or database is executed by this selector'
  ]};
}
module.exports={routesReachable,destructuredImports,functionAt,actualCallSites,selectPairs};
