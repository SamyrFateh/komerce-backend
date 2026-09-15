'use strict';
const { run } = require('../../scripts/allegro-sandbox-check');
const dispatch = require('../../services/sourcing-import-dispatch');
const connector = require('../../services/suppliers/connectors/allegro-connector');
const client = require('../../services/suppliers/allegro-sandbox-client');
function deps() {
  return { fetchProducts: jest.fn().mockResolvedValue({ products: [{ sellable_units: [{ supplier_sku: 'allegro-sandbox:123', supplier_order_identity: {} }] }], invalid: [] }),
    evaluate: jest.fn().mockResolvedValue({ ready: false }), importCatalog: jest.fn().mockResolvedValue({ status: 200 }) };
}
test('default check reads without importing or claiming purchase, notification or invoice', async () => {
  const d = deps(); const report = await run(['123'], d);
  expect(report).toMatchObject({ mode: 'read', purchase_confirmed: false, notification_verified: false, invoice_verified: false });
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
  d.fetchProducts.mockResolvedValue({ products: [], invalid: [] });
  await expect(run(['--import', '123'], d)).rejects.toThrow('VALID_BATCH');
  d.fetchProducts.mockResolvedValue({ products: [], invalid: [{ errors: ['bad stock'] }] });
  await expect(run(['--import', '123'], d)).rejects.toThrow('VALID_BATCH');
  expect(d.importCatalog).not.toHaveBeenCalled();
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
