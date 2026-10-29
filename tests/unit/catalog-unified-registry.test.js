'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

const { listUnified, publicRow } = require('../../services/catalog-unified-registry');

const originalCandidate = {
  record_kind: 'candidate',
  candidate_ref: 'SC-442',
  product_ref: null,
  name: 'Lampe fournisseur',
  supplier_name: 'CJdropshipping',
  supplier_product_id: 'CJ-442',
  supplier_category: 'Home > Lamp',
  candidate_state: 'raw_imported',
  source_ready: false,
  taxonomy_ready: null,
  editorial_ready: null,
  work_status: 'processing',
  operator_group: 'processing',
  is_active: false,
};

const canonical = {
  ...originalCandidate,
  record_kind: 'product',
  candidate_ref: 'SC-442',
  product_ref: 'KPR-442',
  lifecycle_status: 'candidate',
  source_ready: true,
  taxonomy_ready: false,
  editorial_ready: false,
  work_status: 'taxonomy_to_confirm',
  operator_group: 'correction',
};

function executor(groupRows, rows) {
  return {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: groupRows })
      .mockResolvedValueOnce({ rows }),
  };
}

test('un candidat non promu est visible, sans référence produit inventée ni faux défaut humain', () => {
  expect(publicRow(originalCandidate)).toMatchObject({
    record_kind: 'candidate', product_ref: null, candidate_ref: 'SC-442',
    work_status: 'processing', issues: [],
    is_active: false,
  });
});

test('un produit remis conserve ses défauts multiples sans réécrire ses statuts', () => {
  expect(publicRow(canonical)).toMatchObject({
    record_kind: 'product', product_ref: 'KPR-442',
    candidate_ref: 'SC-442', issues: [
      'taxonomy_to_confirm', 'editorial_to_complete',
    ],
  });
});

test('un candidat orphelin après handoff est un écart réel, jamais silencieusement oublié', () => {
  expect(publicRow({
    ...originalCandidate,
    candidate_state: 'imported_to_catalog',
    work_status: 'handoff_missing',
    operator_group: 'correction',
  })).toMatchObject({ issues: ['handoff_missing'] });
});

test('une approbation seulement supposée ne devient pas preuve auditée', () => {
  expect(publicRow({
    ...canonical, lifecycle_status: 'active', is_active: true,
    work_status: 'approval_unproven', operator_group: 'review', approval_audited: false,
  })).toMatchObject({ approval_audited: false, work_status: 'approval_unproven' });
  expect(publicRow({
    ...canonical, lifecycle_status: 'active', is_active: true,
    work_status: 'catalog_approved', operator_group: 'validated', approval_audited: true,
  })).toMatchObject({ approval_audited: true, work_status: 'catalog_approved' });
});

test('l’agrégat donne les compteurs serveur indépendants de la page', async () => {
  const q = executor([
    { operator_group: 'correction', count: 19 },
    { operator_group: 'review', count: 7 },
    { operator_group: 'validated', count: 1 },
    { operator_group: 'processing', count: 10 },
    { operator_group: 'excluded', count: 3 },
  ], [originalCandidate, canonical]);
  const result = await listUnified({ limit: 2, offset: 10 }, q);
  expect(result.groups).toEqual({
    correction: 19, review: 7, validated: 1, processing: 10, excluded: 3,
  });
  expect(result.page).toEqual({
    total: 40, limit: 2, offset: 10, has_previous: true, has_next: true,
  });
  expect(result.products).toHaveLength(2);
  const [countSql] = q.query.mock.calls[0];
  const [pageSql, pageParams] = q.query.mock.calls[1];
  expect(countSql).toContain('SELECT operator_group, COUNT(*)::int AS count');
  expect(pageSql).toContain('LEFT JOIN picked_source sc ON sc.product_id=p.id');
  expect(pageSql).toContain('DISTINCT ON (sc.product_id)');
  expect(pageSql).toContain('WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id=sc.product_id)');
  expect(pageSql).toContain('catalog_publication_decision_audit');
  expect(pageParams).toEqual([2, 10]);
  for (const [sql] of q.query.mock.calls) {
    expect(sql.trimStart()).toMatch(/^WITH /);
    expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE products|DELETE FROM products)\b/i);
  }
});

test('recherche, fournisseur, catégorie et filtre groupé s’appliquent aux deux sélections', async () => {
  const q = executor([{ operator_group: 'correction', count: 1 }], [canonical]);
  const result = await listUnified({
    search: 'Lampe', supplier: 'CJdropshipping', category: 'maison',
    subcategory: 'luminaire', status: 'correction', limit: 50,
  }, q);
  expect(result.page.total).toBe(1);
  const [countSql, countArgs] = q.query.mock.calls[0];
  const [pageSql, pageArgs] = q.query.mock.calls[1];
  expect(countSql).toContain('candidate_ref ILIKE $1');
  expect(countSql).toContain('supplier_name = $2');
  expect(countSql).toContain('boutique_category_key = $3');
  expect(countSql).toContain('boutique_subcategory_key = $4');
  expect(countSql).not.toContain('operator_group = $5');
  expect(pageSql).toContain('operator_group = $5');
  expect(pageSql).toContain('LIMIT $6 OFFSET $7');
  expect(countArgs).toEqual(['%Lampe%', 'CJdropshipping', 'maison', 'luminaire']);
  expect(pageArgs).toEqual([...countArgs, 'correction', 50, 0]);
});

test('statut arbitraire et pagination non fiable ne peuvent pas injecter de SQL', async () => {
  const q = executor([], []);
  const result = await listUnified({
    status: "validated'; DELETE FROM products;--",
    search: "x%' OR TRUE --", limit: 9999, offset: -99,
  }, q);
  expect(result.page).toMatchObject({ total: 0, limit: 100, offset: 0 });
  const [countSql, params] = q.query.mock.calls[0];
  expect(countSql).not.toContain('DELETE FROM');
  expect(countSql).not.toContain("operator_group =");
  expect(params).toEqual(["%x%' OR TRUE --%"]);
});

test('zéro ligne conserve un total fiable, sans produit artificiel', async () => {
  const q = executor([], []);
  const value = await listUnified({}, q);
  expect(value.page).toEqual({
    total: 0, limit: 50, offset: 0, has_previous: false, has_next: false,
  });
  expect(value.products).toEqual([]);
});

test('compteurs non filtrés par onglet : les autres files ne deviennent pas faussement vides', async () => {
  const q = executor([
    { operator_group: 'correction', count: 3 },
    { operator_group: 'review', count: 9 },
    { operator_group: 'validated', count: 7 },
  ], [canonical]);
  const result = await listUnified({ status: 'correction', limit: 50 }, q);
  expect(result.groups).toEqual({
    correction: 3, review: 9, validated: 7, processing: 0, excluded: 0,
  });
  expect(result.page.total).toBe(3);
  expect(q.query.mock.calls[0][0]).not.toContain('operator_group =');
  expect(q.query.mock.calls[1][0]).toContain('operator_group = $1');
  expect(q.query.mock.calls[1][1]).toEqual(['correction', 50, 0]);
});

test('image de prévisualisation et média canonique sont des preuves différentes', () => {
  expect(publicRow({ ...canonical, active_media_count:0, source_media_count:1,
    source_media_repairable:true, image_url:'https://supplier.example.org/lamp.jpg' }))
    .toMatchObject({media_status:'source_recoverable',issues:[
      'taxonomy_to_confirm','editorial_to_complete','media_missing']});
  expect(publicRow({ ...canonical, active_media_count:0, source_media_count:0,
    image_url:'https://supplier.example.org/lamp.jpg' }))
    .toMatchObject({media_status:'preview_only',issues:expect.arrayContaining(['media_missing'])});
  expect(publicRow({ ...canonical, active_media_count:1, source_media_count:1,
    source_media_repairable:true }))
    .toMatchObject({media_status:'canonical_ready',issues:[
      'taxonomy_to_confirm','editorial_to_complete']});
  expect(publicRow({ ...canonical, active_media_count:0, total_media_count:1,
    source_media_count:1, source_media_repairable:true }))
    .toMatchObject({media_status:'canonical_inactive_review',issues:expect.arrayContaining(['media_missing'])});
  expect(publicRow({ ...originalCandidate, active_media_count:0, source_media_count:1 }))
    .toMatchObject({media_status:'pre_handoff',issues:[]});
});
