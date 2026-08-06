'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const { auditProductStockChange, validatePublicationUpdate } = require('../../services/product-publication-guard');

describe('product-publication-guard', () => {
  it('validatePublicationUpdate laisse passer si le produit reste non publie', () => {
    expect(validatePublicationUpdate({ before: { is_active: false, is_available: false }, patch: {} })).toEqual({ ok: true });
  });

  it('validatePublicationUpdate bloque publication sans nom, categorie, prix ou stock valide', () => {
    const base = { name: 'Riz', category: 'food', price_kmf: 1000, stock: 1, is_active: false, is_available: false };

    expect(validatePublicationUpdate({ before: base, patch: { is_active: true, name: '' } })).toMatchObject({ ok: false, code: 'missing_name' });
    expect(validatePublicationUpdate({ before: base, patch: { is_active: true, category: '' } })).toMatchObject({ ok: false, code: 'missing_category' });
    expect(validatePublicationUpdate({ before: base, patch: { is_active: true, price_kmf: 0 } })).toMatchObject({ ok: false, code: 'invalid_price' });
    expect(validatePublicationUpdate({ before: base, patch: { is_active: true, stock: -1 } })).toMatchObject({ ok: false, code: 'invalid_stock' });
  });

  it('validatePublicationUpdate accepte publication avec stock null et prix strictement positif', () => {
    expect(validatePublicationUpdate({
      before: { name: 'Riz', category: 'food', price_kmf: 1000, stock: null, is_active: false, is_available: false },
      patch: { is_available: true },
    })).toEqual({ ok: true });
  });

  it('auditProductStockChange skip missing id et stock inchange', async () => {
    const q = { query: jest.fn() };

    await expect(auditProductStockChange(q, { oldStock: 1, newStock: 2 })).resolves.toEqual({ skipped: true, reason: 'missing_product_id' });
    await expect(auditProductStockChange(q, { productId: 'prod-001', oldStock: 1, newStock: 1 })).resolves.toEqual({ skipped: true, reason: 'unchanged' });
    expect(q.query).not.toHaveBeenCalled();
  });

  it('auditProductStockChange insere une alerte avec delta', async () => {
    const q = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })     // SAVEPOINT product_stock_audit
      .mockResolvedValueOnce({ rows: [{ id: 'alert-1' }] }) // INSERT alerts (createAlert)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }),    // RELEASE SAVEPOINT product_stock_audit
    };

    await expect(auditProductStockChange(q, { productId: 'prod-001', oldStock: 1, newStock: 4, actor: 'admin', source: 'test', note: 'ok' }))
      .resolves.toEqual({ inserted: true, alert_id: 'alert-1' });
    expect(q.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO alerts'),
      expect.arrayContaining(['product_stock_audit', 'product', 'prod-001', 'low'])
    );
  });

  it('auditProductStockChange ne bloque pas si alert insert echoue', async () => {
    const q = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // SAVEPOINT product_stock_audit
      .mockRejectedValueOnce(new Error('alerts_down'))   // INSERT alerts (createAlert) échoue
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }), // ROLLBACK TO SAVEPOINT product_stock_audit
    };

    await expect(auditProductStockChange(q, { productId: 'prod-001', oldStock: 1, newStock: 4 }))
      .resolves.toEqual({ skipped: true, reason: 'alerts_down' });
  });
});
