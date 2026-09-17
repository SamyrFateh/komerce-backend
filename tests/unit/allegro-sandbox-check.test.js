'use strict';
const {
  run, seedCount, createdOfferId, seedOfferIds, selectSellerSettings, prepareOfferIds, SEED_EXTERNAL_IDS,
} = require('../../scripts/allegro-sandbox-check');
const dispatch = require('../../services/sourcing-import-dispatch');
const connector = require('../../services/suppliers/connectors/allegro-connector');
const client = require('../../services/suppliers/allegro-sandbox-client');
const PRODUCER_ID = '44444444-4444-4444-8444-444444444444';

function deps() {
  return {
    fetchProducts: jest.fn().mockResolvedValue({
      products: [{ sellable_units: [{ supplier_sku: 'allegro-sandbox:123', supplier_order_identity: {} }] }],
      invalid: [],
    }),
    evaluate: jest.fn().mockResolvedValue({ ready: false }),
    importCatalog: jest.fn().mockResolvedValue({ status: 200 }),
  };
}

test('default check reads without importing or claiming purchase, notification or invoice', async () => {
  const d = deps(); const report = await run(['123'], d);
  expect(report).toMatchObject({
    mode: 'read', seeded: 0, offer_ids: ['123'],
    purchase_confirmed: false, notification_verified: false, invoice_verified: false,
  });
  expect(d.importCatalog).not.toHaveBeenCalled();
});

test('seller settings select a physical shipping rate and fail closed when any prerequisite is missing', () => {
  const selected = selectSellerSettings({
    shipping_rates: [{ id: 'electronic', type: 'ELECTRONIC' }, { id: 'physical', type: 'PHYSICAL' }],
    return_policies: [
      { id: 'fulfillment', is_fulfillment: true, availability_range: 'FULL', withdrawal_period: 'P14D' },
      { id: 'disabled', is_fulfillment: false, availability_range: 'DISABLED', withdrawal_period: null },
      { id: 'return', is_fulfillment: false, availability_range: 'FULL', withdrawal_period: 'P14D' },
    ],
    implied_warranties: [{ id: 'implied' }],
  });
  expect(selected).toEqual({
    shipping_rate_id: 'physical', return_policy_id: 'return', implied_warranty_id: 'implied',
  });
  expect(() => selectSellerSettings({
    shipping_rates: [{ id: 'physical', type: 'PHYSICAL' }],
    return_policies: [{ id: 'fulfillment', is_fulfillment: true, availability_range: 'FULL', withdrawal_period: 'P14D' }],
    implied_warranties: [{ id: 'implied' }],
  })).toThrow('SELLER_SETTINGS_MISSING_RETURN_POLICY');
  expect(() => selectSellerSettings({ shipping_rates: [], return_policies: [], implied_warranties: [] }))
    .toThrow('SELLER_SETTINGS_MISSING_SHIPPING_RATE_RETURN_POLICY_IMPLIED_WARRANTY');
});

test('seller preparation binds existing settings and skips already active offers', async () => {
  const api = {
    getSellerSettings: jest.fn().mockResolvedValue({
      shipping_rates: [{ id: 'ship', type: 'PHYSICAL' }],
      return_policies: [{ id: 'ret', is_fulfillment: false, availability_range: 'FULL', withdrawal_period: 'P14D' }],
      implied_warranties: [{ id: 'imp' }],
    }),
    get: jest.fn()
      .mockResolvedValueOnce({ publication: { status: 'INACTIVE' } })
      .mockResolvedValueOnce({ publication: { status: 'ACTIVE' } }),
    completeSeedOffer: jest.fn().mockResolvedValue({ offer_id: '123', delivery_bound: true }),
    ensureGoldenResponsibleProducer: jest.fn().mockResolvedValue({ id: PRODUCER_ID, created: false }),
  };
  const proof = await prepareOfferIds(['123', '456'], api);
  expect(api.completeSeedOffer).toHaveBeenCalledWith('123', {
    shippingRateId: 'ship', returnPolicyId: 'ret', impliedWarrantyId: 'imp', responsibleProducerId: PRODUCER_ID,
  });
  expect(api.completeSeedOffer).toHaveBeenCalledTimes(1);
  expect(proof.offers[1]).toEqual({ offer_id: '456', skipped: true, reason: 'ALREADY_ACTIVE' });
});

test('explicit activation waits for observed ACTIVE seller state before canonical reread', async () => {
  const d = deps();
  const api = {
    get: jest.fn()
      .mockResolvedValueOnce({ publication: { status: 'INACTIVE' } })
      .mockResolvedValueOnce({ publication: { status: 'ACTIVE' } }),
    activateOffer: jest.fn().mockResolvedValue({
      offer_id: '123', command_id: '123e4567-e89b-42d3-a456-426614174000',
    }),
    getPublicationTasks: jest.fn().mockResolvedValue({
      tasks: [{ offer: { id: '123' }, status: 'SUCCESS', errors: [] }],
    }),
  };
  const report = await run(['--activate', '123'], {
    ...d, client: api, activationPollMs: 0, sleepImpl: jest.fn(),
  });
  expect(report).toMatchObject({
    mode: 'activate', offer_ids: ['123'],
    activations: [{
      offer_id: '123', publication_status: 'ACTIVE', already_active: false,
      tasks: [{ offer_id: '123', status: 'SUCCESS', error_codes: [] }],
    }],
  });
  expect(api.activateOffer).toHaveBeenCalledWith('123');
  expect(api.getPublicationTasks).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174000');
  expect(d.fetchProducts).toHaveBeenCalledWith({ productIds: ['123'] });
});

test('one-command Golden reuses seed, prepares seller prerequisites, activates and imports', async () => {
  const d = deps();
  let detailReads = 0;
  const api = {
    seedConfiguration: jest.fn(),
    get: jest.fn(async (path, params) => {
      if (path === '/sale/offers') {
        return { offers: [{ id: '123', external: { id: params['external.id'] } }] };
      }
      if (path === '/sale/product-offers/123') {
        detailReads += 1;
        return { publication: { status: detailReads >= 3 ? 'ACTIVE' : 'INACTIVE' } };
      }
      throw new Error(`unexpected ${path}`);
    }),
    getSellerSettings: jest.fn().mockResolvedValue({
      shipping_rates: [{ id: '11111111-1111-4111-8111-111111111111', type: 'PHYSICAL' }],
      return_policies: [{
        id: '22222222-2222-4222-8222-222222222222',
        is_fulfillment: false, availability_range: 'FULL', withdrawal_period: 'P14D',
      }],
      implied_warranties: [{ id: '33333333-3333-4333-8333-333333333333' }],
    }),
    completeSeedOffer: jest.fn().mockResolvedValue({
      offer_id: '123', delivery_bound: true, return_policy_bound: true, implied_warranty_bound: true,
    }),
    ensureGoldenResponsibleProducer: jest.fn().mockResolvedValue({ id: PRODUCER_ID, created: false }),
    activateOffer: jest.fn().mockResolvedValue({
      offer_id: '123', command_id: '123e4567-e89b-42d3-a456-426614174000',
    }),
    getPublicationTasks: jest.fn().mockResolvedValue({
      tasks: [{ offer: { id: '123' }, status: 'SUCCESS', errors: [] }],
    }),
  };
  const env = { KOMERCE_ENV: 'staging', KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED: '1' };
  const report = await run(['--golden'], {
    ...d, client: api, env, activationPollMs: 0, sleepImpl: jest.fn(),
  });
  expect(report).toMatchObject({
    mode: 'golden', seeded: 1, offer_ids: ['123'], accepted: 1,
    preparation: { offers: [{ offer_id: '123', delivery_bound: true }] },
    activations: [{ offer_id: '123', publication_status: 'ACTIVE' }],
  });
  expect(api.completeSeedOffer).toHaveBeenCalledTimes(1);
  expect(api.activateOffer).toHaveBeenCalledTimes(1);
  expect(d.fetchProducts).toHaveBeenCalledWith({ productIds: ['123'] });
  expect(d.importCatalog).toHaveBeenCalledTimes(1);
});

test('Golden stops before activation and import when seller prerequisites are absent', async () => {
  const d = deps();
  const api = {
    seedConfiguration: jest.fn(),
    get: jest.fn().mockResolvedValue({ offers: [{ id: '123', external: { id: SEED_EXTERNAL_IDS[0] } }] }),
    getSellerSettings: jest.fn().mockResolvedValue({ shipping_rates: [], return_policies: [], implied_warranties: [] }),
    completeSeedOffer: jest.fn(),
    ensureGoldenResponsibleProducer: jest.fn(),
    activateOffer: jest.fn(),
  };
  await expect(run(['--golden'], { ...d, client: api, env: {} }))
    .rejects.toThrow('SELLER_SETTINGS_MISSING');
  expect(api.completeSeedOffer).not.toHaveBeenCalled();
  expect(api.activateOffer).not.toHaveBeenCalled();
  expect(d.fetchProducts).not.toHaveBeenCalled();
  expect(d.importCatalog).not.toHaveBeenCalled();
});

test('failed seller publication exposes only bounded provider codes and never free text', async () => {
  const d = deps();
  const api = {
    get: jest.fn()
      .mockResolvedValueOnce({ publication: { status: 'INACTIVE' } })
      .mockResolvedValueOnce({ publication: { status: 'INACTIVE' } }),
    activateOffer: jest.fn().mockResolvedValue({
      offer_id: '123', command_id: '123e4567-e89b-42d3-a456-426614174001',
    }),
    getPublicationTasks: jest.fn().mockResolvedValue({
      tasks: [{
        offer: { id: '123' }, status: 'FAIL',
        errors: [
          { code: 'VALIDATION_ERROR', message: 'seller secret should never leak' },
          { code: 'unsafe code with spaces', message: 'another secret' },
        ],
      }],
    }),
  };
  await expect(run(['--activate', '123'], {
    ...d, client: api, activationAttempts: 1, activationPollMs: 0, sleepImpl: jest.fn(),
  })).rejects.toThrow('ALLEGRO_SANDBOX_ACTIVATION_NOT_ACTIVE_123_INACTIVE_FAIL_VALIDATION_ERROR');
  expect(d.fetchProducts).not.toHaveBeenCalled();
});

test('explicit import uses refinery with fixed sandbox identity and bounded snapshot', async () => {
  const d = deps(); await run(['--import', '123'], d);
  const [body, actor, loader] = d.importCatalog.mock.calls[0];
  expect(body).toMatchObject({ supplier_id: 'allegro', supplier_name: 'Allegro Sandbox', is_full_snapshot: false });
  expect(actor).toBeNull(); expect((await loader()).products).toHaveLength(1);
});

test('bad arguments and invalid import batch cannot mutate catalog', async () => {
  const d = deps();
  await expect(run([], d)).rejects.toThrow('Usage');
  await expect(run(Array(101).fill('123'), d)).rejects.toThrow('Usage');
  await expect(run(['--execute'], d)).rejects.toThrow('OFFER_ID');
  await expect(run(['--golden', '123'], d)).rejects.toThrow('--golden');
  await expect(run(['--seed=1', '123'], { ...d, client: {} })).rejects.toThrow('mutuellement exclusifs');
  d.fetchProducts.mockResolvedValue({ products: [], invalid: [] });
  await expect(run(['--import', '123'], d)).rejects.toThrow('VALID_BATCH');
  d.fetchProducts.mockResolvedValue({ products: [], invalid: [{ errors: ['bad stock'] }] });
  await expect(run(['--import', '123'], d)).rejects.toThrow('VALID_BATCH');
  expect(d.importCatalog).not.toHaveBeenCalled();
});

test('bounded seed creates real seller drafts then passes their ids through the same read/import path', async () => {
  const d = deps();
  d.fetchProducts.mockImplementation(async ({ productIds }) => ({
    products: productIds.map(id => ({
      sellable_units: [{
        supplier_sku: `allegro-sandbox:${id}`,
        supplier_order_identity: { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: id } },
      }],
    })),
    invalid: [],
  }));
  const api = {
    seedConfiguration: jest.fn(),
    get: jest.fn().mockResolvedValue({ offers: [] }),
    searchProducts: jest
      .fn()
      .mockResolvedValueOnce({ products: [{ id: 'p-1', name: 'USB Cable' }] })
      .mockResolvedValueOnce({ products: [{ id: 'p-2', name: 'Wireless Mouse' }] })
      .mockResolvedValueOnce({ products: [{ id: 'p-3', name: 'LED Lamp' }] }),
    inspectProductPublishability: jest.fn().mockResolvedValue({ publishable: true }),
    ensureGoldenResponsibleProducer: jest.fn().mockResolvedValue({ id: PRODUCER_ID, created: false }),
    createDraftOffer: jest
      .fn()
      .mockResolvedValueOnce({ id: '101' })
      .mockResolvedValueOnce({ offer: { id: '102' } })
      .mockResolvedValueOnce({ id: 103 }),
  };
  const env = { KOMERCE_ENV: 'staging', KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED: '1' };
  const report = await run(['--seed=3', '--import'], { ...d, client: api, env });
  expect(report).toMatchObject({ seeded: 3, offer_ids: ['101', '102', '103'], accepted: 3 });
  expect(api.seedConfiguration).toHaveBeenCalledWith(env);
  expect(api.get).toHaveBeenCalledTimes(3);
  expect(api.createDraftOffer).toHaveBeenCalledTimes(3);
  expect(api.searchProducts).toHaveBeenCalledTimes(3);
  expect(api.searchProducts).toHaveBeenCalledWith(expect.any(String), { limit: 5 });
  expect(api.inspectProductPublishability).toHaveBeenCalledTimes(3);
  expect(api.createDraftOffer).toHaveBeenCalledWith(expect.objectContaining({ responsibleProducerId: PRODUCER_ID }));
  expect(api.createDraftOffer.mock.calls.map(([arg]) => arg.externalId)).toEqual(SEED_EXTERNAL_IDS);
  expect(d.fetchProducts).toHaveBeenCalledWith({ productIds: ['101', '102', '103'] });
  expect(d.importCatalog).toHaveBeenCalledTimes(1);
});

test('seed reuses exact external ids and fails closed if sandbox catalog is insufficient', async () => {
  const api = {
    seedConfiguration: jest.fn(),
    get: jest.fn(async (_path, params) => {
      if (params['external.id'] === SEED_EXTERNAL_IDS[0]) {
        return { offers: [{ id: '201', external: { id: SEED_EXTERNAL_IDS[0] } }] };
      }
      return { offers: [] };
    }),
    searchProducts: jest.fn()
      .mockResolvedValueOnce({ products: [{ id: 'p-2', name: 'Mouse' }] })
      .mockResolvedValueOnce({ products: [] }),
    inspectProductPublishability: jest.fn().mockResolvedValue({ publishable: true }),
    ensureGoldenResponsibleProducer: jest.fn().mockResolvedValue({ id: PRODUCER_ID, created: false }),
    createDraftOffer: jest.fn().mockResolvedValue({ id: '202' }),
  };
  await expect(seedOfferIds(3, api, {})).rejects.toThrow('SEED_INCOMPLETE');
  expect(api.createDraftOffer).not.toHaveBeenCalled();

  api.get.mockImplementation(async (_path, params) => {
    const index = SEED_EXTERNAL_IDS.indexOf(params['external.id']);
    return index < 0 ? { offers: [] } : {
      offers: [{ id: String(201 + index), external: { id: SEED_EXTERNAL_IDS[index] } }],
    };
  });
  api.searchProducts.mockClear(); api.createDraftOffer.mockClear();
  await expect(seedOfferIds(3, api, {})).resolves.toEqual(['201', '202', '203']);
  expect(api.searchProducts).not.toHaveBeenCalled();
  expect(api.createDraftOffer).not.toHaveBeenCalled();
});

test('seed parser and provider offer id are strict', () => {
  expect(seedCount([])).toBe(0);
  expect(seedCount(['--seed=2'])).toBe(2);
  expect(() => seedCount(['--seed=0'])).toThrow('--seed');
  expect(createdOfferId({ id: 123 })).toBe('123');
  expect(createdOfferId({ offer: { id: '456' } })).toBe('456');
  expect(() => createdOfferId({ id: 'abc' })).toThrow('OFFER_ID_MISSING');
});

test('sourcing dispatch exposes runtime availability and refuses full-snapshot archival', async () => {
  const config = jest.spyOn(client, 'configuration').mockImplementation(() => { throw new Error('disabled'); });
  expect(dispatch.connectorCatalog().api_suppliers.find(c => c.supplier === 'allegro')).toMatchObject({ active: false, reason: 'disabled' });
  await expect(dispatch.dispatchToConnector({ source_type: 'api', supplier_id: 'allegro' })).rejects.toThrow('disabled');
  config.mockReturnValue({});
  expect(dispatch.connectorCatalog().api_suppliers.find(c => c.supplier === 'allegro')).toMatchObject({ active: true });
  await expect(dispatch.dispatchToConnector({ source_type: 'api', supplier_id: 'allegro', is_full_snapshot: true })).rejects.toThrow('full snapshot');
  const fetched = jest.spyOn(connector, 'fetchProducts').mockResolvedValue({ products: [] });
  await dispatch.dispatchToConnector({ source_type: 'api', supplier_id: 'allegro', product_ids: ['123'] });
  expect(fetched).toHaveBeenCalledWith(expect.objectContaining({ productIds: ['123'] }));
  fetched.mockRestore(); config.mockRestore();
});
