'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  BASE_URL: 'https://developers.cjdropshipping.com/api2.0/v1',
  getAccessToken: jest.fn().mockResolvedValue('token'),
}));

const cjConnector = require('../../services/suppliers/connectors/cj-connector');
const { flattenCategories, fetchCategories } = require('../../services/suppliers/cj-catalog-index');

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('cj-catalog-index', () => {
  test('aplatit les catégories CJ jusqu’aux feuilles niveau 3', () => {
    const rows = flattenCategories([
      {
        categoryFirstName: 'Computer & Office',
        categoryFirstList: [
          {
            categorySecondName: 'Office Electronics',
            categorySecondList: [
              { categoryId: 'leaf-1', categoryName: 'Office & School Supplies' },
              { categoryId: 'leaf-2', categoryName: 'Printers' },
            ],
          },
        ],
      },
    ]);
    expect(rows).toEqual([
      {
        category_id: 'leaf-1',
        level1: 'Computer & Office',
        level2: 'Office Electronics',
        level3: 'Office & School Supplies',
        path: 'Computer & Office > Office Electronics > Office & School Supplies',
      },
      expect.objectContaining({ category_id: 'leaf-2', level3: 'Printers' }),
    ]);
  });

  test('récupère l’index avec CJ-Access-Token sans exposer la clé API', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      code: 200,
      result: true,
      data: [{
        categoryFirstName: 'Home',
        categoryFirstList: [{
          categorySecondName: 'Kitchen',
          categorySecondList: [{ categoryId: 'kitchen-1', categoryName: 'Blenders' }],
        }],
      }],
      requestId: 'req-cat',
    }));

    const result = await fetchCategories({ fetchImpl, env: { CJ_API_KEY: 'hidden' } });
    expect(result.total).toBe(1);
    expect(result.categories[0]).toMatchObject({ category_id: 'kitchen-1', level3: 'Blenders' });
    expect(cjConnector.getAccessToken).toHaveBeenCalled();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/product\/getCategory$/);
    expect(options.headers['CJ-Access-Token']).toBe('token');
    expect(url).not.toContain('hidden');
  });

  test('refuse une réponse catégorie vide', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ code: 200, result: true, data: [] }));
    await expect(fetchCategories({ fetchImpl })).rejects.toThrow(/aucune catégorie feuille/i);
  });
});
