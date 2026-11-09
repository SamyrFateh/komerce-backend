'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs'),path=require('path');
const {assertDisposable,fixtureNames,DB}=require('../../scripts/recette/g4-relay-ab-canonical-rollback');
const ok=()=>({
  GITHUB_ACTIONS:'true',NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  DATABASE_URL:DB,KOMERCE_ENV:'ci',KOMERCE_TARGET_ENV:'ci',
});
test('default deny: production/staging/remote DB/runner hors GitHub interdit',()=>{
  expect(()=>assertDisposable(ok())).not.toThrow();
  for(const [name,value] of [
    ['GITHUB_ACTIONS','false'],['NODE_ENV','production'],
    ['KOMERCE_DISABLE_CRONS','false'],['DATABASE_URL','postgresql://test:secret@db/railway'],
    ['KOMERCE_ENV','staging'],['KOMERCE_TARGET_ENV','staging'],
    ['KOMERCE_ENV','production'],['KOMERCE_TARGET_ENV','production'],
  ])expect(()=>assertDisposable({...ok(),[name]:value})).toThrow('G4_EPHEMERAL_CI_ONLY_NO_STAGING');
  expect(()=>assertDisposable({})).toThrow('G4_EPHEMERAL_CI_ONLY_NO_STAGING');
});

test('run8 collision and invalid input refused before DB/connection',()=>{
  expect(()=>fixtureNames('')).toThrow('G4_RUN8_HEX_REQUIRED');
  expect(()=>fixtureNames('000000000000')).toThrow('G4_RUN8_HEX_REQUIRED');
  expect(()=>fixtureNames('SAMPLE00')).toThrow('G4_RUN8_HEX_REQUIRED');
  const x=fixtureNames('A1B2C3D4');
  expect(x).toHaveLength(2);
  expect(x.map(y=>y.label)).toEqual(['A','B']);
  expect(new Set(x.map(y=>y.email)).size).toBe(2);
  expect(new Set(x.map(y=>y.relaisName)).size).toBe(2);
  expect(x.every(y=>y.email.endsWith('@komerce.test'))).toBe(true);
});

test('zero COMMIT, source only invokes canonical writers and ROLLBACK',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../scripts/recette/g4-relay-ab-canonical-rollback.js'),'utf8');
  expect(source).toMatch(/await client\.query\('BEGIN'\)/);
  expect(source).toMatch(/await client\.query\('ROLLBACK'\)/);
  expect(source).not.toMatch(/client\.query\('COMMIT'\)|\bTRUNCATE\b|session_replication_role/);
  expect(source).toContain("require('../../services/user-mutation-service')");
  expect(source).toContain("require('../../services/relais-mutation-service')");
  expect(source).toContain("require('./staging-e2e-provision').markE2eTestAccount");
  expect(source).toContain('users.assignAgentRelais');
  expect(source).toContain('relays.createRelais');
});
