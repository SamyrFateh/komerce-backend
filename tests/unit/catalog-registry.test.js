'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const registry = require('../../services/catalog-registry');

function fixture(overrides = {}) {
  return {
    product_ref: 'KPR-42', name: 'Robe', supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-42', supplier_category: 'Kids > Dress',
    candidate_ref: 'SC-42', boutique_category_key: 'mode',
    boutique_subcategory_key: null, boutique_category_label: 'Mode',
    boutique_subcategory_label: null, lifecycle_status: 'candidate',
    source_ready: true, taxonomy_ready: false, editorial_ready: false,
    work_status: 'taxonomy_to_confirm', needs_review: true, is_active: false,
    ...overrides,
  };
}

test('un produit remis mais non vendable reste consultable avec plusieurs corrections', () => {
  expect(registry.details(fixture())).toMatchObject({
    product_ref: 'KPR-42', supplier_name: 'CJdropshipping',
    work_status: 'taxonomy_to_confirm',
    issues: ['taxonomy_to_confirm', 'editorial_to_complete'],
    is_active: false,
  });
});

test('une fiche classée et prête ne simule jamais une vente automatique', () => {
  expect(registry.details(fixture({
    taxonomy_ready: true, editorial_ready: true,
    work_status: 'approval_pending',
  }))).toMatchObject({ issues: ['approval_pending'], lifecycle_status: 'candidate' });
});

test('registre : joint uniquement les remises canoniques, sans clôture KIR ni prix local', async () => {
  const executor = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ total: 77 }] })
    .mockResolvedValueOnce({ rows: [fixture()] }) };
  const result = await registry.listRegistry({
    supplier: 'CJdropshipping', category: 'mode', subcategory: 'enfant',
    status: 'editorial_to_complete', search: 'Robe', offset: 50, limit: 50,
  }, executor);
  expect(result.page).toEqual({ total: 77, limit: 50, offset: 50,
    has_previous: true, has_next: true });
  const [countSql, countParams] = executor.query.mock.calls[0];
  const [pageSql, pageParams] = executor.query.mock.calls[1];
  expect(countSql).toContain("state = 'imported_to_catalog'");
  expect(countSql).not.toContain("run_status = 'COMPLETED'");
  expect(countSql).not.toContain("LOCAL_ACTIVE");
  expect(countSql).toContain('NOT editorial_ready');
  expect(countSql).toContain('boutique_category_key = $3');
  expect(countParams).toEqual(['%Robe%', 'CJdropshipping', 'mode', 'enfant']);
  expect(pageSql).toContain('LIMIT $5 OFFSET $6');
  expect(pageParams).toEqual(['%Robe%', 'CJdropshipping', 'mode', 'enfant', 50, 50]);
});

test('le filtre À classer trouve aussi un produit dont la source est incomplète', async () => {
  const executor = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ total: 1 }] })
    .mockResolvedValueOnce({ rows: [fixture({
      source_ready: false, work_status: 'source_to_normalize',
    })] }) };
  const result = await registry.listRegistry({ status: 'taxonomy_to_confirm' }, executor);
  expect(executor.query.mock.calls[0][0]).toContain('NOT taxonomy_ready');
  expect(result.products[0].issues).toEqual([
    'source_to_normalize', 'taxonomy_to_confirm', 'editorial_to_complete',
  ]);
});

test('pagination 0 résultat garde un total fiable', async () => {
  const executor = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ total: 0 }] })
    .mockResolvedValueOnce({ rows: [] }) };
  const result = await registry.listRegistry({ limit: 500 }, executor);
  expect(result.products).toEqual([]);
  expect(result.page).toMatchObject({ total: 0, limit: 100, has_next: false });
});

test('visuel : repli sur la photo fournisseur uniquement pour l’aperçu, sans certification', async () => {
  const executor = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ total: 1 }] })
    .mockResolvedValueOnce({ rows: [fixture({
      image_url: 'https://cdn.example.test/produit.jpg', supplier_image_preview: true,
    })] }) };
  const result = await registry.listRegistry({}, executor);
  const sql = executor.query.mock.calls[1][0];
  expect(sql).toContain("COALESCE(NULLIF(BTRIM(p.image_url), ''), NULLIF(BTRIM(sc.image_url), '')) AS image_url");
  expect(sql).toContain("state = 'imported_to_catalog'");
  expect(result.products[0]).toMatchObject({
    image_url: 'https://cdn.example.test/produit.jpg', supplier_image_preview: true,
    is_active: false, work_status: 'taxonomy_to_confirm',
  });
});


test('Catalogue opérateur : la liste finale exclut les travaux Raffinerie sans effacer le registre historique', async () => {
  const finalExecutor = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ total: 1 }] })
    .mockResolvedValueOnce({ rows: [fixture({
      lifecycle_status: 'active', is_active: true, work_status: 'catalog_approved',
      source_ready: true, taxonomy_ready: true, editorial_ready: true,
    })] }) };
  const final = await registry.listRegistry({ finalized_only: true }, finalExecutor);
  expect(final.page.total).toBe(1);
  expect(final.products[0].work_status).toBe('catalog_approved');
  expect(finalExecutor.query.mock.calls[0][0]).toContain("work_status = 'catalog_approved'");
  expect(finalExecutor.query.mock.calls[1][0]).toContain("work_status = 'catalog_approved'");

  const historicalExecutor = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ total: 1 }] })
    .mockResolvedValueOnce({ rows: [fixture()] }) };
  await registry.listRegistry({}, historicalExecutor);
  expect(historicalExecutor.query.mock.calls[0][0]).not.toContain(
    "WHERE work_status = 'catalog_approved'");
});
