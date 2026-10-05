'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockInvalidate = jest.fn();
jest.mock('../../utils/categories-cache', () => ({
  invalidateCategoriesCache: (...args) => mockInvalidate(...args),
}));
jest.mock('../../db', () => ({ query: jest.fn() }));

const mockAudit = jest.fn().mockResolvedValue({ id: 'audit-1' });
jest.mock('../../services/catalog-taxonomy-audit', () => ({
  recordTaxonomyMutation: (...args) => mockAudit(...args),
}));

const {
  TaxonomyAdminError,
  createCategory,
  updateSubcategory,
  deactivateSubcategory,
} = require('../../services/boutique-taxonomy-admin');

describe('boutique-taxonomy-admin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse une création sans identité métier minimale', async () => {
    await expect(createCategory({ label: 'Maison' }, { query: jest.fn() }))
      .rejects.toMatchObject({ name: 'TaxonomyAdminError', status: 400 });
  });

  it('crée une catégorie, applique les defaults et invalide le cache', async () => {
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ key: 'maison', label: 'Maison' }] }),
    };

    const row = await createCategory({ key: 'maison', label: 'Maison' }, q);

    expect(row).toEqual({ key: 'maison', label: 'Maison', subcategories: [] });
    expect(q.query.mock.calls[1][1]).toEqual([
      'maison', 'Maison', 'Maison', '📦', null, [], null, 99,
      true, true, true, null, null, null,
    ]);
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      q,
      expect.objectContaining({
        action: 'CATEGORY_CREATED',
        entityType: 'category',
        categoryKey: 'maison',
        before: null,
        after: expect.objectContaining({ key: 'maison', label: 'Maison' }),
      })
    );
  });

  it('refuse une mutation de sous-catégorie sans champ autorisé', async () => {
    await expect(updateSubcategory('maison', 'deco', { ignored: true }, { query: jest.fn() }))
      .rejects.toBeInstanceOf(TaxonomyAdminError);
  });

  it('paramètre les UPDATE de sous-catégorie et audite le snapshot avant/après', async () => {
    const before = { category_key: 'maison', key: 'deco', label: 'Déco' };
    const after = { category_key: 'maison', key: 'deco', label: 'Décoration' };
    const q = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [before] })
        .mockResolvedValueOnce({ rows: [after] }),
    };

    const actor = { id: '11111111-1111-4111-8111-111111111111', role: 'admin', source_surface: 'test' };
    const result = await updateSubcategory('maison', 'deco', { label: 'Décoration' }, q, actor);

    expect(result).toEqual(after);
    expect(q.query.mock.calls[1][0]).toContain('SET label = $1');
    expect(q.query.mock.calls[1][0]).toContain('WHERE category_key = $2 AND key = $3');
    expect(q.query.mock.calls[1][1]).toEqual(['Décoration', 'maison', 'deco']);
    expect(mockAudit).toHaveBeenCalledWith(q, expect.objectContaining({
      action: 'SUBCATEGORY_UPDATED',
      before,
      after,
      actor,
    }));
  });

  it('distingue désactivation et hard delete et conserve la preuve avant/après', async () => {
    const before = { category_key: 'maison', key: 'deco', is_active: true };
    const deleted = { category_key: 'maison', key: 'deco', is_active: true };
    const q = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [{ ...deleted, before_snapshot: before }],
      }),
    };
    const actor = { id: '11111111-1111-4111-8111-111111111111', role: 'admin', source_surface: 'test' };
    const result = await deactivateSubcategory('maison', 'deco', { hard: true }, q, actor);

    expect(q.query.mock.calls[0][0]).toContain('DELETE FROM boutique_subcategories');
    expect(q.query.mock.calls[0][1]).toEqual(['maison', 'deco']);
    expect(result).toEqual({ deleted: true, subcategory: deleted });
    expect(mockAudit).toHaveBeenCalledWith(q, expect.objectContaining({
      action: 'SUBCATEGORY_DELETED',
      entityType: 'subcategory',
      categoryKey: 'maison',
      subcategoryKey: 'deco',
      actor,
      before,
      after: null,
    }));
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});
