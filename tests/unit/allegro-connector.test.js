'use strict';
jest.mock('../../db', () => ({ query: jest.fn() }));
const connector = require('../../services/suppliers/connectors/allegro-connector');
const { validateNormalizedProduct, buildNormalizedSourceContractSnapshot } = require('../../services/suppliers/normalized-product');
const { resolveSupplierUnit } = require('../../services/suppliers/supplier-order-identity');
const { planSkuReconciliation } = require('../../services/catalog-promotion/sku');
const scanner = require('../../services/supplier-catalog-scanner');
function offer(id = '123') {
  return { id, name: 'Sandbox test product', category: { id: '456' }, productSet: [{ product: { id: 'UUID-not-an-offer' }, quantity: { value: 1 } }],
    sellingMode: { format: 'BUY_NOW', price: { amount: '19.99', currency: 'PLN' } },
    stock: { available: 3 }, publication: { status: 'ACTIVE' }, images: ['https://a.allegroimg.com/original/test.jpg'] };
}
test('native PLN, exact offer identity and raw facts survive V2 -> snapshot -> SKU plan', () => {
  const raw = offer(); const product = connector.normalizeOffer(raw, '123');
  expect(validateNormalizedProduct(product)).toEqual({ valid: true, errors: [] });
  expect(product.raw_payload.allegro.offer).toBe(raw);
  const snapshot = buildNormalizedSourceContractSnapshot(product);
  const unit = resolveSupplierUnit(snapshot, 'allegro-sandbox:123', 2);
  expect(unit).toMatchObject({ supplier_unit_ref: '123', currency: 'PLN', unit_price: 19.99 });
  expect(unit.supplier_order_identity.payload).toEqual({ environment: 'sandbox', offer_id: '123' });
  expect(JSON.stringify(planSkuReconciliation([], snapshot.sellable_units))).toContain('allegro-sandbox:123');
  expect(scanner.convertToKMF(19.99, 'PLN', { taux_pln_kmf: 115 })).toBe(2299);
  for (const rate of [null, 0, -1, 'bad', Infinity]) expect(() => scanner.convertToKMF(19.99, 'PLN', { taux_pln_kmf: rate })).toThrow('PLN_FX_RATE_REQUIRED');
});
test.each([
  ['id', 'UUID'], ['id', 123], ['id', '124'], ['productSet', []],
  ['productSet', [{ quantity: { value: 2 } }]], ['productSet', [{}]],
  ['sellingMode', { format: 'AUCTION' }], ['sellingMode', { format: 'BUY_NOW', price: { amount: '19 PLN', currency: 'PLN' } }],
  ['sellingMode', { format: 'BUY_NOW', price: { amount: '0', currency: 'PLN' } }],
  ['sellingMode', { format: 'BUY_NOW', price: { amount: '19.99', currency: 'EUR' } }],
  ['stock', { available: '3' }], ['stock', { available: -1 }], ['stock', null], ['publication', null],
])('rejects malformed provider facts %s %j', (field, value) => {
  expect(() => connector.normalizeOffer({ ...offer(), [field]: value }, '123')).toThrow();
});
test('no product UUID fallback or invented images/category; ended offer inactive', () => {
  expect(() => connector.normalizeOffer(null, '123')).toThrow('OFFER_ID');
  const raw = offer(); delete raw.category; delete raw.images; raw.publication.status = 'ENDED';
  const product = connector.normalizeOffer(raw, '123');
  expect(product.media).toEqual([]); expect(product.supplier_category).toBeNull();
  expect(product.sellable_units[0].is_active).toBe(false);
});
test('bounded seller list and exact detail calls, rejects invalid products with reasons', async () => {
  const client = { get: jest.fn().mockResolvedValueOnce({ offers: [{ id: '123' }, { id: '456' }] })
    .mockResolvedValueOnce(offer()).mockResolvedValueOnce({ ...offer('456'), stock: null }) };
  const result = await connector.fetchProducts({ client, page: 2, size: 2, keyword: 'test' });
  expect(client.get.mock.calls[0]).toEqual(['/sale/offers', { limit: 2, offset: 2, 'publication.status': 'ACTIVE', name: 'test' }]);
  expect(result.products).toHaveLength(1); expect(result.invalid).toHaveLength(1); expect(result.total).toBe(2);
});
test('explicit IDs deduplicate, schema rejection is reported, HTTP failure aborts batch', async () => {
  const client = { get: jest.fn().mockResolvedValue({ ...offer(), name: '' }) };
  const r = await connector.fetchProducts({ client, productIds: ['123', '123'] });
  expect(r.invalid).toHaveLength(1); expect(client.get).toHaveBeenCalledTimes(1);
  client.get.mockRejectedValueOnce(new Error('ALLEGRO_HTTP_403'));
  await expect(connector.fetchProducts({ client, productIds: ['123'] })).rejects.toThrow('403');
});
test.each([[], '123', Array(101).fill('123'), ['UUID']])('bad ID batches refused: %j', async productIds => {
  await expect(connector.fetchProducts({ productIds })).rejects.toThrow();
});
test.each([{ size: 0 }, { page: 0 }, { size: 101 }, { page: 10000 }, { page: 1.2 }])('bad page refused: %j', async options => {
  await expect(connector.fetchProducts(options)).rejects.toThrow('INVALID_PAGE');
});
test('default pagination, malformed list, empty list and dynamic runtime availability', async () => {
  const clientModule = require('../../services/suppliers/allegro-sandbox-client');
  const spy = jest.spyOn(clientModule, 'get').mockResolvedValue({ offers: [] });
  expect((await connector.fetchProducts()).total).toBe(0);
  expect(spy).toHaveBeenCalledWith('/sale/offers', { limit: 30, offset: 0, 'publication.status': 'ACTIVE' });
  spy.mockResolvedValueOnce({}); await expect(connector.fetchProducts()).rejects.toThrow('INVALID_OFFER_LIST');
  spy.mockResolvedValueOnce({ offers: [{ id: '1' }, { id: '2' }] });
  await expect(connector.fetchProducts({ size: 1 })).rejects.toThrow('INVALID_OFFER_LIST');
  const configured = jest.spyOn(clientModule, 'configuration').mockImplementation(() => { throw new Error('disabled'); });
  expect(connector.IS_ACTIVE).toBe(false); expect(connector.INACTIVE_REASON).toBe('disabled');
  configured.mockReturnValue({}); expect(connector.IS_ACTIVE).toBe(true); expect(connector.INACTIVE_REASON).toBeNull();
  spy.mockRestore(); configured.mockRestore();
});
