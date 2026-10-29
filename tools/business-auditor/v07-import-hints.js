'use strict';
/**
 * V0.7: find STATIC source-file import candidates from route to SQL writer.
 * Import text is not proof that a route, function or query executes.
 */
const path=require('node:path');
function resolveRelative(from,spec,known){
 if(typeof spec!=='string'||!spec.startsWith('./')&&!spec.startsWith('../'))return null;
 const normalized=path.posix.normalize(path.posix.join(path.posix.dirname(from),spec));
 if(normalized.startsWith('../')||normalized.startsWith('/')||normalized==='..')return null;
 for(const name of [normalized,normalized+'.js',normalized+'.cjs',
  normalized+'.mjs',normalized+'.ts',normalized+'/index.js']){
  if(known.has(name))return name;
 }
 return null;
}
function importCandidates(src){
 // Direct CommonJS/ESM imports only; lexical pattern can still match comments.
 const re=/(?:\brequire\s*\(\s*|\bfrom\s+|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
 return [...String(src).matchAll(re)].map(m=>m[1]);
}
function collectRouteImportPaths(paths,read,writerFiles,options={}){
 const maxDepth=options.maxDepth||4,limit=options.limit||4;
 const known=new Set(paths),back=new Map();let edges=0;
 for(const file of paths){
  let src;
  try{src=read(file)}catch{throw Error('Cannot inspect tracked source '+file)}
  for(const spec of importCandidates(src)){
   const dest=resolveRelative(file,spec,known);
   if(!dest)continue;
   if(!back.has(dest))back.set(dest,new Set());
   back.get(dest).add(file);edges++;
  }
 }
 const pathsByWriter={};
 for(const target of [...new Set(writerFiles)].sort()){
  if(!known.has(target))throw Error('Writer source absent from tracked scan: '+target);
  const hits=[],queue=[{at:target,chain:[target]}],seen=new Set([target]);
  while(queue.length&&hits.length<limit){
   const v=queue.shift();
   if(v.at.startsWith('routes/')){
    hits.push({routeFile:v.at,files:v.chain.slice().reverse(),
     evidence:'STATIC_RELATIVE_IMPORT_CANDIDATE_ONLY',runtimePathProven:false});
    continue;
   }
   if(v.chain.length>maxDepth)continue;
   for(const caller of [...(back.get(v.at)||[])].sort()){
    if(seen.has(caller))continue;
    seen.add(caller);queue.push({at:caller,chain:[...v.chain,caller]});
   }
  }
  pathsByWriter[target]=hits;
 }
 return {contract:'komerce-business-route-import-hints/v1',
  coverage:{scannedFiles:paths.length,importEdges:edges,writerFiles:Object.keys(pathsByWriter).length,
   writersWithRouteHints:Object.values(pathsByWriter).filter(x=>x.length).length,
   pathsProvenAtRuntime:0},
  pathsByWriter,limits:['Import syntax and possible module resolution do not prove function call or route registration',
   'Only relative CommonJS/ESM imports and a maximum hop count are inspected',
   'Commented imports may still match: further AST/call-site validation is required']};
}
module.exports={collectRouteImportPaths,resolveRelative,importCandidates};
