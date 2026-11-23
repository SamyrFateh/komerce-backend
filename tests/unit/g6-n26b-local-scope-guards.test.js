/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const src=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const avail=src('scripts/recette/g6-local-relay-available-chromium.js');
const pickup=src('scripts/recette/g6-local-client-pickup-chromium.js');
const adapter=src('scripts/recette/canonical/real-buyer-cash-adapters.js');
const registry=require('../../scripts/recette/canonical/stage-registry');

describe('G6 N25/N26b local custody actor guards',()=>{
 test('the already registered SAV scenarios must be admitted to both Chromium stages',()=>{
  for(const [file,stage] of [[avail,'LOCAL_RELAY_AVAILABLE'],[pickup,'LOCAL_CLIENT_PICKUP']]){
   expect(file).toContain("'N25','N26b'].includes(env.G6_CANONICAL_SCENARIO)");
   expect(file).toContain("env.G6_CANONICAL_PHASE==='"+stage+"'");
   expect(file).toContain('env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER');
   expect(file).toContain("env.G6_DYNAMIC_FRESH_ORDER==='1'");
   expect(file).toContain('confirmTarget({db,env})');
   expect(file).toContain('env.G6_TARGET_MARKET===MK.code');
  }
 });
 test('the approved actors have legitimate local stages and N26a cannot masquerade as a local case',()=>{
  for(const id of ['N25','N26b']){
   expect(registry.SCENARIO_STAGE_IDS[id]).toContain('LOCAL_RELAY_AVAILABLE');
   expect(registry.SCENARIO_STAGE_IDS[id]).toContain('LOCAL_CLIENT_PICKUP');
   expect(adapter).toContain("'N25','N26b'");
  }
  expect(avail).not.toContain("'N26a'");
  expect(pickup).not.toContain("'N26a'");
 });
});
