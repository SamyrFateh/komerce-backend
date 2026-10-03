/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

jest.mock('../../db', () => ({
  getClient: jest.fn(),
}));

const backfill = require('../../scripts/catalog-taxonomy-provenance-backfill');

function row(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    product_ref: 'KPR-131959',
    name: 'Jupe bouffante en coton blanc',
    category: 'enfants',
    subcategory: null,
    boutique_category_key: null,
    boutique_subcategory_key: null,
    supplier_name: 'CJdropshipping',
    supplier_product_id: 'cj-1',
    segment_id: 'mode-enfant',
    target_category: 'Mode & Beauté',
    target_subcategory: 'Enfant',
    ...overrides,
  };
}

describe('catalog-taxonomy-provenance-backfill', () => {
  test('provenanceFor ne déduit jamais la taxonomie depuis le titre ou category historique', () => {
    expect(backfill.provenanceFor(row({
      name: 'Kids skirt',
      category: 'enfants',
      target_category: null,
      target_subcategory: null,
    }))).toEqual({
      category: null,
      subcategory: null,
      segment_id: 'mode-enfant',
      source: null,
      evidence: null,
    });
  });

  test('la provenance discovery reste prioritaire sur tout fallback historique', () => {
    expect(backfill.provenanceFor(row({
      import_ref: 'KSI-000244',
      supplier_category: "Women's Clothing > Tops & Sets > Lady Dresses",
      target_category: 'Mode & Beauté',
      target_subcategory: 'Enfant',
    }))).toMatchObject({
      category: 'Mode & Beauté',
      subcategory: 'Enfant',
      source: 'discovery',
      evidence: 'raw_payload.discovery',
    });
  });

  test.each([
    ["Women's Clothing > Tops & Sets > Lady Dresses", 'Mode & Beauté', 'Femme'],
    ["Men's Clothing > Bottoms > Man Shorts", 'Mode & Beauté', 'Homme'],
    ['Toys, Kids & Baby / Girls Clothing / Family Matching Outfits', 'Mode & Beauté', 'Enfant'],
  ])('fallback historique KSI-000244 classe la catégorie fournisseur %s', (supplierCategory, category, subcategory) => {
    expect(backfill.provenanceFor(row({
      target_category: null,
      target_subcategory: null,
      segment_id: null,
      import_ref: 'KSI-000244',
      supplier_category: supplierCategory,
    }))).toEqual({
      category,
      subcategory,
      segment_id: null,
      source: 'historical_supplier_category',
      evidence: supplierCategory,
    });
  });

  test('fallback historique ne s applique ni à un autre batch ni à une famille inconnue', () => {
    expect(backfill.historicalSupplierProvenanceFor(row({
      import_ref: 'KSI-999999',
      supplier_category: "Women's Clothing > Tops & Sets > Lady Dresses",
    }))).toBeNull();
    expect(backfill.historicalSupplierProvenanceFor(row({
      import_ref: 'KSI-000244',
      supplier_category: 'Pet Supplies > Dogs',
    }))).toBeNull();
  });

  test('inspectCandidate accepte uniquement une paire active issue de la provenance', async () => {
    const mutation = {
      resolveBoutiqueTaxonomy: jest.fn().mockResolvedValue({
        category: 'Mode & Beauté',
        subcategory: 'Enfant',
      }),
    };
    const q = {};

    await expect(backfill.inspectCandidate(q, mutation, row())).resolves.toMatchObject({
      status: 'READY',
      normalized: { category: 'Mode & Beauté', subcategory: 'Enfant' },
    });
    expect(mutation.resolveBoutiqueTaxonomy).toHaveBeenCalledWith(
      q,
      'Mode & Beauté',
      'Enfant'
    );
  });

  test('un conflit avec une clé Boutique existante bloque sans appeler le writer', async () => {
    const mutation = { resolveBoutiqueTaxonomy: jest.fn() };

    await expect(backfill.inspectCandidate({}, mutation, row({
      boutique_category_key: 'Maison',
    }))).resolves.toMatchObject({
      status: 'BLOCKED',
      reason: 'existing_category_conflict',
    });
    expect(mutation.resolveBoutiqueTaxonomy).not.toHaveBeenCalled();
  });

  test('inspectCandidate valide le fallback historique contre la taxonomie Boutique active', async () => {
    const mutation = {
      resolveBoutiqueTaxonomy: jest.fn().mockResolvedValue({
        category: 'Mode & Beauté',
        subcategory: 'Femme',
      }),
    };
    const candidate = row({
      target_category: null,
      target_subcategory: null,
      segment_id: null,
      import_ref: 'KSI-000244',
      supplier_category: "Women's Clothing > Tops & Sets > Lady Dresses",
    });

    await expect(backfill.inspectCandidate({}, mutation, candidate)).resolves.toMatchObject({
      status: 'READY',
      provenance: {
        category: 'Mode & Beauté',
        subcategory: 'Femme',
        source: 'historical_supplier_category',
      },
    });
    expect(mutation.resolveBoutiqueTaxonomy).toHaveBeenCalledWith(
      {},
      'Mode & Beauté',
      'Femme'
    );
  });

  test('dry-run ne fait aucune mutation', async () => {
    const client = {
      query: jest.fn().mockResolvedValueOnce({ rows: [row()] }),
      release: jest.fn(),
    };
    const rootDb = { getClient: jest.fn().mockResolvedValue(client) };
    const mutation = {
      resolveBoutiqueTaxonomy: jest.fn().mockResolvedValue({
        category: 'Mode & Beauté',
        subcategory: 'Enfant',
      }),
      assignBoutiqueTaxonomy: jest.fn(),
    };

    const result = await backfill.runBackfill(
      { apply: false, expect: 1, productRefs: [] },
      rootDb,
      mutation
    );

    expect(result).toMatchObject({ mode: 'dry-run', total: 1, ready: 1 });
    expect(mutation.assignBoutiqueTaxonomy).not.toHaveBeenCalled();
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain('BEGIN');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('apply est transactionnel, utilise l autorité Catalog et audite la paire écrite', async () => {
    const candidate = row();
    const client = {
      query: jest.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return {};
        if (String(sql).includes('FROM products p')) return { rows: [candidate] };
        if (String(sql).includes('WHERE id = ANY')) {
          return { rows: [{
            id: candidate.id,
            product_ref: candidate.product_ref,
            boutique_category_key: 'Mode & Beauté',
            boutique_subcategory_key: 'Enfant',
          }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }),
      release: jest.fn(),
    };
    const rootDb = { getClient: jest.fn().mockResolvedValue(client) };
    const mutation = {
      resolveBoutiqueTaxonomy: jest.fn().mockResolvedValue({
        category: 'Mode & Beauté',
        subcategory: 'Enfant',
      }),
      assignBoutiqueTaxonomy: jest.fn().mockResolvedValue({
        id: candidate.id,
        boutique_category_key: 'Mode & Beauté',
        boutique_subcategory_key: 'Enfant',
      }),
    };

    const result = await backfill.runBackfill(
      { apply: true, expect: 1, productRefs: [] },
      rootDb,
      mutation
    );

    expect(result).toMatchObject({
      mode: 'apply',
      total: 1,
      ready: 1,
      audit: { checked: 1, correct: 1 },
    });
    expect(mutation.assignBoutiqueTaxonomy).toHaveBeenCalledWith(
      client,
      candidate.id,
      'Mode & Beauté',
      'Enfant'
    );
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });

  test('apply rollbacke tout si une provenance est absente', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return {};
        if (String(sql).includes('FROM products p')) {
          return { rows: [row({ target_subcategory: null })] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }),
      release: jest.fn(),
    };
    const rootDb = { getClient: jest.fn().mockResolvedValue(client) };
    const mutation = {
      resolveBoutiqueTaxonomy: jest.fn(),
      assignBoutiqueTaxonomy: jest.fn(),
    };

    await expect(backfill.runBackfill(
      { apply: true, expect: 1, productRefs: [] },
      rootDb,
      mutation
    )).rejects.toThrow('CATALOG_TAXONOMY_BACKFILL_BLOCKED');

    expect(mutation.assignBoutiqueTaxonomy).not.toHaveBeenCalled();
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });
});
