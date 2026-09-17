'use strict';

const {
  buildCreatePayload,
  inspectShippingRate,
  ensureShippingRate,
  deliveryMethodDecision,
} = require('../../scripts/allegro-shipping-rate-contract');
const { assertConversation, assertThrough } = require('../../scripts/provider-contract-proof');

const RATE_ID = '11111111-1111-4111-8111-111111111111';
const METHOD_ID = '22222222-2222-4222-8222-222222222222';

function managedRates(count = 7) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
    type: null,
    dispatch_country: null,
    managed_by_allegro: true,
    is_fulfillment: true,
  }));
}

function eligibleMethod() {
  return {
    id: METHOD_ID,
    payment_policy: 'IN_ADVANCE',
    dispatch_country: 'PL',
    destination_country: 'PL',
    shipping_rates_constraints: {
      allowed: true,
      max_quantity_per_package_max: 999999,
      max_package_weight: {
        supported: true, min: '5.000', max: '700.000', unit: 'KILOGRAM',
      },
      first_item_rate: { min: '0.00', max: '14.99', currency: 'PLN' },
      shipping_time: {
        default: { from: 'PT24H', to: 'PT24H' }, customizable: false,
      },
    },
  };
}

function eligibleRate(id = RATE_ID) {
  return {
    id,
    type: 'PHYSICAL',
    dispatch_country: 'PL',
    managed_by_allegro: false,
    is_fulfillment: false,
    rates: [{
      delivery_method_id: METHOD_ID,
      max_quantity_per_package: 1,
      first_item_rate: { amount: '0.00', currency: 'PLN' },
      max_package_weight: { value: '5.000', unit: 'KILOGRAM' },
      shipping_time: { from: 'PT24H', to: 'PT24H' },
    }],
  };
}

test('seven managed Fulfillment rates are a known business gap, then delivery constraints derive a create payload', async () => {
  const api = {
    getSellerSettings: jest.fn().mockResolvedValue({ shipping_rates: managedRates() }),
    getShippingRateDetail: jest.fn(),
    getDeliveryMethods: jest.fn().mockResolvedValue({ delivery_methods: [eligibleMethod()] }),
  };

  const inspected = await inspectShippingRate(api);

  expect(inspected.exchange.received).toEqual({
    shipping_rates: 7,
    seller_managed_candidates: 0,
    candidate_details: 0,
    delivery_methods: 1,
  });
  expect(inspected.create_payload).toEqual({
    name: 'Komerce Golden Test Only',
    type: 'PHYSICAL',
    dispatchCountry: 'PL',
    rates: [{
      deliveryMethod: { id: METHOD_ID },
      maxQuantityPerPackage: 1,
      firstItemRate: { amount: '0.00', currency: 'PLN' },
      maxPackageWeight: { value: '5.000', unit: 'KILOGRAM' },
      shippingTime: { from: 'PT24H', to: 'PT24H' },
    }],
  });
  expect(JSON.stringify(inspected.create_payload)).not.toContain('nextItemRate');
  expect(inspected.conversation_ready).toBe(true);
  expect(inspected.p0_ready).toBe(true);
  expect(inspected.p1_ready).toBe(false);
  expect(() => assertConversation(inspected.proof)).not.toThrow();
  expect(() => assertThrough(inspected.proof, 'P1')).toThrow('CREATE_AND_READBACK');
  expect(api.getShippingRateDetail).not.toHaveBeenCalled();
});

test('candidate detail is required only when a seller-managed non-Fulfillment rate could qualify', async () => {
  const api = {
    getSellerSettings: jest.fn().mockResolvedValue({
      shipping_rates: [{
        id: RATE_ID, type: null, dispatch_country: null,
        managed_by_allegro: false, is_fulfillment: false,
      }],
    }),
    getShippingRateDetail: jest.fn().mockResolvedValue({
      id: RATE_ID, type: null, dispatch_country: null,
      managed_by_allegro: false, is_fulfillment: false, rates: [],
    }),
    getDeliveryMethods: jest.fn(),
  };

  const inspected = await inspectShippingRate(api);
  expect(inspected.conversation_ready).toBe(false);
  expect(() => assertConversation(inspected.proof)).toThrow('EXISTING_RATE_DECISION');
  expect(api.getDeliveryMethods).not.toHaveBeenCalled();
});

test('ensure creates exactly one bounded manual rate then proves the provider read-back', async () => {
  const method = eligibleMethod();
  const readback = eligibleRate();
  const api = {
    getSellerSettings: jest.fn().mockResolvedValue({ shipping_rates: managedRates() }),
    getShippingRateDetail: jest.fn().mockResolvedValue(readback),
    getDeliveryMethods: jest.fn().mockResolvedValue({ delivery_methods: [method] }),
    createGoldenShippingRate: jest.fn().mockResolvedValue({ id: RATE_ID }),
  };

  const result = await ensureShippingRate(api);

  expect(result.created).toBe(true);
  expect(result.shipping_rate_ref).toBe(RATE_ID);
  expect(result.conversation_ready).toBe(true);
  expect(result.p0_ready).toBe(true);
  expect(result.p1_ready).toBe(true);
  expect(api.createGoldenShippingRate).toHaveBeenCalledWith(buildCreatePayload(method));
  expect(api.getShippingRateDetail).toHaveBeenCalledWith(RATE_ID);
  expect(() => assertThrough(result.proof, 'P1')).not.toThrow();
});

test('ensure reuses an already confirmed compatible seller rate and never mutates', async () => {
  const readback = eligibleRate();
  const api = {
    getSellerSettings: jest.fn().mockResolvedValue({
      shipping_rates: [{
        id: RATE_ID, type: null, dispatch_country: null,
        managed_by_allegro: false, is_fulfillment: false,
      }],
    }),
    getShippingRateDetail: jest.fn().mockResolvedValue(readback),
    getDeliveryMethods: jest.fn(),
    createGoldenShippingRate: jest.fn(),
  };

  const result = await ensureShippingRate(api);
  expect(result.created).toBe(false);
  expect(result.shipping_rate_ref).toBe(RATE_ID);
  expect(result.p1_ready).toBe(true);
  expect(api.getDeliveryMethods).not.toHaveBeenCalled();
  expect(api.createGoldenShippingRate).not.toHaveBeenCalled();
});

test('known absence of a compatible delivery method blocks P0 without pretending the conversation is unknown', async () => {
  const rejected = eligibleMethod();
  rejected.shipping_rates_constraints.allowed = false;
  const api = {
    getSellerSettings: jest.fn().mockResolvedValue({ shipping_rates: managedRates() }),
    getShippingRateDetail: jest.fn(),
    getDeliveryMethods: jest.fn().mockResolvedValue({ delivery_methods: [rejected] }),
    createGoldenShippingRate: jest.fn(),
  };

  const inspected = await inspectShippingRate(api);
  expect(inspected.conversation_ready).toBe(true);
  expect(inspected.p0_ready).toBe(false);
  expect(() => assertConversation(inspected.proof)).not.toThrow();
  expect(() => assertThrough(inspected.proof, 'P0')).toThrow('EXISTING_OR_CREATABLE_SHIPPING_RATE');
  await expect(ensureShippingRate(api)).rejects.toThrow('EXISTING_OR_CREATABLE_SHIPPING_RATE');
  expect(api.createGoldenShippingRate).not.toHaveBeenCalled();
});

test('delivery method constraints fail closed when a decision-relevant field is absent', () => {
  const method = eligibleMethod();
  method.shipping_rates_constraints.shipping_time.default.from = null;
  expect(deliveryMethodDecision(method)).toBe('UNKNOWN');
});

test('delivery dispatchCountry null is a known ANY-country capability and includes PL', () => {
  const method = eligibleMethod();
  method.dispatch_country = null;
  expect(deliveryMethodDecision(method)).toBe('ELIGIBLE');
  expect(buildCreatePayload(method)).toMatchObject({ type: 'PHYSICAL', dispatchCountry: 'PL' });
});
