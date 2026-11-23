/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const matrix=JSON.parse(fs.readFileSync(path.join(root,'docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json'),'utf8'));
const ledger=JSON.parse(fs.readFileSync(path.join(root,'docs/recette/G6_46_EVIDENCE_LEDGER.json'),'utf8'));
const repo='https://github.com/SamyrFateh/komerce-backend/';
describe('G6 evidence registry: evidence cannot impersonate a 46/46 GO',()=>{
 test('coverage matches the canonical business matrix with exactly 46 IDs, in order',()=>{
  expect(ledger.source_of_truth).toBe('docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json');
  expect(ledger.scenarios.map(s=>s.id)).toEqual(matrix.scenarios.map(s=>s.id));
  expect(ledger.scenarios).toHaveLength(46);
  for(const [i,s] of ledger.scenarios.entries())expect(s.markets).toEqual(matrix.scenarios[i].markets);
 });
 test('every documented proof has run ID, allowed scope, matching ID/market and a traceable Actions URL',()=>{
  const legal=new Set(['NOMINAL_PARTIAL_CHAIN','CHROMIUM_PG_PASS','SIMULATED_TECHNICAL_PASS','SOURCE_INVARIANTS_PASS','GLOBAL_INVARIANTS_SMOKE']);
  const seen=new Set();
  for(const s of ledger.scenarios)for(const p of s.evidence){
   expect(p.id).toBe(s.id);expect(s.markets).toContain(p.market);
   expect(Number.isSafeInteger(p.run_id)&&p.run_id>0).toBe(true);
   expect(p.workflow_url).toBe(repo+'actions/runs/'+p.run_id);
   expect(p.issue_url.startsWith(repo+'issues/')).toBe(true);
   expect(p.github_conclusion).toBe('success');
   expect(legal.has(p.scope)).toBe(true);
   expect(p.limitation.length).toBeGreaterThan(20);
   const key=s.id+':'+p.market+':'+p.run_id;
   expect(seen.has(key)).toBe(false);seen.add(key);
  }
 });
 test('M06 rehearsal and N34 market smokes are not promoted to physical or market-transaction certification',()=>{
  const m06=ledger.scenarios.find(s=>s.id==='M06');
  expect(m06.evidence).toHaveLength(1);
  expect(m06.evidence[0].scope).toBe('SIMULATED_TECHNICAL_PASS');
  expect(m06.evidence[0].limitation).toMatch(/NOT_REAL/);
  const n34=ledger.scenarios.find(s=>s.id==='N34');
  expect(n34.evidence.find(e=>e.market==='KM').scope).toBe('SOURCE_INVARIANTS_PASS');
  for(const market of ['CM','CG'])expect(n34.evidence.find(e=>e.market===market).scope).toBe('GLOBAL_INVARIANTS_SMOKE');
 });
 test('all mandatory N26 and N39 branches retain independent proof requirements',()=>{
  expect(ledger.scenarios.find(s=>s.id==='N26').branches).toEqual(['N26a','N26b']);
  expect(ledger.scenarios.find(s=>s.id==='N39').branches).toEqual(['N39F1','N39F2','N39F3']);
  expect(ledger.scenarios.find(s=>s.id==='N26').evidence).toHaveLength(0);
  expect(ledger.scenarios.find(s=>s.id==='N39').evidence).toHaveLength(0);
 });
 test('no evidence may rewrite scenario verdicts or equate dispatch/CI with acceptance',()=>{
  expect(ledger.policy.not_a_verdict_source).toBe(true);
  expect(ledger.policy.missing_evidence).toBe('NOT_YET_RECONCILED');
  expect(ledger.policy.rule).toMatch(/Never modify matrix verdicts/);
  for(const s of ledger.scenarios){
   expect(s).not.toHaveProperty('verdict');
   expect(s).not.toHaveProperty('certified');
  }
 });
});
