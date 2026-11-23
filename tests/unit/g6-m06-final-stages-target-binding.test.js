/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const adapter=source('scripts/recette/canonical/real-buyer-cash-adapters.js');
const finalBranch=adapter.split("if(SCENARIO==='M06'&&M06_FINAL_STAGES.includes(stageId)){")[1]
 .split("if(SCENARIO==='M06'&&M06_PREP_STAGES.includes(stageId))")[0];

describe('M06 shared final-mile target fingerprint propagates to all Chromium stages',()=>{
 test('forwards the same preflight fingerprint for every M06 final stage, including SAV',()=>{
  const executions=finalBranch.split('execute(SCRIPTS[stageId],').slice(1);
  expect(executions).toHaveLength(2);
  for(const call of executions){
   const options=call.split(');')[0];
   expect(options).toContain('G6_CANONICAL_ORDER_ID:context.order_id');
   expect(options).toContain('G6_CANONICAL_DB_FINGERPRINT:context.db_fingerprint');
   expect(options).toContain("G6_DYNAMIC_FRESH_ORDER:'1'");
  }
  for(const stage of ['M06_FORWARDER','M06_CUSTOMS','M06_RELAY_RECEIPT','M06_CLIENT_PICKUP','M06_SAV_ORACLE'])
   expect(finalBranch).toContain(stage);
 });
 test('retains fail-closed target checks in each downstream real Chromium actor',()=>{
  for(const file of [
   'scripts/recette/g6-canonical-forwarder-chromium.js',
   'scripts/recette/g6-canonical-customs-chromium.js',
   'scripts/recette/g6-canonical-relay-receipt-chromium.js',
   'scripts/recette/g6-canonical-client-pickup-chromium.js',
   'scripts/recette/g6-m06-sav-ui-oracle-chromium.js'
  ]){
   const script=source(file);
   expect(script).toContain('confirmTarget(');
   expect(script).toContain('env.G6_CANONICAL_DB_FINGERPRINT');
  }
 });
});
