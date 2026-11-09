'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {guard,txService,expectedPgFailure} = require('../../scripts/recette/staging-sav-physical-intake-proof');
const BASE='https://komerce-backend-production.up.railway.app';
const env=()=>({
  KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',
  NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',
  EXPECTED_RAILWAY_ENVIRONMENT:'staging',STAGING_BASE_URL:BASE,
  SAV_CERT_CONFIRMATION:'SAV-ROLLBACK-ONLY',DATABASE_URL:'test-placeholder',
});

test('garde : seule la cible staging épinglée et sans crons est admissible',()=>{
  expect(()=>guard(env())).not.toThrow();
  for(const [key,bad] of [
    ['KOMERCE_ENV','production'],['KOMERCE_TARGET_ENV','production'],
    ['NODE_ENV','production'],['STAGING_BASE_URL','https://example.test'],
    ['SAV_CERT_CONFIRMATION','wrong'],['KOMERCE_DISABLE_CRONS','false'],
    ['DATABASE_URL','']
  ]) expect(()=>guard({...env(),[key]:bad})).toThrow();
});

test('le COMMIT du service devient RELEASE SAVEPOINT; aucune fin de transaction externe',async()=>{
  const calls=[];
  const client={query:async(sql,args)=>{calls.push([sql,args]);return {rows:[]};}};
  const proxy=await txService(client).getClient();
  await proxy.query('BEGIN');
  await proxy.query('SELECT $1::int',[1]);
  await proxy.query('COMMIT');
  await proxy.query('BEGIN');
  await proxy.query('ROLLBACK');
  proxy.release();
  expect(calls.map(x=>x[0])).toEqual([
    'SAVEPOINT sav_service','SELECT $1::int','RELEASE SAVEPOINT sav_service',
    'SAVEPOINT sav_service','ROLLBACK TO SAVEPOINT sav_service','RELEASE SAVEPOINT sav_service'
  ]);
  expect(calls.map(x=>x[0])).not.toContain('COMMIT');
});

test('échec trigger PostgreSQL : seule la savepoint test est annulée',async()=>{
  const calls=[];
  const client={query:async(sql)=>{
    calls.push(sql);
    if(sql.startsWith('UPDATE'))throw Object.assign(new Error('immutable'),{code:'P0001'});
    return {rows:[]};
  }};
  await expectPg();
  async function expectPg(){await expectedPgFailure(client,'UPDATE test',[],'P0001');}
  expect(calls).toEqual([
    'SAVEPOINT sav_raw','UPDATE test','ROLLBACK TO SAVEPOINT sav_raw','RELEASE SAVEPOINT sav_raw'
  ]);
});
