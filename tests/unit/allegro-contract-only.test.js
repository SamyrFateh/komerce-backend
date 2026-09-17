'use strict';
const { run } = require('../../scripts/allegro-sandbox-check');

function deps(client) {
  return {
    client,
    fetchProducts: jest.fn(),
    evaluate: jest.fn(),
    importCatalog: jest.fn(),
  };
}

test('contract-only probe returns BLOCKED without any Golden mutation', async () => {
  const client = {
    getSellerSettings: jest.fn().mockResolvedValue({
      shipping_rates: [{
        id: '41a15216-e03b-4b16-971d-6e141256ee67',
        type: null, managed_by_allegro: true, is_fulfillment: true,
      }],
      return_policies: [{
        id: '22222222-2222-4222-8222-222222222222',
        is_fulfillment: false, availability_range: 'FULL', withdrawal_period: 'P14D',
      }],
      implied_warranties: [{ id: '33333333-3333-4333-8333-333333333333' }],
    }),
    seedConfiguration: jest.fn(),
    ensureGoldenResponsibleProducer: jest.fn(),
    createDraftOffer: jest.fn(),
    activateOffer: jest.fn(),
  };
  const d = deps(client);

  const report = await run(['--contract'], d);

  expect(report).toMatchObject({
    mode: 'contract', contract_ready: false, seeded: 0, offer_ids: [],
    contract_proof: {
      provider: 'ALLEGRO', environment: 'SANDBOX',
      stages: expect.arrayContaining([
        expect.objectContaining({
          id: 'P0', status: 'BLOCKED', failed_checks: ['SELLER_MANAGED_SHIPPING_RATE'],
        }),
        expect.objectContaining({ id: 'P1', status: 'PASS' }),
      ]),
    },
  });
  expect(client.seedConfiguration).not.toHaveBeenCalled();
  expect(client.ensureGoldenResponsibleProducer).not.toHaveBeenCalled();
  expect(client.createDraftOffer).not.toHaveBeenCalled();
  expect(client.activateOffer).not.toHaveBeenCalled();
  expect(d.fetchProducts).not.toHaveBeenCalled();
  expect(d.evaluate).not.toHaveBeenCalled();
  expect(d.importCatalog).not.toHaveBeenCalled();
});

test('contract-only probe returns PASS when elementary seller contract is satisfied', async () => {
  const client = {
    getSellerSettings: jest.fn().mockResolvedValue({
      shipping_rates: [{
        id: '11111111-1111-4111-8111-111111111111',
        type: 'PHYSICAL', managed_by_allegro: false, is_fulfillment: false,
      }],
      return_policies: [{
        id: '22222222-2222-4222-8222-222222222222',
        is_fulfillment: false, availability_range: 'FULL', withdrawal_period: 'P14D',
      }],
      implied_warranties: [{ id: '33333333-3333-4333-8333-333333333333' }],
    }),
  };
  const d = deps(client);

  const report = await run(['--contract'], d);

  expect(report).toMatchObject({
    mode: 'contract', contract_ready: true,
    contract_proof: {
      stages: expect.arrayContaining([
        expect.objectContaining({ id: 'P0', status: 'PASS' }),
        expect.objectContaining({ id: 'P1', status: 'PASS' }),
      ]),
    },
  });
  expect(d.fetchProducts).not.toHaveBeenCalled();
  expect(d.importCatalog).not.toHaveBeenCalled();
});
