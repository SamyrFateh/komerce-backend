'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const {
  CLIENT_TITLE_MAX_LENGTH,
  auditProductStockChange,
  validatePublicationUpdate,
} = require('../../services/product-publication-guard');

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

  it('refuse une source étrangère brute à la première activation', () => {
    const before = {
      name: 'Gift box product',
      category: 'Créations personnelles',
      price_kmf: 15000,
      stock: 4,
      is_active: false,
      is_available: false,
      content_source: 'connector_raw',
      source_locale: 'en',
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true } }))
      .toMatchObject({ ok: false, code: 'enrichment_required' });
  });

  it('accepte la même source après enrichissement français', () => {
    const before = {
      name: 'Coffret cadeau artistique',
      category: 'Créations personnelles',
      price_kmf: 15000,
      stock: 4,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true } })).toEqual({ ok: true });
  });

  it('refuse un titre client trop long ou ressemblant à des métadonnées source', () => {
    const base = {
      category: 'Créations personnelles',
      price_kmf: 15000,
      stock: 4,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
    };
    expect(validatePublicationUpdate({
      before: { ...base, name: 'x'.repeat(CLIENT_TITLE_MAX_LENGTH + 1) },
      patch: { is_active: true },
    })).toMatchObject({ ok: false, code: 'title_too_long' });

    expect(validatePublicationUpdate({
      before: { ...base, name: 'HK LCSD HKHM SS2 coffret cadeau' },
      patch: { is_active: true },
    })).toMatchObject({ ok: false, code: 'title_source_noise' });

    expect(validatePublicationUpdate({
      before: { ...base, name: 'File:gift-box.jpg' },
      patch: { is_active: true },
    })).toMatchObject({ ok: false, code: 'title_source_noise' });
  });

  it('ne réapplique pas les invariants de première activation aux mises à jour d’un produit déjà actif', () => {
    const before = {
      name: 'Titre historique extrêmement long qui reste toléré pendant une simple mise à jour de stock du produit déjà publié',
      category: 'Maison',
      price_kmf: 10000,
      stock: 2,
      is_active: true,
      is_available: true,
      content_source: 'connector_raw',
      source_locale: 'en',
    };
    expect(validatePublicationUpdate({ before, patch: { stock: 3 } })).toEqual({ ok: true });
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
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'alert-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
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
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(new Error('alerts_down'))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    await expect(auditProductStockChange(q, { productId: 'prod-001', oldStock: 1, newStock: 4 }))
      .resolves.toEqual({ skipped: true, reason: 'alerts_down' });
  });
});
