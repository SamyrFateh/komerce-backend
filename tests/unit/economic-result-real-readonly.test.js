/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {assess,verifyEnvironment,fmt}=require('../../scripts/recette/economic-result-real-readonly');

const decision=(c,s,result,flowStatus='READY')=>({
  coverage: { coverage_status: 'UNCOVERED', numerator_contribution_kmf:c, structural_charges_kmf:s },
  flow_break_even: {
    status:flowStatus,
    economic_state:{
      period_contribution_kmf:c, period_structural_charges_kmf:s, period_n3_kmf:s,
      period_result_kmf:result
    },
    observed_mix:{ reconciled_contribution_kmf:c }
  }
});

test('contribution 720 - structure 1000 is -280; one pool, server numeric result',()=>{
  expect(assess(decision(720,1000,-280))).toMatchObject({
    ready:true,result:-280,expectedDisplay:'-280 KMF'
  });
});

test('true zero stays a reported zero and positive results remain signed',()=>{
  expect(assess(decision(1000,1000,0))).toMatchObject({ready:true,result:0,expectedDisplay:'0 KMF'});
  expect(assess(decision(1400,1000,400))).toMatchObject({ready:true,result:400,expectedDisplay:'400 KMF'});
});

test('no fake zero when contribution, structure or result are missing',()=>{
  expect(assess(decision(null,1000,null)).ready).toBe(false);
  expect(assess(decision(1000,'',null)).expectedDisplay).toBe('—');
  expect(assess(decision(1000,1000,null)).expectedDisplay).toBe('—');
  expect(assess(decision(1000,1000,200,'NOT_DECISIONAL')).expectedDisplay).toBe('—');
  expect(fmt(null)).toBe('—');
});

test('a mismatch between server authoritative inputs and result is fatal',()=>{
  expect(()=>assess(decision(720,1000,0))).toThrow('SERVER_CONTRIBUTION_MINUS_STRUCTURE_MISMATCH');
  const inconsistent=decision(720,1000,-280);
  inconsistent.flow_break_even.observed_mix.reconciled_contribution_kmf=721;
  expect(()=>assess(inconsistent)).toThrow('RECONCILED_MIX_MISMATCH');
});

test('proof refuses production or non-read-only database and unpinned SHA',()=>{
  const env={STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',KOMERCE_ENV:'staging',
    EXPECTED_RAILWAY_ENVIRONMENT:'staging',PGOPTIONS:'-c default_transaction_read_only=on',
    E2E_EXPECTED_DEPLOY_SHA:'a'.repeat(40), DATABASE_URL:'private', E2E_ADMIN_EMAIL:'test', E2E_ADMIN_PASSWORD:'secret'};
  expect(()=>verifyEnvironment(env)).not.toThrow();
  expect(()=>verifyEnvironment({...env,KOMERCE_ENV:'production'})).toThrow('STAGING_ONLY');
  expect(()=>verifyEnvironment({...env,PGOPTIONS:''})).toThrow('PG_READ_ONLY_REQUIRED');
  expect(()=>verifyEnvironment({...env,E2E_EXPECTED_DEPLOY_SHA:''})).toThrow('DEPLOY_SHA_PIN_REQUIRED');
});
