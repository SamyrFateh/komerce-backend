'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assertParcelConflictEvidence,assertWalletReplayEvidence}=require('./physical-probes');
const parcel={reader_mode:'CONTROLLED_STALE_PREFLIGHT',sql_engine:'POSTGRESQL_16_REAL_SCHEMA',
 nominal_already_assigned:true,ignored_insert_rowcount:0,reported_items_assigned:1,
 actual_new_rows:0,rollback_restored:true};
const wallet={sql_engine:'POSTGRESQL_16_REAL_SCHEMA',
 stable_first_duplicate:false,stable_retry_duplicate:true,stable_key_credit_count:1,
 time_first_duplicate:false,time_second_duplicate:false,time_keys_distinct:true,
 time_key_credit_count:2,rollback_restored:true};
test('real parcel conflict evidence requires actual rowCount=0 and owner report=1',()=>{
 assert.equal(assertParcelConflictEvidence(parcel).outcome,'COUNT_INCREASED_WITH_ZERO_PHYSICAL_INSERT');
 assert.equal(assertParcelConflictEvidence(parcel).productionIncidentConfirmed,false);
 for(const data of [{...parcel,ignored_insert_rowcount:1},{...parcel,reported_items_assigned:0},
  {...parcel,actual_new_rows:1},{...parcel,reader_mode:'NORMAL_PREFLIGHT'},
  {...parcel,rollback_restored:false},{}])
  assert.throws(()=>assertParcelConflictEvidence(data),/counterexample incomplete/);
});
test('financial replay proof differentiates stable idempotency from two time keys',()=>{
 assert.equal(assertWalletReplayEvidence(wallet).outcome,
  'SAME_KEY_DEDUPLICATED_DIFFERENT_TIME_KEYS_CREDITED_TWICE');
 for(const data of [{...wallet,stable_retry_duplicate:false},
  {...wallet,time_key_credit_count:1},{...wallet,time_keys_distinct:false},
  {...wallet,rollback_restored:false},{}])
  assert.throws(()=>assertWalletReplayEvidence(data),/evidence incomplete/);
});
