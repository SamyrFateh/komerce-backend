'use strict';

const {
  BLOCKED_PRICE,
  READY,
  explicitPriceKmf,
  runP4,
} = require('../../scripts/allegro-golden-p4-proof');

const OFFER_ID = '7782182471';
const PRODUCT_ID = 91;
const SKU_ID = 501;

function p3() {
  return Promise.resolve({
    prerequisites: {
      shipping_capability: { provider_ref: 'c5a73d48-2eda-42ad-abe1-0b2cf405bf9f', bindable_to_standard_offer: true },
      return_policy_ref: 'd4a754cd-e508-4b6e-857a-241e30dd5d8d',
      implied_warranty_ref: '5c55a916-cabe-4028-a49b-01a1f31a3183',
    },
    contract_proof: { stages: [{ id: 'P3', status: 'PASS' }] },
  });
}

function golden() {
  return Promise.resolve({
    mode: 'golden',
    offer_ids: [OFFER_ID],
    activations: [{ offer_id: OFFER_ID, publication_status: 'ACTIVE' }],
    accepted: 1,
    invalid: [],
    imported: { status: 200, body: { accepted: 1, rejected: 0, import_id: 44 } },
    checks: [{
      ready: true,
      evidence: {
        manual_procurement_ready: true,
        auto_order_ready: false,
        place_order_invoked: false,
        payment_invoked: false,
      },
    }],
  });
}

function candidate(state = 'scanned', productId = null) {
  return { rows: [{
    id: 71,
    state,
    product_id: productId,
    supplier_name: 'Allegro Sandbox',
    supplier_product_id: OFFER_ID,
  }] };
}

function sku() {
  return { rows: [{
    id: SKU_ID,
    product_id: PRODUCT_ID,
    supplier_sku: `allegro-sandbox:${OFFER_ID}`,
    supplier_unit_ref: OFFER_ID,
    supplier_order_identity: {
      provider: 'allegro', version: 1,
      payload: { environment: 'sandbox', offer_id: OFFER_ID },
    },
    source: 'SUPPLIER',
    is_active: true,
  }] };
}

function hardStop() {
  return Promise.resolve({
    status: 'HARD_STOP',
    ready: false,
    provider: 'allegro',
    canonical_unit_id: 'unit-1',
    place_order_invoked: false,
    payload: {
      provider: 'allegro', environment: 'sandbox', execution_mode: 'manual',
      offer_id: OFFER_ID, quantity: 1, auto_order_ready: false, place_order_invoked: false,
    },
  });
}

test('catalog price is explicit input only', () => {
  expect(explicitPriceKmf([], {})).toBeNull();
  expect(explicitPriceKmf(['--price-kmf=12500'], {})).toBe(12500);
  expect(explicitPriceKmf([], { ALLEGRO_GOLDEN_PRICE_KMF: '12500' })).toBe(12500);
  expect(() => explicitPriceKmf(['--price-kmf=0'], {})).toThrow('ALLEGRO_GOLDEN_PRICE_KMF_INVALID');
});

test('P4 stops after ACTIVE + sourcing import when explicit catalog price is absent', async () => {
  const query = jest.fn().mockResolvedValue(candidate());
  const promoteCandidate = jest.fn();
  const preparePurchase = jest.fn();
  const out = await runP4([], {
    env: {}, client: {}, query,
    proveP3: p3,
    runSellerGolden: golden,
    promoteCandidate,
    preparePurchase,
    adapter: {},
  });

  expect(out).toMatchObject({
    status: BLOCKED_PRICE,
    p4_status: 'BLOCKED',
    blocker: 'EXPLICIT_CATALOG_PRICE_REQUIRED',
    offer_id: OFFER_ID,
    place_order_invoked: false,
    payment_invoked: false,
  });
  expect(promoteCandidate).not.toHaveBeenCalled();
  expect(preparePurchase).not.toHaveBeenCalled();
});

test('P4 reuses an exact already-promoted SKU/SOI and ends at Purchasing HARD_STOP', async () => {
  const query = jest.fn(async sql => {
    if (sql.includes('FROM sourcing_candidates')) return candidate('imported_to_catalog', PRODUCT_ID);
    if (sql.includes('FROM product_skus')) return sku();
    throw new Error('unexpected query');
  });
  const promoteCandidate = jest.fn();
  const preparePurchase = jest.fn().mockImplementation(hardStop);
  const out = await runP4([], {
    env: {}, client: {}, query,
    proveP3: p3,
    runSellerGolden: golden,
    promoteCandidate,
    preparePurchase,
    adapter: { provider: 'allegro' },
  });

  expect(out).toMatchObject({
    status: READY,
    p4_status: 'BLOCKED_MANUAL_BUYER_PURCHASE',
    offer_id: OFFER_ID,
    product_id: PRODUCT_ID,
    product_sku_id: SKU_ID,
    supplier_unit_ref: OFFER_ID,
    promotion_reused: true,
    place_order_invoked: false,
    payment_invoked: false,
  });
  expect(promoteCandidate).not.toHaveBeenCalled();
  expect(preparePurchase).toHaveBeenCalledWith(expect.objectContaining({
    productSkuId: SKU_ID,
    quantity: 1,
    adapters: expect.objectContaining({ allegro: expect.any(Object) }),
  }));
});

test('explicit catalog price promotes once, read-backs exact SKU/SOI, then hard-stops', async () => {
  let candidateReads = 0;
  const query = jest.fn(async sql => {
    if (sql.includes('FROM sourcing_candidates')) {
      candidateReads += 1;
      return candidate(candidateReads === 1 ? 'scanned' : 'imported_to_catalog', candidateReads === 1 ? null : PRODUCT_ID);
    }
    if (sql.includes('FROM product_skus')) return sku();
    throw new Error('unexpected query');
  });
  const promoteCandidate = jest.fn().mockResolvedValue({ product_id: PRODUCT_ID });
  const preparePurchase = jest.fn().mockImplementation(hardStop);

  const out = await runP4(['--price-kmf=12500'], {
    env: {}, client: {}, query,
    proveP3: p3,
    runSellerGolden: golden,
    promoteCandidate,
    preparePurchase,
    adapter: { provider: 'allegro' },
  });

  expect(promoteCandidate).toHaveBeenCalledWith(71, {
    price_kmf: 12500,
    enrichment_mode: 'source_only',
  }, null);
  expect(out).toMatchObject({
    status: READY,
    p4_status: 'BLOCKED_MANUAL_BUYER_PURCHASE',
    catalog_price_kmf: 12500,
    promotion_reused: false,
    supplier_order_identity: {
      provider: 'allegro', version: 1,
      payload: { environment: 'sandbox', offer_id: OFFER_ID },
    },
    next_required_proof: 'MANUAL_BUYER_SANDBOX_PURCHASE_AND_CHECKOUT_FORM_RECONCILIATION',
  });
});
