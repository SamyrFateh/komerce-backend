'use strict';

const { proveOfferPrerequisites } = require('../../scripts/allegro-offer-prerequisites-proof');

const SHIPPING_ID = 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f';

function api() {
  return {
    getSellerSettings: jest.fn().mockResolvedValue({
      shipping_rates: [{ id: SHIPPING_ID, type: null, managed_by_allegro: false, is_fulfillment: false }],
      return_policies: [{ id: '22222222-2222-4222-8222-222222222222', is_fulfillment: false, availability_range: 'FULL', withdrawal_period: 'P14D' }],
      implied_warranties: [{ id: '33333333-3333-4333-8333-333333333333' }],
    }),
    getShippingRateDetail: jest.fn().mockResolvedValue({
      id: SHIPPING_ID,
      type: 'PHYSICAL',
      dispatch_country: 'PL',
      managed_by_allegro: false,
      is_fulfillment: false,
    }),
  };
}

test('read-only P3 proof closes P0 through P3 and leaves P4 blocked', async () => {
  const provider = api();
  const report = await proveOfferPrerequisites(provider);
  expect(report.prerequisites.shipping_capability.provider_ref).toBe(SHIPPING_ID);
  expect(report.prerequisites.shipping_capability.bindable_to_standard_offer).toBe(true);
  expect(report.contract_proof.conversation.status).toBe('PASS');
  expect(report.contract_proof.stages).toEqual([
    expect.objectContaining({ id: 'P0', status: 'PASS' }),
    expect.objectContaining({ id: 'P1', status: 'PASS' }),
    expect.objectContaining({ id: 'P2', status: 'PASS' }),
    expect.objectContaining({ id: 'P3', status: 'PASS' }),
    expect.objectContaining({ id: 'P4', status: 'BLOCKED' }),
  ]);
  expect(provider.getSellerSettings).toHaveBeenCalledTimes(1);
  expect(provider.getShippingRateDetail).toHaveBeenCalledWith(SHIPPING_ID);
});
