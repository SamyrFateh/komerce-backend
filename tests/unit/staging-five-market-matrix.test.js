'use strict';
/** @test-kind unit */
const {MARKET_PROOFS,CODES,REQUIRED_EVIDENCE}=require('../../tests/staging-canonical/market-business-proof-matrix');
const {markets}=require('../../tests/staging-canonical/matrix');

test('les cinq marchés figurent dans le harnais Chromium canonique',()=>{
  expect(markets).toEqual(['KM','CM','CG','DJ','YT']);
  expect(CODES).toEqual(markets);
  expect(REQUIRED_EVIDENCE).toEqual(expect.arrayContaining([
    'canonical_api_request_reference','source_event_id','persisted_state','ui_chromium_result','finance_reconciliation',
  ]));
});
test('les monnaies et exigences réelles ne sont pas cinq clones KM',()=>{
  expect(CODES.map(m=>MARKET_PROOFS[m].currency)).toEqual(['KMF','XAF','XAF','DJF','EUR']);
  expect(MARKET_PROOFS.KM.paths).toContain('MIXED');
  expect(MARKET_PROOFS.KM.paths).toContain('LOCAL_STOCK');
  expect(MARKET_PROOFS.DJ.cases).toContain('P00_CANONICAL_PROVISIONING_TO_ACTIVE');
  expect(MARKET_PROOFS.YT.assertions.join(' ')).toMatch(/Mayotte/);
  expect(MARKET_PROOFS.CM.marketGroup).toEqual(['CM','CG']);
  expect(MARKET_PROOFS.CG.marketGroup).toEqual(['CM','CG']);
  for(const market of CODES){
    const p=MARKET_PROOFS[market];
    expect(p.cases).toContain('P01_SOURCE_TO_PUBLICATION');
    expect(p.cases).toContain('P09_JOURNAL_AND_N1_N2_N3');
    expect(p.paths).toContain('IMPORT');
  }
});
