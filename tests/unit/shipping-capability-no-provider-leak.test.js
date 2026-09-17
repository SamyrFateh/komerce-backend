'use strict';

const { normalizeCapability } = require('../../services/suppliers/shipping-capability-contract');

const base = {
  provider: 'allegro',
  environment: 'sandbox',
  provider_ref: 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f',
  delivery_kind: 'PHYSICAL',
  dispatch_country: 'PL',
  management_mode: 'SELLER',
  fulfillment_mode: 'SELLER',
  bindable_to_standard_offer: true,
};

test.each(['managedByAllegro', 'managed_by_allegro', 'isFulfillment', 'is_fulfillment', 'delivery_method_id'])(
  'canonical boundary rejects provider-specific field %s',
  field => {
    expect(() => normalizeCapability({ ...base, [field]: false })).toThrow('SHIPPING_CAPABILITY_PROVIDER_FIELD_LEAK_');
  }
);
