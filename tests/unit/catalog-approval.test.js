'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/catalog-overrides', () => ({ upsertOverrides: jest.fn() }));
jest.mock('../../utils/rules', () => ({ getRuleNumber: jest.fn() }));

const { upsertOverrides } = require('../../services/catalog-overrides');
const { getRuleNumber } = require('../../utils/rules');
const approval = require('../../services/catalog-approval');

const PRODUCT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function candidateRow(over = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Batterie externe',
    description: 'Batterie externe compacte avec charge rapide pour appareils mobiles.',
    category: 'tech',
    price_kmf: 15000,
    stock: 10,
    is_active: false,
    is_available: true,
    lifecycle_status: 'candidate',
    content_source: 'ai_enriched',
    needs_review: false,
    ...over,
  };
}

function mockDb({ product, activeCount = 3, queueCount = 3, mediaCount = 1 } = {}) {
  const calls = [];
  const q = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
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
  getRuleNumber.mockReset();
  getRuleNumber.mockResolvedValue(120);
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

  it('200 pose les overrides puis publie dans le même geste', async () => {
    const { q, calls } = mockDb({ product: candidateRow(), activeCount: 40 });
    upsertOverrides.mockResolvedValue({ overridden: ['name'], product: candidateRow({ name: 'Nom corrigé' }) });
    const result = await approval.overrideAndApprove(q, PRODUCT_ID, { fields: { name: 'Nom corrigé' }, reason: 'traduction' }, { id: 'admin-1' });
    expect(result.status).toBe(200);
    expect(result.body.overridden).toEqual(['name']);
    expect(calls.find(c => c.sql.startsWith('UPDATE products')).sql).toContain('is_active = TRUE');
  });
});
