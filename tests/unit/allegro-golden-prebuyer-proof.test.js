'use strict';

const { selectedFromPrerequisites, run } = require('../../scripts/allegro-golden-prebuyer-proof');

const prerequisites = {
  shipping_capability: { provider_ref: 'ship-1', bindable_to_standard_offer: true },
  return_policy_ref: 'return-1',
  implied_warranty_ref: 'warranty-1',
};

test('uses the exact P3 prerequisite bundle', () => {
  expect(selectedFromPrerequisites(prerequisites)).toEqual({
    shipping_rate_id: 'ship-1',
    return_policy_id: 'return-1',
    implied_warranty_id: 'warranty-1',
  });
});

test('prebuyer proof reaches canonical HARD_STOP without placeOrder', async () => {
  const soi = { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '123' } };
  const client = {
    ensureGoldenResponsibleProducer: jest.fn().mockResolvedValue({ id: 'producer-1' }),
    get: jest.fn().mockResolvedValue({ publication: { status: 'INACTIVE' } }),
    completeSeedOffer: jest.fn().mockResolvedValue({ offer_id: '123' }),
  };
  const report = await run([], {
    client,
    provePrerequisites: jest.fn().mockResolvedValue({ prerequisites, contract_proof: { stages: [{ id: 'P3', status: 'PASS' }] } }),
    seedOfferIds: jest.fn().mockResolvedValue(['123']),
    activateOfferIds: jest.fn().mockResolvedValue([{ offer_id: '123', publication_status: 'ACTIVE' }]),
    fetchProducts: jest.fn().mockResolvedValue({ products: [{}], invalid: [] }),
    importCatalog: jest.fn().mockResolvedValue({ status: 200, body: { accepted: 1, rejected: 0 } }),
    query: jest.fn().mockResolvedValue({ rows: [{
      id: 77, supplier_unit_ref: '123', supplier_sku: 'allegro-sandbox:123', source: 'SUPPLIER', is_active: true,
      supplier_order_identity: soi,
    }] }),
    prepareCanonicalUnitPurchase: jest.fn().mockResolvedValue({
      status: 'HARD_STOP', provider: 'allegro', place_order_invoked: false,
      payload: { execution_mode: 'manual', offer_id: '123' },
    }),
  });
  expect(report).toMatchObject({
    phase: 'PRE_BUYER', offer_id: '123', product_sku_id: 77,
    purchasing: { status: 'HARD_STOP', provider: 'allegro', place_order_invoked: false },
    buyer_purchase_required: true,
  });
});
