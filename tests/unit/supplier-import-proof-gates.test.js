/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const {assess}=require('../../scripts/lib/supplier-import-proof-gates');

function fixture(n=20,{fxPending=0}={}){
  const source={invalid_count:0,products:Array.from({length:n},(_,i)=>({
    supplier_product_id:'sku-'+i
  }))};
  const candidates=Array.from({length:n},(_,i)=>({
    id:'uuid-'+i,candidate_ref:'KSC-'+i,supplier_product_id:'sku-'+i,
    purchase_price_kmf:i<fxPending?null:300,
    data_sources:i<fxPending?{fx_conversion:'pending_official_rate'}:{},
    scan_result:i<fxPending?{
      fx_gate:{code:'fx_rate_unavailable',status:'AWAITING_OFFICIAL_QUOTE'},
      sourcing_decision:'WATCH'
    }:{sourcing_decision:'TEST'}
  }));
  return {provider:'CJdropshipping',expected:n,source,
    run:{provider:'CJdropshipping',run_ref:'KIR-000013',status:'COMPLETED',source_total:n,
      intake:{accepted:n,rejected:0,fx_pending:fxPending,
        pipeline_status:fxPending?'PARTIAL_BLOCKED':'CANONICAL_RESOLVED'}},
    events:candidates.map((c,i)=>({
      supplier_product_id:c.supplier_product_id,candidate_id:c.id,
      finished_at:'2026-10-27T00:00:00Z',
      outcome:i<fxPending?'deferred':'ready_for_refinery'
    })),
    candidates,
    classification:{inspected:n,auto_classifiable_products:n,
      unresolved_products:0,explicit_review_products:0,conflicting_classifications:0,
      products:candidates.map(c=>({candidate_ref:c.candidate_ref,
        status:'AUTO_CLASSIFIED',category:'Tech',subcategory:'Audio'}))},
    publishedDelta:0
  };
}

describe('Provider-neutral supplier import certification, nominal + fault calibration',()=>{
  test('20/20 imported, traced, classified; never asserts economic or sales approval',()=>{
    const r=assess(fixture());
    expect(r.passed).toBe(true);
    expect(r.verdict).toBe('CLASSIFICATION_CERTIFIED_NOT_SELLABILITY');
    expect(r.gates.fx_deferral.economic_pricing_certified).toBe(false);
  });
  test('same proof contract also works for AliExpress (no supplier-specific exceptions)',()=>{
    const x=fixture(); x.provider='AliExpress';x.run.provider='AliExpress';
    expect(assess(x).passed).toBe(true);
  });
  test('an auto-rejected terminal item does not pass on inflated accepted counters',()=>{
    const x=fixture();x.events[0].outcome='auto_rejected';
    expect(assess(x).failed_gates).toContain('trace');
  });
  test('no approved USD FX: 20 retained WATCH, 20 independently classified, no false sale',()=>{
    const r=assess(fixture(20,{fxPending:20}));
    expect(r.passed).toBe(true);
    expect(r.gates.fx_deferral).toMatchObject({pass:true,pending:20,safe_deferred:20});
    expect(r.gates.publication.pass).toBe(true);
  });
  test('KIR-000012 regression: 20 received, 20 errors, zero candidates cannot be green',()=>{
    const x=fixture();
    x.run.intake={accepted:0,rejected:20,fx_pending:0,pipeline_status:'PARTIAL_BLOCKED'};
    x.events=x.events.map(e=>({...e,candidate_id:null,outcome:'error'}));
    x.candidates=[];x.classification=null;
    expect(assess(x)).toMatchObject({passed:false,failed_gates:expect.arrayContaining(['import','trace','candidates','boutique_classification'])});
  });
  test('a finished event without an explicit outcome is not terminal',()=>{
    const x=fixture();delete x.events[0].outcome;
    expect(assess(x).failed_gates).toContain('trace');
  });
  test('a missing item event is a trace failure even if 20 candidates exist',()=>{
    const x=fixture();x.events.pop();
    expect(assess(x).failed_gates).toContain('trace');
  });
  test('19/20 classifications do not satisfy certification',()=>{
    const x=fixture();x.classification.products[19].status='REVIEW_REQUIRED';
    x.classification.auto_classifiable_products=19;x.classification.unresolved_products=1;
    expect(assess(x).failed_gates).toContain('boutique_classification');
  });
  test('historical category conflict blocks certification',()=>{
    const x=fixture();x.classification.conflicting_classifications=1;
    expect(assess(x).failed_gates).toContain('boutique_classification');
  });
  test('a duplicate supplier identity fails the source gate',()=>{
    const x=fixture();x.source.products[1].supplier_product_id='sku-0';
    expect(assess(x).failed_gates).toContain('source');
  });
  test('an FX-pending item with made-up price or non-WATCH decision fails',()=>{
    const x=fixture(20,{fxPending:20});
    x.candidates[0].purchase_price_kmf=123;
    expect(assess(x).failed_gates).toContain('fx_deferral');
    x.candidates[0].purchase_price_kmf=null;
    x.candidates[0].scan_result.sourcing_decision='TEST';
    expect(assess(x).failed_gates).toContain('fx_deferral');
  });
  test('unplanned catalog creation fails independently from classification',()=>{
    const x=fixture();x.publishedDelta=1;
    expect(assess(x).failed_gates).toContain('publication');
  });
  test('supplier mismatch, wrong run total and incomplete FX metadata cannot be green',()=>{
    const x=fixture(20,{fxPending:20});
    x.run.provider='AliExpress';x.run.source_total=19;
    x.candidates[0].data_sources={};
    const r=assess(x);
    expect(r.failed_gates).toEqual(expect.arrayContaining(['import','fx_deferral']));
  });
});
