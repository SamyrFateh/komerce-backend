#!/usr/bin/env node
'use strict';
/**
 * Fails closed when the isolated PostgreSQL trial fails to produce the
 * exact nominal, controls, deviation and downstream evidence.
 *
 * Verifies evidence existence and honest discrepancy, NOT a code fix.
 * Diagnostic tests intentionally assert current defective behavior.
 */
const fs=require('node:fs'),path=require('node:path');
const filename=process.argv[2];
const output=process.argv[3]||'audit-results/blind-trial';
if(!filename)throw Error('Usage: verify-blind-catalog-trial.js LOG [OUT]');
const lines=fs.readFileSync(filename,'utf8').split('\n');
const rows=lines.filter(l=>l.includes('BLIND_CATALOG_TRIAL '))
 .map(l=>JSON.parse(l.slice(l.indexOf('BLIND_CATALOG_TRIAL ')+20).trim()));
const expected=['NOMINAL','DEVIATION','NEGATIVE_ADDITIVE','NEGATIVE_FRESH_B','DOWNSTREAM'];
const by=new Map();
for(const row of rows){
 if(!expected.includes(row.mode))throw Error('unexpected mode '+row.mode);
 if(by.has(row.mode))throw Error('duplicate mode '+row.mode);
 if(row.db!=='POSTGRES_REAL')throw Error('not real PostgreSQL: '+row.mode);
 if(row.hypothesis!=='SKU_MEDIA_LINKS_SYNCHRONIZED_TO_EXPLICIT_SOURCE_REFS')throw Error('wrong hypothesis');
 by.set(row.mode,row);
}
for(const mode of expected)if(!by.has(mode))throw Error('missing real-db evidence for '+mode);
for(const mode of ['NOMINAL','NEGATIVE_ADDITIVE','NEGATIVE_FRESH_B']){
 if(by.get(mode).invariantOK!==true)throw Error('healthy control not healthy: '+mode);
}
for(const mode of ['DEVIATION','DOWNSTREAM']){
 const r=by.get(mode);
 if(r.invariantOK!==false)throw Error('deviation not independently observed: '+mode);
}
const deviation=by.get('DEVIATION'),downstream=by.get('DOWNSTREAM');
if(JSON.stringify(deviation.expected.refs)!==JSON.stringify(['CI-IMG-B']))
 throw Error('oracle is not B-only snapshot');
if(JSON.stringify(deviation.observed.refs)!==JSON.stringify(['CI-IMG-A','CI-IMG-B']))
 throw Error('A+B stale association not observed');
if(downstream.expected.chosenImage===downstream.observed.chosenImage)
 throw Error('real consumer did not differ from oracle');
if(by.get('NEGATIVE_FRESH_B').expected.chosenImage!==by.get('NEGATIVE_FRESH_B').observed.chosenImage)
 throw Error('fresh B consumer negative control failed');
const result={
 proof:'INDEPENDENT_REAL_POSTGRES_CONTRADICTION',
 meaning:'Novel hypothesis supported by isolated real services, independent of original 5 calibrations; no code fix made',
 modes:expected,healthyModes:3,contradictionModes:2,
 source:'Sourcing normalized_source_contract V2 media_refs',
 writer:'catalog-promotion.promoteCatalog',
 consumer:'product-sellable-service.resolveSellableUnit',
 bugIssue:'https://github.com/SamyrFateh/komerce-backend/issues/2957',
 limitation:'This is not proof the generic scanner autonomously discovered the bug. Generic detector was built after the human R&D hypothesis.'
};
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify(result,null,2)+'\n');
console.log('BLIND_TRIAL_PROOF '+JSON.stringify(result));
