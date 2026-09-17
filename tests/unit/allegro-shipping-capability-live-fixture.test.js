'use strict';

const { adaptShippingRate } = require('../../services/suppliers/allegro-shipping-capability-adapter');

// Fixture is the exact provider decision surface proven live on 2026-09-17.
const LIVE_CONFIRMED_RATE = Object.freeze({
  id: 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f',
  type: 'PHYSICAL',
  dispatch_country: 'PL',
  managed_by_allegro: false,
  is_fulfillment: false,
});

test('live-confirmed Allegro rate maps to bindable canonical capability', () => {
  expect(adaptShippingRate(LIVE_CONFIRMED_RATE)).toEqual({
    provider: 'allegro',
    environment: 'sandbox',
    provider_ref: LIVE_CONFIRMED_RATE.id,
    delivery_kind: 'PHYSICAL',
    dispatch_country: 'PL',
    management_mode: 'SELLER',
    fulfillment_mode: 'SELLER',
    bindable_to_standard_offer: true,
  });
});
