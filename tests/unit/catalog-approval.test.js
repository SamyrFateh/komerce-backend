'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/catalog-overrides', () => ({ upsertOverrides: jest.fn(), finalizeReviewedManualPreparation: jest.fn() }));
jest.mock('../../utils/rules', () => ({ getRuleNumber: jest.fn() }));
jest.mock('../../services/product-sku-service', () => ({
  activateProductSkuInventoryModel: jest.fn(),
}));

const { upsertOverrides, finalizeReviewedManualPreparation } = require('../../services/catalog-overrides');
const { getRuleNumber } = require('../../utils/rules');
const { activateProductSkuInventoryModel } = require('../../services/product-sku-service');
const approval = require('../../services/catalog-approval');

const PRODUCT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function candidateRow(over = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Batterie externe',
    description: 'Batterie externe compacte avec charge rapide pour appareils mobiles.',
    product_ref: 'KPR-TEST',
    category: 'tech',
    boutique_category_key: 'Tech',
    boutique_subcategory_key: 'Batteries',
    source_locale: 'fr',
    price_kmf: 15000,
    stock: 10,
    inventory_model: 'LEGACY_VARIANTS',
    has_variants: false,
    is_active: false,
    is_available: true,
    lifecycle_status: 'candidate',
    content_source: 'ai_enriched',
    needs_review: false,
    ...over,
  };
}

function mockDb({
  product,
  activeCount = 3,
  queueCount = 3,
  mediaCount = 1,
  sourceMapped = false,
  supplierSkuCount = 1,
  completeSupplierSkus = 1,
  enabledMarkets = 0,
  taxonomyActive = true,
} = {}) {
  const calls = [];
  const q = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('WITH media AS (')) {
        if (!product) return { rows: [] };
        return { rows: [{
          ...product,
          product_id: product.id,
          taxonomy_active: taxonomyActive,
          has_sourcing_candidate: sourceMapped,
          supplier_name: sourceMapped ? 'CJdropshipping' : null,
          supplier_product_id: sourceMapped ? 'CJ-1' : null,
          normalized_source_contract: sourceMapped ? { schema_version: '2' } : null,
          sourcing_decision: sourceMapped ? 'TEST' : 'UNKNOWN',
          active_media: mediaCount,
          supplier_skus: sourceMapped ? supplierSkuCount : 0,
          active_supplier_skus: sourceMapped ? supplierSkuCount : 0,
          complete_supplier_skus: sourceMapped ? completeSupplierSkus : 0,
          enabled_markets: enabledMarkets,
        }] };
      }
      if (sql.includes('SELECT * FROM products')) return { rows: product ? [product] : [] };
      if (sql.includes('FROM catalog_media')) return { rows: [{ count: mediaCount }] };
      if (sql.includes('COUNT(*)::int AS count') && sql.includes('FROM products') && sql.includes('is_active = TRUE')) {
        return { rows: [{ count: activeCount }] };
      }
      if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: queueCount }] };
      if (sql.includes('SELECT') && sql.includes('FROM products')) return { rows: product ? [product] : [] };
      if (sql.startsWith('UPDATE products')) return { rows: [{ ...product }] };
      if (sql.includes('INSERT INTO alerts')) return { rows: [] };
      throw new Error(`SQL non mocké: ${sql.slice(0, 80)}`);
    }),
  };
  return { q, calls };
}

beforeEach(() => {
  upsertOverrides.mockReset();
  finalizeReviewedManualPreparation.mockReset();
  getRuleNumber.mockReset();
  getRuleNumber.mockResolvedValue(120);
  finalizeReviewedManualPreparation.mockImplementation(async (_q, _productId) =>
    candidateRow({ needs_review: false, content_source: 'manual' })
  );
  activateProductSkuInventoryModel.mockReset();
  activateProductSkuInventoryModel.mockResolvedValue({ ready: true, inventory_model: 'SKU' });
});

describe('getApprovalQueue', () => {
  it('conserve les préparations manuelles dans la file candidate', async () => {
    const { q, calls } = mockDb({ product: candidateRow({ content_source: 'manual' }) });
    const result = await approval.getApprovalQueue(q, { limit: 10, offset: 0 });
    expect(calls[0].sql).toContain("lifecycle_status = 'candidate'");
    expect(calls[0].sql).toContain("content_source IN ('connector_raw', 'ai_enriched', 'manual')");
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
  });
});

describe('approveProduct', () => {
  it('404 si produit introuvable', async () => {
    const { q } = mockDb({ product: null });
    await expect(approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' }))
      .resolves.toMatchObject({ status: 404 });
  });

  it('409 si déjà décidé', async () => {
    const { q } = mockDb({ product: candidateRow({ is_active: true }) });
    await expect(approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' }))
      .resolves.toMatchObject({ status: 409, body: { code: 'not_pending' } });
  });

  it('422 sans description substantielle', async () => {
    const { q } = mockDb({ product: candidateRow({ description: '' }) });
    await expect(approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' }))
      .resolves.toMatchObject({ status: 422, body: { code: 'description_required' } });
  });

  it('422 sans média catalogue actif', async () => {
    const { q } = mockDb({ product: candidateRow(), mediaCount: 0 });
    await expect(approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' }))
      .resolves.toMatchObject({ status: 422, body: { code: 'media_required' } });
  });

  it('409 si CATALOG_CAP_MVP atteint', async () => {
    const { q, calls } = mockDb({ product: candidateRow(), activeCount: 120 });
    const result = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });
    expect(result).toMatchObject({ status: 409, body: { code: 'catalog_cap_reached', catalog_cap_mvp: 120, published_products: 120 } });
    expect(calls.find(c => c.sql.startsWith('UPDATE products'))).toBeUndefined();
  });

  it('422 si prix invalide', async () => {
    const { q } = mockDb({ product: candidateRow({ price_kmf: 0 }) });
    await expect(approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' }))
      .resolves.toMatchObject({ status: 422, body: { code: 'invalid_price' } });
  });

  it('une approbation humaine clôt une revue faible-confiance déjà préparée', async () => {
    const prepared = candidateRow({
      needs_review: true,
      content_source: 'ai_enriched',
      name_source: 'Power Bank',
      description_source: 'Portable power bank supplier description',
    });
    finalizeReviewedManualPreparation.mockImplementationOnce(async () => {
      prepared.needs_review = false;
      prepared.content_source = 'manual';
      return prepared;
    });
    const { q } = mockDb({ product: prepared, activeCount: 40 });

    const result = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });

    expect(finalizeReviewedManualPreparation).toHaveBeenCalledWith(q, PRODUCT_ID);
    expect(result.status).toBe(200);
  });

  it('une source fournisseur brute étrangère ne peut pas être validée sans préparation FR', async () => {
    const raw = candidateRow({
      content_source: 'connector_raw',
      source_locale: 'en',
      needs_review: true,
      name_source: 'Power Bank',
      description_source: 'Portable power bank supplier description',
    });
    const { q } = mockDb({ product: raw });

    const result = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });

    expect(finalizeReviewedManualPreparation).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 422, body: { code: 'enrichment_required' } });
  });

  it('422 si un produit fournisseur n’a pas une Supplier Order Identity complète', async () => {
    const { q } = mockDb({
      product: candidateRow(),
      sourceMapped: true,
      supplierSkuCount: 1,
      completeSupplierSkus: 0,
    });

    const result = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });

    expect(result).toMatchObject({
      status: 422,
      body: {
        code: 'catalog_certification_failed',
        reasons: expect.arrayContaining(['supplier_order_identity_incomplete']),
      },
    });
    expect(activateProductSkuInventoryModel).not.toHaveBeenCalled();
  });

  it('un produit fournisseur certifié bascule en SKU dans la même décision de publication', async () => {
    const { q, calls } = mockDb({
      product: candidateRow(),
      sourceMapped: true,
      supplierSkuCount: 1,
      completeSupplierSkus: 1,
      activeCount: 40,
    });

    const result = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });

    expect(result.status).toBe(200);
    expect(activateProductSkuInventoryModel).toHaveBeenCalledWith(q, PRODUCT_ID);
    expect(calls.find(call => call.sql.startsWith('UPDATE products'))).toBeDefined();
  });

  it('200 publie une fiche prête sous le cap', async () => {
    const { q, calls } = mockDb({ product: candidateRow(), activeCount: 40 });
    const result = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });
    expect(result.status).toBe(200);
    expect(getRuleNumber).toHaveBeenCalledWith('CATALOG_CAP_MVP', 120);
    const update = calls.find(c => c.sql.startsWith('UPDATE products'));
    expect(update.sql).toContain('is_active = TRUE');
    expect(update.sql).toContain('quality_validated = TRUE');
    expect(update.sql).toContain('needs_review = FALSE');
  });
});

describe('rejectProduct', () => {
  it('400 si raison absente', async () => {
    const { q } = mockDb({ product: candidateRow() });
    await expect(approval.rejectProduct(q, PRODUCT_ID, {}, { id: 'admin-1' }))
      .resolves.toMatchObject({ status: 400 });
  });

  it('200 trace le rejet sans publier', async () => {
    const { q, calls } = mockDb({ product: candidateRow() });
    const result = await approval.rejectProduct(q, PRODUCT_ID, { reason: 'photo non conforme' }, { id: 'admin-1' });
    expect(result.status).toBe(200);
    expect(calls.find(c => c.sql.startsWith('UPDATE products')).sql).toContain("lifecycle_status = 'rejected'");
    expect(calls.find(c => c.sql.includes('INSERT INTO alerts'))).toBeDefined();
  });
});

describe('overrideAndApprove', () => {
  it('400 si fields absent', async () => {
    const { q } = mockDb({ product: candidateRow() });
    await expect(approval.overrideAndApprove(q, PRODUCT_ID, {}, { id: 'admin-1' }))
      .resolves.toMatchObject({ status: 400 });
  });

  it('refuse avant override lorsque le cap est plein', async () => {
    const { q } = mockDb({ product: candidateRow(), activeCount: 120 });
    const result = await approval.overrideAndApprove(q, PRODUCT_ID, { fields: { name: 'Nom corrigé' } }, { id: 'admin-1' });
    expect(result).toMatchObject({ status: 409, body: { code: 'catalog_cap_reached' } });
    expect(upsertOverrides).not.toHaveBeenCalled();
  });

  it('422 pour un champ hors whitelist', async () => {
    const { q } = mockDb({ product: candidateRow() });
    upsertOverrides.mockRejectedValue(Object.assign(new Error('Champ non retouchable'), { code: 'OVERRIDE_FIELD_NOT_ALLOWED' }));
    const result = await approval.overrideAndApprove(q, PRODUCT_ID, { fields: { stock: '999' } }, { id: 'admin-1' });
    expect(result).toMatchObject({ status: 422, body: { code: 'OVERRIDE_FIELD_NOT_ALLOWED' } });
  });

  it('une correction humaine clôt une revue IA faible-confiance avant publication', async () => {
    const prepared = candidateRow({
      needs_review: true,
      content_source: 'ai_enriched',
      name_source: 'Power Bank',
      description_source: 'Portable power bank supplier description',
    });
    const { q } = mockDb({ product: prepared, activeCount: 40 });
    upsertOverrides.mockResolvedValue({
      overridden: ['name', 'description'],
      product: prepared,
    });
    finalizeReviewedManualPreparation.mockImplementationOnce(async () => {
      prepared.needs_review = false;
      prepared.content_source = 'manual';
      return prepared;
    });

    const result = await approval.overrideAndApprove(q, PRODUCT_ID, {
      fields: { name: 'Batterie externe', description: 'Batterie externe compacte et fiable pour téléphone.' },
      reason: 'relecture humaine',
    }, { id: 'admin-1' });

    expect(finalizeReviewedManualPreparation).toHaveBeenCalledWith(q, PRODUCT_ID);
    expect(result.status).toBe(200);
  });

  it('200 pose les overrides puis publie dans le même geste', async () => {
    const { q, calls } = mockDb({ product: candidateRow(), activeCount: 40 });
    upsertOverrides.mockResolvedValue({ overridden: ['name'], product: candidateRow({ name: 'Nom corrigé' }) });
    const result = await approval.overrideAndApprove(q, PRODUCT_ID, { fields: { name: 'Nom corrigé' }, reason: 'traduction' }, { id: 'admin-1' });
    expect(result.status).toBe(200);
    expect(result.body.overridden).toEqual(['name']);
    expect(calls.find(c => c.sql.startsWith('UPDATE products')).sql).toContain('is_active = TRUE');
  });
});
