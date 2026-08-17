'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  upsertCandidateFromCatalogImport,
  archiveMissingCandidatesFromCatalogImport,
} = require('../../services/sourcing-candidate-import-service');

function baseInput() {
  return {
    importId: 'import-1',
    supplierName: 'Supplier',
    product: {
      supplier_product_id: 'sku-1',
      product_name: 'Produit',
      supplier_category: 'Mode',
      purchase_price: 10,
      currency: 'AED',
      image_url: 'https://img',
      product_url: 'https://product',
      description: 'desc',
      stock_available: 4,
      min_order_qty: 1,
      supplier_delay_days: 5,
      weight_kg: 0.5,
      dimensions: { l_cm: 10, w_cm: 20, h_cm: 3 },
      raw_payload: { source: true },
    },
    normalized: {
      komerce_category: 'mode',
      estimated_weight_kg: 0.5,
      estimated_volume_m3: 0.001,
      purchase_price_kmf: 1400,
      target_margin_pct: 40,
      data_sources: { purchase_price: 'auto' },
    },
    normalizedSourceContract: { version: 2 },
    scan: {
      scan_result: { score: 1 },
      sourcing_decision: 'KEEP',
      reason: 'ok',
      recommended_action: 'import',
      confidence: 'high',
    },
    verdict: { layer: 'none', label: 'Eligible' },
    autoState: 'scanned',
    autoRejectedReason: null,
    userId: 'admin-1',
  };
}

describe('sourcing-candidate-import-service', () => {
  it('upserts a new candidate without emitting a correction event', async () => {
    const q = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{ id: 'cand-1', was_updated: false, data_sources: { purchase_price: 'auto' } }],
      }),
    };

    await expect(upsertCandidateFromCatalogImport(q, baseInput())).resolves.toEqual({
      row: expect.objectContaining({ id: 'cand-1' }),
      wasUpdated: false,
    });

    expect(q.query).toHaveBeenCalledTimes(1);
    expect(q.query.mock.calls[0][0]).toContain('INSERT INTO sourcing_candidates');
    expect(q.query.mock.calls[0][0]).toContain('ON CONFLICT (supplier_name, supplier_product_id)');
    expect(q.query.mock.calls[0][0]).toContain("data_sources->>'purchase_price'");
  });

  it('preserves manual locks and records the same re-import audit event', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'cand-1',
            was_updated: true,
            data_sources: { purchase_price: 'manual', weight: 'auto', category: 'manual' },
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const result = await upsertCandidateFromCatalogImport(q, baseInput());

    expect(result.wasUpdated).toBe(true);
    expect(q.query).toHaveBeenCalledTimes(2);
    expect(q.query.mock.calls[1][0]).toContain('INSERT INTO sourcing_candidate_events');
    expect(q.query.mock.calls[1][1][0]).toBe('cand-1');
    expect(JSON.parse(q.query.mock.calls[1][1][1])).toEqual({
      re_import: true,
      locked_manual_fields: ['purchase_price', 'category'],
    });
    expect(q.query.mock.calls[1][1][2]).toContain('purchase_price, category');
  });

  it('archives missing full-snapshot candidates and records one event per row', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [
            { id: 'cand-a', supplier_product_id: 'a', state: 'scanned' },
            { id: 'cand-b', supplier_product_id: 'b', state: 'watchlist' },
          ],
        })
        .mockResolvedValue({ rows: [] }),
    };

    await expect(archiveMissingCandidatesFromCatalogImport(q, {
      supplierName: 'Supplier',
      importedIds: ['kept'],
      userId: 'admin-1',
      importId: 'import-9',
    })).resolves.toBe(2);

    expect(q.query).toHaveBeenCalledTimes(3);
    expect(q.query.mock.calls[0][0]).toContain("SET state = 'archived'");
    expect(q.query.mock.calls[1][0]).toContain('INSERT INTO sourcing_candidate_events');
    expect(q.query.mock.calls[2][0]).toContain('INSERT INTO sourcing_candidate_events');
    expect(q.query.mock.calls[1][1][2]).toBe('Absent du full-snapshot import import-9');
  });
});
