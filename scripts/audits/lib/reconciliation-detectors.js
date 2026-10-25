'use strict';
/**
 * Generic lexical reconciliation risks.
 *
 * Derived from a semantic property, not from named files or bug IDs:
 * when an owner refreshes the source-of-truth collection, an insert-only
 * junction writer may leave links that disappeared from the next snapshot.
 *
 * Candidate is REVIEW only. Some collections are intentionally append-only
 * and some source events are deltas rather than complete snapshots.
 * No direct DB effect is claimed here.
 */
const line=(text,index)=>text.slice(0,index).split('\n').length;
function stripCommentsPreservingLines(text){
 return String(text)
  .replace(/\/\*[\s\S]*?\*\//g,x=>x.replace(/[^\n]/g,' '))
  .replace(/(^|[ \t])\/\/[^\n]*/gm,x=>x.replace(/[^\n]/g,' '));
}
const APPROACH=/(?:promot|reconcil|sync|refresh|replace|import|materializ)/i;
function scanAppendOnlyReconciliationRisk(source,file){
 const body=stripCommentsPreservingLines(source),out=[];
 const sql=/\bINSERT\s+INTO\s+(?:public\.)?([a-z][a-z0-9_]*)\s*\(([^)]{4,500})\)\s*VALUES\s*\([^)]{0,700}\)\s*ON\s+CONFLICT\s*\([^)]{3,350}\)\s*DO\s+NOTHING\b/gi;
 for(const m of body.matchAll(sql)){
  const table=m[1].toLowerCase(),columns=m[2].split(',').map(x=>x.trim().toLowerCase());
  // Junctions have at least 2 foreign-ID columns or 2 relationships;
  // do not flag single-key event dedup / idempotent inbox inserts.
  if(columns.filter(x=>/_id$/.test(x)).length<2)continue;
  const preceding=body.slice(0,m.index);
  const functionName=[...preceding.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].at(-1)?.[1]||null;
  if(!functionName||!APPROACH.test(functionName))continue;
  // File-wide delete/update can be a reconciliation boundary, not a
  // guarantee of correct filtering, so suppress heuristic alert only.
  const escapes=new RegExp('\\b(?:DELETE\\s+FROM|TRUNCATE\\s+TABLE|UPDATE)\\s+(?:public\\.)?'+table+'\\b','i');
  if(escapes.test(body))continue;
  out.push({
   kind:'APPEND_ONLY_ASSOCIATION_REPLAY_RISK',
   severity:'REVIEW',file,table,line:line(source,m.index),
   function:functionName,columns,
   evidence:'junction INSERT ... ON CONFLICT DO NOTHING; no delete or deactivate in this module',
   caveat:'Only a candidate when input is an authoritative replacement snapshot, not an event/delta. Prove changed identity set, DB residual links and downstream effect against true services.'
  });
 }
 return out;
}
module.exports={scanAppendOnlyReconciliationRisk};
