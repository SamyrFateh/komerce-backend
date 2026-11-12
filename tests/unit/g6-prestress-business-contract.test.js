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
  test('contrat unique de 5 nominaux et 37 cas limites, stable et sans trous',()=>{
    expect(data.version).toBe('G6-PRE-STRESS-1');
    expect(data.agents).toEqual(['ChatGPT','Opus']);
    expect(data.scenarios).toHaveLength(42);
    const ids=data.scenarios.map(x=>x.id);
    const expected=[
      ...Array.from({length:5},(_,i)=>'M'+String(i+1).padStart(2,'0')),
      ...Array.from({length:37},(_,i)=>'N'+String(i+1).padStart(2,'0')),
    ];
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(42);
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
  test('guide humain et contrat machine conservent exactement les mêmes IDs',()=>{
    const md=fs.readFileSync(documentation,'utf8');
    const ids=[...md.matchAll(/^\| ([MN]\d{2}) \|/gm)].map(m=>m[1]);
    expect(ids).toEqual(data.scenarios.map(x=>x.id));
  });
});
