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
/**
 * Variable-time money request keys require durable retries, but a matching
 * Date.now elsewhere (expiry timestamps, OAuth cache) is not evidence.
 * PayPal legacy refund fallback is distinct from durable provider override.
 */
function detectTimeBasedRequestKeys(source,file){
 const str=String(source),out=[];
 const keyAssignment=/(?:\bidempotencyKey\b|['"]PayPal-Request-Id['"])\s*:\s*\x60[^\x60]{0,240}\bDate\.now\s*\(\s*\)[^\x60]{0,240}\x60/g;
 for(const m of str.matchAll(keyAssignment)){
  const expr=m[0],at=m.index;
  const provider=expr.includes('PayPal-Request-Id');
  const after=str.slice(at+m[0].length,at+m[0].length+360);
  const overridden=provider&&
   /\bif\s*\(\s*providerRequestKey\s*\)\s*refundHeaders\[['"]PayPal-Request-Id['"]\]\s*=\s*providerRequestKey\s*;?/.test(after);
  out.push({
   id:'KBA-C02',file,line:str.slice(0,at).split('\n').length,
   owner:provider?'Payments / PayPal Refunds':'Wallet / Admin Credits',
   priority:'P1',risk:'TIME_DERIVED_FINANCIAL_REQUEST_IDENTITY',
   requestKey:provider?'PayPal-Request-Id':'idempotencyKey',
   classification:overridden?'LEGACY_FALLBACK_WITH_DURABLE_OVERRIDE':'TIME_BASED_ADMIN_CREDIT_KEY',
   stableOverrideObserved:overridden,
   externalFinancialDuplicateConfirmed:false,
   verifiedBusinessBug:false,
   requiredIndependentProof:provider
    ?'Trace all caller and durable intents; replay legacy no-key refund in PSP sandbox and compare provider IDs'
    :'Replay same logical admin credit request against disposable ledger with different clock times and compare credit lots',
  });
 }
 return out;
}
function scanRelevantCode(staticFindings,root,read=fs.readFileSync){
 const categories=new Map();
 for(const finding of staticFindings||[]){
  if(!['LS-03','LS-05'].includes(finding.rule)||typeof finding.file!=='string')continue;
  const categoriesForFile=categories.get(finding.file)||new Set();
  categoriesForFile.add(finding.rule);
  categories.set(finding.file,categoriesForFile);
 }
 const out=[];
 for(const filename of [...categories.keys()].sort()){
  const pathNorm=filename.replace(/\\/g,'/');
  if(path.isAbsolute(pathNorm)||pathNorm.split('/').includes('..'))
   throw Error('Unsafe static finding path');
  const source=read(path.join(root,pathNorm),'utf8');
  if(categories.get(filename).has('LS-05'))
   out.push(...detectIgnoredInsertCount(source,pathNorm));
  if(categories.get(filename).has('LS-03'))
   out.push(...detectTimeBasedRequestKeys(source,pathNorm));
 }
 return out;
}
module.exports={detectIgnoredInsertCount,detectTimeBasedRequestKeys,scanRelevantCode};
