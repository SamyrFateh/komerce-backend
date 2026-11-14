/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const fs=require('fs');
const path=require('path');
const source=path.join(__dirname,'../../docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json');
const documentation=path.join(__dirname,'../../docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.md');

describe('G6 pré-stress — unique business contract ChatGPT / Opus',()=>{
  const data=JSON.parse(fs.readFileSync(source,'utf8'));
  test('contrat unique de 6 nominaux et 40 cas limites, stable et sans trous',()=>{
    expect(data.version).toBe('G6-PRE-STRESS-2');
    expect(data.agents).toEqual(['ChatGPT','Opus']);
    expect(data.scenarios).toHaveLength(46);
    const ids=data.scenarios.map(x=>x.id);
    const expected=[
      ...Array.from({length:6},(_,i)=>'M'+String(i+1).padStart(2,'0')),
      ...Array.from({length:40},(_,i)=>'N'+String(i+1).padStart(2,'0')),
    ];
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(46);
  });
  test('aucun PASS injecté au départ, aucun oracle ni marché absent',()=>{
    for(const s of data.scenarios){
      expect(s.verdict).toBe('NOT_PROVEN');
      expect(s.expected.length).toBeGreaterThan(12);
      expect(s.title.length).toBeGreaterThan(5);
      expect(s.markets.length).toBeGreaterThan(0);
      expect(s.markets.every(m=>['KM','CM','CG'].includes(m))).toBe(true);
      expect(['nominal','negative_or_edge']).toContain(s.kind);
      expect(['P0','P1']).toContain(s.priority);
    }
    expect(data.provider_side_effects_forbidden).toBe(true);
    expect(data.distinct_run8_and_order_by_agent).toBe(true);
    expect(data.serialize_shared_relay_agent).toBe(true);
    expect(data.same_staging_sha_required).toBe(true);
    expect(data.required_proof).toContain('postgres_before_after');
    expect(data.required_proof).toContain('real_chromium');
  });
  test('v2 : NOT_APPLICABLE encadré, lots P0 et oracles transversaux référencés',()=>{
    expect(data.verdicts).toEqual(['PASS','FAIL','BLOCKED','NOT_PROVEN','NOT_APPLICABLE']);
    expect(data.not_applicable_rule).toMatch(/jamais compté comme PASS/);
    expect(Object.keys(data.p0_fix_lots).sort()).toEqual(['L-A1','L-A2','L-A5','L-A6','L-SEC']);
    for(const k of ['O-ECO','O-DOC','O-NOTIF','O-SEC-DOC']) expect(data.transversal_oracles[k]).toBeTruthy();
    const known=new Set([...Object.keys(data.p0_fix_lots),'#3900']);
    for(const s of data.scenarios) for(const dep of (s.depends_on||[])) expect(known.has(dep)).toBe(true);
    const ids=new Set(data.scenarios.map(x=>x.id));
    for(const c of Object.values(data.configurations).filter(c=>c&&c.applies_to)) for(const id of c.applies_to) expect(ids.has(id)).toBe(true);
  });
  test('O-FIN Fable I1-I15 est partagé et appliqué aux scénarios financiers',()=>{
    const oracle=data.transversal_oracles['O-FIN'];
    expect(oracle.source).toBe('docs/recette/G6_FINANCE_SQL_ORACLES.sql');
    expect(oracle.invariants).toHaveLength(15);
    const sql=require('fs').readFileSync(require('path').join(__dirname,'../../docs/recette/G6_FINANCE_SQL_ORACLES.sql'),'utf8');
    for(let i=1;i<=15;i++) expect(sql).toMatch(new RegExp('-- I'+i+' '));
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    for(const id of oracle.applies_to) expect(data.scenarios.find(s=>s.id===id).oracles).toContain('O-FIN');
  });
  test('O-HUB Fable H1-H9 est partagé et appliqué à tous les scénarios Hub critiques',()=>{
    const oracle=data.transversal_oracles['O-HUB'];
    expect(oracle.source).toBe('docs/recette/G6_HUB_SQL_ORACLES.sql');
    expect(oracle.ids).toEqual(Array.from({length:9},(_,i)=>'H'+(i+1)));
    const sql=fs.readFileSync(path.join(__dirname,'../../',oracle.source),'utf8');
    for(const id of oracle.ids) expect(sql).toMatch(new RegExp('^-- '+id+'\\b','m'));
    for(const id of ['M01','M03','M04','M05','M06','N13','N14','N15','N16']) {
      expect(data.scenarios.find(s=>s.id===id).oracles).toContain('O-HUB');
    }
    expect(data.same_staging_sha_required).toBe(true);
    expect(data.distinct_run8_and_order_by_agent).toBe(true);
  });
  test('O-ECO Fable Q1-Q3 et cas extrêmes rattachés à des scénarios existants',()=>{
    const oracle=data.transversal_oracles['O-ECO'];
    expect(oracle.read_only_controls).toEqual(['Q1','Q2','Q3']);
    const sql=fs.readFileSync(path.join(__dirname,'../../',oracle.source),'utf8');
    for(const id of oracle.read_only_controls) expect(sql).toMatch(new RegExp('^-- '+id+'\\b','m'));
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    const ids=new Set(data.scenarios.map(s=>s.id));
    expect(oracle.extreme_cases.cases).toHaveLength(7);
    for(const c of oracle.extreme_cases.cases) for(const id of c.scenarios) expect(ids.has(id)).toBe(true);
  });
  test('cas limites Fable L01-L25 : chacun rattaché à un ID existant ou reporté au stress',()=>{
    const b=data.fable_stress_boundary_cases;
    const ids=new Set(data.scenarios.map(s=>s.id));
    for(let i=1;i<=25;i++){
      const l='L'+String(i).padStart(2,'0');
      const mapped=b.mapped[l], deferred=b.deferred_to_stress[l];
      expect(Boolean(mapped)!==Boolean(deferred)).toBe(true);
      if(mapped) for(const id of mapped){ expect(ids.has(id)).toBe(true); expect(data.scenarios.find(s=>s.id===id).boundary_cases).toContain(l); }
    }
  });
  test('guide humain et contrat machine conservent exactement les mêmes IDs',()=>{
    const md=fs.readFileSync(documentation,'utf8');
    const ids=[...md.matchAll(/^\| ([MN]\d{2}) \|/gm)].map(m=>m[1]);
    expect(ids).toEqual(data.scenarios.map(x=>x.id));
  });
});
