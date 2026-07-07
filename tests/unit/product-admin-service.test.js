'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../services/product-price-audit', () => ({ recordProductPriceChange: jest.fn() }));
jest.mock('../../services/product-publication-guard', () => ({
  auditProductStockChange: jest.fn(),
  validatePublicationUpdate: jest.fn(() => ({ ok: true })),
}));
// Le vrai catalog-overrides.js require('./catalog-enrichment') -> require('../db')
// -> connexion pg reelle instanciee a l'import. Mocke ici comme les autres
// dependances de service (meme pattern que product-publication-guard
// ci-dessus) pour garder ces tests unitaires hors DB.
jest.mock('../../services/catalog-overrides', () => ({
  OVERRIDABLE_FIELDS: ['name', 'description', 'category', 'fragility', 'emoji'],
  isPipelineSourced: jest.fn(() => false),
  upsertOverrides: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const { recordProductPriceChange } = require('../../services/product-price-audit');
const { auditProductStockChange, validatePublicationUpdate } = require('../../services/product-publication-guard');
const { isPipelineSourced, upsertOverrides } = require('../../services/catalog-overrides');
const svc = require('../../services/product-admin-service');

describe('product-admin-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('validateProductTaxonomyPayload accepte labsence de categorie', async () => {
    await expect(svc.validateProductTaxonomyPayload({ query: jest.fn() }, {})).resolves.toEqual({ ok: true });
  });

  it('validateProductTaxonomyPayload retourne 422 avec categories valides si categorie inconnue', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ key: 'food', label: 'Food' }] }) };

    await expect(svc.validateProductTaxonomyPayload(db, { category: 'bad' })).resolves.toEqual({
      ok: false,
      status: 422,
      body: { error: 'Catégorie invalide : "bad"', validCategories: [{ key: 'food', label: 'Food' }] },
    });
  });

  it('createProduct refuse les champs obligatoires manquants et les nombres negatifs', async () => {
    const db = { query: jest.fn() };

    await expect(svc.createProduct(db, { name: 'Riz' }, { id: 'admin' }))
      .resolves.toEqual({ status: 400, body: { error: 'Champs obligatoires manquants : name, category, price_kmf' } });
    await expect(svc.createProduct(db, { name: 'Riz', category: 'food', price_kmf: -1 }, { id: 'admin' }))
      .resolves.toEqual({ status: 400, body: { error: 'Le champ "price_kmf" doit être un nombre positif' } });
  });

  it('createProduct insere le produit et audite prix/stock', async () => {
    const product = { id: 'prod-001', name: 'Riz', category: 'food', price_kmf: 1000, stock: 5 };
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ key: 'food' }] })
      .mockResolvedValueOnce({ rows: [product] }) };

    await expect(svc.createProduct(db, { name: 'Riz', category: 'food', price_kmf: 1000, stock: 5 }, { id: 'admin' }))
      .resolves.toEqual({ status: 201, body: product });
    expect(recordProductPriceChange).toHaveBeenCalledWith(db, expect.objectContaining({ productId: 'prod-001', oldPriceKmf: 0, newPriceKmf: 1000 }));
    expect(auditProductStockChange).toHaveBeenCalledWith(db, expect.objectContaining({ productId: 'prod-001', oldStock: null, newStock: 5 }));
  });

  it('updateProduct retourne 404 si produit introuvable', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(svc.updateProduct(db, 'prod-404', { name: 'New' }, { id: 'admin' }))
      .resolves.toEqual({ status: 404, body: { error: 'Produit introuvable' } });
  });

  it('updateProduct audite changement prix et stock', async () => {
    const before = { id: 'prod-001', name: 'Old', category: 'food', subcategory: null, price_kmf: 1000, stock: 1, is_active: true, is_available: true };
    const updated = { ...before, price_kmf: 1500, stock: 3 };
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [updated] }) };

    await expect(svc.updateProduct(db, 'prod-001', { price_kmf: 1500, stock: 3 }, { id: 'admin' }))
      .resolves.toEqual({ status: 200, body: updated });
    expect(recordProductPriceChange).toHaveBeenCalledWith(db, expect.objectContaining({ oldPriceKmf: 1000, newPriceKmf: 1500 }));
    expect(auditProductStockChange).toHaveBeenCalledWith(db, expect.objectContaining({ oldStock: 1, newStock: 3 }));
  });

  it('updateProduct route les champs overridables vers catalog-overrides pour un produit issu du pipeline (§5)', async () => {
    const before = {
      id: 'prod-001', name: 'Old', category: 'food', subcategory: null,
      price_kmf: 1000, stock: 1, is_active: true, is_available: true,
      content_source: 'ai_enriched', lifecycle_status: 'active',
    };
    isPipelineSourced.mockReturnValueOnce(true);
    upsertOverrides.mockResolvedValueOnce({ overridden: ['name'], product: { ...before, name: 'Nom corrigé' } });
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [before] }) };

    const result = await svc.updateProduct(db, 'prod-001', { name: 'Nom corrigé' }, { id: 'admin' });

    expect(upsertOverrides).toHaveBeenCalledWith(
      db, 'prod-001', { name: 'Nom corrigé' }, { reason: null, setBy: 'admin' }
    );
    expect(result).toEqual({ status: 200, body: { ...before, name: 'Nom corrigé' } });
    // Un seul SELECT ("avant") — aucun UPDATE direct sur products puisque
    // tous les champs de la requête sont passés par l'override.
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('updateProduct refuse la publication directe d\'un candidat pipeline non approuvé (§6, code pending_approval)', async () => {
    const before = {
      id: 'prod-002', name: 'Nouveau', category: 'tech', subcategory: null,
      price_kmf: 5000, stock: 2, is_active: false, is_available: true,
      content_source: 'connector_raw', lifecycle_status: 'candidate',
    };
    isPipelineSourced.mockReturnValueOnce(true);
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [before] }) };

    await expect(svc.updateProduct(db, 'prod-002', { is_active: true }, { id: 'admin' }))
      .resolves.toEqual({
        status: 409,
        body: {
          error: 'Fiche candidate en attente d\'approbation — utilisez la file d\'approbation (approve/override), pas une édition directe.',
          code: 'pending_approval',
        },
      });
    expect(upsertOverrides).not.toHaveBeenCalled();
  });

  it('setMainImage et appendImages gerent 404 et ajout premiere image', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', images: null }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };

    await expect(svc.setMainImage(db, 'missing', 'img.jpg')).resolves.toEqual({ status: 404, body: { error: 'Produit introuvable ou inactif' } });
    await expect(svc.appendImages(db, 'prod-001', ['a.jpg', 'b.jpg'])).resolves.toEqual({
      status: 200,
      body: { product_name: 'Riz', images: ['a.jpg', 'b.jpg'], new_images: ['a.jpg', 'b.jpg'], total_count: 2 },
    });
    expect(db.query.mock.calls[2][1]).toEqual([JSON.stringify(['a.jpg', 'b.jpg']), 'a.jpg', 'prod-001']);
  });

  it('replaceVariants valide le payload avant transaction', async () => {
    await expect(svc.replaceVariants({ getClient: jest.fn() }, 'prod-001', null)).rejects.toMatchObject({ status: 400 });
    await expect(svc.replaceVariants({ getClient: jest.fn() }, 'prod-001', [{ type: '', value: 'M' }])).rejects.toMatchObject({ status: 400 });
    await expect(svc.replaceVariants({ getClient: jest.fn() }, 'prod-001', [{ type: 'Taille', value: 'M', stock: -1 }])).rejects.toMatchObject({ status: 400 });
  });

  it('replaceVariants remplace atomiquement les variantes et relit has_variants', async () => {
    const client = makeClient([
      { rows: [{ id: 'prod-001', name: 'Riz' }] },
      { rows: [], rowCount: 1 },
      { rows: [{ id: 'var-001', variant_type: 'Taille', variant_value: 'M' }] },
    ]);
    const dbPool = { getClient: jest.fn().mockResolvedValue(client), query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'prod-001', name: 'Riz', has_variants: true }] }) };

    const result = await svc.replaceVariants(dbPool, 'prod-001', [{ type: ' Taille ', value: ' M ', stock: 2, price_kmf: 1500 }]);

    expect(result).toMatchObject({ product_id: 'prod-001', has_variants: true, count: 1 });
    expect(client.calls[3].params).toEqual(['prod-001', 'Taille', 'M', null, 2, 1500, null, JSON.stringify([]), 0]);
    expectTransactionCommitted(client);
  });

  it('replaceVariants rollback si produit introuvable', async () => {
    const client = makeClient([{ rows: [] }]);
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    await expect(svc.replaceVariants(dbPool, 'missing', [{ type: 'Taille', value: 'M' }])).rejects.toMatchObject({ status: 404 });
    expectTransactionRolledBack(client);
  });

  it('deleteVariant refuse une variante referencee puis supprime sinon', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ cnt: '2' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'var-001', variant_type: 'Taille', variant_value: 'M' }] }) };

    await expect(svc.deleteVariant(db, 'prod-001', 'var-001')).resolves.toMatchObject({ status: 409 });
    await expect(svc.deleteVariant(db, 'prod-001', 'var-001')).resolves.toMatchObject({ status: 200, body: { deleted: { id: 'var-001', variant_type: 'Taille', variant_value: 'M' } } });
  });
});
