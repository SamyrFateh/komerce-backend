'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const { readinessFromGaps } = require('../../services/market-control-plane');

describe('Market Control Plane G — two readiness verdicts', () => {
  test('platform and operations blockers are independent', () => {
    const result = readinessFromGaps([
      { code:'NO_PAYMENT_PROVIDER', message:'x' },
      { code:'NO_RELAIS', message:'y' },
      { code:'MARKET_INACTIVE', message:'expected while provisioning' },
    ]);
    expect(result.platform.ready).toBe(false);
    expect(result.platform.blockers.map(x=>x.code)).toEqual(['NO_PAYMENT_PROVIDER']);
    expect(result.operations.ready).toBe(false);
    expect(result.operations.blockers.map(x=>x.code)).toEqual(['NO_RELAIS']);
    expect(result.ready_for_activation).toBe(false);
  });

  test('inactive/provisioning state alone does not block readiness verdicts', () => {
    expect(readinessFromGaps([{ code:'MARKET_INACTIVE', message:'x' }])).toEqual({
      platform:{ ready:true, blockers:[] },
      operations:{ ready:true, blockers:[] },
      ready_for_activation:true,
    });
  });
});
