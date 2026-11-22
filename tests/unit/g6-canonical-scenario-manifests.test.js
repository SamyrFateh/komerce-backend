/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const Ajv=require('ajv');
const {loadManifest,assertManifestCoverage,requireExecutableManifest}
 =require('../../scripts/recette/canonical/manifest-loader');
const business=require('../../docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json');
const manifestSchema=require('../../docs/recette/canonical/scenario-manifest.schema.json');
const proofSchema=require('../../docs/recette/canonical/proof.schema.json');
test('exactly 46 manifests, one per authoritative business matrix scenario',()=>{
 const coverage=assertManifestCoverage();
 expect(coverage.count).toBe(46);
 expect(coverage.ids).toEqual(business.scenarios.map(x=>x.id).sort());
 for(const s of business.scenarios)expect(loadManifest(s.id).expected_oracle_ids).toEqual(s.oracles||[]);
});
test('all scenario manifests match strict schema and cannot claim unwitnessed PASS',()=>{
 const ajv=new Ajv({allErrors:true,strict:false});
 const valid=ajv.compile(manifestSchema);
 for(const s of business.scenarios){
  const m=loadManifest(s.id);expect(valid(m)).toBe(true);
  if(s.id==='N34'){
   expect(m.binding_status).toBe('READY_FOR_REVIEW');
   expect(m.configuration.market).toBeNull();
   expect(m.configuration.cohort).toBeNull();
   expect(m.configuration.basket).toEqual({source:null,lines:[]});
   expect(m.configuration.payment).toEqual({method:null,simulated_only:true});
   expect(m.configuration.steps).toEqual(['N34_CENTRAL_IMMUTABILITY','N34_EXPLICIT_SOURCE']);
   expect(m.configuration.branches).toEqual(['N34A','N34B']);
   for(const market of ['KM','CM','CG'])
    expect(requireExecutableManifest('N34',{market,cohort:'GPT-G6'})).toEqual(m);
   expect(()=>requireExecutableManifest('N34',{market:'YT',cohort:'GPT-G6'}))
    .toThrow('G6_MANIFEST_NOT_BOUND_N34');
   expect(()=>requireExecutableManifest('N34',{market:'KM',cohort:'UNKNOWN'}))
    .toThrow('G6_MANIFEST_NOT_BOUND_N34');
  }else{
   expect(['NOT_BOUND','GOLDEN_EVIDENCE_ONLY']).toContain(m.binding_status);
   expect(m.configuration.market).toBeNull();
   expect(m.configuration.steps).toEqual([]);
   expect(()=>requireExecutableManifest(s.id,{market:s.markets[0],cohort:'GPT-G6'}))
    .toThrow('G6_MANIFEST_NOT_BOUND_'+s.id);
  }
 }
});
test('only archived completed M01 is marked Golden, with replay forbidden',()=>{
 const m=loadManifest('M01');
 expect(m.binding_status).toBe('GOLDEN_EVIDENCE_ONLY');
 expect(m.historical_proof).toEqual({
  run_id:44280122740,artifact_id:14416158709,order_ref:'KL1WGP6',
  order_status:'collected',replay_forbidden:true
 });
 expect(()=>loadManifest('../../package')).toThrow('G6_MANIFEST_ID_INVALID');
});
test('M06 has a fully specified staging-only fixture plan but remains unroutable',()=>{
 const m=loadManifest('M06');
 expect(m.binding_status).toBe('NOT_BOUND');
 expect(m.fixture_plan).toMatchObject({
  status:'PREPARED_BLOCKED',provenance:'SIMULATED / STAGING ONLY',market:'KM',
  product:{fixture_ref:'G6-M06-KM',source_kind:'central_hub_manual',supplier_system_key:'central_hub',physical_stock:0,sellable_status:'ON_ORDER'},
  buyer_order:{quantity:3,payment_method:'cash_relais',payment_simulated_only:true,procure_on_order:true},
  commitment:{amount:30,currency:'EUR',indicative_budget_is_not_confirmed_cost:true},
  manual_purchase_capture:{seller_identity_source:'actual_seller_entered_by_operator',confirmed_price_source:'price_confirmed_at_purchase',proof_required:true,synthetic_seller_or_price_values:false,allocation_must_cover_order_quantity:true},
  supplier_payment_authorization:{amount_source:'confirmed_manual_purchase_totals',currency:'EUR',separate_from_commitment:true,external_debit:false},
  external_effects:false,
 });
 expect(m.fixture_plan.manual_purchase_capture.allocations).toBe('captured_in_canonical_ui_at_purchase_time');
 expect(()=>requireExecutableManifest('M06',{market:'KM',cohort:'GPT-G6'}))
  .toThrow('G6_MANIFEST_NOT_BOUND_M06');
});
test('proof must include role-screen actions, before/after screenshots, observed request, read-only PG, 100% coverage for PASS',()=>{
 const valid=new Ajv({allErrors:true,strict:false}).compile(proofSchema);
 const x={schema:'komerce-g6-canonical-proof/1',scenario_id:'M01',cohort:'GPT-G6',
  market:'KM',staging_sha:'a'.repeat(40),db_fingerprint:'8acbf99fef010c23eac7d252',
  steps:[{id:'CLIENT_PICKUP',verdict:'PASS'}],
  gestures:[{step:'CLIENT_PICKUP',role:'agent_relais',page:'/admin/relais-live',
   selector:'[data-pickup-code-confirm]',action:'click',
   screenshots:{before:'artifacts/before.png',after:'artifacts/after.png'},
   observed_request:{method:'POST',path:'/api/scans/collect',status:200}}],
  oracles:[{id:'O-FIN',scope:'M01',read_only:true,verdict:'PASS'}],
  external_responses:[],screen_coverage:{covered:1,required:1,percent:100},verdict:'PASS'};
 expect(valid(x)).toBe(true);
 expect(valid({...x,screen_coverage:{covered:0,required:1,percent:0}})).toBe(false);
 expect(valid({...x,gestures:[{...x.gestures[0],screenshots:{before:'a'}}]})).toBe(false);
 expect(valid({...x,oracles:[{...x.oracles[0],read_only:false}]})).toBe(false);
});
