'use strict';

const { activationVerdict } = require('../../services/market-local-price-activation-service');

describe('market local price activation verdict', () => {
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
