'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {check}=require('../../scripts/recette/staging-sav-browser-fixture-census');
const base=()=>({
 KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',NODE_ENV:'test',
 KOMERCE_DISABLE_CRONS:'true',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
 STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
 E2E_AGENT_RELAIS_EMAIL:'agent@komerce.test',
 SAV_CENSUS_CONFIRMATION:'SAV-READ-ONLY',
});
test('census only permitted for official staging and dedicated E2E identity',()=>{
 expect(()=>check(base())).not.toThrow();
 for(const [key,value] of [
  ['KOMERCE_ENV','production'],['KOMERCE_TARGET_ENV','production'],
  ['NODE_ENV','production'],['KOMERCE_DISABLE_CRONS','false'],
  ['EXPECTED_RAILWAY_ENVIRONMENT','production'],
  ['STAGING_BASE_URL','https://example.org'],
  ['E2E_AGENT_RELAIS_EMAIL',''],
  ['SAV_CENSUS_CONFIRMATION','WRITES_ALLOWED']
 ])expect(()=>check({...base(),[key]:value})).toThrow();
});
