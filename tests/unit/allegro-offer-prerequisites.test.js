'use strict';

const { resolveOfferPrerequisites } = require('../../services/suppliers/allegro-offer-prerequisites');

const SHIPPING_ID = 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f';
const RETURN_ID = '22222222-2222-4222-8222-222222222222';
const WARRANTY_ID = '33333333-3333-4333-8333-333333333333';

function settings(overrides = {}) {
  return {
    shipping_rates: [{ id: SHIPPING_ID, type: null, managed_by_allegro: false, is_fulfillment: false }],
    return_policies: [{ id: RETURN_ID, is_fulfillment: false, availability_range: 'FULL', withdrawal_period: 'P14D' }],
    implied_warranties: [{ id: WARRANTY_ID }],
    ...overrides,
  };
}

function api(detailOverrides = {}) {
  return {
    getShippingRateDetail: jest.fn().mockResolvedValue({
      id: SHIPPING_ID,
      type: 'PHYSICAL',
      dispatch_country: 'PL',
      managed_by_allegro: false,
      is_fulfillment: false,
      ...detailOverrides,
    }),
  };
}

test('P3 composes offer prerequisites from canonical ShippingCapability rather than list type', async () => {
  const provider = api();
  const result = await resolveOfferPrerequisites(settings(), provider);
  expect(provider.getShippingRateDetail).toHaveBeenCalledWith(SHIPPING_ID);
  expect(result).toEqual({
    shipping_capability: {
      provider: 'allegro',
      environment: 'sandbox',
      provider_ref: SHIPPING_ID,
      delivery_kind: 'PHYSICAL',
      dispatch_country: 'PL',
      management_mode: 'SELLER',
      fulfillment_mode: 'SELLER',
      bindable_to_standard_offer: true,
    },
    return_policy_ref: RETURN_ID,
    implied_warranty_ref: WARRANTY_ID,
  });
});

test('P3 fails closed when shipping detail cannot produce a bindable canonical capability', async () => {
  await expect(resolveOfferPrerequisites(settings(), api({ dispatch_country: null })))
    .rejects.toThrow('ALLEGRO_SHIPPING_CAPABILITY_UNKNOWN_DISPATCH_COUNTRY');
});

test('P3 refuses ambiguous bindable shipping capabilities instead of choosing by provider order', async () => {
  const second = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const provider = {
    getShippingRateDetail: jest.fn(async id => ({
      id,
      type: 'PHYSICAL',
      dispatch_country: 'PL',
      managed_by_allegro: false,
      is_fulfillment: false,
    })),
  };
  await expect(resolveOfferPrerequisites(settings({
    shipping_rates: [
      { id: SHIPPING_ID, managed_by_allegro: false, is_fulfillment: false },
      { id: second, managed_by_allegro: false, is_fulfillment: false },
    ],
  }), provider)).rejects.toThrow('ALLEGRO_OFFER_PREREQUISITES_SHIPPING_AMBIGUOUS');
});
