'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { decisionSnapshot, recordCatalogPublicationDecision } = require('../../services/catalog-publication-decision-audit');

test('decisionSnapshot reste minimal et ne publie aucun payload fournisseur', () => {
  expect(decisionSnapshot({
    product_ref: 'KPR-1',
    lifecycle_status: 'candidate',
    is_active: false,
    is_available: true,
    needs_review: true,
    content_source: 'manual',
    raw_payload: { secret: true },
  })).toEqual({
    product_ref: 'KPR-1',
    lifecycle_status: 'candidate',
    is_active: false,
    is_available: true,
    needs_review: true,
    content_source: 'manual',
  });
});

test('recordCatalogPublicationDecision écrit acteur, raison et snapshots dans le journal owner', async () => {
  const q = {
    query: jest.fn().mockResolvedValue({ rows: [{ id: 'audit-1', created_at: '2026-10-05T00:00:00Z' }] }),
  };
  const before = { product_ref: 'KPR-1', lifecycle_status: 'candidate', is_active: false };
  const after = { product_ref: 'KPR-1', lifecycle_status: 'active', is_active: true, is_available: true };

  await recordCatalogPublicationDecision(q, {
    action: 'CATALOG_PRODUCT_APPROVED',
    productId: 'aaaaaaaa-0000-0000-0000-000000000001',
    productRef: 'KPR-1',
    actor: { id: 'bbbbbbbb-0000-0000-0000-000000000001', role: 'admin', source_surface: 'canonical_catalog_workspace' },
    reason: 'validation humaine',
    before,
    after,
  });

  expect(q.query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO catalog_publication_decision_audit'),
    expect.arrayContaining([
      'CATALOG_PRODUCT_APPROVED',
      'aaaaaaaa-0000-0000-0000-000000000001',
      'KPR-1',
      'bbbbbbbb-0000-0000-0000-000000000001',
      'admin',
      'canonical_catalog_workspace',
      'validation humaine',
    ])
  );
});
