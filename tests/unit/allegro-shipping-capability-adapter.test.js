'use strict';

const { adaptShippingRate } = require('../../services/suppliers/allegro-shipping-capability-adapter');
const { normalizeCapability } = require('../../services/suppliers/shipping-capability-contract');

const RATE_ID = 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f';

function sellerPhysicalRate(overrides = {}) {
  return {
    id: RATE_ID,
    type: 'PHYSICAL',
    dispatch_country: 'PL',
    managed_by_allegro: false,
    is_fulfillment: false,
    rates: [{ delivery_method_id: '00bc935e-b423-4cd4-9849-5760758db049' }],
    ...overrides,
  };
}

test('Allegro shipping detail becomes exact canonical capability without provider field leakage', () => {
  const capability = adaptShippingRate(sellerPhysicalRate());

  expect(capability).toEqual({
    provider: 'allegro',
    environment: 'sandbox',
    provider_ref: RATE_ID,
    delivery_kind: 'PHYSICAL',
    dispatch_country: 'PL',
    management_mode: 'SELLER',
    fulfillment_mode: 'SELLER',
    bindable_to_standard_offer: true,
  });
  expect(Object.isFrozen(capability)).toBe(true);
  expect(JSON.stringify(capability)).not.toContain('managed_by_allegro');
  expect(JSON.stringify(capability)).not.toContain('is_fulfillment');
  expect(JSON.stringify(capability)).not.toContain('delivery_method_id');
});

test('provider-owned or Fulfillment Allegro rates remain representable but are not bindable', () => {
  expect(adaptShippingRate(sellerPhysicalRate({ managed_by_allegro: true }))).toMatchObject({
    management_mode: 'PROVIDER',
    fulfillment_mode: 'SELLER',
    bindable_to_standard_offer: false,
  });
  expect(adaptShippingRate(sellerPhysicalRate({ is_fulfillment: true }))).toMatchObject({
    management_mode: 'SELLER',
    fulfillment_mode: 'PROVIDER',
    bindable_to_standard_offer: false,
  });
});

test('decision-relevant Allegro facts fail closed when unknown instead of defaulting to seller', () => {
  expect(() => adaptShippingRate(sellerPhysicalRate({ managed_by_allegro: null })))
    .toThrow('ALLEGRO_SHIPPING_CAPABILITY_UNKNOWN_MANAGEMENT');
  expect(() => adaptShippingRate(sellerPhysicalRate({ is_fulfillment: null })))
    .toThrow('ALLEGRO_SHIPPING_CAPABILITY_UNKNOWN_FULFILLMENT');
  expect(() => adaptShippingRate(sellerPhysicalRate({ type: null })))
    .toThrow('ALLEGRO_SHIPPING_CAPABILITY_UNKNOWN_TYPE');
  expect(() => adaptShippingRate(sellerPhysicalRate({ dispatch_country: null })))
    .toThrow('ALLEGRO_SHIPPING_CAPABILITY_UNKNOWN_DISPATCH_COUNTRY');
});

test('canonical contract rejects provider-specific fields at its boundary', () => {
  expect(() => normalizeCapability({
    provider: 'allegro',
    environment: 'sandbox',
    provider_ref: RATE_ID,
    delivery_kind: 'PHYSICAL',
    dispatch_country: 'PL',
    management_mode: 'SELLER',
    fulfillment_mode: 'SELLER',
    bindable_to_standard_offer: true,
    managedByAllegro: false,
  })).toThrow('SHIPPING_CAPABILITY_PROVIDER_FIELD_LEAK_MANAGEDBYALLEGRO');
});

test('provider reference is preserved exactly across the adapter boundary', () => {
  expect(adaptShippingRate(sellerPhysicalRate()).provider_ref).toBe(RATE_ID);
});
