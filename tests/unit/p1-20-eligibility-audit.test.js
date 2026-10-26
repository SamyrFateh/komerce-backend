/**
 * @test-kind unit
 * @komerce-arch-lite
 * @role p1-source-commercial-eligibility-diagnostic-unit
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @impact-areas sourcing, catalog, staging-only
 */
'use strict';
const {issueCategory,summarize}=require('../../scripts/recette/p1-20-eligibility-audit');
const verdict=(decision,sourcing_certified=false)=>({decision,sourcing_certified,outcome_valid:true,reasons:[]});
describe('P1 evidence is not the same as commercial rejection',()=>{
  test('missing category means review, never hard exclusion',()=>{
    expect(issueCategory({state:'scanned',purchase_price_kmf:1000,
      komerce_category:null,scan_result:{commercial_review:{status:'PENDING_CLASSIFICATION'},reason:'category missing'}},
      verdict('WATCH'))).toMatchObject({type:'TAXONOMY_OR_CUSTOMS_REVIEW',hard_gate:false});
  });
  test('unknown supplier cost is not proof of economic loss',()=>{
    expect(issueCategory({state:'scanned',purchase_price_kmf:null,scan_result:{}},
      verdict('WATCH'))).toMatchObject({type:'MISSING_PURCHASE_COST',hard_gate:false});
  });
  test('economic WATCH is provisional and not an explicit exclusion',()=>{
    expect(issueCategory({state:'scanned',purchase_price_kmf:2000,komerce_category:'tech',
      data_sources:{category:'mapped'},scan_result:{economic_test_health_status:'fragile'}},
      verdict('WATCH'))).toMatchObject({type:'ECONOMIC_TEST_NOT_ACCEPTED',hard_gate:false});
  });
  test('EXCLUDED remains a hard gate pending cause review',()=>{
    expect(issueCategory({state:'scanned',purchase_price_kmf:3000,scan_result:{reason:'legal'}},
      verdict('EXCLUDED'))).toMatchObject({type:'EXPLICIT_EXCLUSION_REVIEW',hard_gate:true});
  });
  test('certified is preserved even when publication and local price are absent',()=>{
    expect(issueCategory({state:'scanned',purchase_price_kmf:1000},verdict('TEST',true)))
      .toMatchObject({type:'SOURCE_CERTIFIED',hard_gate:false});
  });
  test('single coherent accounting keeps missing and excluded visible',()=>{
    expect(summarize([{issue:{type:'SOURCE_CERTIFIED',hard_gate:false},sourcing_certified:true,catalog_linked:true},
      {issue:{type:'MISSING_FX_QUOTE',hard_gate:false},sourcing_certified:false,catalog_linked:false},
      {issue:{type:'EXPLICIT_EXCLUSION_REVIEW',hard_gate:true},sourcing_certified:false,catalog_linked:false}
    ])).toMatchObject({total:3,certified:1,noncertified:2,excluded_pending_review:1,catalog_linked:1});
  });
});
