'use strict';
/**
 * Independent code-pattern observer: no service imports, no eval, no runtime
 * invocation. Detects count-as-success following conflict-tolerant INSERT.
 * It is a code signal, not proof that concurrency/conflict occurs in reality.
 */
const fs=require('node:fs');
const path=require('node:path');
function detectIgnoredInsertCount(source,file){
 const str=String(source),out=[];
 const sql=/\bON\s+CONFLICT\s+DO\s+NOTHING\b/gi;
 for(const m of str.matchAll(sql)){
  const before=str.slice(Math.max(0,m.index-700),m.index);
  if(!/\bINSERT\s+INTO\s+(?:public\.)?parcel_items\b/i.test(before))continue;
  const after=str.slice(m.index+m[0].length,m.index+m[0].length+280);
  const counter=/\b(assigned|totalAssigned)\s*\+\+/g;
  const next=counter.exec(after);
  if(!next)continue;
  const intervening=after.slice(0,next.index);
  if(/\b(?:rowCount|rows\.length|RETURNING|returning)\b/.test(intervening))continue;
  const countAt=m.index+m[0].length+next.index;
  out.push({
   id:'KBA-C01',file,line:str.slice(0,countAt).split('\n').length,
   priority:'P1',owner:'Logistics / Parcel Membership',
   ignoredConflict:true,counter:next[1],
   risk:'COUNT_INCREASED_AFTER_CONFLICT_IGNORED_WITHOUT_ROWCOUNT_CHECK',
   verifiedBusinessBug:false,
   previousEvidence:file==='services/auto-parcel.js'
    ?{issue:2949,level:'SERVICE_MOCK_REPRODUCED_NOT_PHYSICAL_PG'}:null,
   requiredIndependentProof:'Replay duplicate or concurrent membership on disposable PG, assert affected rowCount versus returned assigned count',
  });
 }
 return out;
}
function scanRelevantCode(staticFindings,root,read=fs.readFileSync){
 const matched=[...new Set((staticFindings||[])
   .filter(f=>f.rule==='LS-05'&&typeof f.file==='string')
   .map(f=>f.file))].sort();
 const out=[];
 for(const filename of matched){
  const pathNorm=filename.replace(/\\/g,'/');
  if(path.isAbsolute(pathNorm)||pathNorm.split('/').includes('..'))
   throw Error('Unsafe static finding path');
  const source=read(path.join(root,pathNorm),'utf8');
  out.push(...detectIgnoredInsertCount(source,pathNorm));
 }
 return out;
}
module.exports={detectIgnoredInsertCount,scanRelevantCode};
