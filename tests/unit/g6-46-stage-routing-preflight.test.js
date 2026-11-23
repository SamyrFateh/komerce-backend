/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const matrix=require('../../docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json');
const {SCENARIO_STAGE_IDS}=require('../../scripts/recette/canonical/stage-registry');
const wf=fs.readFileSync(path.join(root,'.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml'),'utf8');
const n34wf=fs.readFileSync(path.join(root,'.github/workflows/staging-g6-n34-unified.yml'),'utf8');
const selector=wf.split('\n').find(x=>x.includes('G6_CANONICAL_SCENARIO:'))||'';
const direct=new Set(['N01','N02','N03','N05','N06']);
function variants(s){
 if(s.id==='M04')return ['M01'];
 if(s.id==='M05')return ['M01'];
 if(s.id==='N26')return ['N26a','N26b'];
 if(s.id==='N39')return ['N39F1','N39F2','N39F3'];
 return [s.id];
}
describe('G6 46 — test stages behind real owner-only dispatch',()=>{
 test('all 45 accepted business IDs have complete stage modules or explicit Chromium handler',()=>{
  const blocked=['M06'];
  expect(matrix.scenarios).toHaveLength(46);
  const dispatchable=matrix.scenarios.filter(s=>!blocked.includes(s.id));
  expect(dispatchable).toHaveLength(45);
  for(const scenario of dispatchable){
   for(const id of variants(scenario)){
    if(id==='N34'){
     expect(n34wf).toContain("g6-dynamic-fresh-full-N34-KM'");
     for(const mk of ['KM','CM','CG'])expect(n34wf).toContain("g6-dynamic-fresh-full-N34-"+mk+"'");
     for(const script of ['g6-n34a-api-delete-negative-chromium.js','g6-n34b-final-provenance-readonly.js','g6-n34-final-verdict.js'])expect(n34wf).toContain('node scripts/recette/'+script);
    }
    if(direct.has(id)){
     expect(selector).toContain("'-full-"+id+"-'");
     const script=id==='N06'?'g6-negative-n06-price-changed-chromium.js':'g6-negative-g5a-storefront-chromium.js';
     expect(fs.existsSync(path.join(root,'scripts/recette',script))).toBe(true);
     expect(wf).toContain('node scripts/recette/'+script);
    }else{
     expect(SCENARIO_STAGE_IDS[id]).toBeDefined();
     const ids=SCENARIO_STAGE_IDS[id];
     expect(ids.length).toBeGreaterThan(0);
     for(const stage of ids){
      const file=path.join(root,'scripts/recette/canonical/stages',stage+'.js');
      expect(fs.existsSync(file)).toBe(true);
     }
    }
   }
  }
 });
 test('N34 routes dedicated security stages; M06 partial runner wiring stays outside full dispatch',()=>{
  expect(SCENARIO_STAGE_IDS.M06).toEqual(['BUYER','RELAY_CASH','HUB_PO','HUB_COMMITMENT','HUB_VENDOR_READINESS',
   'M06_MANUAL_PURCHASE','M06_PAYMENT_AUTHORIZATION','M06_RECEIVING','M06_DIRECT_COMBOX','M06_SHIPMENT_HANDOVER','M06_FORWARDER','M06_CUSTOMS','M06_RELAY_RECEIPT','M06_CLIENT_PICKUP','M06_SAV_ORACLE']);
  expect(SCENARIO_STAGE_IDS.N34).toEqual(['N34_CENTRAL_IMMUTABILITY','N34_EXPLICIT_SOURCE']);
  expect(wf).not.toContain("g6-dynamic-fresh-full-M06-KM'");
  expect(wf).not.toContain("g6-dynamic-fresh-full-N34-KM'");
  expect(n34wf).toContain('komerce-g6-canonical-real-transaction');
 });
 test('N39/N26 branches and M04/M05 market aliases are preserved',()=>{
  for(const id of ['N39F1','N39F2','N39F3','N26a','N26b']){
   expect(SCENARIO_STAGE_IDS[id]).toBeDefined();
   expect(selector).toContain("'-full-"+id+"-'");
   for(const mk of ['KM','CM','CG'])expect(wf).toContain("g6-dynamic-fresh-full-"+id+'-'+mk+"'");
  }
  expect(wf).toContain("g6-dynamic-fresh-full-M01-CM'");
  expect(wf).toContain("g6-dynamic-fresh-full-M01-CG'");
  expect(wf).toContain('komerce-g6-canonical-real-transaction');
  expect(wf).toContain('node scripts/recette/target-guard.js');
 });
});