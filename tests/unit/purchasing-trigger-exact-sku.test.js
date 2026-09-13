'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/notification-service', () => ({ notifyText: jest.fn() }));
jest.mock('../../utils/alerts', () => ({ createAlert: jest.fn().mockResolvedValue({ id: 'alert-1' }) }));
jest.mock('../../utils/logger', () => {
  const mk = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { child: mk, forModule: mk, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

const db = require('../../db');
const { createAlert } = require('../../utils/alerts');
const { triggerPurchasing } = require('../../services/purchasing-trigger-service');

const ORDER = { id: 'order-1', reference: 'KOM-EXACT-1', relais_id: null, relais_name: null };
const IDENTITY = {
  provider: 'aliexpress',
  version: 1,
  payload: { product_id: '1005000000001', sku_attr: 'Black / M' },
};

function makeClient(handler) {
  const calls = [];
  const client = {
    calls,
    query: jest.fn(async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (
        normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK' ||
        /^SAVEPOINT /.test(normalized) || /^RELEASE SAVEPOINT/.test(normalized) ||
        /^ROLLBACK TO SAVEPOINT/.test(normalized)
      ) return { rows: [], rowCount: 0 };
      return handler(normalized, params);
    }),
    release: jest.fn(),
  };
  return client;
}

describe('purchasing exact SKU procurement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_PHONE;
  });

  it('LOCAL_STOCK ne déclenche aucune recherche fournisseur ni PO', async () => {
    const item = {
      id: 'oi-local', product_id: 'p1', product_name: 'Produit local', category: 'local',
      quantity: 1, sku_id: 'sku-local', fulfillment_source: 'LOCAL_STOCK', price_aed: 10,
    };
    db.query.mockResolvedValueOnce({ rows: [ORDER] }).mockResolvedValueOnce({ rows: [item] });
    const client = makeClient(sql => { throw new Error(`SQL inattendu: ${sql}`); });
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing(ORDER.id);

    expect(result.purchase_orders).toEqual([{
      item: 'Produit local', status: 'local_stock_no_purchase', purchase_order_id: null,
    }]);
    expect(client.calls.some(c => c.sql.includes('FROM product_suppliers'))).toBe(false);
    expect(client.calls.some(c => c.sql.includes('INSERT INTO purchase_orders'))).toBe(false);
  });

  it('IMPORT + sku_id snapshotte exactement la Supplier Order Identity vendue', async () => {
    const item = {
      id: 'oi-import', product_id: 'p1', product_name: 'T-shirt', category: 'mode',
      quantity: 2, sku_id: 'sku-black-m', fulfillment_source: 'IMPORT', price_aed: 50,
    };
    db.query.mockResolvedValueOnce({ rows: [ORDER] }).mockResolvedValueOnce({ rows: [item] });

    let insertParams = null;
    const client = makeClient((sql, params) => {
      if (sql.includes('FROM product_skus')) return { rows: [{
        id: 'sku-black-m', product_id: 'p1', supplier_sku: 'ALI-BLACK-M',
        supplier_unit_ref: 'UNIT-BLACK-M', supplier_order_identity: IDENTITY,
      }] };
      if (sql.includes('FROM product_suppliers')) return { rows: [{
        id: 'ps1', supplier_id: 'sup1', supplier_sku: 'GENERIC-PRODUCT-SKU',
        supplier_price_aed: 30, supplier_name: 'AliExpress', platform: 'aliexpress',
        auto_order: false, contact_phone: null, account_id: null, api_key_enc: null,
        api_secret_enc: null, lead_time_days: 5, supplier_url: null,
      }] };
      if (sql.startsWith('SELECT id, status FROM purchase_orders')) return { rows: [] };
      if (sql.includes('INSERT INTO purchase_orders')) {
        insertParams = params;
        return { rows: [{ id: 'po1' }] };
      }
      if (sql.startsWith('UPDATE purchase_orders')) return { rows: [] };
      throw new Error(`SQL inattendu: ${sql}`);
    });
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing(ORDER.id);

    expect(result.purchase_orders[0]).toMatchObject({ status: 'admin_notified', purchase_order_id: 'po1' });
    expect(client.calls.find(c => c.sql.includes('FROM product_suppliers')).sql).toContain('lower(s.platform) = lower($2)');
    expect(insertParams[0]).toBe(ORDER.id);
    expect(insertParams[1]).toBe('oi-import');
    expect(insertParams[4]).toBe('sku-black-m');
    expect(insertParams[5]).toBe('ALI-BLACK-M');
    expect(insertParams[6]).toBe('UNIT-BLACK-M');
    expect(JSON.parse(insertParams[7])).toEqual(IDENTITY);
    expect(insertParams[8]).toBe(2);
  });

  it('IMPORT + sku_id sans SOI bloque avant le mapping fournisseur', async () => {
    const item = {
      id: 'oi-bad', product_id: 'p1', product_name: 'T-shirt', category: 'mode',
      quantity: 1, sku_id: 'sku-no-soi', fulfillment_source: 'IMPORT', price_aed: 50,
    };
    db.query.mockResolvedValueOnce({ rows: [ORDER] }).mockResolvedValueOnce({ rows: [item] });

    const client = makeClient(sql => {
      if (sql.includes('FROM product_skus')) return { rows: [{
        id: 'sku-no-soi', product_id: 'p1', supplier_sku: 'ALI-NO-SOI',
        supplier_unit_ref: null, supplier_order_identity: null,
      }] };
      throw new Error(`SQL inattendu: ${sql}`);
    });
    db.getClient.mockResolvedValue(client);

    const result = await triggerPurchasing(ORDER.id);

    expect(result.purchase_orders[0].status).toBe('error');
    expect(result.purchase_orders[0].error).toContain('BLOCKED_SUPPLIER_IDENTITY');
    expect(client.calls.some(c => c.sql.includes('FROM product_suppliers'))).toBe(false);
    expect(createAlert).toHaveBeenCalledWith(client, expect.objectContaining({ type: 'purchasing_po_creation_failed' }));
  });
});
