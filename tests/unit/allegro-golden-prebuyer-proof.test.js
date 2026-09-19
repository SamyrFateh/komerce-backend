'use strict';

const {
  selectedFromPrerequisites,
  runConfig,
  explicitPromotionPrice,
  assertCandidateIdentity,
  run,
} = require('../../scripts/allegro-golden-prebuyer-proof');

const prerequisites = {
  shipping_capability: { provider_ref: 'ship-1', bindable_to_standard_offer: true },
  return_policy_ref: 'return-1',
  implied_warranty_ref: 'warranty-1',
};

const soi = { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '123' } };

function candidate() {
  return {
    id: 'candidate-1', supplier_name: 'Allegro Sandbox', supplier_product_id: '123',
    state: 'scanned', product_id: null,
    normalized_source_contract: {
      sellable_units: [{
        supplier_unit_ref: '123', supplier_sku: 'allegro-sandbox:123', supplier_order_identity: soi,
      }],
    },
  };
}

test('uses the exact P3 prerequisite bundle', () => {
  expect(selectedFromPrerequisites(prerequisites)).toEqual({
    shipping_rate_id: 'ship-1',
    return_policy_id: 'return-1',
    implied_warranty_id: 'warranty-1',
  });
});

test('requires an explicit operator promotion price', () => {
  expect(() => explicitPromotionPrice([])).toThrow('Usage:');
  expect(() => explicitPromotionPrice(['--price-kmf=0'])).toThrow('ALLEGRO_GOLDEN_PROMOTION_PRICE_INVALID');
  expect(explicitPromotionPrice(['--price-kmf=12345'])).toBe(12345);
});

test('accepts only bounded deterministic Sandbox seed slots', () => {
  expect(runConfig(['--price-kmf=12345'])).toEqual({ priceKmf: 12345, seedSlot: 1 });
  expect(runConfig(['--price-kmf=12345', '--seed-slot=2'])).toEqual({ priceKmf: 12345, seedSlot: 2 });
  expect(() => runConfig(['--price-kmf=12345', '--seed-slot=0'])).toThrow('ALLEGRO_GOLDEN_SEED_SLOT_INVALID');
  expect(() => runConfig(['--price-kmf=12345', '--seed-slot=4'])).toThrow('ALLEGRO_GOLDEN_SEED_SLOT_INVALID');
});

test('candidate boundary requires exact Allegro unit identity', () => {
  expect(assertCandidateIdentity(candidate(), '123')).toMatchObject({ supplier_unit_ref: '123' });
  const broken = candidate();
  broken.normalized_source_contract.sellable_units[0].supplier_order_identity = null;
  expect(() => assertCandidateIdentity(broken, '123')).toThrow('ALLEGRO_GOLDEN_CANDIDATE_UNIT_NOT_EXACT_0');
});

test('prebuyer proof promotes exact candidate then reaches canonical HARD_STOP without placeOrder', async () => {
  const client = {
    ensureGoldenResponsibleProducer: jest.fn().mockResolvedValue({ id: 'producer-1' }),
    get: jest.fn().mockResolvedValue({ publication: { status: 'INACTIVE' } }),
    completeSeedOffer: jest.fn().mockResolvedValue({ offer_id: '123' }),
  };
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [candidate()] })
    .mockResolvedValueOnce({ rows: [{
      id: 77, supplier_unit_ref: '123', supplier_sku: 'allegro-sandbox:123', source: 'SUPPLIER', is_active: true,
      supplier_order_identity: soi,
    }] });
  const promoteCandidate = jest.fn().mockResolvedValue({ candidate_id: 'candidate-1', product_id: 'product-1' });

  const report = await run(['--price-kmf=12345'], {
    client,
    provePrerequisites: jest.fn().mockResolvedValue({ prerequisites, contract_proof: { stages: [{ id: 'P3', status: 'PASS' }] } }),
    seedOfferIds: jest.fn().mockResolvedValue(['123']),
    activateOfferIds: jest.fn().mockResolvedValue([{ offer_id: '123', publication_status: 'ACTIVE' }]),
    fetchProducts: jest.fn().mockResolvedValue({ products: [{}], invalid: [] }),
    importCatalog: jest.fn().mockResolvedValue({ status: 200, body: { accepted: 1, rejected: 0 } }),
    query,
    promoteCandidate,
    prepareCanonicalUnitPurchase: jest.fn().mockResolvedValue({
      status: 'HARD_STOP', provider: 'allegro', place_order_invoked: false,
      payload: { execution_mode: 'manual', offer_id: '123' },
    }),
  });

  expect(promoteCandidate).toHaveBeenCalledWith('candidate-1', { price_kmf: 12345, enrichment_mode: 'source_only' }, null);
  expect(report).toMatchObject({
    phase: 'PRE_BUYER', offer_id: '123', candidate_id: 'candidate-1', product_sku_id: 77,
    promotion_price_kmf: 12345,
    purchasing: { status: 'HARD_STOP', provider: 'allegro', place_order_invoked: false },
    buyer_purchase_required: true,
  });
});

test('rerun skips duplicate promotion when candidate is already promoted', async () => {
  const promoted = candidate();
  promoted.state = 'imported_to_catalog';
  promoted.product_id = 'product-1';
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [promoted] })
    .mockResolvedValueOnce({ rows: [{
      id: 77, supplier_unit_ref: '123', supplier_sku: 'allegro-sandbox:123', source: 'SUPPLIER', is_active: true,
      supplier_order_identity: soi,
    }] });
  const promoteCandidate = jest.fn();

  const report = await run(['--price-kmf=12345'], {
    client: {
      ensureGoldenResponsibleProducer: jest.fn().mockResolvedValue({ id: 'producer-1' }),
      get: jest.fn().mockResolvedValue({ publication: { status: 'ACTIVE' } }),
    },
    provePrerequisites: jest.fn().mockResolvedValue({ prerequisites, contract_proof: {} }),
    seedOfferIds: jest.fn().mockResolvedValue(['123']),
    activateOfferIds: jest.fn().mockResolvedValue([{ offer_id: '123', publication_status: 'ACTIVE' }]),
    fetchProducts: jest.fn().mockResolvedValue({ products: [{}], invalid: [] }),
    importCatalog: jest.fn().mockResolvedValue({ status: 200, body: { accepted: 1, rejected: 0 } }),
    query,
    promoteCandidate,
    prepareCanonicalUnitPurchase: jest.fn().mockResolvedValue({
      status: 'HARD_STOP', provider: 'allegro', place_order_invoked: false,
      payload: { execution_mode: 'manual', offer_id: '123' },
    }),
  });

  expect(promoteCandidate).not.toHaveBeenCalled();
  expect(report.promotion).toMatchObject({ skipped: true, reason: 'ALREADY_PROMOTED' });
});
