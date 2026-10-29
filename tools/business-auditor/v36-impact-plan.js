#!/usr/bin/env node
'use strict';
/** Pure G3 impact plan; selects but NEVER executes an unreviewed experiment. */
const fs=require('node:fs'),path=require('node:path');
const {fromRepo}=require('./v29-metadata-selector');
const {normalize}=require('./v35-invariant-census');
const {plan}=require('./v36-impact-selector');
function parse(argv){
 const o={files:[],budget:4,out:null};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];
  if(key==='--help')return {...o,help:true};
  if(!['--files','--budget','--out'].includes(key)||!argv[i+1])
   throw Error('G3_CLI_TOOL_ERROR: usage --files CSV [--budget N] [--out DIR]');
  const val=argv[++i];
  if(key==='--files')o.files=val.split(',').map(x=>x.trim());
  if(key==='--budget')o.budget=Number(val);
  if(key==='--out')o.out=val;
 }
 if(!o.files.length)throw Error('G3_CLI_TOOL_ERROR: explicit --files required');
 return o;
}
function run(argv=process.argv.slice(2),deps={}){
 const opts=parse(argv);
 if(opts.help)return {help:true};
 const source=(deps.discovery||fromRepo)();
 const census=(deps.census||normalize)();
 const result=plan({paths:opts.files,discovery:source,census,budget:opts.budget});
 if(opts.out){
  const dir=path.resolve(opts.out);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'impact-plan.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'impact-plan.md'),[
   '# G3 — plan ciblé (sélection seule)','',
   '- SHA : '+result.sourceSha,
   '- Budget : '+result.budget,
   '- Risques retenus : '+result.selected.length,
   '- Risques écartés par budget : '+result.omitted.length,
   '- Expériences générées : **0**',
   '- Exécutions physiques : **0**',
   '- Verdict : **STATIC_TRIAGE_ONLY**','',
   '| Classe de risque | Domaine | Rang | Statut |',
   '|---|---|---:|---|',
   ...result.selected.map(x=>'| '+x.pairId+' | '+x.domain+' | '+
    x.priority+' | REVIEW_REQUIRED |'),
   '', 'Tous les scénarios non certifiés restent NON EXÉCUTÉS.',''
  ].join('\n'));
 }
 console.log('BUSINESS_AUDIT_V36_IMPACT_PLAN '+JSON.stringify({
  sha:result.sourceSha,selected:result.selected.length,omitted:result.omitted.length,
  executions:0,verdict:result.verdict,planHash:result.planHash
 }));
 return result;
}
if(require.main===module){try{run()}catch(e){console.error('G3_CLI_TOOL_ERROR '+e.message);process.exitCode=2}}
module.exports={run,parse};
