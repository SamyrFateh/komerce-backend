'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  DUMMY_URL,
  PLATZI_URL,
  collectPrimaryPool,
} = require('../../scripts/showcase-curate-staging-500-primary');

describe('showcase-curate-staging-500-primary', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('le chemin critique utilise seulement DummyJSON et Platzi, jamais Wikimedia', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === DUMMY_URL) {
        return {
          ok: true,
          json: async () => ({
            products: [{
              id: 1,
              title: 'Beauty Cream',
              description: 'A useful beauty cream for everyday care and testing.',
              category: 'beauty',
              price: 15,
              discountPercentage: 10,
              thumbnail: 'https://cdn.example.test/dummy-1.jpg',
              images: ['https://cdn.example.test/dummy-1.jpg'],
            }],
          }),
        };
      }
      if (url === PLATZI_URL) {
        return {
          ok: true,
          json: async () => [{
            id: 2,
            title: 'Wireless Speaker',
            description: 'An electronics item for a realistic staging catalogue.',
            price: 40,
            category: { name: 'Electronics' },
            images: ['https://cdn.example.test/platzi-2.jpg'],
          }],
        };
      }
      throw new Error(`source inattendue: ${url}`);
    });

    const pool = await collectPrimaryPool();
    expect(pool).toHaveLength(2);
    expect(pool.map((row) => row.source)).toEqual(['dummyjson:1', 'platzi:2']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([DUMMY_URL, PLATZI_URL]);
  });
});
