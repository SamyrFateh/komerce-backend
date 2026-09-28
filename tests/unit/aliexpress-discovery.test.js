'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const discovery = require('../../services/suppliers/aliexpress-discovery');

describe('aliexpress-source-discovery', () => {
  test('découvre feeds/catégories puis choisit la première surface réellement productrice', async () => {
    const invokeTop = jest.fn(async (method, params) => {
      if (method === 'aliexpress.ds.feedname.get') {
        return {
          resp_result: {
            result: {
              promos: {
                promo: [
                  { promo_name: 'Empty feed' },
                  { promo_name: 'Hot sale' },
                ],
              },
            },
          },
        };
      }
      if (method === 'aliexpress.ds.category.get') {
        return {
          result: {
            result: {
              categories: {
                category: [
                  { category_id: 21, category_name: 'Sports' },
                ],
              },
            },
          },
        };
      }
      if (method === 'aliexpress.ds.recommend.feed.get' && params.feed_name === 'Empty feed') {
        return { resp_result: { result: { products: [] } } };
      }
      if (method === 'aliexpress.ds.recommend.feed.get' && params.feed_name === 'Hot sale') {
        return {
          resp_result: {
            result: {
              opaque_products: {
                rows: [
                  { itemId: '100000000001' },
                  { product_id: '100000000002' },
                ],
              },
            },
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });

    await expect(discovery.discoverAcquisitionPlan({
      invokeTop,
      countryCode: 'AE',
      pageSize: 20,
      maxProbes: 4,
    })).resolves.toMatchObject({
      status: 'READY',
      provider: 'aliexpress',
      strategy: 'feed-category',
      version: 'aliexpress-ds-discovery-v1',
      pull_options: {
        page: 1,
        size: 20,
        country_code: 'AE',
        sort: 'volumeDesc',
        feed_name: 'Hot sale',
      },
      evidence: {
        feeds_discovered: 2,
        categories_discovered: 1,
        probes: 2,
        selected_feed: 'Hot sale',
        probe_product_count: 2,
      },
    });

    expect(invokeTop).toHaveBeenCalledWith('aliexpress.ds.feedname.get', {});
    expect(invokeTop).toHaveBeenCalledWith('aliexpress.ds.category.get', {});
  });

  test('utilise le même plan feed puis feed x catégorie que les scripts historiques', () => {
    const feeds = Array.from({ length: 90 }, (_, i) => `feed-${i + 1}`);
    const categories = Array.from({ length: 60 }, (_, i) => ({
      id: String(i + 1),
      name: `cat-${i + 1}`,
    }));
    const slots = discovery.planSlots(feeds, categories);
    expect(slots).toHaveLength((80 * 2) + (48 * 3));
    expect(slots[0]).toEqual({ feed: 'feed-1', page: 1, categoryId: null, categoryName: null });
    expect(slots[160]).toEqual({ feed: 'feed-1', page: 1, categoryId: '1', categoryName: 'cat-1' });
  });

  test('échoue fermé avec preuve si aucune surface testée ne retourne de produit', async () => {
    const invokeTop = jest.fn(async (method) => {
      if (method === 'aliexpress.ds.feedname.get') {
        return { result: { promos: { promo: [{ promo_name: 'Empty feed' }] } } };
      }
      if (method === 'aliexpress.ds.category.get') {
        return { result: { categories: { category: [] } } };
      }
      if (method === 'aliexpress.ds.recommend.feed.get') {
        return { result: { products: [] } };
      }
      throw new Error('unexpected method');
    });

    await expect(discovery.discoverAcquisitionPlan({
      invokeTop,
      maxProbes: 2,
    })).rejects.toMatchObject({
      code: 'ALIEXPRESS_DISCOVERY_EMPTY',
      details: {
        feeds: 1,
        categories: 0,
        probes: 2,
      },
    });
  });

  test('un résultat vide fournisseur est un probe vide, pas une panne du Discovery', async () => {
    let probes = 0;
    const invokeTop = jest.fn(async (method, params) => {
      if (method === 'aliexpress.ds.feedname.get') {
        return { result: { promos: { promo: [{ promo_name: 'A' }, { promo_name: 'B' }] } } };
      }
      if (method === 'aliexpress.ds.category.get') {
        return { result: { categories: { category: [] } } };
      }
      if (method === 'aliexpress.ds.recommend.feed.get') {
        probes += 1;
        if (params.feed_name === 'A') throw new Error('[AliExpress] The result is empty');
        return { result: { rows: [{ product_id: '100000000003' }] } };
      }
      throw new Error('unexpected');
    });

    const plan = await discovery.discoverAcquisitionPlan({ invokeTop, maxProbes: 3 });
    expect(probes).toBe(2);
    expect(plan.pull_options.feed_name).toBe('B');
  });
});
