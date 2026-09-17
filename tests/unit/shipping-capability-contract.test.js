'use strict';

const contract = require('../../services/suppliers/shipping-capability-contract');

const BASE = {
  provider: 'allegro',
  environment: 'sandbox',
  provider_ref: 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f',
  delivery_kind: 'PHYSICAL',
  dispatch_country: 'PL',
  management_mode: 'SELLER',
  fulfillment_mode: 'SELLER',
  bindable_to_standard_offer: true,
};

test('canonical shipping capability accepts only provider-agnostic fields', () => {
  expect(contract.normalizeCapability(BASE)).toEqual(BASE);
});

test('provider-specific fields are rejected at the canonical boundary', () => {
  expect(() => contract.normalizeCapability({ ...BASE, managedByAllegro: false }))
    .toThrow('SHIPPING_CAPABILITY_PROVIDER_FIELD_LEAK_MANAGEDBYALLEGRO');
  expect(() => contract.normalizeCapability({ ...BASE, isFulfillment: false }))
    .toThrow('SHIPPING_CAPABILITY_PROVIDER_FIELD_LEAK_ISFULFILLMENT');
});

test('decision-relevant canonical fields fail closed when absent', () => {
  for (const key of ['provider_ref', 'delivery_kind', 'dispatch_country', 'management_mode', 'fulfillment_mode']) {
    const row = { ...BASE };
    delete row[key];
    expect(() => contract.normalizeCapability(row)).toThrow();
  }
});
