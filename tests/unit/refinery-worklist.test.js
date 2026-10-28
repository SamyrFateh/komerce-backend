'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
const { buildRefineryWorklist, _test } = require('../../services/refinery-worklist');

beforeEach(() => { jest.clearAllMocks(); });

test('Raffinerie : un candidat avec origine éditoriale manquante est expliqué, pas déclaré prêt', () => {
  expect(_test.explainUnprepared({ content_source: null })).toEqual({
    code: 'content_source_missing',
    label: 'Source du contenu à qualifier',
    detail: 'Aucune origine éditoriale reconnue pour ce brouillon',
  });
  expect(_test.explainUnprepared({ content_source: 'legacy_unknown' })).toEqual({
    code: 'content_status_unrecognized',
    label: 'Statut de contenu à examiner',
    detail: 'État enregistré : legacy_unknown',
  });
});

test('Raffinerie : projection lecture seule, compteurs globaux séparés et pagination bornée', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    in_approval_queue: 5, unprepared_candidates: 2,
    active_products: 9, rejected_products: 1, handoff_already_active: 4,
  }] }).mockResolvedValueOnce({ rows: [{
    product_ref: 'KPR-12', name: 'Produit à qualifier',
    content_source: null, candidate_ref: 'KSC-12', supplier_name: 'CJ',
  }] });
  const result = await buildRefineryWorklist({ refinery_limit: '300', refinery_offset: '0' });
  expect(result.scope).toBe('refinery_readonly_diagnostic');
  expect(result.coverage).toEqual({
    in_approval_queue: 5, unprepared_candidates: 2,
    active_products: 9, rejected_products: 1, handoff_already_active: 4,
  });
  expect(result.unprepared_page).toEqual({
    total: 2, limit: 50, offset: 0, has_previous: false, has_next: true,
  });
  expect(result.unprepared).toEqual([expect.objectContaining({
    product_ref: 'KPR-12', candidate_ref: 'KSC-12',
    reason: expect.objectContaining({ code: 'content_source_missing' }),
  })]);
  const [countSql] = mockQuery.mock.calls[0];
  const [rowsSql, args] = mockQuery.mock.calls[1];
  expect(countSql).toContain("p.lifecycle_status = 'candidate'");
  expect(countSql).toContain('p.is_active = FALSE');
  expect(countSql).toContain("c.state = 'imported_to_catalog'");
  expect(rowsSql).toContain('p.content_source IS NULL');
  expect(rowsSql).not.toContain('UPDATE ');
  expect(rowsSql).not.toContain('INSERT ');
  expect(args).toEqual([50, 0]);
});

test('Raffinerie : un zéro ne simule pas la présence de produits à préparer', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  const data = await buildRefineryWorklist({});
  expect(data.coverage.in_approval_queue).toBe(0);
  expect(data.coverage.unprepared_candidates).toBe(0);
  expect(data.unprepared).toEqual([]);
  expect(data.unprepared_page.has_next).toBe(false);
});
