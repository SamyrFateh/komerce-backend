#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {trackedJs,buildWriterInventory,sourceScope}=require('./writer-inventory');
const {selectPairs}=require('./v21-static-pair-selector');
const {collapseFrozenPairs}=require('./v22-prioritize-pairs');
function run(out,root=path.resolve(__dirname,'../..')){
 if(!out)throw Error('TOOL_ERROR: output required');
 const paths=trackedJs(root),inventory=buildWriterInventory(root,{paths});
 const app=paths.filter(p=>sourceScope(p)==='APPLICATION_CANDIDATE');
 const read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const frozen=selectPairs({paths:app,read,writes:inventory.writes});
 const ranking=collapseFrozenPairs(frozen,read);
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const data={contract:'komerce-reduction-before-physical-PG/v22',
  sha,parent:{hash:frozen.selectionHash,total:frozen.pairs.length},
  ranking,source:'LIVE_V06_V07_RECOMPUTED_OFFLINE'};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v22-priority-pairs.json'),JSON.stringify(data,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V22_RANK '+JSON.stringify({
  sha,parentHash:frozen.selectionHash,reducedHash:ranking.rankHash,
  previous:frozen.pairs.length,classes:ranking.rank.length,
  prBudget:ranking.limits.pr,nightlyBudget:ranking.limits.nightly,
  top:ranking.rank.slice(0,10).map((x,i)=>({position:i+1,table:x.table,
   ownerFunctions:x.ownerFunctions,score:x.score,groupMembers:x.groupMembers,
   actorSources:x.actors.map(a=>a.source)})),
  dropped:ranking.counts.dropped
 }));
 return data;
}
if(require.main===module)try{run(process.argv[2])}catch(e){
 console.error('BUSINESS_AUDIT_V22_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
}
module.exports={run};
