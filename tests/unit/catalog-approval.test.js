'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — K-4 file de curation / approbation catalogue.
 *
 * Verrouille :
 * - source native/IA/manuelle visible dans la file ;
 * - première publication humaine ;
 * - garde de sanité ;
 * - cap CATALOG_CAP_MVP appliqué avant activation ;
 * - reject tracé ;
 * - override + publication atomique au niveau métier.
 */

jest.mock('../../services/catalog-overrides', () => ({
  upsertOverrides: jest.fn(),
}));

jest.mock('../../utils/rules', () => ({
  getRuleNumber: jest.fn(),
}));

const { upsertOverrides } = require('../../services/catalog-overrides');
const { getRuleNumber } = require('../../utils/rules');
const approval = require('../../services/catalog-approval');

const PRODUCT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function candidateRow(over = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Batterie externe',
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

function mockDb({ product, activeCount = 3, queueCount = 3 } = {}) {
  const calls = [];
  const q = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT * FROM products')) return { rows: product ? [product] : [] };
      if (sql.includes('COUNT(*)::int AS count') && sql.includes('is_active = TRUE')) {
        return { rows: [{ count: activeCount }] };
      }
      if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: queueCount }] };
      if (sql.includes('SELECT') && sql.includes('FROM products')) return { rows: product ? [product] : [] };
      if (sql.startsWith('UPDATE products')) return { rows: [{ ...product, ...paramsToPatch(sql, params) }] };
      if (sql.includes('INSERT INTO alerts')) return { rows: [] };
      throw new Error(`SQL non mocké: ${sql.slice(0, 80)}`);
    }),
  };
  return { q, calls };
}

function paramsToPatch() { return {}; }

beforeEach(() => {
  upsertOverrides.mockReset();
  getRuleNumber.mockReset();
  getRuleNumber.mockResolvedValue(120);
});

describe('getApprovalQueue', () => {
  it('filtre sur candidate/inactif et inclut les préparations manuelles', async () => {
    const { q, calls } = mockDb({ product: candidateRow({ content_source: 'manual' }) });
    const result = await approval.getApprovalQueue(q, { limit: 10, offset: 0 });
    expect(calls[0].sql).toContain("lifecycle_status = 'candidate'");
    expect(calls[0].sql).toContain('is_active = FALSE');
    expect(calls[0].sql).toContain("content_source IN ('connector_raw', 'ai_enriched', 'manual')");
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(approval.PENDING_SOURCES).toContain('manual');
  });
});

describe('approveProduct', () => {
  it('404 si produit introuvable', async () => {
    const { q } = mockDb({ product: null });
    const { status } = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });
    expect(status).toBe(404);
  });

  it('409 si déjà décidé (plus candidate ou déjà actif)', async () => {
    const { q } = mockDb({ product: candidateRow({ is_active: true }) });
    const { status, body } = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });
    expect(status).toBe(409);
    expect(body.code).toBe('not_pending');
  });

  it('409 si la sélection a atteint CATALOG_CAP_MVP', async () => {
    const { q, calls } = mockDb({ product: candidateRow(), activeCount: 120 });
    const { status, body } = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });
    expect(status).toBe(409);
    expect(body.code).toBe('catalog_cap_reached');
    expect(body.catalog_cap_mvp).toBe(120);
    expect(body.published_products).toBe(120);
    expect(calls.find(c => c.sql.startsWith('UPDATE products'))).toBeUndefined();
  });

  it('422 si la fiche ne passe pas la garde de sanité (prix invalide)', async () => {
    const { q } = mockDb({ product: candidateRow({ price_kmf: 0 }) });
    const { status, body } = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });
    expect(status).toBe(422);
    expect(body.code).toBe('invalid_price');
  });

  it('200 : publie et valide la référence sous le cap', async () => {
    const { q, calls } = mockDb({ product: candidateRow(), activeCount: 40 });
    const { status } = await approval.approveProduct(q, PRODUCT_ID, { id: 'admin-1' });
    expect(status).toBe(200);
    expect(getRuleNumber).toHaveBeenCalledWith('CATALOG_CAP_MVP', 120);
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE products'));
    expect(updateCall.sql).toContain('is_active = TRUE');
    expect(updateCall.sql).toContain('quality_validated = TRUE');
    expect(updateCall.sql).toContain('needs_review = FALSE');
    expect(updateCall.sql).toContain("lifecycle_status = 'candidate'");
  });
});

describe('rejectProduct', () => {
  it('400 si raison absente', async () => {
    const { q } = mockDb({ product: candidateRow() });
    const { status } = await approval.rejectProduct(q, PRODUCT_ID, {}, { id: 'admin-1' });
    expect(status).toBe(400);
  });

  it('200 : ne publie jamais, trace la raison dans alerts, sort de la file', async () => {
    const { q, calls } = mockDb({ product: candidateRow() });
    const { status } = await approval.rejectProduct(
      q, PRODUCT_ID, { reason: 'photo non conforme' }, { id: 'admin-1' }
    );
    expect(status).toBe(200);
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE products'));
    expect(updateCall.sql).toContain('is_active = FALSE');
    expect(updateCall.sql).toContain("lifecycle_status = 'rejected'");
    const alertCall = calls.find(c => c.sql.includes('INSERT INTO alerts'));
    expect(alertCall).toBeDefined();
    expect(alertCall.sql).toContain('type, entity_type, entity_id, severity, title, description');
    expect(alertCall.params[0]).toBe('catalog_approval_reject');
    expect(alertCall.params[1]).toBe('product');
    expect(alertCall.params[2]).toBe(PRODUCT_ID);
    expect(alertCall.params[3]).toBe('low');
    expect(alertCall.params[4]).toContain('photo non conforme');
    expect(alertCall.params[5]).toContain('photo non conforme');
  });
});

describe('overrideAndApprove', () => {
  it('400 si fields absent/vide', async () => {
    const { q } = mockDb({ product: candidateRow() });
    const { status } = await approval.overrideAndApprove(q, PRODUCT_ID, {}, { id: 'admin-1' });
    expect(status).toBe(400);
    expect(upsertOverrides).not.toHaveBeenCalled();
  });

  it('refuse avant override lorsque le cap est plein', async () => {
    const { q } = mockDb({ product: candidateRow(), activeCount: 120 });
    const { status, body } = await approval.overrideAndApprove(
      q, PRODUCT_ID, { fields: { name: 'Nom corrigé' } }, { id: 'admin-1' }
    );
    expect(status).toBe(409);
    expect(body.code).toBe('catalog_cap_reached');
    expect(upsertOverrides).not.toHaveBeenCalled();
  });

  it('422 si un champ hors whitelist (délégué à catalog-overrides.js)', async () => {
    const { q } = mockDb({ product: candidateRow() });
    const err = Object.assign(new Error('Champ non retouchable'), { code: 'OVERRIDE_FIELD_NOT_ALLOWED' });
    upsertOverrides.mockRejectedValue(err);
    const { status, body } = await approval.overrideAndApprove(
      q, PRODUCT_ID, { fields: { stock: '999' } }, { id: 'admin-1' }
    );
    expect(status).toBe(422);
    expect(body.code).toBe('OVERRIDE_FIELD_NOT_ALLOWED');
  });

  it('200 : pose les overrides puis publie dans le même geste', async () => {
    const { q, calls } = mockDb({ product: candidateRow(), activeCount: 40 });
    upsertOverrides.mockResolvedValue({
      overridden: ['name'],
      product: candidateRow({ name: 'Nom corrigé' }),
    });
    const { status, body } = await approval.overrideAndApprove(
      q, PRODUCT_ID, { fields: { name: 'Nom corrigé' }, reason: 'traduction' }, { id: 'admin-1' }
    );
    expect(status).toBe(200);
    expect(upsertOverrides).toHaveBeenCalledWith(
      q, PRODUCT_ID, { name: 'Nom corrigé' }, { reason: 'traduction', setBy: 'admin-1' }
    );
    expect(body.overridden).toEqual(['name']);
    const updateCall = calls.find(c => c.sql.startsWith('UPDATE products'));
    expect(updateCall.sql).toContain('is_active = TRUE');
  });
});