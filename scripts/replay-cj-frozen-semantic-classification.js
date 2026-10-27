#!/usr/bin/env node
/** @komerce-arch-lite
 * @role frozen-cj-semantic-classifier-replay
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Re-evaluate genuine archived CJ source names/paths with today's pure supplier-neutral semantic engine, without re-imports.
 * @db-read none
 * @db-write none
 * @impact-areas catalog, sourcing, certification, offline-replay
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {semanticIntent}=require('../services/commercial-taxonomy-semantics');
const EXPECTED_SHA256='9ff18f6f902f2e72fc893a90da96b61058c77028d55e941381631fc9fb8116de';
const EXPECTED_COUNT=498;
const inc=(o,k)=>{o[k]=(o[k]||0)+1;};
function replay(report){
  if(!Array.isArray(report?.products))throw Error('SOURCE_PRODUCTS_MISSING');
  const previousAuto=report.products.filter(x=>x.status==='AUTO_CLASSIFIED').length;
  const segments={},byConcept={},changes=[],conflicts=[],regressions=[];
  let semanticAuto=0;
  for(const item of report.products){
    const candidate={product_name:item.product_name,supplier_category:item.supplier_category};
    const inferred=semanticIntent(candidate);
    const wasAuto=item.status==='AUTO_CLASSIFIED';
    const nowPair=inferred.kind==='pair';
    const segment=item.segment_id||'NO_SEGMENT';
    const r=segments[segment]||(segments[segment]={total:0,previous_auto:0,semantic_auto:0,newly_semantic:0,conflict:0});
    r.total++;if(wasAuto)r.previous_auto++;
    if(nowPair){
      semanticAuto++;r.semantic_auto++;inc(byConcept,inferred.category+'/'+inferred.subcategory);
      if(!wasAuto){r.newly_semantic++;changes.push({
        candidate_ref:item.candidate_ref,name:item.product_name,
        source_path:item.supplier_category,segment,
        previous_status:item.status,discovery_target:item.discovery_target,
        semantic_destination:inferred.category+'/'+inferred.subcategory,
        semantic_source:inferred.source
      });}
    } else if(wasAuto)regressions.push({candidate_ref:item.candidate_ref,reason:inferred.kind});
    if(inferred.kind==='conflict'){r.conflict++;conflicts.push({
      candidate_ref:item.candidate_ref,name:item.product_name,
      source_path:item.supplier_category,segment,reason:inferred.reason
    });}
  }
  return {mode:'FROZEN_REAL_CJ_SEMANTIC_REPLAY_PURE_ONLY',
    source_count:report.products.length,previous_auto:previousAuto,
    semantic_auto:semanticAuto,
    newly_semantic:changes.length,conflicts:conflicts.length,
    regressions:regressions.length,by_concept:byConcept,segments,changes,
    conflict_examples:conflicts,regression_examples:regressions,
    certification:'NOT_CERTIFIED',
    note:'Pure hierarchy+title replay only. Not full commercial classification, supplier availability or economic price proof.'};
}
function inspectFrozenFile(file) {
  const buf=fs.readFileSync(file);
  const hash=crypto.createHash('sha256').update(buf).digest('hex');
  if(hash!==EXPECTED_SHA256)throw Error('FROZEN_CJ_EVIDENCE_SHA256_MISMATCH:'+hash);
  const report=JSON.parse(buf.toString('utf8'));
  if(report.inspected!==EXPECTED_COUNT||report.products?.length!==EXPECTED_COUNT
      ||report.automatic!==52||report.target!==500)
    throw Error('FROZEN_CJ_EVIDENCE_BASELINE_UNEXPECTED');
  if(new Set(report.products.map(p=>p.supplier_product_id)).size!==EXPECTED_COUNT)
    throw Error('FROZEN_CJ_DUPLICATE_SUPPLIER_ID');
  return report;
}
if(require.main===module){
  try {
    const file=process.argv[2]||'baseline/classification-evidence.json';
    const target=process.argv[3]||'artifacts/cj-semantic-offline-replay/report.json';
    const report=replay(inspectFrozenFile(file));
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
    console.log('[CJ_FROZEN_REPLAY] '+JSON.stringify({
      source_count:report.source_count,previous_auto:report.previous_auto,
      semantic_auto:report.semantic_auto,newly_semantic:report.newly_semantic,
      conflicts:report.conflicts,regressions:report.regressions,by_concept:report.by_concept
    }));
    if(report.regressions>0)process.exitCode=2;
  }catch(e){console.error('[CJ_FROZEN_REPLAY] '+e.stack);process.exitCode=1;}
}
module.exports={replay,inspectFrozenFile};
