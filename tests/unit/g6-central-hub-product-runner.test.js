'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { nextStep } = require('../../scripts/recette/g6-central-hub-product-chromium');

describe('G6 central Hub product runner screen progression', () => {
  test('starts with manual import when no candidate exists', () => {
    expect(nextStep({ sellable: [], candidate: null })).toEqual({ step: 'manual-import' });
  });

  test('promotes an imported candidate that has no product yet', () => {
    expect(nextStep({
      sellable: [],
      candidate: { candidate_ref: 'KSC-000001', product_ref: null },
    })).toEqual({ step: 'promote-candidate', candidate_ref: 'KSC-000001' });
  });

  test('continues with the global Catalogue for an already promoted product', () => {
    expect(nextStep({
      sellable: [],
      candidate: { candidate_ref: 'KSC-000001', product_ref: 'KPR-000321' },
    })).toEqual({ step: 'catalog-review', product_ref: 'KPR-000321' });
  });

  test('keeps the sellable and duplicate guards ahead of the UI workflow', () => {
    expect(nextStep({ sellable: [{ product_ref: 'KPR-000321' }], candidate: null }))
      .toEqual({ verdict: 'G6_CENTRAL_HUB_PRODUCT_ALREADY_SELLABLE_PASS', done: true });
    expect(nextStep({ sellable: [{}, {}], candidate: null }))
      .toEqual({ verdict: 'G6_CENTRAL_HUB_PRODUCT_DUPLICATE', done: true, fail: true });
  });
});
