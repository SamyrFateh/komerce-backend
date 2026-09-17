'use strict';

const { proveShippingCapability, run } = require('../../scripts/allegro-shipping-capability-proof');

const RATE_ID = 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f';

function eligibleDetail(overrides = {}) {
  return {
    id: RATE_ID,
    type: 'PHYSICAL',
    dispatch_country: 'PL',
    managed_by_allegro: false,
    is_fulfillment: false,
    rates: [],
    ...overrides,
  };
}

test('live-style readback proves P0-P2 and exposes only canonical shipping capability', async () => {
  const api = { getShippingRateDetail: jest.fn().mockResolvedValue(eligibleDetail()) };
  const report = await proveShippingCapability(RATE_ID, api);

  expect(report.shipping_rate_ref).toBe(RATE_ID);
  expect(report.capability).toEqual({
    provider: 'allegro',
    environment: 'sandbox',
    provider_ref: RATE_ID,
    delivery_kind: 'PHYSICAL',
    dispatch_country: 'PL',
    management_mode: 'SELLER',
    fulfillment_mode: 'SELLER',
    bindable_to_standard_offer: true,
  });
  expect(report.contract_proof.stages.slice(0, 3).map(stage => [stage.id, stage.status])).toEqual([
    ['P0', 'PASS'],
    ['P1', 'PASS'],
    ['P2', 'PASS'],
  ]);
  expect(JSON.stringify(report.capability)).not.toContain('managed_by_allegro');
  expect(JSON.stringify(report.capability)).not.toContain('is_fulfillment');
  expect(api.getShippingRateDetail).toHaveBeenCalledTimes(1);
});

test('P2 blocks when the provider rate is known but cannot bind a standard seller offer', async () => {
  const api = { getShippingRateDetail: jest.fn().mockResolvedValue(eligibleDetail({ managed_by_allegro: true })) };
  await expect(proveShippingCapability(RATE_ID, api))
    .rejects.toThrow('PROVIDER_CONTRACT_BLOCKED_ALLEGRO_P2_STANDARD_OFFER_CAPABILITY');
});

test('P2 fails closed when a decision fact is unknown', async () => {
  const api = { getShippingRateDetail: jest.fn().mockResolvedValue(eligibleDetail({ dispatch_country: null })) };
  await expect(proveShippingCapability(RATE_ID, api))
    .rejects.toThrow('PROVIDER_CONVERSATION_BLOCKED_ALLEGRO_CONFIRMS_CANONICAL_MAPPING');
});

test('CLI contract is read-only and requires exactly one confirmed shipping rate id', async () => {
  const api = {
    getShippingRateDetail: jest.fn().mockResolvedValue(eligibleDetail()),
    createGoldenShippingRate: jest.fn(),
  };
  await expect(run([RATE_ID], api)).resolves.toMatchObject({ shipping_rate_ref: RATE_ID });
  expect(api.createGoldenShippingRate).not.toHaveBeenCalled();
  await expect(run([], api)).rejects.toThrow('Usage:');
});
