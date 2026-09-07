'use strict';

const { activationVerdict } = require('../../services/market-local-price-activation-service');

describe('market local price activation verdict', () => {
  test('never activates a destructive price', () => {
    expect(activationVerdict(
      { strategy_risk: 'destructive' },
      { authorization: 'ALLOW_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: false, reason: 'PRICE_BELOW_VARIABLE_COST' });
  });

  test('requires market coverage authorization for an undercovered price', () => {
    expect(activationVerdict(
      { strategy_risk: 'undercovered' },
      { authorization: 'DENY_NEW_UNDER_CDR_POSITION', reason: 'COVERAGE_THRESHOLD_NOT_MET' }
    )).toEqual({ allowed: false, reason: 'COVERAGE_THRESHOLD_NOT_MET' });
  });

  test('allows an undercovered price only when the market gate explicitly allows it', () => {
    expect(activationVerdict(
      { strategy_risk: 'undercovered' },
      { authorization: 'ALLOW_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: true, reason: 'MARKET_GATE_AUTHORIZES_UNDER_CDR_POSITION' });
  });

  test('a price covering full CDR does not require an under-CDR authorization', () => {
    expect(activationVerdict(
      { strategy_risk: 'covered' },
      { authorization: 'DENY_NEW_UNDER_CDR_POSITION' }
    )).toEqual({ allowed: true, reason: 'PRICE_COVERS_CDR' });
  });
});
