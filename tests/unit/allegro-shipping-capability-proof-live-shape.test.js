'use strict';

const { proveShippingCapability } = require('../../scripts/allegro-shipping-capability-proof');

const RATE_ID = 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f';

test('P2 proof exposes only canonical shipping capability shape', async () => {
  const api = {
    getShippingRateDetail: jest.fn().mockResolvedValue({
      id: RATE_ID,
      type: 'PHYSICAL',
      dispatch_country: 'PL',
      managed_by_allegro: false,
      is_fulfillment: false,
      rates: [{ delivery_method_id: '00bc935e-b423-4cd4-9849-5760758db049' }],
    }),
  };

  const result = await proveShippingCapability(RATE_ID, api);
  expect(result.capability).toEqual({
    provider: 'allegro',
    environment: 'sandbox',
    provider_ref: RATE_ID,
    delivery_kind: 'PHYSICAL',
    dispatch_country: 'PL',
    management_mode: 'SELLER',
    fulfillment_mode: 'SELLER',
    bindable_to_standard_offer: true,
  });
  expect(JSON.stringify(result.capability)).not.toContain('managed_by_allegro');
  expect(JSON.stringify(result.capability)).not.toContain('is_fulfillment');
  expect(result.contract_proof.stages.find(stage => stage.id === 'P2').status).toBe('PASS');
});
