'use strict';
/**
 * Independent interpretation of disposable PostgreSQL adversarial evidence.
 * This file never runs money, logistics, SQL or any Komerce service.
 * Owners are invoked by the isolated Golden; this module checks observations.
 */
function assertParcelConflictEvidence(e){
 if(!e||e.reader_mode!=='CONTROLLED_STALE_PREFLIGHT'||
   e.sql_engine!=='POSTGRESQL_16_REAL_SCHEMA'||
   e.nominal_already_assigned!==true||
   !Number.isInteger(e.ignored_insert_rowcount)||e.ignored_insert_rowcount!==0||
   e.reported_items_assigned!==1||e.actual_new_rows!==0||
   e.rollback_restored!==true)
  throw Error('KBA-C01: physical PostgreSQL parcel-count counterexample incomplete');
 return {id:'KBA-C01',outcome:'COUNT_INCREASED_WITH_ZERO_PHYSICAL_INSERT',
  independentProof:'PHYSICAL_POSTGRESQL_CONTROLLED_PREFLIGHT_STALENESS',
  ownerReportCount:1,postgresNewRows:0,productionIncidentConfirmed:false};
}
function assertWalletReplayEvidence(e){
 if(!e||e.sql_engine!=='POSTGRESQL_16_REAL_SCHEMA'||
    e.stable_first_duplicate!==false||
    e.stable_retry_duplicate!==true||
    e.stable_key_credit_count!==1||
    e.time_first_duplicate!==false||
    e.time_second_duplicate!==false||
    e.time_keys_distinct!==true||
    e.time_key_credit_count!==2||
    e.rollback_restored!==true)
  throw Error('KBA-C02: wallet retry evidence incomplete or inconsistent');
 return {id:'KBA-C02',outcome:'SAME_KEY_DEDUPLICATED_DIFFERENT_TIME_KEYS_CREDITED_TWICE',
   independentProof:'PHYSICAL_POSTGRESQL_WALLET_SERVICE',
   note:'Does not establish two HTTP retries or double-credit in production',
   productionIncidentConfirmed:false};
}
module.exports={assertParcelConflictEvidence,assertWalletReplayEvidence};
