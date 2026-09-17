'use strict';

const {
  safeShippingRateDetail,
  safeDeliveryMethodRows,
  goldenShippingRatePayload,
  GOLDEN_SHIPPING_RATE_NAME,
} = require('../../services/suppliers/allegro-sandbox-client');

const RATE_ID = '11111111-1111-4111-8111-111111111111';
const METHOD_ID = '22222222-2222-4222-8222-222222222222';

test('shipping read-back sanitizer preserves only decision facts', () => {
  const detail = safeShippingRateDetail({
    id: RATE_ID,
    name: 'provider free text must disappear',
    type: 'PHYSICAL',
    dispatchCountry: 'PL',
    features: { managedByAllegro: false, isFulfillment: false },
    rates: [{
      deliveryMethod: { id: METHOD_ID, name: 'another provider label' },
      maxQuantityPerPackage: 2,
      maxPackageWeight: { value: '5.000', unit: 'KILOGRAM' },
      firstItemRate: { amount: '7.99', currency: 'PLN' },
      nextItemRate: { amount: '0.00', currency: 'PLN' },
      shippingTime: { from: 'PT24H', to: 'PT48H' },
    }],
  });

  expect(detail).toEqual({
    id: RATE_ID,
    type: 'PHYSICAL',
    dispatch_country: 'PL',
    managed_by_allegro: false,
    is_fulfillment: false,
    rates: [{
      delivery_method_id: METHOD_ID,
      max_quantity_per_package: 2,
      first_item_rate: { amount: '7.99', currency: 'PLN' },
      max_package_weight: { value: '5.000', unit: 'KILOGRAM' },
      shipping_time: { from: 'PT24H', to: 'PT48H' },
    }],
  });
  expect(JSON.stringify(detail)).not.toContain('provider free text');
  expect(JSON.stringify(detail)).not.toContain('another provider label');
  expect(JSON.stringify(detail)).not.toContain('nextItemRate');
});

test('delivery method sanitizer exposes constraints, not provider labels', () => {
  const rows = safeDeliveryMethodRows([{
    id: METHOD_ID,
    name: 'Allegro Courier Provider Label',
    paymentPolicy: 'IN_ADVANCE',
    dispatchCountry: 'PL',
    destinationCountry: 'PL',
    shippingRatesConstraints: {
      allowed: true,
      maxQuantityPerPackage: { max: 999999 },
      maxPackageWeight: { supported: true, min: '5.000', max: '700.000', unit: 'KILOGRAM' },
      firstItemRate: { min: '0.00', max: '14.99', currency: 'PLN' },
      nextItemRate: { min: '0.00', max: '0.00', currency: 'PLN' },
      shippingTime: { default: { from: 'PT24H', to: 'PT72H' }, customizable: false },
    },
  }]);

  expect(rows[0]).toMatchObject({
    id: METHOD_ID,
    payment_policy: 'IN_ADVANCE',
    dispatch_country: 'PL',
    destination_country: 'PL',
    shipping_rates_constraints: {
      allowed: true,
      max_quantity_per_package_max: 999999,
      first_item_rate: { min: '0.00', max: '14.99', currency: 'PLN' },
      shipping_time: { default: { from: 'PT24H', to: 'PT72H' }, customizable: false },
    },
  });
  expect(JSON.stringify(rows)).not.toContain('Allegro Courier Provider Label');
  expect(JSON.stringify(rows)).not.toContain('nextItemRate');
});

test('guarded Golden create payload allows provider-owned shipping time to be omitted', () => {
  const base = {
    name: GOLDEN_SHIPPING_RATE_NAME,
    type: 'PHYSICAL',
    dispatchCountry: 'PL',
    rates: [{
      deliveryMethod: { id: METHOD_ID },
      maxQuantityPerPackage: 1,
      firstItemRate: { amount: '0.00', currency: 'PLN' },
    }],
  };
  expect(goldenShippingRatePayload(base)).toEqual(base);
});

test('guarded Golden create payload accepts shippingTime only when caller explicitly supplies valid bounds', () => {
  const base = {
    name: GOLDEN_SHIPPING_RATE_NAME,
    type: 'PHYSICAL',
    dispatchCountry: 'PL',
    rates: [{
      deliveryMethod: { id: METHOD_ID },
      maxQuantityPerPackage: 1,
      firstItemRate: { amount: '0.00', currency: 'PLN' },
      shippingTime: { from: 'PT24H', to: 'PT72H' },
    }],
  };
  expect(goldenShippingRatePayload(base)).toEqual(base);
});

test('guarded Golden create payload forbids deprecated nextItemRate', () => {
  const base = {
    name: GOLDEN_SHIPPING_RATE_NAME,
    type: 'PHYSICAL',
    dispatchCountry: 'PL',
    rates: [{
      deliveryMethod: { id: METHOD_ID },
      maxQuantityPerPackage: 1,
      firstItemRate: { amount: '0.00', currency: 'PLN' },
    }],
  };
  expect(() => goldenShippingRatePayload({
    ...base,
    rates: [{ ...base.rates[0], nextItemRate: { amount: '0.00', currency: 'PLN' } }],
  })).toThrow('NEXT_ITEM_RATE_FORBIDDEN');
});
