'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
describe('finance-metrics/index', () => {
  it('re-exporte les quatre fonctions publiques du dashboard finance', () => {
    const metrics = require('../../services/finance-metrics');

    expect(typeof metrics.getFinanceSummary).toBe('function');
    expect(typeof metrics.getAnnulationsParcels).toBe('function');
    expect(typeof metrics.getPaymentsDetail).toBe('function');
    expect(typeof metrics.getSalesAnalysis).toBe('function');
    expect(Object.keys(metrics).sort()).toEqual([
      'getAnnulationsParcels',
      'getFinanceSummary',
      'getPaymentsDetail',
      'getSalesAnalysis',
    ].sort());
  });
});
