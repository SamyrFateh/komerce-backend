'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * services/dashboard-metrics/costing.js — contrat « inconnu ≠ zéro » (complète dashboard-metrics.test.js).
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const { getCoutEstime, getCoutReel, getMargeConsolidee } = require('../../services/dashboard-metrics/costing');

beforeEach(() => db.query.mockReset());

test('coût estimé inconnu = null, zéro mesuré = 0', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ value: null, items_with_data: 0, items_total: 2 }] });
  expect((await getCoutEstime({})).value).toBeNull();
  db.query.mockResolvedValueOnce({ rows: [{ value: '0', items_with_data: 2, items_total: 2 }] });
  expect((await getCoutEstime({})).value).toBe(0);
});

test('coût réel sans allocation = null, jamais COALESCE à zéro', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ value: null, items_with_data: 0, items_total: 2 }] });
  expect((await getCoutReel({})).value).toBeNull();
  expect(db.query.mock.calls[0][0]).not.toMatch(/COALESCE\(SUM\(alc\.amount_kmf\), 0\)/);
});

test('marge consolidée sans commande finalisée = null', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ margin_kmf: null, revenue_kmf: null, items_with_data: 0, items_total: 2 }] });
  expect((await getMargeConsolidee({})).value).toBeNull();
});
