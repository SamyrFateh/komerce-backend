/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const { activationVerdict } = require('../../services/market-local-price-activation-service');

describe('market local price activation verdict', () => {
  test('enforces the versioned family contribution minimum and requires purchase evidence', () => {
    const policy = { version: 'CM-V2', selection_by_family: { audio: { minimum_contribution_kmf: 150, loss_observation_count: 3 } } };
    const priced = { category: 'audio', strategy_risk: 'contributive', contribution_kmf: 149, data_quality: { sources: { purchase_price: 'real' } } };
    expect(activationVerdict(priced, { policy })).toEqual({ allowed: false, reason: 'ECONOMIC_SELECTION_BELOW_FAMILY_MINIMUM' });
    expect(activationVerdict({ ...priced, contribution_kmf: 150 }, { policy }).allowed).toBe(true);
    expect(activationVerdict({ ...priced, data_quality: null }, { policy })).toEqual({ allowed: false, reason: 'ECONOMIC_SELECTION_EVIDENCE_REQUIRED' });
    expect(activationVerdict({ ...priced, category: 'clothing' }, { policy }).allowed).toBe(true);
  });

  test('never activates a destructive price', () => {
    expect(activationVerdict(
      { strategy_risk: 'destructive' },
      { authorization: 'ALLOW_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: false, reason: 'PRICE_BELOW_VARIABLE_COST' });
  });

  test('requires market coverage authorization for a contributive low-buffer price', () => {
    expect(activationVerdict(
      { strategy_risk: 'contributive_low_buffer' },
      { authorization: 'DENY_NEW_UNDER_CDR_POSITION', reason: 'COVERAGE_THRESHOLD_NOT_MET' }
    )).toEqual({ allowed: false, reason: 'COVERAGE_THRESHOLD_NOT_MET' });
  });

  test('allows a contributive low-buffer price only when the market gate explicitly allows it', () => {
    expect(activationVerdict(
      { strategy_risk: 'contributive_low_buffer' },
      { authorization: 'ALLOW_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: true, reason: 'MARKET_GATE_AUTHORIZES_UNDER_CDR_POSITION' });
  });

  test('a price above the minimum safe contribution boundary does not require the market coverage exception', () => {
    expect(activationVerdict(
      { strategy_risk: 'contributive' },
      { authorization: 'DENY_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: true, reason: 'PRICE_MEETS_MINIMUM_SAFE_CONTRIBUTION_BOUNDARY' });
  });

  test('unknown pricing risk is fail-closed', () => {
    expect(activationVerdict(
      { strategy_risk: 'future_unmapped_state' },
      { authorization: 'ALLOW_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: false, reason: 'CDR_POSITION_UNKNOWN' });
  });

  test('legacy covered/undercovered snapshots remain understood during migration', () => {
    expect(activationVerdict(
      { strategy_risk: 'undercovered' },
      { authorization: 'ALLOW_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: true, reason: 'MARKET_GATE_AUTHORIZES_UNDER_CDR_POSITION' });
    expect(activationVerdict(
      { strategy_risk: 'covered' },
      { authorization: 'DENY_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: true, reason: 'PRICE_COVERS_CDR' });
  });
});
