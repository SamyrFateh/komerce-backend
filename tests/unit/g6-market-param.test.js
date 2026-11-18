/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {marketProfile,PROFILES}=require('../../scripts/recette/canonical/market-profile');
const {resolveRelayCashRefs}=require('../../scripts/recette/g6-canonical-journey-binding');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const STAGE_SCRIPTS=fs.readdirSync(path.join(root,'scripts/recette')).filter(f=>/^g6-(hub-.*|canonical-(client-pickup|customs|forwarder|relay-receipt))-chromium\.js$/.test(f))
  .map(f=>'scripts/recette/'+f);

describe('G6 dynamic runner market parameter',()=>{
  test('KM effective parameters are unchanged (default and explicit)',()=>{
    const legacy={code:'KM',label:'KM · Comores',dial:'+269',currency:'KMF'};
    expect(marketProfile({})).toEqual(legacy);
    expect(marketProfile({G6_TARGET_MARKET:'KM'})).toEqual(legacy);
  });
  test('CM and CG profiles',()=>{
    expect(marketProfile({G6_TARGET_MARKET:'CM'})).toMatchObject({label:'CM · Cameroun',dial:'+237',currency:'XAF'});
    expect(marketProfile({G6_TARGET_MARKET:'cg'})).toMatchObject({label:'CG · Congo',dial:'+242',currency:'XAF'});
    expect(Object.keys(PROFILES)).toEqual(['KM','CM','CG']);
  });
  test('unknown market is refused',()=>{
    for(const m of ['FR','KMX','XX','km ;'])
      expect(()=>marketProfile({G6_TARGET_MARKET:m})).toThrow('G6_UNSUPPORTED_MARKET');
  });
  test('market is propagated to every stage script (no KM hardcoding left)',()=>{
    expect(STAGE_SCRIPTS.length).toBeGreaterThanOrEqual(11);
    for(const f of STAGE_SCRIPTS){
      const s=read(f);
      expect(s).toContain('marketProfile(process.env)');
      expect(s).not.toMatch(/G6_TARGET_MARKET==='KM'|market:'KM'|market=KM|'KM · Comores'|market\/KM|markets\/KM/);
    }
    for(const f of ['scripts/recette/canonical/real-buyer-cash-adapters.js','scripts/recette/canonical/fresh-buyer-bootstrap.js','scripts/recette/g6-dynamic-buyer-cash.js']){
      const s=read(f);
      expect(s).not.toMatch(/market!=='KM'|market:'KM'|market==='KM'|MARKET!=='KM'|G6_CANONICAL_MARKET:'KM'/);
    }
  });
  test('workflow adds CM and CG titles, sets the market from the title, keeps guards',()=>{
    const y=read('.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml');
    for(const m of ['CM','CG'])expect(y).toContain("'[staging-op] g6-dynamic-fresh-full-M01-"+m+"'");
    expect(y).toContain("endsWith(github.event.issue.title, '-M01-CM') && 'CM'");
    expect(y).toContain("endsWith(github.event.issue.title, '-M01-CG') && 'CG'");
    expect(y).toContain('github.actor == github.repository_owner');
    expect(y).toContain('Undeployed-only drift');
    expect(y).not.toMatch(/G6_TARGET_MARKET: KM\n/);
  });
  test('relay cash binding: M01 in CM/CG only under the dynamic flag',()=>{
    const base={G6_CANONICAL_SCENARIO:'M01',G6_CANONICAL_ORDER_REFERENCE:'K123456'};
    expect(resolveRelayCashRefs({...base,G6_CANONICAL_MARKET:'KM'})).toEqual({KM:'K123456'});
    expect(()=>resolveRelayCashRefs({...base,G6_CANONICAL_MARKET:'CM'})).toThrow('G6_MARKET_OUTSIDE_SCENARIO');
    const d={...base,G6_DYNAMIC_FRESH_BUYER:'1'};
    expect(resolveRelayCashRefs({...d,G6_CANONICAL_MARKET:'CM'})).toEqual({CM:'K123456'});
    expect(resolveRelayCashRefs({...d,G6_CANONICAL_MARKET:'CG'})).toEqual({CG:'K123456'});
    expect(()=>resolveRelayCashRefs({...d,G6_CANONICAL_MARKET:'FR'})).toThrow();
  });
});
