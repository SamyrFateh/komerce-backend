'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  getCheckpoint,
  recordPageSuccess,
  recordError,
  summarize,
} = require('../../services/suppliers/catalog-sync-checkpoint');

describe('catalog-sync-checkpoint', () => {
  test('getCheckpoint scope la lecture par supplier, syncKey et catégorie', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'cp1' }] }) };

    await expect(getCheckpoint(q, {
      supplierName: 'CJ', syncKey: 'full', categoryId: 'cat1',
    })).resolves.toEqual({ id: 'cp1' });

    expect(q.query).toHaveBeenCalledWith(expect.stringContaining('supplier_catalog_sync_checkpoints'), ['CJ', 'full', 'cat1']);
  });

  test('recordPageSuccess avance la page et borne les compteurs négatifs à zéro', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'cp1', completed: false }] }) };

    await recordPageSuccess(q, {
      supplierName: 'CJ', syncKey: 'full', categoryId: 'cat1',
      page: 2, totalPages: 5, totalRecords: 100,
      accepted: -3, rejected: -9, requestId: 'req1',
    });

    expect(q.query.mock.calls[0][1]).toEqual([
      'CJ', 'full', 'cat1', 3, 5, 100, 0, 0, false, false, 'req1',
    ]);
  });

  test('recordPageSuccess marque completed sur la dernière page', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [{ completed: true }] }) };

    await recordPageSuccess(q, {
      supplierName: 'CJ', syncKey: 'full', categoryId: 'cat1',
      page: 5, totalPages: 5, totalRecords: 100,
    });

    expect(q.query.mock.calls[0][1][9]).toBe(true);
  });

  test('recordError tronque le message persistant à 2000 caractères', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await recordError(q, {
      supplierName: 'CJ', syncKey: 'full', categoryId: 'cat1', error: 'x'.repeat(2500),
    });
    expect(q.query.mock.calls[0][1][3]).toHaveLength(2000);
  });

  test('summarize retourne la projection agrégée du checkpoint', async () => {
    const summary = { categories: 3, completed_categories: 2, api_calls: 7 };
    const q = { query: jest.fn().mockResolvedValue({ rows: [summary] }) };
    await expect(summarize(q, { supplierName: 'CJ', syncKey: 'full' })).resolves.toBe(summary);
  });
});
