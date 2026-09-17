'use strict';
const { buildSellerContractProof } = require('../../scripts/allegro-sandbox-check');
const { assertThrough } = require('../../scripts/provider-contract-proof');

test('known ineligible shipping rows do not require irrelevant type detail', () => {
  const proof = buildSellerContractProof({
    shipping_rates: Array.from({ length: 7 }, (_, index) => ({
      id: `rate-${index}`,
      type: null,
      managed_by_allegro: true,
      is_fulfillment: true,
    })),
    return_policies: [{
      id: 'return',
      is_fulfillment: false,
      availability_range: 'FULL',
      withdrawal_period: 'P14D',
    }],
    implied_warranties: [{ id: 'implied' }],
  });

  expect(proof.conversation.status).toBe('PASS');
  expect(proof.conversation.phases.find(phase => phase.id === 'CONFIRMS')).toEqual(
    expect.objectContaining({ status: 'PASS' }),
  );
  expect(() => assertThrough(proof, 'P1'))
    .toThrow('PROVIDER_CONTRACT_BLOCKED_ALLEGRO_P0_SELLER_MANAGED_SHIPPING_RATE');
});

test('seller-managed non-Fulfillment candidate requires type detail before P0', () => {
  const proof = buildSellerContractProof({
    shipping_rates: [{
      id: 'candidate',
      type: null,
      managed_by_allegro: false,
      is_fulfillment: false,
    }],
    return_policies: [{
      id: 'return',
      is_fulfillment: false,
      availability_range: 'FULL',
      withdrawal_period: 'P14D',
    }],
    implied_warranties: [{ id: 'implied' }],
  });

  expect(proof.conversation.status).toBe('BLOCKED');
  expect(() => assertThrough(proof, 'P1'))
    .toThrow('PROVIDER_CONVERSATION_BLOCKED_ALLEGRO_CONFIRMS_SHIPPING_TYPE');
});
