#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {trackedJs,buildWriterInventory,sourceScope}=require('./writer-inventory');
const {selectPairs}=require('./v21-static-pair-selector');
function run(out,root=path.resolve(__dirname,'../..')){
 if(!out)throw Error('TOOL_ERROR: selection report directory required');
 const paths=trackedJs(root),inventory=buildWriterInventory(root,{paths});
 const app=paths.filter(p=>sourceScope(p)==='APPLICATION_CANDIDATE');
 const read=p=>fs.readFileSync(path.join(root,p),'utf8');
 const selection=selectPairs({paths:app,read,writes:inventory.writes});
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const record={contract:'komerce-frozen-before-DB-pair-selection/v21',sha,
  inventory:{coverage:inventory.coverage,summary:inventory.summary},
  selection};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v21-static-pair-selection.json'),
  JSON.stringify(record,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V21_PAIR_SELECTOR '+JSON.stringify({
  sha,selectionHash:selection.selectionHash,scannedFiles:selection.scannedFiles,
  candidatePairs:selection.pairs.length,topPairs:selection.pairs.slice(0,12).map(x=>({
   id:x.id,table:x.table,owner:x.owner,actors:x.actors.map(a=>a.source+'#'+a.ownerFunction),
   score:x.score
  })),excludedDeadExamples:selection.excluded.filter(x=>x.owner.startsWith('utils/')).slice(0,12)
 }));
 return record;
}
if(require.main===module)try{run(process.argv[2])}catch(e){
 console.error('BUSINESS_AUDIT_V21_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
}
module.exports={run};
