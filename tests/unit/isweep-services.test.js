/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

describe('I-SWEEP service behavior', () => {
  describe('product publication guard', () => {
    const { validatePublicationUpdate } = require('../../services/product-publication-guard');

    test('rejects active/available product with invalid price', () => {
      const result = validatePublicationUpdate({
        before: { is_active: true, is_available: true, name: 'Produit', category: 'Maison', price_kmf: 0, stock: 1 },
        patch: { is_active: true, is_available: true },
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('invalid_price');
    });

    test('allows draft inactive product even with incomplete commercial fields', () => {
      const result = validatePublicationUpdate({
        before: { is_active: false, is_available: false, name: '', category: '', price_kmf: 0, stock: null },
        patch: { is_active: false, is_available: false },
      });
      expect(result.ok).toBe(true);
    });

    test('rejects negative stock on publication', () => {
      const result = validatePublicationUpdate({
        before: { is_active: true, is_available: true, name: 'Produit', category: 'Maison', price_kmf: 1000, stock: 1 },
        patch: { stock: -1 },
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('invalid_stock');
    });
  });

  describe('price audit helper', () => {
    test('skips unchanged prices without querying DB', async () => {
      jest.resetModules();
      const { recordProductPriceChange } = require('../../services/product-price-audit');
      const q = { query: jest.fn() };

      const result = await recordProductPriceChange(q, {
        productId: '00000000-0000-0000-0000-000000000001',
        oldPriceKmf: 1000,
        newPriceKmf: 1000,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('unchanged');
      expect(q.query).not.toHaveBeenCalled();
    });

    test('inserts price_history for changed prices', async () => {
      jest.resetModules();
      const { recordProductPriceChange } = require('../../services/product-price-audit');
      const q = { query: jest.fn().mockResolvedValue({ rows: [] }) };

      const result = await recordProductPriceChange(q, {
        productId: '00000000-0000-0000-0000-000000000001',
        oldPriceKmf: 1000,
        newPriceKmf: 1200,
        source: 'test',
        appliedBy: '00000000-0000-0000-0000-000000000002',
      });

      expect(result.inserted).toBe(true);
      expect(q.query).toHaveBeenCalledTimes(1);
      expect(q.query.mock.calls[0][0]).toContain('INSERT INTO price_history');
    });
  });

  describe('stock audit helper', () => {
    test('skips unchanged stock without querying DB', async () => {
      jest.resetModules();
      const { auditProductStockChange } = require('../../services/product-publication-guard');
      const q = { query: jest.fn() };

      const result = await auditProductStockChange(q, {
        productId: '00000000-0000-0000-0000-000000000001',
        oldStock: 5,
        newStock: 5,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('unchanged');
      expect(q.query).not.toHaveBeenCalled();
    });

    test('writes a product_stock_audit alert when stock changes', async () => {
      jest.resetModules();
      const { auditProductStockChange } = require('../../services/product-publication-guard');
      const q = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'alert-1' }] }) };

      const result = await auditProductStockChange(q, {
        productId: '00000000-0000-0000-0000-000000000001',
        oldStock: 5,
        newStock: 8,
        actor: '00000000-0000-0000-0000-000000000002',
      });

      expect(result.inserted).toBe(true);
      expect(q.query).toHaveBeenCalledTimes(3);
      expect(q.query.mock.calls[0][0]).toContain('SAVEPOINT');
      expect(q.query.mock.calls[1][0]).toContain('INSERT INTO alerts');
      expect(q.query.mock.calls[1][1][5]).toContain('delta=3');
      expect(q.query.mock.calls[2][0]).toContain('RELEASE SAVEPOINT');
    });
  });
});
