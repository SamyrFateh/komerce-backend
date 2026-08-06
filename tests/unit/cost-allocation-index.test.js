'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
describe('cost-allocation/index', () => {
  it('re-exporte linterface publique doctrine du cost allocation', () => {
    const svc = require('../../services/cost-allocation');

    [
      'shareByWeight',
      'taxableWeight',
      'lockEstimatedCostsForOrder',
      'allocateShipmentRealCosts',
      'allocateParcelRealCosts',
      'allocateProductPurchaseCosts',
      'allocateMonthlyFixedCosts',
      'computeOrderCostVariance',
      'computeProductCostVariance',
      'getOrderCostTruth',
    ].forEach((name) => expect(typeof svc[name]).toBe('function'));

    expect(svc.COST_TYPES).toEqual(expect.arrayContaining(['product_purchase', 'freight', 'customs', 'payment']));
    expect(svc.ALLOCATION_METHODS).toEqual(expect.arrayContaining(['by_weight', 'by_value', 'manual']));
    expect(svc.VARIABLE_COST_TYPES).toEqual(expect.arrayContaining(['product_purchase', 'freight', 'customs']));
    expect(svc.FIXED_COST_TYPES).toContain('fixed_overhead');
    expect(svc.EXCEPTIONAL_COST_TYPES).toContain('incident');
  });
});
