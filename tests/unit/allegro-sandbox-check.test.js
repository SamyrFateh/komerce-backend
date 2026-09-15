'use strict';
const {
  run, seedCount, createdOfferId, seedOfferIds,
} = require('../../scripts/allegro-sandbox-check');
const dispatch = require('../../services/sourcing-import-dispatch');
const connector = require('../../services/suppliers/connectors/allegro-connector');
const client = require('../../services/suppliers/allegro-sandbox-client');

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
  expect(api.createDraftOffer).toHaveBeenCalledTimes(3);
  expect(d.fetchProducts).toHaveBeenCalledWith({ productIds: ['101', '102', '103'] });
  expect(d.importCatalog).toHaveBeenCalledTimes(1);
});

test('seed reuses prior Komerce drafts and fails closed if the sandbox catalog is insufficient', async () => {
  const api = {
    seedConfiguration: jest.fn(),
    get: jest.fn().mockResolvedValue({
      offers: [
        { id: '201', name: 'Komerce Sandbox Seed 1 - A' },
        { id: 'x', name: 'Komerce Sandbox Seed malformed' },
        { id: '999', name: 'Unrelated' },
      ],
    }),
    searchProducts: jest.fn()
      .mockResolvedValueOnce({ products: [] })
      .mockResolvedValueOnce({ products: [{ id: 'p-2', name: 'Mouse' }] })
      .mockResolvedValueOnce({ products: [] }),
    createDraftOffer: jest.fn().mockResolvedValue({ id: '202' }),
  };
  await expect(seedOfferIds(3, api, {})).rejects.toThrow('SEED_INCOMPLETE');
  expect(api.createDraftOffer).toHaveBeenCalledTimes(1);

  api.get.mockResolvedValue({
    offers: [
      { id: '201', name: 'Komerce Sandbox Seed 1 - A' },
      { id: '202', name: 'Komerce Sandbox Seed 2 - B' },
      { id: '203', name: 'Komerce Sandbox Seed 3 - C' },
    ],
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
