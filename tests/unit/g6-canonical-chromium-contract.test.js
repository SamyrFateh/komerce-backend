/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {preflightScenario}=require('../../scripts/recette/canonical/preflight');
const {CadenceGate}=require('../../scripts/recette/canonical/cadence');
const {ActorPool}=require('../../scripts/recette/canonical/actors');
const {assertStageSourceSafe,validateStageModuleSources,assertCanonicalProof}
 =require('../../scripts/recette/canonical/chromium-policy');
const cohorts=require('../../docs/recette/canonical/cohorts.json');
const external=require('../../docs/recette/canonical/external-responses.json');
test('all existing Golden stage modules reject direct business API or PostgreSQL mutations',()=>{
 expect(validateStageModuleSources()).toBe(15);
 expect(()=>assertStageSourceSafe('stage.js',"require('axios')")).toThrow('G6_STAGE_DIRECT_WRITE_FORBIDDEN');
 expect(()=>assertStageSourceSafe('stage.js',"db.query('INSERT INTO orders VALUES (1)')")).toThrow('G6_STAGE_DIRECT_WRITE_FORBIDDEN');
 expect(()=>assertStageSourceSafe('stage.js',"page.request.post('/api/orders')")).toThrow('G6_STAGE_DIRECT_WRITE_FORBIDDEN');
});
test('no external response is automatically approved',()=>{
 expect(external.approved).toEqual([]);
 expect(cohorts.cohorts['CLAUDE-PAR'].binding_status).toBe('NOT_READY');
 for(const c of Object.values(cohorts.cohorts))
  for(const p of Object.values(c.roles))
   expect(p.secret_keys.every(v=>/^[A-Z][A-Z0-9_]*$/.test(v))).toBe(true);
});
test('M01 preflight is NOT_READY without a new safely-bound scenario, with zero probing and writes',async()=>{
 const probe=jest.fn();
 const result=await preflightScenario({scenarioId:'M01',market:'KM',cohort:'GPT-G6',
  env:{KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
   E2E_EXPECTED_DEPLOY_SHA:'a'.repeat(40)},
  readOnly:{catalog:probe,relayAssignment:probe,dialCodes:probe,featureFlags:probe,localStock:probe}});
 expect(result.verdict).toBe('NOT_READY');
 expect(result.mutations).toBe(0);
 expect(result.reasons).toContain('G6_PREFLIGHT_SCENARIO_UNBOUND');
 expect(probe).not.toHaveBeenCalled();
});
test('shared G0c reserve cadence refuses premature repeats and HTTP429',()=>{
 const gate=new CadenceGate();
 expect(gate.reserve('order',1000)).toMatchObject({minimum_gap_ms:12000});
 expect(()=>gate.reserve('order',11999)).toThrow('G6_CADENCE_NOT_READY_order');
 expect(gate.reserve('order',13000).at).toBe(13000);
 expect(gate.reserve('cash',13000).minimum_gap_ms).toBe(30000);
 expect(()=>gate.assertResponse(429)).toThrow('G6_RATE_LIMIT_429_NOT_PROVEN');
});
test('Chromium ActorPool reuses one context per role and separates roles',async()=>{
 const closes=[],browser={newContext:jest.fn(async()=>({
  newPage:jest.fn(async()=>({url:()=> 'https://staging.invalid/test'})),
  close:jest.fn(async()=>closes.push('closed'))
 }))};
 const pool=new ActorPool({browser,baseURL:'https://staging.invalid',outputDir:'/tmp/g6-test'});
 expect(await pool.get('agent_relais')).toBe(await pool.get('agent_relais'));
 expect(await pool.get('client')).not.toBe(await pool.get('agent_relais'));
 expect(browser.newContext).toHaveBeenCalledTimes(2);
 expect(()=>pool.get('untrusted_role')).rejects.toThrow('G6_ACTOR_ROLE_UNKNOWN_untrusted_role');
 await pool.close();expect(closes).toHaveLength(2);
});
test('PASS evidence cannot omit human gestures, read-only PG or explicit approved external response',()=>{
 const p={schema:'komerce-g6-canonical-proof/1',scenario_id:'M01',cohort:'GPT-G6',market:'KM',
  staging_sha:'a'.repeat(40),db_fingerprint:'8acbf99fef010c23eac7d252',
  steps:[{id:'CLIENT_PICKUP',verdict:'PASS'}],
  gestures:[{step:'CLIENT_PICKUP',role:'agent_relais',page:'/admin/relais-live',
   selector:'[data-pickup-code-confirm]',action:'click',
   screenshots:{before:'before.png',after:'after.png'},
   observed_request:{method:'POST',path:'/api/scans/collect',status:200}}],
  oracles:[{id:'O-FIN',scope:'M01',read_only:true,verdict:'PASS'}],
  external_responses:[],screen_coverage:{covered:1,required:1,percent:100},verdict:'PASS'};
 expect(assertCanonicalProof(p)).toBe(true);
 expect(()=>assertCanonicalProof({...p,gestures:[]})).toThrow('G6_PROOF_HUMAN_GESTURE_MISSING_CLIENT_PICKUP');
 expect(()=>assertCanonicalProof({...p,screen_coverage:{covered:0,required:1,percent:100}})).toThrow('G6_PROOF_SCREEN_COVERAGE_NOT_100');
 expect(()=>assertCanonicalProof({...p,external_responses:[{id:'unapproved',approved:true}]})).toThrow('G6_EXTERNAL_RESPONSE_NOT_OWNER_APPROVED_unapproved');
});
