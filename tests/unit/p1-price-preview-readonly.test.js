/**
 * @test-kind unit
 * @komerce-arch-lite
 * @role p1-km-market-price-readonly-projection-contract
 * @domain economic-engine
 * @layer test
 * @owner backend-core
 * @impact-areas pricing, staging-only
 */
'use strict';
const {summarizePriceResponse}=require('../../scripts/recette/p1-price-preview-readonly');

describe('P1 local-price read-only diagnostic contract',()=>{
  test('missing draft is BLOCKED, not a failed product publication',()=>{
    expect(summarizePriceResponse(404,{code:'market_price_draft_not_found'})).toMatchObject({
      status:'BLOCKED_NO_LOCAL_DECISION_OR_PRODUCT',http:404,
      code:'market_price_draft_not_found'
    });
  });
  test('economic guard produces a typed business blockage',()=>{
    const r=summarizePriceResponse(200,{
      decision:{decision_status:'DRAFT_PENDING_GATE',local_price:2500,currency:'KMF'},
      activation:{allowed:false,reason:'CDR_POSITION_UNAVAILABLE'},
      market_gate:{decision_status:'NOT_DECISIONAL',reason:'POLICY_DOES_NOT_COVER_CANONICAL_PERIOD'},
      economics:{cdr_complete_kmf:null}
    });
    expect(r).toMatchObject({status:'BLOCKED_ECONOMIC_GATE',activation_allowed:false,
      activation_reason:'CDR_POSITION_UNAVAILABLE',market_gate_status:'NOT_DECISIONAL'});
  });
  test('allowed preview still requires explicit human activation',()=>{
    expect(summarizePriceResponse(200,{
      decision:{decision_status:'DRAFT_PENDING_GATE'},
      activation:{allowed:true,reason:'PRICE_COVERS_CDR'}
    }).status).toBe('AWAITING_HUMAN_ACTIVATION');
  });
  test('active local price is not itself a buyer GO',()=>{
    expect(summarizePriceResponse(200,{
      decision:{decision_status:'LOCAL_ACTIVE'},
      activation:{allowed:true,reason:'PRICE_COVERS_CDR'}
    }).status).toBe('PRICE_ACTIVE_VERIFY_BUYER');
  });
  test('authorization failures remain technical blocks',()=>{
    expect(summarizePriceResponse(403,{error:{code:'MARKET_CAPABILITY_REQUIRED'}}))
      .toMatchObject({status:'PREVIEW_HTTP_BLOCKED',http:403,code:'MARKET_CAPABILITY_REQUIRED'});
  });
});
