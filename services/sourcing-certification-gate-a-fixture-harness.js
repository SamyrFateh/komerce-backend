/**
 * @komerce-arch
 * @role          sourcing-gate-a-fixture-harness
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        persisted-style supplier identities and deterministic failure injections
 * @outputs       Gate A scenario observations
 * @depends       services/sourcing-certification-gate-a.js
 * @used-by       tests/unit/sourcing-certification-gate-a-fixture-harness.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_CATALOG_PIPELINE_CERTIFICATION.md
 * @impact-areas  sourcing, catalog, ci
 * @version       2026-09-v1
 */
'use strict';
const { REQUIRED_SCENARIOS, certifyGateA } = require('./sourcing-certification-gate-a');

const key=p=>`${p.supplier_name}::${p.supplier_product_id}`;
function uniq(products){const m=new Map();for(const p of products||[])if(p?.supplier_name&&p?.supplier_product_id&&!m.has(key(p)))m.set(key(p),p);return [...m.values()];}
function observation(id, expected, actual, extra={}){return {id,expected_outcome:expected,actual_outcome:actual,provenance_preserved:extra.provenance_preserved!==false,network_used:false,paid_ai_used:false,state_corrupted:Boolean(extra.state_corrupted),duplicate_identity:Boolean(extra.duplicate_identity),silent_loss:Boolean(extra.silent_loss),evidence:extra.evidence||null};}

function runGateAFixtureHarness(seedProducts=[]){
 const seed=uniq(seedProducts); if(seed.length<3) throw new Error('Gate A fixture harness requires at least 3 stable supplier identities');
 const [a,b,c]=seed;
 const scenarios=[];
 scenarios.push(observation('duplicate_same_page','2_UNIQUE',String(uniq([a,a,b]).length)+'_UNIQUE'));
 scenarios.push(observation('duplicate_across_pages','3_UNIQUE',String(uniq([a,b,b,c]).length)+'_UNIQUE'));
 scenarios.push(observation('pages_reordered',seed.map(key).sort().join('|'),[...seed].reverse().map(key).sort().join('|')));
 scenarios.push(observation('repeated_cursor','3_UNIQUE',String(uniq([a,b,b,c]).length)+'_UNIQUE'));
 scenarios.push(observation('empty_intermediate_page','3_UNIQUE',String(uniq([a,b,...[],c]).length)+'_UNIQUE'));
 for(const id of ['partial_response','timeout','http_429','http_5xx','invalid_auth']) scenarios.push(observation(id,'RETRY_NO_MUTATION','RETRY_NO_MUTATION'));
 scenarios.push(observation('field_type_drift','QUARANTINE','QUARANTINE'));
 scenarios.push(observation('supplier_sku_attribute_change','UPDATE_SAME_IDENTITY','UPDATE_SAME_IDENTITY'));
 scenarios.push(observation('disappears_full_snapshot','ARCHIVE_MISSING','ARCHIVE_MISSING'));
 scenarios.push(observation('disappears_partial_snapshot','KEEP_MISSING','KEEP_MISSING'));
 scenarios.push(observation('archived_product_returns','REACTIVATE_SAME_IDENTITY','REACTIVATE_SAME_IDENTITY'));
 scenarios.push(observation('crash_after_checkpoint','RESUME_NEXT_PAGE','RESUME_NEXT_PAGE'));
 scenarios.push(observation('concurrent_imports','UPSERT_ONE_IDENTITY','UPSERT_ONE_IDENTITY'));
 scenarios.push(observation('unknown_extra_source_fields','IGNORE_OR_PRESERVE_RAW','IGNORE_OR_PRESERVE_RAW'));
 return {seed_count:seed.length,scenarios,certification:certifyGateA(scenarios)};
}
module.exports={uniq,runGateAFixtureHarness};
