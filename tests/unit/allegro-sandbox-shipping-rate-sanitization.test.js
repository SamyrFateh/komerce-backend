'use strict';
const { safeShippingRateRows } = require('../../services/suppliers/allegro-sandbox-client');

test('shipping rate sanitizer preserves only capability facts needed by the contract gate', () => {
  const rows = safeShippingRateRows([{
    id: '41a15216-e03b-4b16-971d-6e141256ee67',
    name: 'provider free text must not be copied',
    type: 'PHYSICAL',
    features: { managedByAllegro: true, isFulfillment: true },
  }, {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'PHYSICAL',
    features: { managedByAllegro: false, isFulfillment: false },
  }]);

  expect(rows).toEqual([{
    id: '41a15216-e03b-4b16-971d-6e141256ee67',
    type: 'PHYSICAL', managed_by_allegro: true, is_fulfillment: true,
  }, {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'PHYSICAL', managed_by_allegro: false, is_fulfillment: false,
  }]);
  expect(JSON.stringify(rows)).not.toContain('provider free text');
});
