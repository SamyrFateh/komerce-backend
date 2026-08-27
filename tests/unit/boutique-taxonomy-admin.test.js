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
  });

  it('refuse une mutation de sous-catégorie sans champ autorisé', async () => {
    await expect(updateSubcategory('maison', 'deco', { ignored: true }, { query: jest.fn() }))
      .rejects.toBeInstanceOf(TaxonomyAdminError);
  });

  it('distingue désactivation et hard delete sans changer l’identité métier', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows: [{ category_key: 'maison', key: 'deco' }] }) };
    const result = await deactivateSubcategory('maison', 'deco', { hard: true }, q);

    expect(q.query.mock.calls[0][0]).toContain('DELETE FROM boutique_subcategories');
    expect(q.query.mock.calls[0][1]).toEqual(['maison', 'deco']);
    expect(result).toEqual({ deleted: true, subcategory: { category_key: 'maison', key: 'deco' } });
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});
